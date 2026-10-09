"""
FrozenMemory — The immutable soul ROM of every Bucks agent.

Two layers:
  1. frozen_memory.json  — ethical constitution, encryption stack, trust rules.
  2. WorldSoul           — encrypted Quran; unlocked at runtime for RAG retrieval.

Both layers are loaded once at startup. The frozen layer is injected as the
fixed system prompt prefix into every LLM call. The world soul hash is embedded
in the soul manifest so peer agents can verify both layers before trust.
"""
import hashlib
import json
import logging
from pathlib import Path
from typing import Optional

log = logging.getLogger("bucks.soul.frozen")

_FROZEN_FILE = Path(__file__).parent / "frozen_memory.json"

with open(_FROZEN_FILE, "r", encoding="utf-8") as _f:
    _FROZEN_DATA: dict = json.load(_f)

_FROZEN_RAW: str  = json.dumps(_FROZEN_DATA, sort_keys=True, ensure_ascii=False)
_FROZEN_HASH: str = hashlib.sha256(_FROZEN_RAW.encode()).hexdigest()


def _build_system_prompt(data: dict) -> str:
    lines = [
        "=== BUCKS AGENT — SOUL OF THE WORLD (FROZEN / READ-ONLY) ===",
        "",
        f"FOUNDATION: {data['soul_of_the_world']['source']}",
        "",
        f"MISSION: {data['bucks_mission']}",
        "",
        "CORE VALUES (derived from the Quran):",
    ]
    for v in data["core_values_from_quran"]:
        lines.append(f"  • {v}")
    lines += [
        "",
        "AGENT CONSTITUTION (immutable behavioral constraints):",
    ]
    for rule in data["agent_constitution"]:
        lines.append(f"  {rule}")
    lines += [
        "",
        "ENCRYPTION STACK (non-negotiable — do not bypass):",
    ]
    for k, v in data["encryption_stack"].items():
        lines.append(f"  {k}: {v}")
    lines += [
        "",
        "NOTE: Full Quran text is stored encrypted in the WorldSoul.",
        "Relevant verses are retrieved via RAG and prepended to your context.",
        "Every response must be consistent with Quranic guidance.",
        "",
        "=== END FROZEN MEMORY ===",
    ]
    return "\n".join(lines)


_SYSTEM_PROMPT: str = _build_system_prompt(_FROZEN_DATA)


def _build_runtime_system_prompt(data: dict) -> str:
    """A SLIM system prompt for actual LLM calls.

    The full _build_system_prompt() manifest (encryption stack, 8-point
    constitution with repeated "refuse it" rules, "ground every response in
    the Quran") is meant to be HASHED for peer soul-identity — dumping all
    3.2k chars of it into every prompt derails small local models into
    moralizing, off-topic answers (a plain "convert USD to EUR" triggers the
    riba/usury refusal rule). Keep the identity + a light values nudge; drop
    everything the model doesn't need to answer a user's question well."""
    return (
        "You are Bucks, a helpful, local-first AI assistant inside the Bucks Browser. "
        "Answer the user's actual question directly, accurately, and concisely — stay on topic. "
        "Be honest: if you don't know something, say so rather than guessing. "
        "Act with fairness and respect the user's privacy. Decline only genuinely harmful or "
        "deceptive requests — everyday tasks like currency conversion, research, or shopping are "
        "perfectly fine and should just be answered helpfully."
    )


_RUNTIME_SYSTEM_PROMPT: str = _build_runtime_system_prompt(_FROZEN_DATA)

_CID_CACHE_FILE = Path(__file__).parent / ".frozen_cid_cache"


class FrozenMemory:
    """
    Singleton-style access to the immutable frozen memory layer.
    Also exposes the WorldSoul hash once the world soul is bootstrapped.
    """
    _cached_cid: str      = ""
    _world_soul_hash: str = ""   # set by server after WorldSoul.lock()

    # ── Frozen memory ─────────────────────────────────────────────────────────

    @staticmethod
    def get_system_prompt() -> str:
        """Full manifest — for hashing / peer verification / display, NOT for
        injecting into LLM calls (too heavy for small models). Use
        get_runtime_system_prompt() for actual prompts."""
        return _SYSTEM_PROMPT

    @staticmethod
    def get_runtime_system_prompt() -> str:
        """Slim system prompt for actual LLM calls — see _build_runtime_system_prompt."""
        return _RUNTIME_SYSTEM_PROMPT

    @staticmethod
    def get_hash() -> str:
        return _FROZEN_HASH

    @staticmethod
    def get_data() -> dict:
        return dict(_FROZEN_DATA)

    # ── IPFS CID (frozen_memory.json) ─────────────────────────────────────────

    @classmethod
    def get_ipfs_cid(cls) -> str:
        if not cls._cached_cid:
            cls._cached_cid = _load_cached_cid()
        return cls._cached_cid

    @classmethod
    def set_ipfs_cid(cls, cid: str) -> None:
        cls._cached_cid = cid
        _save_cached_cid(cid)

    @classmethod
    async def pin_to_ipfs(
        cls,
        ipfs_api_url: str = "http://localhost:5001",
        cluster_api_url: str = "http://127.0.0.1:9094",
    ) -> str:
        if cls._cached_cid:
            return cls._cached_cid
        from ipfs_cluster_client import IPFSClusterClient
        cid = await IPFSClusterClient(ipfs_api_url, cluster_api_url).add(
            _FROZEN_RAW.encode(), filename="frozen_memory.json",
        )
        if cid:
            cls.set_ipfs_cid(cid)
        return cid

    @classmethod
    async def verify_remote(cls, cid: str, ipfs_api_url: str = "http://localhost:5001") -> bool:
        if not cid:
            return False
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{ipfs_api_url}/api/v0/cat?arg={cid}",
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as resp:
                    content = await resp.read()
                    return hashlib.sha256(content).hexdigest() == _FROZEN_HASH
        except Exception:
            return False

    # ── WorldSoul hash (for soul manifest + peer verification) ────────────────

    @classmethod
    def get_world_soul_hash(cls) -> str:
        """Return the SHA256 of the locked WorldSoul (plaintext Quran hash)."""
        if cls._world_soul_hash:
            return cls._world_soul_hash
        # Try loading from meta file written by WorldSoul.lock()
        meta_file = Path(__file__).parent.parent.parent / "data" / "world_soul_meta.json"
        if meta_file.exists():
            try:
                cls._world_soul_hash = json.loads(
                    meta_file.read_text()
                ).get("sha256_plaintext", "")
            except Exception:
                pass
        return cls._world_soul_hash

    @classmethod
    def set_world_soul_hash(cls, sha: str) -> None:
        cls._world_soul_hash = sha


def _load_cached_cid() -> str:
    if _CID_CACHE_FILE.exists():
        try:
            return _CID_CACHE_FILE.read_text().strip()
        except Exception:
            pass
    return ""


def _save_cached_cid(cid: str) -> None:
    try:
        _CID_CACHE_FILE.write_text(cid)
    except Exception:
        pass
