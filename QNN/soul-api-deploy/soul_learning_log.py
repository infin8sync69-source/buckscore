#!/usr/bin/env python3
"""
Soul of the World — Interaction Logger
Every interaction is logged as a structured record for future LoRA fine-tuning.
Implements the Phase F self-learning foundation.

Log format (JSONL):
{
  "timestamp":             1722470400,
  "query":                 "...",
  "strategy_used":         "dense",
  "retrieved_cids":        ["sha256:...", ...],
  "retrieved_layers":      [2, 13, 33],
  "response_preview":      "first 200 chars...",
  "corpus_alignment_score": 0.71,
  "response_length":       342,
  "latency_ms":            1240,
  "pheromone_delta":       {"sha256:abc": 0.12},
  "user_signal":           null
}
"""
import json
import time
from pathlib import Path
from collections import defaultdict

BASE             = Path(__file__).parent
INTERACTION_LOG  = BASE / "soul_interactions.jsonl"


class LearningLogger:
    """
    Append-only structured logger for all swarm interactions.
    Records are the raw material for future LoRA fine-tuning runs.
    """

    # ── Write ─────────────────────────────────────────────────────────────────

    def log(
        self,
        query: str,
        strategy: str,
        retrieved_units: list,
        response: str,
        alignment_score: float,
        latency_ms: int,
        pheromone_delta: dict,
        eval_scores: dict = None,
    ):
        """
        Append one interaction record to soul_interactions.jsonl.
        Thread-safe via file-level append (atomic on POSIX).

        eval_scores: dict from SoulEvaluator.evaluate() — faithfulness,
                     answer_relevance, context_precision, context_recall, composite.
                     Stored alongside the heuristic alignment_score for comparison.
        """
        record = {
            "timestamp":              int(time.time()),
            "query":                  query,
            "strategy_used":          strategy,
            "retrieved_cids":         [u.get("cid", "") for u in retrieved_units],
            "retrieved_layers":       sorted(set(u.get("layer_id", 0) for u in retrieved_units)),
            "response_preview":       (response[:200] if response else ""),
            "response_full":          response or "",   # full response for LoRA training
            "corpus_alignment_score": round(float(alignment_score), 4),
            "eval_scores":            eval_scores or {},  # RAGAS-style composite metrics
            "response_length":        len(response) if response else 0,
            "latency_ms":             int(latency_ms),
            "pheromone_delta":        {k: round(float(v), 4) for k, v in pheromone_delta.items()},
            "user_signal":            None,   # filled later from implicit/explicit feedback
        }
        with open(INTERACTION_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    # ── Read / iterate ────────────────────────────────────────────────────────

    def _iter_records(self):
        if not INTERACTION_LOG.exists():
            return
        with open(INTERACTION_LOG, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue

    # ── Training dataset generator ────────────────────────────────────────────

    def generate_training_dataset(
        self,
        min_alignment: float = 0.50,
        output_file: str = "soul_training_data.jsonl",
    ) -> int:
        """
        Filter high-quality interactions → format as instruction-tuning pairs.

        Output format (one JSON object per line):
          {"instruction": <query>, "input": <cited_passages>, "output": <response>}

        Run weekly to accumulate LoRA training data.
        Returns count of records written.
        """
        out_path = BASE / output_file
        written = 0
        with open(out_path, "w", encoding="utf-8") as f_out:
            for rec in self._iter_records():
                if rec.get("corpus_alignment_score", 0) < min_alignment:
                    continue
                if not rec.get("response_preview"):
                    continue

                # Re-build citation string from layer IDs
                layers = rec.get("retrieved_layers", [])
                layer_str = f"Resonance layers: {', '.join(str(l) for l in layers)}"

                # Prefer full response; fall back to preview for old log entries
                full_resp = rec.get("response_full") or rec.get("response_preview", "")
                pair = {
                    "instruction": rec["query"],
                    "input":       layer_str,
                    "output":      full_resp,
                    "eval_scores": rec.get("eval_scores", {}),
                }
                f_out.write(json.dumps(pair, ensure_ascii=False) + "\n")
                written += 1

        print(f"[LearningLogger] {written} training pairs → {out_path.name}")
        return written

    # ── Stats ─────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        """
        Return summary statistics over all logged interactions:
          - total interactions
          - average alignment score
          - strategy win rates
          - top resonance layers by appearance count
          - average latency
          - date of first and last record
        """
        total          = 0
        sum_align      = 0.0
        sum_latency    = 0
        strategy_counts: dict[str, int]   = defaultdict(int)
        layer_counts:    dict[int, int]   = defaultdict(int)
        first_ts: int | None = None
        last_ts:  int | None = None

        for rec in self._iter_records():
            total += 1
            sum_align   += rec.get("corpus_alignment_score", 0.0)
            sum_latency += rec.get("latency_ms", 0)
            strat = rec.get("strategy_used", "unknown")
            strategy_counts[strat] += 1
            for lid in rec.get("retrieved_layers", []):
                layer_counts[int(lid)] += 1
            ts = rec.get("timestamp", 0)
            if first_ts is None or ts < first_ts:
                first_ts = ts
            if last_ts is None or ts > last_ts:
                last_ts = ts

        if total == 0:
            return {"total_interactions": 0, "message": "No interactions logged yet"}

        # Strategy win rates
        strategy_rates = {
            s: {"count": c, "rate": round(c / total, 3)}
            for s, c in sorted(strategy_counts.items(), key=lambda x: x[1], reverse=True)
        }

        # Top 10 resonance layers
        top_layers = sorted(layer_counts.items(), key=lambda x: x[1], reverse=True)[:10]

        import datetime
        return {
            "total_interactions":    total,
            "avg_alignment_score":   round(sum_align / total, 4),
            "avg_latency_ms":        round(sum_latency / total),
            "strategy_usage":        strategy_rates,
            "top_resonance_layers":  [{"layer": l, "hits": c} for l, c in top_layers],
            "first_interaction":     datetime.datetime.utcfromtimestamp(first_ts).isoformat() if first_ts else None,
            "last_interaction":      datetime.datetime.utcfromtimestamp(last_ts).isoformat() if last_ts else None,
            "log_file":              str(INTERACTION_LOG),
        }

    def add_user_signal(self, query: str, signal: float):
        """
        Retroactively attach a user feedback signal to matching log entries.
        signal: -1.0 (bad) … 0.0 (neutral) … 1.0 (excellent)
        Rewrites the log file — use sparingly.
        """
        if not INTERACTION_LOG.exists():
            return

        records = list(self._iter_records())
        updated = 0
        for rec in records:
            if rec.get("query") == query and rec.get("user_signal") is None:
                rec["user_signal"] = float(signal)
                updated += 1

        if updated:
            with open(INTERACTION_LOG, "w", encoding="utf-8") as f:
                for rec in records:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            print(f"[LearningLogger] Updated {updated} records with user signal={signal}")
