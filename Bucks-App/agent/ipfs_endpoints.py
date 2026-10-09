"""
ipfs_endpoints — discover which IPFS HTTP API / gateway endpoints exist.

The Electron browser writes ~/.bucks/ipfs.json on startup (see
electron/ipfs-bridge.js): it says whether a real Kubo daemon is running
(mode "kubo+bridge") or whether the browser's embedded Helia node is the
only IPFS API on the machine (mode "bridge-only", Kubo-compatible API on
:5006 or :5001).

This module turns that manifest + env vars + well-known ports into ordered
candidate lists, so the agent's IPFS clients work identically whether the
user runs Kubo, only the Bucks browser, both, or (reads only) neither.

Resolution order for the API:
  1. IPFS_API_URL env var (explicit override always wins)
  2. manifest apiUrl / bridgeUrl from ~/.bucks/ipfs.json
  3. well-known local ports: :5001 (Kubo default) then :5006 (Bucks bridge)

Reads additionally fall back through HTTP gateways (local Kubo :8080,
local bridge /ipfs/, then public gateways) so ipfs_cat works even when
no local node is running at all.
"""
import json
import logging
import os
import time
from pathlib import Path
from typing import List, Optional

log = logging.getLogger("bucks.ipfs_endpoints")

BUCKS_HOME = Path(os.getenv("BUCKS_HOME", str(Path.home() / ".bucks")))
MANIFEST_FILE = BUCKS_HOME / "ipfs.json"

KUBO_DEFAULT_API = "http://localhost:5001"
BRIDGE_DEFAULT_API = "http://127.0.0.1:5006"
DEFAULT_GATEWAYS = [
    "http://127.0.0.1:8080/ipfs/",        # local Kubo gateway
    "http://127.0.0.1:5006/ipfs/",        # Bucks bridge gateway route
    "https://ipfs.io/ipfs/",              # public — reads only, last resort
    "https://dweb.link/ipfs/",
]

_MANIFEST_TTL_S = 30.0
_cache = {"ts": 0.0, "data": None}


def _manifest() -> Optional[dict]:
    """Read ~/.bucks/ipfs.json with a small TTL cache (the browser rewrites
    it on every launch, so never cache it for the process lifetime)."""
    now = time.monotonic()
    if _cache["data"] is not None and now - _cache["ts"] < _MANIFEST_TTL_S:
        return _cache["data"]
    data = None
    try:
        if MANIFEST_FILE.exists():
            data = json.loads(MANIFEST_FILE.read_text())
    except Exception as e:
        log.debug("Could not read IPFS endpoint manifest: %s", e)
    _cache["ts"] = now
    _cache["data"] = data
    return data


def candidate_api_urls(preferred: Optional[str] = None) -> List[str]:
    """Ordered, deduped Kubo-API candidates to try for any IPFS operation."""
    urls: List[str] = []

    def _push(u: Optional[str]):
        if u:
            u = u.rstrip("/")
            if u not in urls:
                urls.append(u)

    _push(os.getenv("IPFS_API_URL"))
    _push(preferred)
    m = _manifest()
    if m:
        _push(m.get("apiUrl"))
        _push(m.get("bridgeUrl"))
    _push(KUBO_DEFAULT_API)
    _push(BRIDGE_DEFAULT_API)
    return urls


def gateway_urls() -> List[str]:
    """Ordered HTTP gateway prefixes (each ends with '/ipfs/') for reads."""
    urls: List[str] = []
    m = _manifest()
    for u in (m.get("gatewayUrls") if m else None) or []:
        if u and u not in urls:
            urls.append(u)
    for u in DEFAULT_GATEWAYS:
        if u not in urls:
            urls.append(u)
    return urls


def bridge_url() -> Optional[str]:
    """The Bucks browser bridge URL (bucks/* extension endpoints live there),
    or None if the browser hasn't written a manifest yet."""
    m = _manifest()
    if m and m.get("bridgeUrl"):
        return m["bridgeUrl"].rstrip("/")
    return None
