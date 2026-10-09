"""
Tool Registry — no crewai dependency.
Each tool is a plain async/sync callable with metadata.
"""
import re
import json
import time
import subprocess
import tempfile
import os
from pathlib import Path
from typing import Callable, Any
from urllib.parse import urljoin
import httpx
from bs4 import BeautifulSoup

# Anchored to this file's location (<repo>/agent/tools/registry.py → <repo>)
# rather than a hardcoded "~/Desktop/bucks core", which does not exist on the
# machine this ships from and made every file/shell tool fail. Must stay in
# sync with the identical default in file_tools.py and shell_tools.py.
BUCKS_ROOT = Path(
    os.environ.get("BUCKS_PROJECT_ROOT")
    or Path(__file__).resolve().parents[2]
)

# ── Tool descriptor ───────────────────────────────────────────────────────────

class Tool:
    def __init__(self, name: str, description: str, fn: Callable,
                 schema: dict = None, safe: bool = True):
        self.name        = name
        self.description = description
        self.fn          = fn
        self.schema      = schema or {}
        self.safe        = safe   # False = requires user confirmation

    async def run(self, **kwargs) -> str:
        import asyncio
        if asyncio.iscoroutinefunction(self.fn):
            return await self.fn(**kwargs)
        return self.fn(**kwargs)

    def to_dict(self):
        return {"name": self.name, "description": self.description, "safe": self.safe}


# ── Web tools ─────────────────────────────────────────────────────────────────

async def _ddg_html_search(query: str, max_results: int = 6) -> list[dict]:
    results = []
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            r = await client.post("https://html.duckduckgo.com/html/", data={"q": query}, headers=headers)
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, "html.parser")
                for div in soup.find_all("div", class_="result"):
                    a_title = div.find("a", class_="result__a")
                    snippet_elem = div.find(class_="result__snippet")
                    if a_title:
                        title = a_title.get_text().strip()
                        href = a_title.get("href", "")
                        body = snippet_elem.get_text().strip() if snippet_elem else ""
                        if href.startswith("/l/?"):
                            from urllib.parse import parse_qs, urlparse
                            parsed = parse_qs(urlparse(href).query)
                            if "uddg" in parsed:
                                href = parsed["uddg"][0]
                        results.append({"title": title, "href": href, "body": body})
                        if len(results) >= max_results:
                            break
    except Exception:
        pass
    return results


# Attribute order inside a <meta> tag is arbitrary — some sites emit
# content= before property=, so match the whole tag and pull content out after.
_OG_RE = re.compile(
    r'<meta[^>]+(?:property|name)\s*=\s*["\'](?:og:image(?::secure_url|:url)?'
    r'|twitter:image(?::src)?)["\'][^>]*>',
    re.I,
)
_LINK_IMG_RE = re.compile(r'<link[^>]+rel\s*=\s*["\']image_src["\'][^>]*>', re.I)
_CONTENT_RE = re.compile(r'content\s*=\s*["\']([^"\']+)["\']', re.I)
_HREF_RE = re.compile(r'href\s*=\s*["\']([^"\']+)["\']', re.I)
_JSONLD_IMG_RE = re.compile(r'"image"\s*:\s*(?:\{[^}]*?"url"\s*:\s*)?"(https?://[^"]+)"', re.I)

# A full browser header set — several publishers (phys.org among them) 403 a
# request that carries only a User-Agent.
_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,"
              "image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}


def _abs_url(src: str, base: str) -> str:
    src = (src or "").strip()
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("/"):
        return urljoin(base, src)
    return src if src.startswith("http") else ""


async def _og_thumbnail(client, url: str) -> str:
    """Best-effort share image for one result. Never raises.

    Tries og:image, then twitter:image, then <link rel=image_src>, then a
    JSON-LD "image" — in that order of reliability. Reads only the head of the
    response; social meta tags live in <head>, so pulling a whole article down
    for a thumbnail would be wasted bandwidth.
    """
    try:
        async with client.stream("GET", url, headers=_BROWSER_HEADERS,
                                 timeout=4.0, follow_redirects=True) as r:
            if r.status_code >= 400:
                return ""
            if "html" not in r.headers.get("content-type", "").lower():
                return ""
            head = ""
            async for chunk in r.aiter_text(16384):
                head += chunk
                # </head> means every meta tag we care about has been seen.
                if len(head) > 96000 or "</head" in head.lower():
                    break

        for tag in _OG_RE.findall(head):
            m = _CONTENT_RE.search(tag)
            if m and (src := _abs_url(m.group(1), url)):
                return src
        for tag in _LINK_IMG_RE.findall(head):
            m = _HREF_RE.search(tag)
            if m and (src := _abs_url(m.group(1), url)):
                return src
        if m := _JSONLD_IMG_RE.search(head):
            if src := _abs_url(m.group(1), url):
                return src
    except Exception:
        pass
    return ""


_YT_ID_RE = re.compile(
    r'(?:youtube\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/)|youtu\.be/)'
    r'([A-Za-z0-9_-]{11})', re.I)
_VIMEO_ID_RE = re.compile(r'vimeo\.com/(?:video/)?(\d{6,})', re.I)


def _derived_media(url: str) -> tuple[str, str]:
    """(thumbnail, kind) derivable from the URL alone, without a fetch.

    Video hosts render their pages client-side, so an og:image scrape is both
    slow and unreliable there — but their thumbnail URLs are deterministic.
    """
    if m := _YT_ID_RE.search(url or ""):
        return f"https://i.ytimg.com/vi/{m.group(1)}/hqdefault.jpg", "video"
    if _VIMEO_ID_RE.search(url or ""):
        return "", "video"
    return "", ""


async def _enrich_thumbnails(results: list[dict], limit: int = 8) -> list[dict]:
    """Attach a `thumbnail` to each search hit, concurrently.

    Bounded by an overall deadline so a slow site can never stall the answer —
    whatever has resolved by then is used, the rest simply render text-only.
    """
    import asyncio
    targets = []
    for r in results[:limit]:
        url = r.get("href") or r.get("url")
        if not url:
            continue
        thumb, kind = _derived_media(url)
        if kind:
            r["kind"] = kind
        if thumb:
            # Known media host — no fetch needed.
            r["thumbnail"] = thumb
            continue
        targets.append(r)
    if not targets:
        return results
    try:
        # max_redirects caps hosts that 308-loop between the slashed and
        # unslashed form of a URL; without it one such host burns the timeout
        # twenty times over.
        async with httpx.AsyncClient(timeout=4.0, follow_redirects=True,
                                     max_redirects=5) as client:
            tasks = [
                asyncio.create_task(_og_thumbnail(client, r.get("href") or r.get("url")))
                for r in targets
            ]
            done, pending = await asyncio.wait(tasks, timeout=6.0)
            for t in pending:
                t.cancel()
            for r, t in zip(targets, tasks):
                if t in done:
                    try:
                        r["thumbnail"] = t.result() or ""
                    except Exception:
                        r["thumbnail"] = ""
    except Exception:
        pass
    return results


async def web_search(query: str, max_results: int = 6):
    """Search the web with DuckDuckGo.

    Returns {"text", "_ui"}: `text` is the summary the model reads; `_ui` is a
    `list` component (clickable source cards) rendered for the user. See genui.py.
    """
    import asyncio
    results = []
    try:
        try:
            from ddgs import DDGS  # renamed successor of duckduckgo_search
        except ImportError:
            from duckduckgo_search import DDGS
        def _sync_ddgs():
            with DDGS() as ddgs:
                return list(ddgs.text(query, max_results=max_results))
        results = await asyncio.to_thread(_sync_ddgs)
    except Exception:
        results = []

    if not results:
        results = await _ddg_html_search(query, max_results=max_results)

    if not results:
        return "No results found."

    text = "\n---\n".join(
        f"**{r.get('title','')}**\n{r.get('href','')}\n{r.get('body','')}"
        for r in results
    )
    try:
        from genui import search_results_component
        results = await _enrich_thumbnails(results)
        return {"text": text, "_ui": search_results_component(query, results)}
    except Exception:
        return text


async def fetch_url(url: str, max_chars: int = 5000) -> str:
    """Fetch a URL and return clean readable text."""
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            headers = {"User-Agent": "Mozilla/5.0 (BucksBrowser/2.0)"}
            r = await client.get(url, headers=headers)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            for tag in soup(["script","style","nav","footer","header","aside"]):
                tag.decompose()
            text = soup.get_text(separator="\n", strip=True)
            text = re.sub(r"\n{3,}", "\n\n", text)
            return text[:max_chars]
    except Exception as e:
        return f"Fetch error: {e}"


async def extract_links(url: str, max_links: int = 15) -> str:
    """Extract hyperlinks from a page."""
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0 (BucksBrowser/2.0)"})
            soup = BeautifulSoup(r.text, "html.parser")
            links = [
                f"{a.get_text(strip=True)} → {a['href']}"
                for a in soup.find_all("a", href=True)
                if a["href"].startswith("http")
            ][:max_links]
            return "\n".join(links) or "No external links found."
    except Exception as e:
        return f"Extract error: {e}"


# ── Code execution (sandboxed) ────────────────────────────────────────────────

def execute_code(code: str, language: str = "python", timeout: int = 10) -> str:
    """
    Execute code in a sandboxed subprocess.
    Supports: python, javascript (node), bash (restricted).
    """
    if language not in ("python", "javascript", "bash"):
        return f"Unsupported language: {language}. Use python, javascript, or bash."

    # Safety: block dangerous patterns
    BLOCKED = [
        r"import\s+os.*system", r"subprocess\.Popen", r"__import__",
        r"open\s*\(.*['\"]w['\"]", r"shutil\.rmtree", r"rm\s+-rf",
        r"curl\s+.*\|.*sh", r"eval\s*\(",  r"exec\s*\(",
    ]
    for pattern in BLOCKED:
        if re.search(pattern, code, re.IGNORECASE):
            return f"⚠️ Blocked: potentially unsafe pattern detected ({pattern})."

    try:
        with tempfile.NamedTemporaryFile(
            suffix={"python": ".py", "javascript": ".js", "bash": ".sh"}[language],
            mode="w", delete=False, encoding="utf-8"
        ) as f:
            f.write(code)
            tmp = f.name

        cmd = {
            "python":     ["python3", tmp],
            "javascript": ["node", tmp],
            "bash":       ["bash", "-r", tmp],   # -r = restricted shell
        }[language]

        result = subprocess.run(
            cmd, capture_output=True, text=True,
            timeout=timeout, env={"PATH": os.environ.get("PATH", "")}
        )
        output = result.stdout + (f"\n[stderr]: {result.stderr}" if result.stderr else "")
        return output.strip() or "(no output)"
    except subprocess.TimeoutExpired:
        return f"⏱️ Code execution timed out after {timeout}s."
    except FileNotFoundError as e:
        return f"Runtime not found: {e}"
    except Exception as e:
        return f"Execution error: {e}"
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass


# ── File tools (scoped to BUCKS_ROOT) ────────────────────────────────────────

# ── Filesystem / git tools ────────────────────────────────────────────────────
# Single source of truth lives in tools/fs_impl.py. These used to be
# re-implemented here AND in tools/file_tools.py; only this copy was ever
# dispatched by the agent, so fixes applied to the other file silently did
# nothing. Import, don't duplicate.
from tools.fs_impl import (  # noqa: E402
    safe_path as _safe_path,
    read_file,
    write_file,
    list_directory,
    git_status,
    git_diff,
)


# ── Calendar (file-backed) ────────────────────────────────────────────────────

CALENDAR_FILE = Path.home() / ".bucks" / "calendar.json"

def _load_cal() -> list:
    if CALENDAR_FILE.exists():
        return json.loads(CALENDAR_FILE.read_text())
    return []

def _save_cal(events: list):
    CALENDAR_FILE.parent.mkdir(parents=True, exist_ok=True)
    CALENDAR_FILE.write_text(json.dumps(events, indent=2))

def calendar_add(title: str, date: str, time_str: str = "", note: str = "") -> str:
    events = _load_cal()
    event = {"id": int(time.time()), "title": title, "date": date,
             "time": time_str, "note": note}
    events.append(event)
    _save_cal(events)
    return f"✓ Added: {title} on {date} {time_str}".strip()

def calendar_list(date: str = "") -> str:
    events = _load_cal()
    if date:
        events = [e for e in events if e.get("date","").startswith(date)]
    if not events:
        return "No events found."
    lines = []
    for e in sorted(events, key=lambda x: (x.get("date",""), x.get("time",""))):
        lines.append(f"• {e['date']} {e.get('time','')} — {e['title']}" +
                     (f" ({e['note']})" if e.get("note") else ""))
    return "\n".join(lines)


# ── Commerce stubs ────────────────────────────────────────────────────────────

def track_order(order_id: str, carrier: str = "") -> str:
    import os
    api = os.environ.get("BUCKS_LOGISTICS_API","")
    if api:
        try:
            r = httpx.get(f"{api}/track/{order_id}", timeout=10)
            return json.dumps(r.json()) if r.is_success else f"API error: {r.status_code}"
        except Exception as e:
            return f"Tracking error: {e}"
    return json.dumps({
        "order_id": order_id, "status": "In Transit",
        "carrier": carrier or "DHL", "location": "Mumbai Sorting Facility",
        "eta": "Tomorrow by 8 PM", "note": "Set BUCKS_LOGISTICS_API for live data."
    })


def product_search(query: str, max_results: int = 5):
    """Returns {"text", "_ui"} — text for the model, a product_grid for the user.
    Demo/sample catalog (mock). Each item still gets a real search URL (so
    clicking opens results for it) and a placeholder image (so the card looks
    complete). For genuinely real products, prefer product_lookup."""
    from urllib.parse import quote_plus
    def _demo(tier: str, price: str, stock: str, rating: float):
        name = f"{query} — {tier}"
        return {
            "name": name, "price": price, "stock": stock, "rating": rating,
            "url": f"https://duckduckgo.com/?q={quote_plus('buy ' + query + ' ' + tier)}",
            "imageUrl": f"https://placehold.co/400x300/1e1e2e/a978ff?text={quote_plus(query)}",
        }
    products = [
        _demo("Premium", "₹299", "In Stock", 4.6),
        _demo("Standard", "₹199", "Low Stock", 4.1),
        _demo("Essentials", "₹149", "In Stock", 3.9),
    ][:max_results]
    text = json.dumps({"results": products, "note": "Set BUCKS_ECOMMERCE_API for live catalog."})
    try:
        from genui import product_grid_component
        return {"text": text, "_ui": product_grid_component(query, products)}
    except Exception:
        return text


# ── Registry ──────────────────────────────────────────────────────────────────

async def _wrap_product_lookup(query: str, max_results: int = 12):
    from tools.shopping import product_lookup
    return await product_lookup(query, max_results)

async def wrap_ipfs_upload_text(text: str) -> str:
    from tools.ipfs_tools import ipfs_upload_text as _upload
    return await _upload(text)

async def wrap_ipfs_cat_text(cid: str) -> str:
    from tools.ipfs_tools import ipfs_cat_text as _cat
    return await _cat(cid)

async def wrap_ipfs_dynamic_load_tool(cid: str) -> str:
    from tools.ipfs_tools import ipfs_dynamic_load_tool as _load
    return await _load(cid)

async def wrap_dweb_publish(name: str, content: str, title: str = "", desc: str = "") -> str:
    from tools.ipfs_tools import dweb_publish as _pub
    return await _pub(name, content, title, desc)

async def wrap_dweb_search(query: str) -> str:
    from tools.ipfs_tools import dweb_search as _search
    return await _search(query)

async def wrap_cluster_list_members() -> str:
    from tools.cluster_tools import cluster_list_members as _fn
    return await _fn()

async def wrap_cluster_list_discovered() -> str:
    from tools.cluster_tools import cluster_list_discovered as _fn
    return await _fn()

async def wrap_cluster_get_my_identity() -> str:
    from tools.cluster_tools import cluster_get_my_identity as _fn
    return await _fn()

async def wrap_cluster_list_files(scope: str = "cluster") -> str:
    from tools.cluster_tools import cluster_list_files as _fn
    return await _fn(scope)

async def wrap_cluster_recommend(cid: str) -> str:
    from tools.cluster_tools import cluster_recommend as _fn
    return await _fn(cid)

async def wrap_cluster_unrecommend(cid: str) -> str:
    from tools.cluster_tools import cluster_unrecommend as _fn
    return await _fn(cid)

async def wrap_cluster_pin(cid: str) -> str:
    from tools.cluster_tools import cluster_pin as _fn
    return await _fn(cid)

async def wrap_cluster_unpin(cid: str) -> str:
    from tools.cluster_tools import cluster_unpin as _fn
    return await _fn(cid)

async def _wrap_image_search(query: str, max_results: int = 12):
    from tools.media_tools import image_search
    return await image_search(query, max_results)

async def _wrap_youtube_search(query: str, max_results: int = 8):
    from tools.media_tools import youtube_search
    return await youtube_search(query, max_results)

async def _wrap_deep_research(topic: str, max_sources: int = 4):
    from tools.research import deep_research
    return await deep_research(topic, max_sources)

async def _wrap_weather_lookup(place: str, days: int = 5):
    from tools.weather_tools import weather_lookup
    return await weather_lookup(place, days)

# ── Task Orchestration Wrappers ───────────────────────────────────────────
_ORCHESTRATOR = None

async def _registry_tool_executor(tool_name: str, tool_args: dict):
    """Run a workflow step against the real tool registry.

    Without this the orchestrator falls back to its mock executor, which logs
    "would execute …" and returns a placeholder — so a workflow reported
    status=completed at 100% having run nothing at all.
    """
    tool = TOOLS.get(tool_name)
    if tool is None:
        raise ValueError(f"Unknown tool: {tool_name}")
    return await tool.run(**(tool_args or {}))

def _get_orchestrator():
    """Lazy-load the orchestrator, wired to this registry."""
    global _ORCHESTRATOR
    if _ORCHESTRATOR is None:
        from task_orchestrator import TaskOrchestrator
        _ORCHESTRATOR = TaskOrchestrator(tool_executor=_registry_tool_executor)
    return _ORCHESTRATOR

async def _wrap_create_workflow(name: str, description: str = None):
    """Create a new workflow."""
    orch = _get_orchestrator()
    workflow = orch.create_workflow(name, description)
    return {
        "workflow_id": workflow.workflow_id,
        "name": workflow.name,
        "description": workflow.description,
        "status": workflow.status.value
    }

async def _wrap_add_task(
    workflow_id: str,
    name: str,
    tool_name: str,
    tool_args: dict,
    depends_on: list = None,
    description: str = None,
    max_retries: int = 3,
    timeout_seconds: int = None
):
    """Add a task to a workflow."""
    orch = _get_orchestrator()
    task = orch.add_task(
        workflow_id=workflow_id,
        name=name,
        tool_name=tool_name,
        tool_args=tool_args,
        depends_on=depends_on,
        description=description,
        max_retries=max_retries,
        timeout_seconds=timeout_seconds
    )
    return {
        "task_id": task.task_id,
        "name": task.name,
        "tool_name": task.tool_name,
        "status": task.status.value,
        "depends_on": task.depends_on
    }

async def _wrap_execute_workflow(workflow_id: str):
    """Execute a workflow."""
    orch = _get_orchestrator()
    workflow = await orch.execute_workflow(workflow_id)
    return {
        "workflow_id": workflow.workflow_id,
        "name": workflow.name,
        "status": workflow.status.value,
        "completed_at": workflow.completed_at,
        "error": workflow.error,
        "results_count": len(workflow.results or {})
    }

async def _wrap_get_workflow_status(workflow_id: str):
    """Get workflow status."""
    orch = _get_orchestrator()
    status = orch.get_workflow_status(workflow_id)
    if not status:
        return {"error": f"Workflow not found: {workflow_id}"}
    return status

async def _wrap_watch_directory(
    path: str,
    duration_seconds: float = 5.0,
    patterns: list = None,
    recursive: bool = True,
):
    """Watch a directory for a fixed window and report what changed."""
    from tools.watch_impl import collect_events
    return await collect_events(
        path,
        duration_seconds=duration_seconds,
        patterns=patterns,
        recursive=recursive,
    )

async def _wrap_list_workflows():
    """List all workflows."""
    orch = _get_orchestrator()
    workflows = orch.list_workflows()
    return {
        "count": len(workflows),
        "workflows": [
            {
                "workflow_id": w.workflow_id,
                "name": w.name,
                "status": w.status.value,
                "tasks": len(w.tasks or {}),
                "created_at": w.created_at
            }
            for w in workflows
        ]
    }

TOOLS: dict[str, Tool] = {
    "web_search":            Tool("web_search",            "Search the web with DuckDuckGo",                       web_search),
    "fetch_url":             Tool("fetch_url",             "Fetch and read a URL's text content",                  fetch_url),
    "extract_links":         Tool("extract_links",         "Extract hyperlinks from a webpage",                    extract_links),
    "execute_code":          Tool("execute_code",          "Run Python/JS/bash code in a sandbox",                 execute_code, safe=False),
    "read_file":             Tool("read_file",             "Read a file in the Bucks project",                     read_file),
    "write_file":            Tool("write_file",            "Write a file in the Bucks project",                    write_file, safe=False),
    "list_directory":        Tool("list_directory",        "List files in a project directory",                    list_directory),
    "git_status":            Tool("git_status",            "Show git status of the Bucks project",                 git_status),
    "calendar_add":          Tool("calendar_add",          "Add an event to the user's calendar",                  calendar_add),
    "calendar_list":         Tool("calendar_list",         "List calendar events, optionally filtered by date",    calendar_list),
    "track_order":           Tool("track_order",           "Track a shipment order",                               track_order),
    "product_search":        Tool("product_search",        "Search the product catalog",                           product_search),
    "product_lookup":        Tool("product_lookup",        "Fetch REAL products from trusted retailer pages",      _wrap_product_lookup),
    "ipfs_upload_text":      Tool("ipfs_upload_text",      "Upload text content to IPFS, returning the CID",       wrap_ipfs_upload_text, safe=False),
    "ipfs_cat_text":         Tool("ipfs_cat_text",         "Retrieve and read text content from an IPFS CID",      wrap_ipfs_cat_text),
    "ipfs_dynamic_load_tool": Tool("ipfs_dynamic_load_tool", "Fetch and dynamically load a new agent tool from IPFS", wrap_ipfs_dynamic_load_tool, safe=False),
    "dweb_publish":          Tool("dweb_publish",          "Publish a page to the Bucks dWeb (IPFS + swarm index)", wrap_dweb_publish, safe=False),
    "dweb_search":           Tool("dweb_search",           "Search pages on the Bucks dWeb discovery index",       wrap_dweb_search),
    "image_search":          Tool("image_search",          "Search the web for images (renders an image gallery)", _wrap_image_search),
    "youtube_search":        Tool("youtube_search",        "Search YouTube videos (renders an embedded player)",   _wrap_youtube_search),
    "deep_research":         Tool("deep_research",         "Multi-source research with images (renders a dossier)", _wrap_deep_research),
    "weather_lookup":        Tool("weather_lookup",        "Current weather + forecast (renders a weather card)",  _wrap_weather_lookup),
    "cluster_list_members":    Tool("cluster_list_members",    "List members admitted into the user's Bucks cluster",     wrap_cluster_list_members),
    "cluster_list_discovered": Tool("cluster_list_discovered", "List nearby peers not yet admitted into the cluster",     wrap_cluster_list_discovered),
    "cluster_get_my_identity": Tool("cluster_get_my_identity", "Get this node's own shareable cluster invite ID",         wrap_cluster_get_my_identity),
    "cluster_list_files":      Tool("cluster_list_files",      "List files pinned locally or visible across the cluster", wrap_cluster_list_files),
    "cluster_recommend":       Tool("cluster_recommend",       "Recommend a file to the cluster (a vote; does not pin)",  wrap_cluster_recommend, safe=False),
    "cluster_unrecommend":     Tool("cluster_unrecommend",     "Mark a file as not recommended (a vote; does not unpin)", wrap_cluster_unrecommend, safe=False),
    "cluster_pin":             Tool("cluster_pin",             "Pin/host a file locally (standalone; no vote)",          wrap_cluster_pin, safe=False),
    "cluster_unpin":           Tool("cluster_unpin",           "Unpin a file, stop hosting it (standalone; no vote)",    wrap_cluster_unpin, safe=False),
    # ── Task Orchestration & Workflows ────────────────────────────────────
    "create_workflow":         Tool("create_workflow",         "Create a new workflow (task orchestration)",              _wrap_create_workflow, safe=False),
    "add_task":                Tool("add_task",                "Add a task to a workflow",                               _wrap_add_task, safe=False),
    "execute_workflow":        Tool("execute_workflow",        "Execute a workflow (run all tasks with dependencies)",  _wrap_execute_workflow, safe=False),
    "get_workflow_status":     Tool("get_workflow_status",     "Get workflow execution status and progress",            _wrap_get_workflow_status),
    "list_workflows":          Tool("list_workflows",          "List all workflows and their status",                   _wrap_list_workflows),
    "watch_directory":         Tool("watch_directory",         "Watch a folder for a few seconds and report file changes", _wrap_watch_directory),
}


def get_tool(name: str) -> Tool | None:
    return TOOLS.get(name)

def list_tools() -> list[dict]:
    return [t.to_dict() for t in TOOLS.values()]

AGENT_TOOL_MAPPINGS = {
    "browser":  ["web_search", "fetch_url", "extract_links", "image_search",
                 "youtube_search", "deep_research", "weather_lookup"],
    "code":     ["read_file", "write_file", "list_directory", "git_status", "execute_code"],
    "commerce": ["track_order", "product_search", "web_search"],
    "slm":      ["web_search", "calendar_list"],
    "calendar": ["calendar_add", "calendar_list"],
    "ipfs":     ["ipfs_upload_text", "ipfs_cat_text", "ipfs_dynamic_load_tool",
                 "dweb_publish", "dweb_search"],
    "cluster":  ["cluster_list_members", "cluster_list_discovered", "cluster_get_my_identity",
                 "cluster_list_files", "cluster_recommend", "cluster_unrecommend",
                 "cluster_pin", "cluster_unpin"],
    "workflow": ["create_workflow", "add_task", "execute_workflow", "get_workflow_status", "list_workflows"],
    "files":    ["read_file", "write_file", "list_directory", "watch_directory"],
}

def tools_for_agent(agent_type: str) -> list[Tool]:
    """Return relevant tools for each agent type."""
    names = AGENT_TOOL_MAPPINGS.get(agent_type, ["web_search"])
    return [TOOLS[n] for n in names if n in TOOLS]

def register_dynamic_tool(name: str, description: str, fn: Callable, safe: bool = True, agent_mapping: str = "code"):
    """Register a custom dynamic tool fetched from IPFS into the agent registry."""
    TOOLS[name] = Tool(name, description, fn, safe=safe)
    if agent_mapping not in AGENT_TOOL_MAPPINGS:
        AGENT_TOOL_MAPPINGS[agent_mapping] = []
    if name not in AGENT_TOOL_MAPPINGS[agent_mapping]:
        AGENT_TOOL_MAPPINGS[agent_mapping].append(name)

