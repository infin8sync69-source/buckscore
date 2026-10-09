import json
import logging
import os
import sys
from pathlib import Path
from typing import Callable, Optional

import aiohttp

import ipfs_endpoints
from rag.ipfs_store import IPFSKnowledgeStore
from config import IPFS_API_URL

log = logging.getLogger("bucks.tools.ipfs")


# ── Headless fallback: read cluster state straight off disk ──────────────────
# The /api/v0/bucks/* endpoints (dWeb index, cluster membership, shared files)
# are served ONLY by electron/ipfs-bridge.js, i.e. only while the browser
# window is open. Generic IPFS calls (add/cat) go to the Kubo daemon and keep
# working headless, so the agent used to end up half-functional in a way that
# looked arbitrary: it could upload to IPFS but "knew nothing" about the
# cluster the moment the UI closed.
#
# ipfs-node.js already persists all of this state as plain JSON, so the agent
# can read it directly as a degraded, read-only path. Writes still require the
# browser (they need the live libp2p node to gossip).
def _electron_user_data_dir() -> Optional[Path]:
    """Electron's userData dir for this app, per platform."""
    app = "bucks-browser"
    home = Path.home()
    if sys.platform == "darwin":
        p = home / "Library" / "Application Support" / app
    elif os.name == "nt":
        base = os.environ.get("APPDATA")
        p = Path(base) / app if base else home / "AppData" / "Roaming" / app
    else:
        base = os.environ.get("XDG_CONFIG_HOME")
        p = (Path(base) if base else home / ".config") / app
    return p if p.is_dir() else None


def _read_local_state(filename: str):
    """Read one persisted ipfs-data JSON file, or None if unavailable."""
    root = _electron_user_data_dir()
    if not root:
        return None
    f = root / "ipfs-data" / filename
    try:
        if not f.is_file() or f.stat().st_size == 0:
            return None
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning("local state read failed for %s: %s", filename, e)
        return None


async def _bucks_bridge_request(path: str, payload: Optional[dict] = None) -> Optional[dict]:
    """
    Call a /api/v0/bucks/* extension endpoint on the browser's IPFS bridge
    (electron/ipfs-bridge.js). Only the bridge answers these, so probe the
    manifest-declared bridge URL first, then the other candidates.
    """
    candidates = []
    bridge = ipfs_endpoints.bridge_url()
    if bridge:
        candidates.append(bridge)
    for api in ipfs_endpoints.candidate_api_urls():
        if api not in candidates:
            candidates.append(api)

    async with aiohttp.ClientSession() as session:
        for base in candidates:
            try:
                kwargs = {"timeout": aiohttp.ClientTimeout(total=10)}
                if payload is not None:
                    kwargs["json"] = payload
                async with session.post(f"{base}{path}", **kwargs) as resp:
                    if resp.status in (404, 405):
                        continue  # a real Kubo daemon — no bucks extensions
                    body = await resp.json(content_type=None)
                    if resp.status == 200:
                        return body
                    log.warning("Bridge %s%s returned %s: %s", base, path, resp.status, body)
                    return None
            except Exception:
                continue
    return None


async def ipfs_upload_text(text: str) -> str:
    """
    Upload text content (documents, pages, scripts) to IPFS.
    Returns: CID of the uploaded content.
    """
    try:
        store = IPFSKnowledgeStore(IPFS_API_URL)
        cid = await store.publish_fragment(text)
        if cid:
            log.info(f"Successfully uploaded text to IPFS. CID: {cid}")
            return f"✓ Successfully uploaded to IPFS. CID: {cid}"
        return "Error: IPFS upload failed."
    except Exception as e:
        log.error(f"IPFS upload failed: {e}")
        return f"Error: {e}"


async def ipfs_cat_text(cid: str) -> str:
    """
    Fetch and read text content from an IPFS CID.
    """
    try:
        store = IPFSKnowledgeStore(IPFS_API_URL)
        # Try fetching as a structured JSON fragment first
        frag = await store.fetch_fragment(cid)
        if frag and isinstance(frag, dict) and "text" in frag:
            return frag["text"]
        elif frag:
            # Fallback to entire JSON if not formatted as a standard fragment
            import json
            return json.dumps(frag)
        
        # Fallback to raw text fetch (for normal documents/files)
        raw_text = await store.fetch_raw(cid)
        if raw_text is not None:
            return raw_text

        return f"Error: Failed to fetch CID {cid} from IPFS."
    except Exception as e:
        log.error(f"IPFS fetch failed for {cid}: {e}")
        return f"Error: {e}"


async def dweb_publish(name: str, content: str, title: str = "", desc: str = "") -> str:
    """
    Publish a page (HTML or text) to the Bucks dWeb: stores it on IPFS via
    the browser's node and gossips it to the swarm's discovered-pages index,
    so other Bucks browsers can find it at bucks dweb / ipfs://<cid>.
    """
    result = await _bucks_bridge_request(
        "/api/v0/bucks/dweb/publish",
        {"name": name, "content": content, "title": title or name, "desc": desc},
    )
    if result and result.get("ok"):
        return (f"✓ Published '{name}' to the Bucks dWeb. CID: {result['cid']} "
                f"(viewable at ipfs://{result['cid']})")
    # Bridge unreachable (browser not running) — fall back to a plain IPFS
    # upload so the content is at least addressable, without swarm discovery.
    upload = await ipfs_upload_text(content)
    if upload.startswith("✓"):
        return (f"{upload}\nNote: the Bucks browser is not running, so the page was "
                f"stored on IPFS but NOT announced to the dWeb discovery index.")
    return "Error: could not reach the Bucks browser bridge or any IPFS node."


async def dweb_search(query: str) -> str:
    """
    Search the Bucks dWeb index — pages published and gossiped by Bucks
    browsers in the swarm. Returns names, titles and CIDs.
    """
    result = await _bucks_bridge_request(f"/api/v0/bucks/dweb/search?q={query}", {})
    if result is None:
        # Browser closed → fall back to the index ipfs-node.js persisted to
        # disk, filtering locally, rather than reporting "unavailable".
        index = _read_local_state("dweb-index.json")
        if index is None:
            return ("The dWeb index is unavailable: the Bucks browser isn't running "
                    "and no cached index was found on disk.")
        q = (query or "").lower().strip()
        items = [
            it for it in index
            if not q or any(q in str(it.get(f, "")).lower()
                            for f in ("name", "title", "desc", "cid"))
        ]
        # A narrow query matching nothing is a dead end for the model — it
        # tends to retry the same phrase. The index is small, so show what IS
        # available instead and let the model pick.
        if not items:
            if not index:
                return "The dWeb index is empty — nothing has been published to this swarm yet."
            lines = [f"No dWeb page matched '{query}'. The index currently holds "
                     f"{len(index)} page(s):"]
            items = index
        else:
            lines = [f"Found {len(items)} dWeb page(s) [cached index — browser not running]:"]
        for it in items[:20]:
            lines.append(f"- {it.get('name', '?')} — {it.get('title', '')} "
                         f"(CID: {it.get('cid', '?')}, ipfs://{it.get('cid', '?')})")
        # Small models stop here and describe the page from its title alone,
        # inventing content they never read. Spell out the next step.
        lines.append(
            "\n[NEXT STEP: this listing contains titles only, NOT page content. "
            "To describe what a page actually says you MUST call ipfs_cat_text "
            "with its CID. Do not guess or infer the contents from the title.]"
        )
        return "\n".join(lines)
    items = result.get("results", [])
    if not items:
        return f"No dWeb pages found for '{query}'."
    lines = [f"Found {len(items)} dWeb page(s):"]
    for it in items[:20]:
        lines.append(f"- {it.get('name', '?')} — {it.get('title', '')} "
                     f"(CID: {it.get('cid', '?')}, ipfs://{it.get('cid', '?')})")
    return "\n".join(lines)


async def ipfs_dynamic_load_tool(cid: str) -> str:
    """
    Fetch a Python script from IPFS and dynamically load/register it as an agent tool.
    The script must define a function 'get_tool_definition() -> dict' which returns:
    {
        'name': str,
        'description': str,
        'fn': Callable,
        'safe': bool (optional, defaults to True),
        'agent_mapping': str (optional, defaults to 'code')
    }
    """
    from tools.registry import register_dynamic_tool
    
    code = await ipfs_cat_text(cid)
    if code.startswith("Error:"):
        return f"Failed to retrieve tool code from IPFS: {code}"
    
    # Compile and execute the retrieved code in a localized dictionary
    local_scope = {}
    try:
        # We pass globals() to allow importing modules inside the script
        exec(code, globals(), local_scope)
    except Exception as e:
        log.error(f"Error compiling script from IPFS CID {cid}: {e}")
        return f"Error compiling script from IPFS: {e}"
    
    if "get_tool_definition" not in local_scope:
        return "Error: The IPFS script does not define the required 'get_tool_definition()' function."
    
    try:
        defn = local_scope["get_tool_definition"]()
        name = defn.get("name")
        desc = defn.get("description")
        fn = defn.get("fn")
        safe = defn.get("safe", True)
        agent_mapping = defn.get("agent_mapping", "code")
        
        if not name or not desc or not fn:
            return "Error: Invalid tool definition returned (missing name, description, or fn)."
            
        register_dynamic_tool(name, desc, fn, safe, agent_mapping)
        log.info(f"Successfully registered dynamic tool '{name}' from IPFS CID {cid}")
        return f"✓ Successfully loaded custom tool '{name}' from IPFS CID {cid}."
    except Exception as e:
        log.error(f"Error registering dynamic tool from IPFS CID {cid}: {e}")
        return f"Error registering dynamic tool: {e}"
