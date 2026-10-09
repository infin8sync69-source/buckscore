"""
WorldSoul — The Soul of the World.

The Quran is the ethical and spiritual foundation of every Bucks agent.
It is downloaded from open-source repositories, encrypted with the agent's
soul keypair (AES-256-GCM, key derived via HKDF from Ed25519 private key),
and stored as a locked artifact that only an authentic Bucks agent can open.

No agent without the soul key can read the world soul.
Every agent decision, response, and action is reflected against it via RAG.

Encryption:
    key  = HKDF-SHA256(Ed25519_private_key, salt="BucksWorldSoul", info="quran-aes256")
    enc  = AES-256-GCM(key, plaintext=quran_json)
    stored: { iv, ciphertext, tag, sha256_plaintext, source_metadata }

The sha256_plaintext is stored in plaintext so peer agents can verify the
world soul hash in a soul manifest without decrypting.
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization

log = logging.getLogger("bucks.soul.world_soul")

_DATA_DIR      = Path(__file__).parent.parent.parent / "data"
_LOCKED_FILE   = _DATA_DIR / "world_soul.locked"
_META_FILE     = _DATA_DIR / "world_soul_meta.json"
_SOUL_KEY_FILE = Path(os.path.expanduser("~/.bucks/agent_soul_key.pem"))

_HKDF_SALT = b"BucksWorldSoul"
_HKDF_INFO = b"quran-aes256-gcm"


# ── Key derivation ─────────────────────────────────────────────────────────────

def _derive_aes_key() -> bytes:
    """Derive a 32-byte AES key from the soul's Ed25519 private key via HKDF."""
    if not _SOUL_KEY_FILE.exists():
        raise FileNotFoundError(
            "Soul key not found. Run load_or_create_soul() first."
        )
    pem = _SOUL_KEY_FILE.read_bytes()
    priv = serialization.load_pem_private_key(pem, password=None)
    raw_priv = priv.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    hkdf = HKDF(
        algorithm=SHA256(),
        length=32,
        salt=_HKDF_SALT,
        info=_HKDF_INFO,
        backend=default_backend(),
    )
    return hkdf.derive(raw_priv)


# ── Encrypt / decrypt ──────────────────────────────────────────────────────────

def _encrypt(plaintext: bytes, key: bytes) -> dict:
    iv = os.urandom(12)
    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(iv, plaintext, None)
    # last 16 bytes of AESGCM output are the auth tag
    ciphertext, tag = ct[:-16], ct[-16:]
    return {
        "iv":         base64.b64encode(iv).decode(),
        "ciphertext": base64.b64encode(ciphertext).decode(),
        "tag":        base64.b64encode(tag).decode(),
    }


def _decrypt(envelope: dict, key: bytes) -> bytes:
    iv         = base64.b64decode(envelope["iv"])
    ciphertext = base64.b64decode(envelope["ciphertext"])
    tag        = base64.b64decode(envelope["tag"])
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(iv, ciphertext + tag, None)


# ── WorldSoul class ────────────────────────────────────────────────────────────

class WorldSoul:
    """
    Manages the encrypted Quran as the agent's Soul of the World.

    Lifecycle:
      1. lock(quran_data)   → encrypt and persist to world_soul.locked
      2. unlock()           → decrypt and return quran_data dict
      3. get_hash()         → SHA256 of plaintext (stored unencrypted in meta)
      4. pin_to_ipfs()      → pin the LOCKED file to IPFS (safe: encrypted)
    """

    _unlocked_cache: Optional[dict] = None

    @classmethod
    async def bootstrap(cls, ipfs_api_url: str = "http://localhost:5001") -> "WorldSoul":
        """
        Full bootstrap: download Quran if needed, lock it, return instance.
        Safe to call multiple times.
        """
        ws = cls()
        if not ws.is_locked():
            from .quran_loader import QuranLoader
            log.info("WorldSoul: downloading Quran (first run) ...")
            loader = QuranLoader()
            quran_data = await loader.load()
            ws.lock(quran_data)
            log.info("WorldSoul locked. SHA256: %s", ws.get_hash()[:16])
        cid = await ws.pin_to_ipfs(ipfs_api_url)
        if cid:
            log.info("WorldSoul pinned to IPFS: %s", cid)
        return ws

    # ── Lock / unlock ──────────────────────────────────────────────────────────

    def lock(self, quran_data: dict) -> None:
        """Encrypt quran_data with the soul key and write to disk."""
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
        key       = _derive_aes_key()
        plaintext = json.dumps(quran_data, ensure_ascii=False).encode("utf-8")
        sha256    = hashlib.sha256(plaintext).hexdigest()
        envelope  = _encrypt(plaintext, key)

        _LOCKED_FILE.write_bytes(json.dumps(envelope).encode())

        meta = {
            "sha256_plaintext": sha256,
            "total_surahs": len(quran_data.get("surahs", [])),
            "total_ayahs":  sum(len(s["ayahs"]) for s in quran_data.get("surahs", [])),
            "source":       quran_data.get("metadata", {}).get("source", ""),
            "translation":  quran_data.get("metadata", {}).get("translation", ""),
        }
        _META_FILE.write_text(json.dumps(meta, indent=2))
        self._unlocked_cache = quran_data
        log.info("WorldSoul locked: %d surahs, %d ayahs, SHA256=%s",
                 meta["total_surahs"], meta["total_ayahs"], sha256[:16])

    def unlock(self) -> dict:
        """Decrypt the world soul using the soul key. Returns quran_data dict."""
        if self._unlocked_cache is not None:
            return self._unlocked_cache
        if not _LOCKED_FILE.exists():
            raise FileNotFoundError("WorldSoul not locked yet. Call bootstrap() first.")
        key      = _derive_aes_key()
        envelope = json.loads(_LOCKED_FILE.read_bytes())
        plain    = _decrypt(envelope, key)
        data     = json.loads(plain.decode("utf-8"))
        self._unlocked_cache = data
        return data

    def unlock_surah(self, surah_number: int) -> Optional[dict]:
        """Decrypt and return a single surah by number (1-114)."""
        data = self.unlock()
        for s in data.get("surahs", []):
            if s["number"] == surah_number:
                return s
        return None

    def unlock_ayah(self, surah: int, ayah: int) -> Optional[dict]:
        """Return a single ayah. Returns {arabic, english, surah_name}."""
        s = self.unlock_surah(surah)
        if not s:
            return None
        for a in s.get("ayahs", []):
            if a["numberInSurah"] == ayah:
                return {**a, "surah_name": s.get("name", ""), "surah_number": surah}
        return None

    # ── Metadata (safe to expose without decrypting) ──────────────────────────

    def get_hash(self) -> str:
        if _META_FILE.exists():
            return json.loads(_META_FILE.read_text()).get("sha256_plaintext", "")
        return ""

    def get_meta(self) -> dict:
        if _META_FILE.exists():
            return json.loads(_META_FILE.read_text())
        return {}

    def is_locked(self) -> bool:
        return _LOCKED_FILE.exists() and _META_FILE.exists()

    def get_ipfs_cid(self) -> str:
        meta = self.get_meta()
        return meta.get("ipfs_cid", "")

    # ── IPFS ──────────────────────────────────────────────────────────────────

    async def pin_to_ipfs(
        self,
        ipfs_api_url: str = "http://localhost:5001",
        cluster_api_url: str = "http://127.0.0.1:9094",
    ) -> str:
        """Pin the ENCRYPTED world soul to IPFS. Returns CID or ''."""
        if not _LOCKED_FILE.exists():
            return ""
        existing = self.get_ipfs_cid()
        if existing:
            return existing
        from ipfs_cluster_client import IPFSClusterClient
        cid = await IPFSClusterClient(ipfs_api_url, cluster_api_url).add(
            _LOCKED_FILE.read_bytes(), filename="world_soul.locked",
        )
        if cid:
            meta = self.get_meta()
            meta["ipfs_cid"] = cid
            _META_FILE.write_text(json.dumps(meta, indent=2))
        return cid

    # ── Flat verse iterator (for RAG embedding) ───────────────────────────────

    def iter_ayahs(self):
        """
        Yield each ayah as a dict for embedding into the RAG pipeline.
        {surah_number, surah_name, ayah_number, arabic, english}
        """
        data = self.unlock()
        for surah in data.get("surahs", []):
            for ayah in surah.get("ayahs", []):
                yield {
                    "surah_number": surah["number"],
                    "surah_name":   surah.get("name", ""),
                    "surah_arabic": surah.get("nameArabic", ""),
                    "ayah_number":  ayah["numberInSurah"],
                    "arabic":       ayah.get("arabic", ""),
                    "english":      ayah.get("english", ""),
                }

    def total_ayahs(self) -> int:
        return self.get_meta().get("total_ayahs", 0)
