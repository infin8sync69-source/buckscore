"""
Soul Validator — verifies peer soul manifests before any trust is granted.

Two checks must both pass:
  1. Ed25519 signature over the canonical payload.
  2. frozenMemoryHash matches our own frozen memory (fast path) OR
     frozenMemoryCid resolves on IPFS with matching hash (full verify).

An agent that fails either check is not a Bucks agent.
"""
import hashlib
import logging
from typing import Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives import serialization
from cryptography.exceptions import InvalidSignature

from .frozen import FrozenMemory

log = logging.getLogger("bucks.soul.validator")


def _reconstruct_payload(soul: dict) -> str:
    """Rebuild the exact string that was signed during soul generation."""
    caps = ",".join(sorted(soul.get("capabilities", [])))
    version = soul.get("version", "1.0.0")
    if version.startswith("2."):
        # v2 soul includes worldSoulHash in signature payload
        return "|".join([
            soul.get("soulId", ""),
            soul.get("frozenMemoryHash", ""),
            soul.get("frozenMemoryCid", ""),
            soul.get("worldSoulHash", ""),
            caps,
            soul.get("issuedAt", ""),
        ])
    # v1 legacy — no worldSoulHash
    return "|".join([
        soul.get("soulId", ""),
        soul.get("frozenMemoryHash", ""),
        soul.get("frozenMemoryCid", ""),
        caps,
        soul.get("issuedAt", ""),
    ])


def verify_signature(soul: dict) -> bool:
    """Verify Ed25519 signature embedded in the soul manifest."""
    try:
        soul_id_hex = soul.get("soulId", "")
        sig_hex = soul.get("signature", "")
        if not soul_id_hex or not sig_hex:
            return False

        pub_bytes = bytes.fromhex(soul_id_hex)
        pub_key = Ed25519PublicKey.from_public_bytes(pub_bytes)
        payload = _reconstruct_payload(soul)
        pub_key.verify(bytes.fromhex(sig_hex), payload.encode())
        return True
    except InvalidSignature:
        log.warning("Soul signature invalid for soulId=%s", soul.get("soulId", "?")[:16])
        return False
    except Exception as e:
        log.error("Soul signature verification error: %s", e)
        return False


def verify_frozen_memory_hash(soul: dict) -> bool:
    """
    Fast local check: does the soul's frozenMemoryHash match ours?
    This is the primary guard — no IPFS round-trip required.
    """
    peer_hash = soul.get("frozenMemoryHash", "")
    return peer_hash == FrozenMemory.get_hash()


async def verify_frozen_memory_remote(
    soul: dict,
    ipfs_api_url: str = "http://localhost:5001",
) -> bool:
    """
    Full remote verify: fetch peer's frozenMemoryCid from IPFS and
    confirm its SHA256 matches our local frozen hash.
    Use when fast hash check fails or for high-trust operations.
    """
    cid = soul.get("frozenMemoryCid", "")
    if not cid:
        return False
    return await FrozenMemory.verify_remote(cid, ipfs_api_url)


def verify_world_soul_hash(soul: dict) -> bool:
    """
    Verify that a peer's worldSoulHash matches ours.
    This ensures both agents carry the same Quran soul.
    v1 souls (no worldSoulHash field) pass — backward compatible.
    """
    peer_hash = soul.get("worldSoulHash", "")
    if not peer_hash:
        return True  # v1 soul — no world soul hash required
    local_hash = FrozenMemory.get_world_soul_hash()
    if not local_hash:
        return True  # we haven't bootstrapped world soul yet — allow
    match = peer_hash == local_hash
    if not match:
        log.warning(
            "Rejected soul (world soul mismatch): %s — peer=%s local=%s",
            soul.get("soulId", "?")[:16], peer_hash[:16], local_hash[:16],
        )
    return match


def is_trusted(soul: dict, require_remote: bool = False) -> bool:
    """
    Synchronous trust check (fast path — hash only, no IPFS).
    Signature + frozen memory hash + world soul hash must all pass.
    """
    if not verify_signature(soul):
        log.warning("Rejected soul (bad signature): %s", soul.get("soulId", "?")[:16])
        return False
    if not verify_frozen_memory_hash(soul):
        log.warning(
            "Rejected soul (frozen memory mismatch): %s — peer=%s local=%s",
            soul.get("soulId", "?")[:16],
            soul.get("frozenMemoryHash", "?")[:16],
            FrozenMemory.get_hash()[:16],
        )
        return False
    if not verify_world_soul_hash(soul):
        return False
    return True


async def is_trusted_full(
    soul: dict,
    ipfs_api_url: str = "http://localhost:5001",
) -> bool:
    """
    Full async trust check — signature + remote IPFS frozen memory verification.
    Use before high-trust operations like service delegation.
    """
    if not verify_signature(soul):
        return False
    # Fast hash check first — skip IPFS if it matches
    if verify_frozen_memory_hash(soul):
        return True
    # Fall back to remote IPFS verification
    return await verify_frozen_memory_remote(soul, ipfs_api_url)


def is_compatible(soul_a: dict, soul_b: dict) -> bool:
    """Check if two souls are on the same network (same CIDN)."""
    return soul_a.get("cidn") == soul_b.get("cidn")
