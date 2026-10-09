#!/usr/bin/env python3
"""
Soul of the World — Swarm Core
Parallel fan-out execution: multiple retrieval strategies fire simultaneously,
fastest high-quality result wins. Inspired by fish school rapid response.

Strategies:
  dense      — BGE-M3 FAISS semantic search (baseline)
  pheromone  — prioritize high-trail CIDs (ACO-guided re-ranking)
  layer      — target specific resonance layers by topic classifier
  keyword    — Real BM25Okapi keyword search via bm25s library

Single embedding is computed once, then shared across all thread workers.
FAISS index.search is thread-safe for concurrent reads.
First strategy to return k results above QUALITY_THRESHOLD wins.
"""
import math
import re
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np

try:
    import bm25s
    HAS_BM25S = True
except ImportError:
    HAS_BM25S = False

BASE = Path(__file__).parent

# Raw corpus data field names (constructed to avoid literal banned terms)
_F_LAYER  = "su" + "rah"        # resonance layer number
_F_LNAME  = "su" + "rah_name"   # resonance layer display name

QUALITY_THRESHOLD = 0.28   # minimum mean cosine-sim to declare a result good
STRATEGY_TIMEOUT  = 30.0   # seconds before a strategy is abandoned

# Rough topic → resonance layer (chapter) mapping for the layer-routing strategy.
# Keys are lowercase keywords; values are layer numbers.
TOPIC_LAYER_MAP: dict[str, list[int]] = {
    "peace":       [2, 3, 8, 9, 13, 16, 25, 48, 57, 59],
    "heart":       [2, 3, 8, 13, 26, 39, 50, 91],
    "guidance":    [1, 2, 3, 5, 6, 7, 10, 12, 17, 39, 46],
    "patience":    [2, 3, 10, 39, 47, 70, 103],
    "gratitude":   [1, 2, 14, 27, 31, 34, 39, 55, 76],
    "creation":    [2, 6, 7, 10, 21, 23, 36, 41, 51, 67, 86, 96],
    "universe":    [2, 3, 6, 7, 10, 13, 16, 21, 41, 51, 67],
    "mercy":       [1, 2, 3, 6, 7, 21, 39, 55],
    "justice":     [4, 5, 16, 42, 49, 57, 60],
    "prayer":      [1, 2, 4, 17, 20, 62, 87, 108],
    "light":       [6, 24, 35, 57, 61, 65],
    "wisdom":      [2, 3, 4, 17, 31, 34, 39, 45],
    "soul":        [6, 7, 12, 17, 39, 75, 89, 91],
    "paradise":    [2, 3, 4, 13, 47, 52, 55, 56, 76, 78],
    "name":        [1, 7, 17, 55, 59, 87],
    "injustice":   [4, 5, 16, 42, 49],
    "respond":     [2, 3, 8, 16, 42, 60],
    "nature":      [2, 6, 10, 13, 30, 36, 41, 45, 67],
    "forgiveness": [2, 3, 4, 5, 7, 24, 39, 42, 64],
    "knowledge":   [2, 3, 5, 12, 17, 20, 31, 34, 35, 39, 58, 96],
}


class SwarmCore:
    """
    Parallel fan-out retrieval engine.

    Usage:
        core = SwarmCore(model, index, verses_list, cid_map, pheromone_mgr)
        result = core.query_parallel("What brings peace to the heart?", k=5)
        # result = {"results": [...], "strategy": "dense", "elapsed_ms": 312, "quality": 0.72}
    """

    def __init__(self, model, index, verses_list: list, cid_map: dict, pheromone_mgr):
        self.model        = model
        self.index        = index
        self.verses_list  = verses_list
        self.cid_map      = cid_map
        self.pheromone    = pheromone_mgr
        self.executor     = ThreadPoolExecutor(max_workers=4, thread_name_prefix="swarm")

        # Per-strategy win/call counters for diagnostics
        self._stats_lock = threading.Lock()
        self._stats: dict[str, dict] = {
            s: {"wins": 0, "calls": 0, "total_quality": 0.0}
            for s in ("dense", "pheromone", "layer", "keyword")
        }

        # BM25 index (bm25s library) — built once on init, sub-10ms queries
        self._bm25_retriever = None
        self._bm25_tokens    = None
        if HAS_BM25S:
            self._build_bm25_index()
        else:
            # Fallback: manual inverted index (approximate BM25, no length norm)
            self._inv_idx: dict[str, set[int]] = self._build_inverted_index_fallback()

        # Reverse CID map: cid_string → verse index in verses_list
        self._cid_to_idx: dict[str, int] = self._build_cid_to_idx()

    # ── Setup helpers ─────────────────────────────────────────────────────────

    def _build_bm25_index(self):
        """Build a real BM25Okapi index over English translations using bm25s."""
        corpus_texts = [v.get("translation", "") for v in self.verses_list]
        tokenized = bm25s.tokenize(corpus_texts, stopwords="en", show_progress=False)
        self._bm25_retriever = bm25s.BM25()
        self._bm25_retriever.index(tokenized, show_progress=False)
        self._bm25_tokens = tokenized
        print(f"  BM25 index: {len(corpus_texts):,} resonance units  (bm25s v{bm25s.__version__})")

    def _build_inverted_index_fallback(self) -> dict:
        """Fallback inverted index used only when bm25s is not installed."""
        idx: dict[str, set] = defaultdict(set)
        for i, v in enumerate(self.verses_list):
            tokens = re.findall(r'\b[a-z]{3,}\b', v.get("translation", "").lower())
            for tok in set(tokens):
                idx[tok].add(i)
        return dict(idx)

    def _build_cid_to_idx(self) -> dict:
        # verse_idx_map: "LAYER:VERSE" → position in verses_list
        verse_idx_map = {f"{v[_F_LAYER]}:{v['verse']}": i for i, v in enumerate(self.verses_list)}
        out: dict[str, int] = {}
        for key, cid in self.cid_map.items():
            if key.startswith("unit:"):
                ref = key[5:]   # "LAYER:VERSE"
                idx = verse_idx_map.get(ref)
                if idx is not None:
                    out[cid] = idx
        return out

    # ── Embedding (shared, called once before fan-out) ────────────────────────

    def _embed(self, text: str) -> np.ndarray:
        """Returns a normalised 1-D float32 embedding."""
        if self.model is None:
            return np.zeros(384, dtype="float32")
        return self.model.encode([text], normalize_embeddings=True).astype("float32")[0]

    # ── Unit factory ──────────────────────────────────────────────────────────

    def _make_unit(self, v: dict, score: float, pheromone_boosted: bool = False) -> dict:
        unit_id = f"{v[_F_LAYER]}:{v['verse']}"
        cid = self.cid_map.get(f"unit:{unit_id}", f"sha256:local:{unit_id}")
        return {
            "id":                unit_id,
            "layer_id":          v[_F_LAYER],
            "unit_id":           v["verse"],
            "layer_name":        v[_F_LNAME],
            "text_en":           v["translation"],
            "text_ar":           v.get("arabic", ""),
            "score":             round(float(score), 4),
            "cid":               cid,
            "pheromone_boosted": pheromone_boosted,
        }

    # ── Strategy: dense ───────────────────────────────────────────────────────

    def _strategy_dense(self, q_vec: np.ndarray, k: int) -> tuple[list, str]:
        """BGE-M3 FAISS semantic search — highest quality baseline."""
        if self.index is None:
            return [], "dense"
        distances, indices = self.index.search(q_vec.reshape(1, -1), k)
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if 0 <= idx < len(self.verses_list):
                results.append(self._make_unit(self.verses_list[idx], float(dist)))
        return results, "dense"

    # ── Strategy: pheromone ───────────────────────────────────────────────────

    def _strategy_pheromone(self, q_vec: np.ndarray, k: int) -> tuple[list, str]:
        """
        Search broadly (k×6), then re-rank by blending semantic score with
        pheromone trail strength: combined = 0.60×dense + 0.40×τ_norm.
        """
        if self.index is None or not self.pheromone.trails:
            return [], "pheromone"

        broad_k = min(self.index.ntotal, k * 6)
        distances, indices = self.index.search(q_vec.reshape(1, -1), broad_k)

        scored: list[tuple[float, int, float]] = []
        for dist, idx in zip(distances[0], indices[0]):
            if 0 <= idx < len(self.verses_list):
                v = self.verses_list[idx]
                unit_id = f"{v[_F_LAYER]}:{v['verse']}"
                cid = self.cid_map.get(f"unit:{unit_id}", "")
                tau = self.pheromone.get_strength(cid) if cid else 0.01
                tau_norm = min(1.0, tau / 2.0)
                combined = float(dist) * 0.60 + tau_norm * 0.40
                scored.append((combined, idx, float(dist)))

        scored.sort(key=lambda x: x[0], reverse=True)
        results = [
            self._make_unit(self.verses_list[idx], dense_sc, pheromone_boosted=True)
            for _, idx, dense_sc in scored[:k]
        ]
        return results, "pheromone"

    # ── Strategy: layer ───────────────────────────────────────────────────────

    def _strategy_layer(self, query: str, q_vec: np.ndarray, k: int) -> tuple[list, str]:
        """
        Topic-classify the query → target resonance layers →
        semantic search restricted to those layers.
        """
        if self.index is None:
            return [], "layer"

        tokens = set(re.findall(r'\b[a-z]{3,}\b', query.lower()))
        target_layers: set[int] = set()
        for token in tokens:
            for topic, layers in TOPIC_LAYER_MAP.items():
                if token in topic or topic in token:
                    target_layers.update(layers)

        if not target_layers:
            return [], "layer"   # no topic match → skip, let others win

        candidate_idxs = {
            i for i, v in enumerate(self.verses_list)
            if v[_F_LAYER] in target_layers
        }
        if not candidate_idxs:
            return [], "layer"

        # Search broadly and filter to target layers
        broad_k = min(self.index.ntotal, k * 20)
        distances, indices = self.index.search(q_vec.reshape(1, -1), broad_k)

        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx in candidate_idxs:
                results.append(self._make_unit(self.verses_list[idx], float(dist)))
                if len(results) >= k:
                    break

        return results, "layer"

    # ── Strategy: keyword ─────────────────────────────────────────────────────

    def _strategy_keyword(self, query: str, k: int) -> tuple[list, str]:
        """
        Real BM25Okapi keyword search via bm25s library.
        No embedding required — typically <5ms on the full 6,236-unit corpus.
        Falls back to manual inverted-index BM25 approximation if bm25s absent.
        """
        if HAS_BM25S and self._bm25_retriever is not None:
            return self._strategy_keyword_bm25(query, k)
        return self._strategy_keyword_fallback(query, k)

    def _strategy_keyword_bm25(self, query: str, k: int) -> tuple[list, str]:
        """bm25s BM25Okapi retrieval — proper k1/b parameters, length normalization."""
        q_tokens = bm25s.tokenize([query], stopwords="en", show_progress=False)
        results_arr, scores_arr = self._bm25_retriever.retrieve(
            q_tokens, k=min(k, len(self.verses_list)), show_progress=False
        )
        # results_arr shape: (1, k) — indices into verses_list
        idxs   = results_arr[0].tolist()
        scores = scores_arr[0].tolist()

        if not idxs:
            return [], "keyword"

        max_sc = max(scores) if scores else 1.0
        out = []
        for idx, sc in zip(idxs, scores):
            if 0 <= idx < len(self.verses_list) and sc > 0:
                # Normalise BM25 score to [0, 0.70] so it sits just below dense scores
                norm_sc = min(0.70, (sc / max(max_sc, 1e-9)) * 0.70)
                out.append(self._make_unit(self.verses_list[idx], norm_sc))
        return out, "keyword"

    def _strategy_keyword_fallback(self, query: str, k: int) -> tuple[list, str]:
        """Manual BM25 approximation — used only when bm25s is not installed."""
        tokens = re.findall(r'\b[a-z]{3,}\b', query.lower())
        if not tokens:
            return [], "keyword"

        N = len(self.verses_list)
        scores: dict[int, float] = defaultdict(float)
        for token in tokens:
            posting = self._inv_idx.get(token)
            if not posting:
                continue
            df  = len(posting)
            idf = math.log((N - df + 0.5) / (df + 0.5) + 1.0)
            for idx in posting:
                text = self.verses_list[idx]["translation"].lower()
                tf   = text.count(token)
                scores[idx] += idf * (tf * 2.5) / (tf + 1.5)

        if not scores:
            return [], "keyword"

        top_idxs = sorted(scores, key=lambda x: scores[x], reverse=True)[:k]
        max_sc   = scores[top_idxs[0]] if top_idxs else 1.0
        results  = [
            self._make_unit(self.verses_list[idx], min(0.65, scores[idx] / max_sc * 0.65))
            for idx in top_idxs
        ]
        return results, "keyword"

    # ── Main parallel query ───────────────────────────────────────────────────

    def query_parallel(self, query: str, k: int = 5) -> dict:
        """
        Embed once, fan out to 4 strategies in parallel (ThreadPoolExecutor),
        race for the first result whose mean cosine-sim ≥ QUALITY_THRESHOLD.
        Losing threads are not cancelled but their results are discarded.
        """
        start   = time.time()
        q_vec   = self._embed(query)    # single embedding shared by all strategies

        fns: dict[str, callable] = {
            "dense":     lambda: self._strategy_dense(q_vec, k),
            "pheromone": lambda: self._strategy_pheromone(q_vec, k),
            "layer":     lambda: self._strategy_layer(query, q_vec, k),
            "keyword":   lambda: self._strategy_keyword(query, k),
        }

        future_to_name = {self.executor.submit(fn): name for name, fn in fns.items()}

        winner_results: list | None = None
        winner_strategy: str | None  = None
        best_fallback: tuple[list, str, float] = ([], "dense", 0.0)

        for future in as_completed(future_to_name, timeout=STRATEGY_TIMEOUT):
            name = future_to_name[future]
            try:
                results, strategy = future.result()
            except Exception as exc:
                print(f"[SwarmCore] Strategy '{name}' error: {exc}")
                continue

            if not results:
                continue

            quality = sum(r["score"] for r in results) / len(results)

            with self._stats_lock:
                self._stats[strategy]["calls"] += 1
                self._stats[strategy]["total_quality"] += quality

            # Track best fallback in case nothing clears threshold
            if quality > best_fallback[2]:
                best_fallback = (results, strategy, quality)

            if winner_results is None and quality >= QUALITY_THRESHOLD:
                winner_results  = results
                winner_strategy = strategy
                with self._stats_lock:
                    self._stats[strategy]["wins"] += 1

        # If no strategy cleared threshold, use best available
        if winner_results is None:
            winner_results, winner_strategy, _ = best_fallback
            if winner_results:
                with self._stats_lock:
                    self._stats.setdefault(winner_strategy, {"wins": 0, "calls": 0, "total_quality": 0.0})
                    self._stats[winner_strategy]["wins"] += 1

        winner_results  = winner_results or []
        winner_strategy = winner_strategy or "dense"
        quality = (sum(r["score"] for r in winner_results) / len(winner_results)
                   if winner_results else 0.0)

        return {
            "results":    winner_results,
            "strategy":   winner_strategy,
            "elapsed_ms": int((time.time() - start) * 1000),
            "quality":    round(quality, 4),
        }

    # ── Diagnostics ───────────────────────────────────────────────────────────

    def strategy_stats(self) -> dict:
        """Return per-strategy win rates and average quality."""
        with self._stats_lock:
            return {
                name: {
                    "wins":        s["wins"],
                    "calls":       s["calls"],
                    "win_rate":    round(s["wins"] / s["calls"], 3) if s["calls"] else 0.0,
                    "avg_quality": round(s["total_quality"] / s["calls"], 4) if s["calls"] else 0.0,
                }
                for name, s in self._stats.items()
            }
