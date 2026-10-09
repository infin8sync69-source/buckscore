"""
Soul Generator — creates and persists the agent's cryptographic soul identity.
Binds Ed25519 keypair to frozen memory CID so peers can verify both.
"""
import json
import os
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

from .frozen import FrozenMemory

_SOUL_DIR = Path(os.getenv("BUCKS_HOME", os.path.expanduser("~/.bucks")))
_SOUL_KEY_FILE = _SOUL_DIR / "agent_soul_key.pem"
_SOUL_FILE = _SOUL_DIR / "agent_soul.json"

DEFAULT_CAPABILITIES = [
    "rag_search",
    "ride_dispatch",
    "commerce",
    "code",
    "browser",
    "calendar",
    "wallet",
    "ipfs",
]


def _ensure_dir() -> None:
    _SOUL_DIR.mkdir(parents=True, exist_ok=True)


def _load_or_generate_keypair() -> Ed25519PrivateKey:
    _ensure_dir()
    if _SOUL_KEY_FILE.exists():
        pem = _SOUL_KEY_FILE.read_bytes()
        return serialization.load_pem_private_key(pem, password=None)
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    _SOUL_KEY_FILE.write_bytes(pem)
    _SOUL_KEY_FILE.chmod(0o600)
    return key


def _sign(private_key: Ed25519PrivateKey, payload: str) -> str:
    sig = private_key.sign(payload.encode())
    return sig.hex()


def _soul_id(private_key: Ed25519PrivateKey) -> str:
    pub = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return pub.hex()


def generate_soul(
    locality: str = "global",
    capabilities: Optional[list] = None,
    cidn: str = "mainnet",
) -> dict:
    """
    Generate a new soul manifest, sign it, and persist it to disk.
    frozenMemoryHash and frozenMemoryCid are embedded so peers can
    verify both the signing key and the frozen memory simultaneously.
    """
    _ensure_dir()
    key = _load_or_generate_keypair()
    soul_id = _soul_id(key)
    caps = capabilities or DEFAULT_CAPABILITIES
    frozen_hash = FrozenMemory.get_hash()
    frozen_cid = FrozenMemory.get_ipfs_cid()
    issued_at = datetime.now(timezone.utc).isoformat()

    # Include WorldSoul hash so peers can verify Quran soul
    from .frozen import FrozenMemory as _FM
    world_soul_hash = _FM.get_world_soul_hash()

    # Canonical payload for signing — order matters for determinism
    payload = "|".join([soul_id, frozen_hash, frozen_cid, world_soul_hash, ",".join(sorted(caps)), issued_at])
    signature = _sign(key, payload)

    soul = {
        "soulId": soul_id,
        "did": f"did:bucks:{soul_id}",
        "version": "2.0.0",
        "cidn": cidn,
        "capabilities": caps,
        "locality": locality,
        "ancestry": [],
        "frozenMemoryCid": frozen_cid,
        "frozenMemoryHash": frozen_hash,
        "worldSoulHash": world_soul_hash,
        "issuedAt": issued_at,
        "signature": signature,
    }

    _SOUL_FILE.write_text(json.dumps(soul, indent=2))
    return soul


def load_or_create_soul(
    locality: str = "global",
    capabilities: Optional[list] = None,
    cidn: str = "mainnet",
) -> dict:
    """Idempotent — returns existing soul or generates a new one."""
    if _SOUL_FILE.exists():
        try:
            soul = json.loads(_SOUL_FILE.read_text())
            # Refresh frozenMemoryCid if it was empty when first generated
            if not soul.get("frozenMemoryCid") and FrozenMemory.get_ipfs_cid():
                soul = generate_soul(
                    locality=soul.get("locality", locality),
                    capabilities=soul.get("capabilities", capabilities),
                    cidn=soul.get("cidn", cidn),
                )
            return soul
        except Exception:
            pass
    return generate_soul(locality=locality, capabilities=capabilities, cidn=cidn)


def get_public_key_bytes() -> bytes:
    key = _load_or_generate_keypair()
    return key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )


def sign_payload(payload: str) -> str:
    key = _load_or_generate_keypair()
    return _sign(key, payload)
