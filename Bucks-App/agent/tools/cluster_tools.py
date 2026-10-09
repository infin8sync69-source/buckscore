import logging

from tools.ipfs_tools import _bucks_bridge_request

log = logging.getLogger("bucks.tools.cluster")

# NOTE: there is deliberately no cluster_admit tool here, and no HTTP route
# on the bridge for it (see electron/ipfs-bridge.js). Admission changes who
# can reach the user's entire cluster, permanently and transitively — that's
# a materially larger blast radius than any other tool in this file, so it
# stays a human-click-only action in the renderer (see
# electron/cluster-membership.js's header comment). An agent can help the
# user find and describe a peer to admit, but never admits one itself.


async def cluster_list_members() -> str:
    """List members already admitted into the user's Bucks cluster."""
    result = await _bucks_bridge_request("/api/v0/bucks/cluster/members")
    if result is None:
        return "Error: the Bucks browser bridge is not reachable."
    members = result.get("members", [])
    if not members:
        return "No cluster members yet."
    lines = [f"{len(members)} cluster member(s):"]
    for m in members:
        online = "online" if m.get("online") else "offline"
        lines.append(f"- {m.get('displayName') or 'Member'} ({m.get('soulId', '?')[:16]}...) — {online}")
    return "\n".join(lines)


async def cluster_list_discovered() -> str:
    """List peers discovered nearby (same CIDN) but NOT yet admitted into the cluster."""
    result = await _bucks_bridge_request("/api/v0/bucks/cluster/discovered")
    if result is None:
        return "Error: the Bucks browser bridge is not reachable."
    discovered = result.get("discovered", [])
    if not discovered:
        return "No unadmitted peers discovered nearby right now."
    lines = [f"{len(discovered)} discovered peer(s) not yet in the cluster:"]
    for d in discovered:
        lines.append(f"- {d.get('locality') or 'Unknown'} ({d.get('soulId', '?')[:16]}...)")
    return "\n".join(lines)


async def cluster_get_my_identity() -> str:
    """Get this node's own shareable cluster identity (soulId) — what a friend needs to be invited."""
    result = await _bucks_bridge_request("/api/v0/bucks/cluster/identity")
    if result is None:
        return "Error: the Bucks browser bridge is not reachable."
    soul_id = result.get("soulId")
    if not soul_id:
        return "Soul identity not ready yet — try again in a few seconds."
    return f"Your cluster ID: {soul_id}\n(Share this with someone already in the cluster so they can add you.)"


async def cluster_list_files(scope: str = "cluster") -> str:
    """
    List files/content known to this node. scope='mine' = only locally
    pinned content; scope='cluster' (default) = everything visible from the
    swarm feed, including content not yet pinned locally.
    """
    path = "/api/v0/bucks/files/mine" if scope == "mine" else "/api/v0/bucks/files/cluster"
    result = await _bucks_bridge_request(path)
    if result is None:
        return "Error: the Bucks browser bridge is not reachable."
    items = result.get("pinnedItems") if scope == "mine" else result.get("feed")
    items = items or []
    if not items:
        return f"No files found (scope={scope})."
    lines = [f"{len(items)} file(s) (scope={scope}):"]
    for it in items[:30]:
        name = it.get("name") or (it.get("metadata") or {}).get("name") or "Untitled"
        cid = it.get("cid", "?")
        lines.append(f"- {name} (CID: {cid})")
    return "\n".join(lines)


async def cluster_recommend(cid: str) -> str:
    """Recommend a file to the network — a positive vote that is broadcast to
    the cluster. This is a pure signal and does NOT pin/host the file; use
    cluster_pin separately to host it."""
    result = await _bucks_bridge_request("/api/v0/bucks/cluster/vote", {"cid": cid, "direction": "up"})
    if result is None:
        return "Error: the Bucks browser bridge is not reachable."
    if result.get("status") == "recommended":
        return f"✓ Recommended {cid} to the cluster."
    return f"Error recommending {cid}: {result.get('error', 'unknown error')}"


async def cluster_unrecommend(cid: str) -> str:
    """Mark a file as not recommended — a negative vote broadcast to the
    cluster. Pure signal; does NOT unpin/remove any local copy."""
    result = await _bucks_bridge_request("/api/v0/bucks/cluster/vote", {"cid": cid, "direction": "down"})
    if result is None:
        return "Error: the Bucks browser bridge is not reachable."
    return f"✓ Marked {cid} as not recommended."


async def cluster_pin(cid: str) -> str:
    """Pin/host a file locally so this node stores and serves it. Standalone
    action, separate from recommending — pin to become a source for the CID."""
    result = await _bucks_bridge_request("/api/v0/bucks/cluster/pin", {"cid": cid})
    if result is None:
        return "Error: the Bucks browser bridge is not reachable."
    if result.get("status") == "pinned":
        return f"✓ Pinned {cid} — now hosting it locally."
    return f"Error pinning {cid}: {result.get('error', 'unknown error')}"


async def cluster_unpin(cid: str) -> str:
    """Unpin a file — stop hosting the local copy to free storage. Standalone;
    does not affect recommend votes."""
    result = await _bucks_bridge_request("/api/v0/bucks/cluster/pin", {"cid": cid, "unpin": True})
    if result is None:
        return "Error: the Bucks browser bridge is not reachable."
    return f"✓ Unpinned {cid}."
