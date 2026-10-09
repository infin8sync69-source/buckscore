"""
AgentDiscovery — listens for peer soul advertisements and maintains
a registry of verified, trusted Bucks agents on the network.

Trust requires:
  1. Valid Ed25519 soul signature.
  2. frozenMemoryHash matches ours (same soul ROM).
  3. Same CIDN (same network partition).
"""
import asyncio
import logging
from typing import Callable, List, Optional

from soul.registry import SoulRegistry
from soul.validator import is_trusted, is_compatible

log = logging.getLogger("bucks.p2p.discovery")


class AgentDiscovery:
    def __init__(
        self,
        soul_registry: SoulRegistry,
        own_soul: dict,
        ipfs_api_url: str = "http://localhost:5001",
    ):
        self._registry   = soul_registry
        self._own_soul   = own_soul
        self._ipfs_url   = ipfs_api_url
        self._callbacks: List[Callable[[dict], None]] = []
        self._running    = False

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self) -> None:
        self._running = True
        log.info("AgentDiscovery started — listening for peer souls")

    def stop(self) -> None:
        self._running = False

    # ── Incoming soul handler (called by ipfs-agent-soul.js via HTTP) ─────────

    def on_peer_soul(self, soul: dict) -> dict:
        """
        Verify and register an incoming peer soul.
        Returns {"trusted": bool, "reason": str}.
        """
        soul_id = soul.get("soulId", "?")[:16]

        if not is_trusted(soul):
            reason = "signature or frozen memory mismatch"
            log.warning("Rejected peer soul %s: %s", soul_id, reason)
            return {"trusted": False, "reason": reason}

        if not is_compatible(self._own_soul, soul):
            reason = f"CIDN mismatch (peer={soul.get('cidn')}, local={self._own_soul.get('cidn')})"
            log.warning("Rejected peer soul %s: %s", soul_id, reason)
            return {"trusted": False, "reason": reason}

        registered = self._registry.register(soul)
        if registered:
            for cb in self._callbacks:
                try:
                    cb(soul)
                except Exception as e:
                    log.error("Discovery callback error: %s", e)
            return {"trusted": True, "reason": "ok"}

        return {"trusted": False, "reason": "registry rejected"}

    # ── Announce ──────────────────────────────────────────────────────────────

    async def announce_self(self) -> None:
        """
        Publish own soul via HTTP to the agent server's advertise endpoint.
        The JS bridge then publishes to gossipsub.
        The Python server exposes POST /api/v1/soul/advertise which
        the bridge calls on its own schedule; this is a manual trigger.
        """
        log.info("Manual soul announcement triggered for %s", self._own_soul.get("soulId", "?")[:16])

    # ── Query ─────────────────────────────────────────────────────────────────

    def get_agents_with_capability(self, capability: str) -> List[dict]:
        return self._registry.by_capability(capability)

    def get_all_agents(self) -> List[dict]:
        return self._registry.all_souls()

    def on_agent_discovered(self, callback: Callable[[dict], None]) -> None:
        self._callbacks.append(callback)
