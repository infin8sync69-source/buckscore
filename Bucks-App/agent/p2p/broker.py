"""
ServiceBroker — routes tasks to the best available agent (local or peer).

Routing priority:
  1. Local capability available → run locally.
  2. Trusted peer with capability and reachable server → delegate.
  3. No reachable peer → queue task in IPFS outbox for async pickup.

The broker is the single entry point for cross-agent task execution.
"""
import logging
from typing import Callable, Dict, List, Optional

from .discovery import AgentDiscovery
from .connector import AgentConnector

log = logging.getLogger("bucks.p2p.broker")


class ServiceBroker:
    def __init__(
        self,
        discovery: AgentDiscovery,
        connector: AgentConnector,
        ipfs_api_url: str = "http://localhost:5001",
    ):
        self._discovery  = discovery
        self._connector  = connector
        self._ipfs_url   = ipfs_api_url
        # Local capability handlers: capability_name → async callable(task) → dict
        self._handlers: Dict[str, Callable] = {}

    # ── Service registration ──────────────────────────────────────────────────

    def register_service(self, capability: str, handler: Callable) -> None:
        """Expose a local capability to the network."""
        self._handlers[capability] = handler
        log.info("Registered local service: %s", capability)

    def list_local_services(self) -> List[str]:
        return list(self._handlers.keys())

    def list_network_services(self) -> List[dict]:
        """All known capabilities across local + peer agents."""
        services = [{"capability": c, "location": "local"} for c in self._handlers]
        for soul in self._discovery.get_all_agents():
            for cap in soul.get("capabilities", []):
                services.append({
                    "capability": cap,
                    "location":   "peer",
                    "soulId":     soul.get("soulId", "")[:16],
                    "locality":   soul.get("locality", "?"),
                })
        return services

    # ── Task routing ──────────────────────────────────────────────────────────

    async def route_task(
        self,
        task: dict,
        required_capability: str,
    ) -> dict:
        """
        Route a task to the best available handler.

        Returns a result dict with at least:
          {"status": "success|queued|error", "result": ..., "routed_to": ...}
        """
        # 1. Local handler
        handler = self._handlers.get(required_capability)
        if handler:
            try:
                result = await handler(task)
                log.info("Task routed locally via capability=%s", required_capability)
                return {"status": "success", "result": result, "routed_to": "local"}
            except Exception as e:
                log.error("Local handler %s failed: %s", required_capability, e)

        # 2. Peer delegation
        peers = self._discovery.get_agents_with_capability(required_capability)
        for peer in peers:
            peer_id = peer.get("soulId", "")
            result = await self._connector.send(peer_id, task)
            if result and result.get("status") != "error":
                log.info("Task delegated to peer %s for capability=%s", peer_id[:16], required_capability)
                return {
                    "status":    "success",
                    "result":    result,
                    "routed_to": f"peer:{peer_id[:16]}",
                }

        # 3. Queue in IPFS for async pickup
        if peers:
            first_peer_id = peers[0].get("soulId", "")
            cid = await self._connector.queue_in_ipfs(
                first_peer_id, task, self._ipfs_url
            )
            return {
                "status":    "queued",
                "result":    {"cid": cid},
                "routed_to": f"ipfs_outbox:{first_peer_id[:16]}",
            }

        return {
            "status":    "error",
            "result":    {"message": f"No handler found for capability: {required_capability}"},
            "routed_to": "none",
        }
