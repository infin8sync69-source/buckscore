"""
Embedder — converts text to dense vector representations.

Primary:  Ollama nomic-embed-text (local, free, 768-dim)
Fallback: Deterministic TF-IDF-style hash vector (offline safe, 256-dim)
"""
import hashlib
import logging
import math
from typing import List

import aiohttp

log = logging.getLogger("bucks.rag.embedder")

_OLLAMA_EMBED_URL = "http://localhost:11434/api/embeddings"
_EMBED_MODEL      = "nomic-embed-text"
_FALLBACK_DIM     = 256


async def embed(text: str, model: str = _EMBED_MODEL) -> List[float]:
    """Embed a single string. Returns a vector or falls back to hash vector."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                _OLLAMA_EMBED_URL,
                json={"model": model, "prompt": text},
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("embedding", [])
    except Exception as e:
        log.debug("Ollama embed unavailable (%s), using fallback", e)
    return _hash_embed(text)


async def embed_batch(texts: List[str], model: str = _EMBED_MODEL) -> List[List[float]]:
    """Embed multiple strings. Sequential — Ollama doesn't batch yet."""
    results = []
    for t in texts:
        results.append(await embed(t, model))
    return results


# ── Fallback: deterministic hash embedding ────────────────────────────────────

def _hash_embed(text: str, dim: int = _FALLBACK_DIM) -> List[float]:
    """
    Deterministic TF-IDF-inspired hash vector.
    Not semantically rich, but consistent — same text → same vector.
    Allows the system to operate fully offline.
    """
    tokens = text.lower().split()
    vec = [0.0] * dim
    for tok in tokens:
        h = int(hashlib.sha256(tok.encode()).hexdigest(), 16)
        idx = h % dim
        # TF weight: log(1 + count)
        vec[idx] += 1.0
    # L2 normalize
    mag = math.sqrt(sum(x * x for x in vec))
    if mag > 0:
        vec = [x / mag for x in vec]
    return vec
