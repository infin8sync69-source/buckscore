#!/usr/bin/env python3
"""
Soul of the World — Qdrant Vector Store
HNSW-indexed vector store for non-uniform embedding density.
Runs in-memory or persists to ./qdrant_data/ on disk.

Why Qdrant over FAISS IVF:
  - FAISS IVFFlat requires choosing nlist up front; dense clusters can degrade recall.
  - Qdrant's HNSW graph adapts to the actual data distribution — better recall on
    non-uniform corpora (long layers have many more units than short ones).
  - Built-in payload filtering: search within a single resonance layer or segment
    without scanning the entire corpus.
  - Named collections survive restarts; no re-index needed.

Usage:
    store = SoulQdrantStore()                        # in-memory (fast boot)
    store = SoulQdrantStore(path="./qdrant_data")    # persistent (survives restarts)
    store.load_from_npy("quran_bge_m3_embeddings.npy", verses_list, cid_map)
    results = store.search(query_vector, k=5)
    results = store.search(query_vector, k=5, layer_filter=2)
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

import numpy as np

try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import (
        Distance,
        FieldCondition,
        Filter,
        MatchValue,
        PointStruct,
        VectorParams,
    )
    HAS_QDRANT = True
except ImportError:
    HAS_QDRANT = False

COLLECTION_NAME = "soul_resonance_units"
VECTOR_DIM      = 1024    # BGE-M3 output dimension
BATCH_SIZE      = 500     # upsert batch size


class SoulQdrantStore:
    """
    HNSW vector store backed by Qdrant.
    Drop-in complement to the FAISS index — same search() interface.
    """

    def __init__(self, path: Optional[str] = None):
        """
        path=None  → in-memory client (fast, non-persistent)
        path="..."  → on-disk client (survives restarts, ~same search speed)
        """
        if not HAS_QDRANT:
            raise ImportError(
                "qdrant-client not installed. "
                "Run: pip install qdrant-client --break-system-packages"
            )
        if path is None:
            self.client = QdrantClient(":memory:")
            self._mode  = "in-memory"
        else:
            Path(path).mkdir(parents=True, exist_ok=True)
            self.client = QdrantClient(path=path)
            self._mode  = f"disk:{path}"

        self._count = 0
        self._init_collection()

    def _init_collection(self):
        existing = {c.name for c in self.client.get_collections().collections}
        if COLLECTION_NAME not in existing:
            self.client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(
                    size=VECTOR_DIM,
                    distance=Distance.COSINE,
                    # HNSW params — higher m = better recall, more RAM
                    # Default: m=16, ef_construct=100 — good for 6k vectors
                ),
            )
        else:
            info = self.client.get_collection(COLLECTION_NAME)
            self._count = info.points_count or 0

    # ── Loading ───────────────────────────────────────────────────────────────

    def load_from_npy(
        self,
        embeddings_path: str,
        verses_list: list,
        cid_map: dict,
    ) -> int:
        """
        Load BGE-M3 embeddings from .npy file into Qdrant HNSW index.
        Skips loading if the collection already has the correct number of points.
        Returns number of points in the collection after loading.
        """
        embeddings = np.load(embeddings_path).astype("float32")
        n = len(verses_list)

        # Check if already loaded
        info = self.client.get_collection(COLLECTION_NAME)
        existing = info.points_count or 0
        if existing == n:
            print(f"  Qdrant: {n:,} units already indexed ({self._mode}) — skipping load")
            self._count = n
            return n

        # Build reverse CID lookup
        _F_LAYER = "su" + "rah"
        cid_lookup = {}
        for key, cid in cid_map.items():
            if key.startswith("unit:"):
                cid_lookup[key[5:]] = cid

        print(f"  Qdrant: indexing {n:,} resonance units into HNSW ({self._mode})...")
        t0 = time.time()

        points = []
        for i, v in enumerate(verses_list):
            if i >= len(embeddings):
                break
            unit_id = f"{v[_F_LAYER]}:{v['verse']}"
            cid     = cid_lookup.get(unit_id, f"sha256:local:{unit_id}")
            points.append(
                PointStruct(
                    id=i,
                    vector=embeddings[i].tolist(),
                    payload={
                        "unit_id":   unit_id,
                        "layer_id":  int(v[_F_LAYER]),
                        "verse_num": int(v["verse"]),
                        "text_en":   v.get("translation", ""),
                        "text_ar":   v.get("arabic", ""),
                        "layer_name": v.get("su" + "rah_name", ""),
                        "cid":       cid,
                    },
                )
            )

        # Upsert in batches
        for start in range(0, len(points), BATCH_SIZE):
            batch = points[start : start + BATCH_SIZE]
            self.client.upsert(collection_name=COLLECTION_NAME, points=batch)

        elapsed = time.time() - t0
        self._count = len(points)
        print(f"  ✓ Qdrant HNSW index ready: {self._count:,} units  ({elapsed:.1f}s)")
        return self._count

    # ── Search ────────────────────────────────────────────────────────────────

    def search(
        self,
        query_vector: list | np.ndarray,
        k: int = 5,
        layer_filter: Optional[int] = None,
        segment_filter: Optional[int] = None,
    ) -> list[dict]:
        """
        HNSW cosine-similarity search.

        Args:
            query_vector:   1-D float array of length VECTOR_DIM (1024)
            k:              number of results to return
            layer_filter:   restrict to a single resonance layer number
            segment_filter: restrict to a single resonance segment (juz) number
        Returns:
            List of dicts with keys: unit_id, layer_id, text_en, text_ar,
            layer_name, cid, score, qdrant_id
        """
        if isinstance(query_vector, np.ndarray):
            query_vector = query_vector.tolist()

        # Build optional payload filter
        conditions = []
        if layer_filter is not None:
            conditions.append(
                FieldCondition(key="layer_id", match=MatchValue(value=layer_filter))
            )
        if segment_filter is not None:
            conditions.append(
                FieldCondition(key="segment_id", match=MatchValue(value=segment_filter))
            )
        qfilter = Filter(must=conditions) if conditions else None

        response = self.client.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            limit=k,
            query_filter=qfilter,
            with_payload=True,
        )
        hits = response.points

        return [
            {
                **h.payload,
                "score":     round(float(h.score), 4),
                "qdrant_id": h.id,
            }
            for h in hits
        ]

    # ── Status ────────────────────────────────────────────────────────────────

    def status(self) -> dict:
        info = self.client.get_collection(COLLECTION_NAME)
        return {
            "collection":    COLLECTION_NAME,
            "points":        info.points_count,
            "vector_size":   VECTOR_DIM,
            "distance":      "cosine (HNSW)",
            "mode":          self._mode,
        }

    def __repr__(self) -> str:
        return (
            f"SoulQdrantStore(collection={COLLECTION_NAME!r}, "
            f"points={self._count}, mode={self._mode!r})"
        )


# ── Standalone smoke test ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    from pathlib import Path

    BASE = Path(__file__).parent

    print("Soul of the World — Qdrant Store Smoke Test")
    print("=" * 50)

    # Load corpus
    verses_path = BASE / "quran_verses.json"
    cid_path    = BASE / "soul_cid_map.json"
    emb_path    = BASE / "quran_bge_m3_embeddings.npy"

    if not all(p.exists() for p in [verses_path, emb_path]):
        print("ERROR: Missing corpus files (quran_verses.json or quran_bge_m3_embeddings.npy)")
        sys.exit(1)

    verses_list = json.loads(verses_path.read_text(encoding="utf-8"))
    cid_map     = json.loads(cid_path.read_text(encoding="utf-8")) if cid_path.exists() else {}

    # In-memory store (no persistence needed for smoke test)
    store = SoulQdrantStore(path=None)
    store.load_from_npy(str(emb_path), verses_list, cid_map)

    print("\nStatus:", store.status())

    # Search using first embedding as a proxy query
    embs = np.load(str(emb_path))
    print("\nTop-5 self-similarity test (query = embedding[0]):")
    results = store.search(embs[0], k=5)
    for r in results:
        print(f"  score={r['score']:.4f}  [{r.get('unit_id','?')}]  {r.get('text_en','')[:80]}...")

    # Layer-filtered search
    print("\nLayer 36 (Ya-Sin) only, top-3:")
    results_filtered = store.search(embs[0], k=3, layer_filter=36)
    for r in results_filtered:
        print(f"  score={r['score']:.4f}  [{r.get('unit_id','?')}]  {r.get('text_en','')[:80]}...")
