"""
MemoryItem — a single unit of floating memory with priority scoring.

Priority = relevance (50%) + recency (20%) + feedback (20%) + trend (10%)
Items below the eviction threshold are pruned from ChromaDB periodically.
"""
import math
import time
import hashlib
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class MemoryItem:
    text: str
    source: str                          # "interaction", "knowledge_base", "ipfs_peer", etc.
    embedding: List[float]
    timestamp: float = field(default_factory=time.time)
    feedback_score: float = 0.0          # accumulated: +1 per positive, -1 per negative
    retrieval_count: int = 0             # times surfaced to LLM context
    item_id: str = ""

    def __post_init__(self):
        if not self.item_id:
            self.item_id = hashlib.sha256(self.text.encode()).hexdigest()[:16]

    # ── Scoring ───────────────────────────────────────────────────────────────

    def priority_score(self, query_embedding: List[float]) -> float:
        relevance  = _cosine(self.embedding, query_embedding) if query_embedding else 0.0
        recency    = self._recency_score()
        feedback   = self._feedback_score()
        trend      = self._trend_score()
        return (relevance * 0.5) + (recency * 0.2) + (feedback * 0.2) + (trend * 0.1)

    def _recency_score(self) -> float:
        age_hours = (time.time() - self.timestamp) / 3600
        return math.exp(-age_hours / 24.0)  # half-life 24h

    def _feedback_score(self) -> float:
        # Normalize feedback into [0, 1]; neutral = 0.5
        return min(1.0, max(0.0, (self.feedback_score + 5) / 10))

    def _trend_score(self) -> float:
        # More retrievals → higher trend score, log-capped
        return min(1.0, math.log1p(self.retrieval_count) / 5)

    # ── Mutations ─────────────────────────────────────────────────────────────

    def boost(self, delta: float = 1.0) -> None:
        self.feedback_score = min(5.0, self.feedback_score + delta)

    def penalize(self, delta: float = 1.0) -> None:
        self.feedback_score = max(-5.0, self.feedback_score - delta)

    def record_retrieval(self) -> None:
        self.retrieval_count += 1

    # ── Serialization ─────────────────────────────────────────────────────────

    def to_chroma_metadata(self) -> dict:
        return {
            "source":          self.source,
            "timestamp":       self.timestamp,
            "feedback_score":  self.feedback_score,
            "retrieval_count": self.retrieval_count,
            "item_id":         self.item_id,
        }

    @classmethod
    def from_chroma(cls, doc: str, metadata: dict, embedding: List[float]) -> "MemoryItem":
        return cls(
            text=doc,
            source=metadata.get("source", "unknown"),
            embedding=embedding,
            timestamp=float(metadata.get("timestamp", time.time())),
            feedback_score=float(metadata.get("feedback_score", 0.0)),
            retrieval_count=int(metadata.get("retrieval_count", 0)),
            item_id=metadata.get("item_id", ""),
        )


# ── Utility ───────────────────────────────────────────────────────────────────

def _cosine(a: List[float], b: List[float]) -> float:
    # ChromaDB returns embeddings as numpy arrays, where `not a` raises
    # ValueError (ambiguous truth value) instead of testing emptiness —
    # use explicit length checks so this works for both lists and ndarrays.
    if a is None or b is None or len(a) == 0 or len(b) == 0 or len(a) != len(b):
        return 0.0
    dot   = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x * x for x in a))
    mag_b = math.sqrt(sum(x * x for x in b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)
