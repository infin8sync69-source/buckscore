"""
SoulRegistry — local registry of known peer agent souls.

Only verified souls (signature + frozen memory hash) are admitted.
Backed by known_souls.json so it survives restarts.
"""
import json
import logging
import time
from pathlib import Path
from typing import Optional

from .validator import is_trusted

log = logging.getLogger("bucks.soul.registry")

_REGISTRY_FILE = Path(__file__).parent.parent.parent / "data" / "known_souls.json"


def _ensure_data_dir() -> None:
    _REGISTRY_FILE.parent.mkdir(parents=True, exist_ok=True)


class SoulRegistry:
    def __init__(self, registry_path: Optional[Path] = None):
        self._path = registry_path or _REGISTRY_FILE
        self._souls: dict[str, dict] = {}  # soulId -> soul_dict
        _ensure_data_dir()
        self._load()

    # ── Write ─────────────────────────────────────────────────────────────────

    def register(self, soul: dict) -> bool:
        """
        Admit a peer soul after trust verification.
        Returns True if registered, False if rejected.
        """
        soul_id = soul.get("soulId", "")
        if not soul_id:
            log.warning("Rejected soul: missing soulId")
            return False

        if not is_trusted(soul):
            return False

        soul["_registeredAt"] = time.time()
        self._souls[soul_id] = soul
        self._save()
        log.info("Registered soul: %s (%s)", soul_id[:16], soul.get("locality", "?"))
        return True

    def remove(self, soul_id: str) -> None:
        if soul_id in self._souls:
            del self._souls[soul_id]
            self._save()

    # ── Read ──────────────────────────────────────────────────────────────────

    def lookup(self, soul_id: str) -> Optional[dict]:
        return self._souls.get(soul_id)

    def all_souls(self) -> list[dict]:
        return list(self._souls.values())

    def by_capability(self, capability: str) -> list[dict]:
        return [
            s for s in self._souls.values()
            if capability in s.get("capabilities", [])
        ]

    def by_locality(self, locality: str) -> list[dict]:
        return [
            s for s in self._souls.values()
            if s.get("locality", "").startswith(locality)
        ]

    def count(self) -> int:
        return len(self._souls)

    # ── Persistence ───────────────────────────────────────────────────────────

    def _save(self) -> None:
        try:
            self._path.write_text(json.dumps(self._souls, indent=2))
        except Exception as e:
            log.error("Failed to save soul registry: %s", e)

    def _load(self) -> None:
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text())
                self._souls = {k: v for k, v in data.items() if isinstance(v, dict)}
                log.info("Loaded %d souls from registry", len(self._souls))
            except Exception as e:
                log.error("Failed to load soul registry: %s", e)
                self._souls = {}
