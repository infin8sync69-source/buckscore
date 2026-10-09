"""
AgentConnector — establishes encrypted channels with peer agents.

Uses the soul registry to locate peers and delegates tasks over
HTTPS to their agent server endpoints. Messages are authenticated
using the soul signature so man-in-the-middle is detectable.

For high-security operations the JS signal-store X3DH handshake can
be invoked; for now we use soul-signed HTTP for simplicity and expand
to full Signal sessions in Phase 5+.
"""
import hashlib
import json
import logging
import time
from typing import Optional

import aiohttp

from soul.registry import SoulRegistry
from soul.generator import sign_payload
from ipfs_cluster_client import IPFSClusterClient

log = logging.getLogger("bucks.p2p.connector")

_DEFAULT_AGENT_PORT = 3000
_TASK_TIMEOUT       = 30


class AgentConnector:
    def __init__(self, soul_registry: SoulRegistry, own_soul: dict):
        self._registry  = soul_registry
        self._own_soul  = own_soul

    # ── Send ──────────────────────────────────────────────────────────────────

    async def send(
        self,
        peer_soul_id: str,
        task: dict,
        timeout: int = _TASK_TIMEOUT,
    ) -> Optional[dict]:
        """
        Send a task to a peer agent's server.
        Attaches a soul signature so the peer can verify origin.
        Returns the peer's response dict, or None on failure.
        """
        peer = self._registry.lookup(peer_soul_id)
        if not peer:
            log.warning("send: unknown peer %s", peer_soul_id[:16])
            return None

        endpoint = self._peer_endpoint(peer)
        if not endpoint:
            log.warning("send: no endpoint for peer %s", peer_soul_id[:16])
            return None

        signed_task = self._sign_task(task)

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{endpoint}/api/v1/swarm/task",
                    json=signed_task,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                ) as resp:
                    result = await resp.json()
                    log.info("Peer %s responded: status=%s", peer_soul_id[:16], result.get("status"))
                    return result
        except Exception as e:
            log.error("send to peer %s failed: %s", peer_soul_id[:16], e)
            return None

    # ── IPFS Inbox (async/offline delivery) ───────────────────────────────────

    async def queue_in_ipfs(
        self,
        peer_soul_id: str,
        task: dict,
        ipfs_api_url: str = "http://localhost:5001",
        cluster_api_url: str = "http://127.0.0.1:9094",
    ) -> str:
        """
        Queue a task in IPFS for offline peer pickup — cluster-replicated when
        a local IPFS Cluster is running, so the message survives even if this
        node goes offline before the peer picks it up.
        Returns the CID of the queued message, or "".
        """
        envelope = {
            "to":        peer_soul_id,
            "from":      self._own_soul.get("soulId", ""),
            "timestamp": time.time(),
            "task":      self._sign_task(task),
        }
        payload = json.dumps(envelope).encode()
        cid = await IPFSClusterClient(ipfs_api_url, cluster_api_url).add(
            payload, filename="msg.json",
        )
        if cid:
            log.info("Queued task for %s → IPFS %s", peer_soul_id[:16], cid)
        else:
            log.error("IPFS queue failed for peer %s", peer_soul_id[:16])
        return cid

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _peer_endpoint(self, peer: dict) -> Optional[str]:
        """
        Derive the HTTP endpoint for a peer agent.
        Peers that advertise a 'serverUrl' in their soul use that.
        Otherwise fall back to libp2p peer address resolution (future).
        """
        server_url = peer.get("serverUrl")
        if server_url:
            return server_url.rstrip("/")
        # Future: resolve via libp2p multiaddr
        return None

    def _sign_task(self, task: dict) -> dict:
        """Attach a soul signature to a task payload for peer authentication."""
        payload_str = json.dumps(task, sort_keys=True)
        sig = sign_payload(payload_str)
        return {
            **task,
            "_origin":    self._own_soul.get("soulId", ""),
            "_signature": sig,
            "_ts":        time.time(),
        }
