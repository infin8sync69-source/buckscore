"""
IPFSKnowledgeStore — stores and retrieves knowledge fragments on IPFS.

Peer agents publish their KB fragments here. When a peer soul is registered,
we pull their KB CIDs and embed them into local floating memory.

Publishing goes through IPFSClusterClient, which prefers a local IPFS Cluster
(replicates the fragment to every peer in that cluster) and falls back to a
single Kubo node when no cluster is running — see ipfs_cluster_client.py.
"""
import json
import logging
from typing import List, Optional

import aiohttp

import ipfs_endpoints
from ipfs_cluster_client import IPFSClusterClient

log = logging.getLogger("bucks.rag.ipfs_store")


class IPFSKnowledgeStore:
    def __init__(
        self,
        ipfs_api_url: str = "http://localhost:5001",
        cluster_api_url: str = "http://127.0.0.1:9094",
    ):
        self._url = ipfs_api_url.rstrip("/")
        self._cluster = IPFSClusterClient(ipfs_api_url, cluster_api_url)

    # ── Write ─────────────────────────────────────────────────────────────────

    async def publish_fragment(self, text: str, metadata: Optional[dict] = None) -> str:
        """
        Publish a knowledge fragment (cluster-replicated when available).
        Returns the CID string, or "" on failure.
        """
        payload = json.dumps({"text": text, "metadata": metadata or {}}).encode()
        cid = await self._cluster.add(payload, filename="fragment.json")
        if cid:
            log.debug("Published fragment: %s", cid)
        return cid

    # ── Read ──────────────────────────────────────────────────────────────────

    async def _cat_bytes(self, cid: str) -> Optional[bytes]:
        """
        Fetch raw bytes for a CID with maximum compatibility: try every
        local Kubo-compatible API (real Kubo, Bucks browser bridge), then
        fall back through HTTP gateways (local first, public last) so reads
        work even when no local IPFS node is running.
        """
        async with aiohttp.ClientSession() as session:
            for api in ipfs_endpoints.candidate_api_urls(self._url):
                try:
                    async with session.post(
                        f"{api}/api/v0/cat?arg={cid}",
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as resp:
                        if resp.status == 200:
                            return await resp.read()
                except Exception:
                    continue
            for gw in ipfs_endpoints.gateway_urls():
                try:
                    async with session.get(
                        f"{gw}{cid}",
                        timeout=aiohttp.ClientTimeout(total=20),
                    ) as resp:
                        if resp.status == 200:
                            return await resp.read()
                except Exception:
                    continue
        return None

    async def fetch_fragment(self, cid: str) -> Optional[dict]:
        """
        Fetch a knowledge fragment by CID.
        Returns {"text": ..., "metadata": ...} or None.
        """
        if not cid:
            return None
        raw = await self._cat_bytes(cid)
        if raw is None:
            log.warning("IPFS fetch failed for %s: no endpoint could serve it", cid)
            return None
        try:
            return json.loads(raw)
        except Exception as e:
            log.warning("IPFS fragment %s is not JSON: %s", cid, e)
            return None

    async def fetch_raw(self, cid: str) -> Optional[str]:
        """
        Fetch raw text content by CID (fallback for non-JSON documents).
        """
        if not cid:
            return None
        raw = await self._cat_bytes(cid)
        if raw is None:
            log.warning("IPFS raw fetch failed for %s: no endpoint could serve it", cid)
            return None
        return raw.decode("utf-8", errors="ignore")

    async def pin_remote_cid(self, cid: str) -> bool:
        """Pin a CID this node has already fetched, replicating it further
        (cluster-wide if a local cluster is running) instead of depending on
        the original publisher staying online."""
        return await self._cluster.pin_existing(cid)

    async def index_peer_fragments(self, peer_soul: dict) -> List[dict]:
        """
        Pull all knowledge fragments from a peer agent's KB CIDs
        (listed in peer_soul["kbCids"]) and return as list of dicts.
        """
        cids: List[str] = peer_soul.get("kbCids", [])
        fragments = []
        for cid in cids:
            frag = await self.fetch_fragment(cid)
            if frag and frag.get("text"):
                frag["_cid"] = cid
                frag["_peer"] = peer_soul.get("soulId", "unknown")[:16]
                fragments.append(frag)
        log.info("Indexed %d fragments from peer %s", len(fragments), peer_soul.get("soulId", "?")[:16])
        return fragments
