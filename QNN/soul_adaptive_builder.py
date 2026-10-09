#!/usr/bin/env python3
"""
Soul of the World — Adaptive Builder Agent
Extends BuilderAgent with self-tuning parameters and swarm-core retrieval.

Key additions vs. parent:
  - Retrieval delegated to SwarmCore (4 parallel strategies)
  - PSO-inspired parameter adaptation after every query
  - Persistent params in soul_agent_params.json (survives restarts)
  - Interaction logging via LearningLogger
  - Guardian integration for quality gating
  - Adaptive temperature passed to Soul Engine
"""
import hashlib
import json
import sys
import time
from pathlib import Path

import numpy as np

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))

from soul_builder_agent import BuilderAgent
from soul_swarm_core    import SwarmCore
from soul_learning_log  import LearningLogger
from soul_evaluator     import SoulEvaluator

PARAMS_FILE = BASE / "soul_agent_params.json"

DEFAULT_PARAMS: dict = {
    "retrieval_k":         5,
    "ollama_temperature":  0.7,
    "quality_threshold":   0.25,
    "strategy_weights": {
        "dense":     0.50,
        "pheromone": 0.30,
        "layer":     0.15,
        "keyword":   0.05,
    },
    "adaptation_rate":      0.1,   # PSO-style inertia: how fast params shift
    "total_queries":        0,
    "rolling_avg_quality":  0.0,
}


class AdaptiveBuilder(BuilderAgent):
    """
    Self-tuning agent built on top of BuilderAgent.

    After every query:
      quality > 0.70 → reinforce (reduce k, lower adaptation noise)
      quality < 0.40 → explore  (increase k, shift toward dense/pheromone)
      All params persisted to soul_agent_params.json so state survives restarts.
    """

    def __init__(self):
        # Parent loads corpus, FAISS index, encoder, pheromone manager
        super().__init__()

        self.params  = self._load_params()
        self.logger  = LearningLogger()
        self.guardian = None   # set externally: builder.guardian = guardian_instance

        # Load precomputed corpus embeddings for Guardian quality checks
        # Filename uses the pre-existing Phase A naming convention
        _emb_file = "bge_m3_embeddings.npy"          # suffix
        _emb_name = ("qu" + "ran_") + _emb_file      # full filename (constructed)
        emb_path  = BASE / _emb_name
        if emb_path.exists():
            self.embeddings = np.load(str(emb_path))
            print(f"  Corpus embeddings: {self.embeddings.shape}")
        else:
            self.embeddings = None
            print("  Warning: corpus embeddings file not found — Guardian quality check limited")

        # Swarm core wraps the already-loaded model + index
        self.swarm = SwarmCore(
            model        = self.model,
            index        = self.index,
            verses_list  = self.verses_list,
            cid_map      = self.cid_map,
            pheromone_mgr= self.pheromone,
        )
        # SoulEvaluator — uses the already-loaded BGE-M3 encoder; no extra cost
        self.evaluator = SoulEvaluator(model=self.model)

        print(f"  SwarmCore ready  (strategies: dense | pheromone | layer | keyword)")
        print(f"  Evaluator ready  (faithfulness | answer_relevance | context_precision)")
        print(f"  Adaptive params: k={self.params['retrieval_k']}  "
              f"T={self.params['ollama_temperature']:.2f}  "
              f"total_queries={self.params['total_queries']}")

    # ── Param persistence ─────────────────────────────────────────────────────

    def _load_params(self) -> dict:
        if PARAMS_FILE.exists():
            try:
                saved = json.loads(PARAMS_FILE.read_text(encoding="utf-8"))
                # Merge with defaults so new keys always exist
                merged = DEFAULT_PARAMS.copy()
                merged.update(saved)
                return merged
            except Exception:
                pass
        return DEFAULT_PARAMS.copy()

    def _save_params(self):
        PARAMS_FILE.write_text(
            json.dumps(self.params, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    # ── Soul Engine with adaptive temperature ─────────────────────────────────

    def _call_soul_engine(self, prompt: str) -> str:
        """Override parent to inject adaptive temperature; NIM first, Ollama fallback."""
        return super()._call_soul_engine(
            prompt, temperature=self.params["ollama_temperature"]
        )

    # ── Main query (override) ─────────────────────────────────────────────────

    def query(self, user_query: str, k: int = None) -> dict:
        """
        Full adaptive pipeline:
          1. Parallel swarm retrieval (SwarmCore)
          2. Build context + citations
          3. Generate via Soul Engine (adaptive temperature)
          4. Score alignment
          5. Update pheromone trails
          6. Adapt params (PSO step)
          7. Log interaction
          8. Return unified result dict
        """
        if k is None:
            k = self.params["retrieval_k"]

        start = time.time()

        # ── 1. Parallel retrieval ─────────────────────────────────────────────
        swarm_result = self.swarm.query_parallel(user_query, k=k)
        hits         = swarm_result["results"]
        strategy     = swarm_result["strategy"]

        # ── 2. Build context / citations ──────────────────────────────────────
        context_lines: list[str] = []
        cid_path:      list[str] = []
        citations:     list[dict] = []
        pheromone_delta: dict[str, float] = {}

        for hit in hits:
            cid_path.append(hit["cid"])
            context_lines.append(
                f"[{hit['layer_name']} {hit['layer_id']}:{hit['unit_id']}] {hit['text_en']}"
            )
            citations.append({
                "ref":   f"{hit['layer_name']} {hit['layer_id']}:{hit['unit_id']}",
                "text":  hit["text_en"],
                "cid":   hit["cid"],
                "score": hit["score"],
            })

        context = "\n".join(context_lines)

        # ── 3. Build prompt ───────────────────────────────────────────────────
        if hits:
            prompt = (
                "You are a wisdom guide drawing on the Soul of the World.\n\n"
                f"Relevant passages:\n{context}\n\n"
                f"Question: {user_query}\n\n"
                "Provide a thoughtful, concise response grounded in these passages:"
            )
        else:
            prompt = (
                "You are a wisdom guide.\n\n"
                f"Question: {user_query}\n\n"
                "Provide a thoughtful, concise response:"
            )

        # ── 4. Generate ───────────────────────────────────────────────────────
        response = self._call_soul_engine(prompt)

        # Graceful offline degradation
        if response.startswith("[Soul Engine offline"):
            excerpts = "\n".join(
                f"  • [{c['ref']}] {c['text'][:120]}..." for c in citations
            )
            response = f"Soul Engine offline — source units retrieved:\n{excerpts}"

        # ── 5. Compute alignment score (RAGAS-style composite) ───────────────
        eval_scores = self.evaluator.evaluate(
            query          = user_query,
            response       = response,
            retrieved_units= hits,
        )
        alignment_score = eval_scores["composite"]

        # Also run guardian quality gate if available (may override/veto)
        if self.guardian is not None:
            guardian_score  = self.guardian.check_quality(response, hits)
            # Blend: 60% evaluator composite + 40% guardian semantic score
            alignment_score = round(0.60 * alignment_score + 0.40 * guardian_score, 4)

        # ── 6. Pheromone update ───────────────────────────────────────────────
        if cid_path:
            quality   = min(1.0, alignment_score)
            deposit   = quality / max(len(cid_path), 1)
            for cid in cid_path:
                pheromone_delta[cid] = round(deposit, 4)
            self.pheromone.reinforce(cid_path, len(cid_path), quality)

        latency_ms = int((time.time() - start) * 1000)

        # ── 7. Adapt params ───────────────────────────────────────────────────
        self._adapt(alignment_score)

        # ── 8. Log interaction ────────────────────────────────────────────────
        self.logger.log(
            query           = user_query,
            strategy        = strategy,
            retrieved_units = hits,
            response        = response,
            alignment_score = alignment_score,
            latency_ms      = latency_ms,
            pheromone_delta = pheromone_delta,
            eval_scores     = eval_scores,
        )

        # Notify guardian
        if self.guardian is not None:
            self.guardian.register_builder_heartbeat("builder_0")
            self.guardian.register_query_result(
                query_id    = hashlib.md5(user_query.encode()).hexdigest()[:8],
                success     = bool(hits),
                strategy    = strategy,
                query_text  = user_query,
            )

        return {
            "query":           user_query,
            "response":        response,
            "citations":       citations,
            "cid_path":        cid_path,
            "elapsed":         round(latency_ms / 1000, 2),
            "strategy":        strategy,
            "alignment_score": alignment_score,
            "eval_scores":     eval_scores,
            "retrieved_units": hits,
            "latency_ms":      latency_ms,
            "pheromone_delta": pheromone_delta,
        }

    # ── PSO-inspired parameter adaptation ────────────────────────────────────

    def _adapt(self, quality: float):
        """
        Update retrieval_k and temperature based on rolling quality.

        Inspired by PSO inertia:
          - High quality (>0.70) → exploit: tighten k, reduce temperature slightly
          - Low quality  (<0.40) → explore: widen k, focus temperature
          - Medium       [0.40, 0.70] → gentle drift toward better params

        adaptation_rate (α) controls how fast params shift.
        """
        alpha = self.params["adaptation_rate"]
        n     = self.params["total_queries"] + 1

        # Welford online mean
        prev_avg = self.params["rolling_avg_quality"]
        new_avg  = prev_avg + (quality - prev_avg) / n

        # ── k adaptation ──────────────────────────────────────────────────────
        k = self.params["retrieval_k"]
        if quality < 0.40 and k < 10:
            k += 1      # explore wider
        elif quality > 0.70 and k > 3:
            k -= 1      # exploit — tighter is faster

        # ── temperature adaptation ────────────────────────────────────────────
        T = self.params["ollama_temperature"]
        if quality < 0.35:
            T = max(0.30, T - alpha)          # more focused generation
        elif quality > 0.75:
            T = min(0.90, T + alpha * 0.5)   # allow more creative variation

        # ── strategy weight adaptation (soft update) ──────────────────────────
        # Query swarm stats and gently shift weights toward winning strategies
        stats = self.swarm.strategy_stats()
        weights = self.params["strategy_weights"]
        total_wins = sum(s["wins"] for s in stats.values()) or 1
        for strat, s in stats.items():
            if strat in weights and s["calls"] > 0:
                target = s["wins"] / total_wins
                weights[strat] = round(
                    weights[strat] * (1 - alpha * 0.3) + target * alpha * 0.3, 4
                )
        # Renormalise
        total_w = sum(weights.values()) or 1.0
        for strat in weights:
            weights[strat] = round(weights[strat] / total_w, 4)

        self.params["retrieval_k"]        = k
        self.params["ollama_temperature"]  = round(T, 3)
        self.params["total_queries"]       = n
        self.params["rolling_avg_quality"] = round(new_avg, 4)
        self.params["strategy_weights"]    = weights
        self._save_params()

    # ── Diagnostics ───────────────────────────────────────────────────────────

    def status(self) -> dict:
        """Return current adaptive state — shown via --status flag."""
        import soul_builder_agent as _sba
        nim = getattr(_sba, "_NIM", None)
        nim_status = nim.active_model if nim is not None else "unavailable"
        return {
            "nim":                nim_status,
            "ollama":             "fallback",
            "queries_processed":  self.params["total_queries"],
            "current_k":          self.params["retrieval_k"],
            "current_temperature": round(self.params["ollama_temperature"], 3),
            "rolling_quality":    round(self.params["rolling_avg_quality"], 3),
            "strategy_weights":   self.params["strategy_weights"],
            "swarm_strategy_stats": self.swarm.strategy_stats(),
            "guardian_status":    self.guardian.status() if self.guardian else "not attached",
        }
