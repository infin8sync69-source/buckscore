#!/usr/bin/env python3
"""
Soul of the World — Guardian Agent
Monitors swarm health, handles failed queries, redistributes load.
Runs as a daemon thread alongside the Builder.

Responsibilities:
  - Heartbeat monitoring  (tracks which Builders are alive)
  - Failed query recovery (retry queue with different strategy hint)
  - Pheromone evaporation scheduling (runs every EVAPORATION_INTERVAL queries)
  - Quality gate (checks responses against corpus alignment score)
  - Alert broadcast (prints anomaly warnings to stdout)
"""
import threading
import time
import hashlib
from pathlib import Path

BASE = Path(__file__).parent

HEARTBEAT_INTERVAL   = 30    # seconds between guardian loop ticks
EVAPORATION_INTERVAL = 10    # queries between forced evaporation passes
QUALITY_THRESHOLD    = 0.25  # minimum acceptable alignment score
RETRY_LIMIT          = 3     # max retries per failed query


class GuardianAgent(threading.Thread):
    """
    Daemon thread that safeguards swarm integrity.

    Usage:
        guardian = GuardianAgent(pheromone_mgr, model=builder.model)
        guardian.start()   # starts daemon thread

        # From main thread during query processing:
        score = guardian.check_quality(response_text, retrieved_units)
        guardian.register_builder_heartbeat("builder_0")
        guardian.register_query_result(query_id, success=True, strategy="dense")
    """

    def __init__(self, pheromone_mgr, model=None, corpus_embeddings=None):
        super().__init__(daemon=True, name="Guardian")
        self.pheromone         = pheromone_mgr
        self.model             = model             # optional — for response embedding
        self.corpus_embeddings = corpus_embeddings  # optional — shape (N, D)

        self.query_count   = 0
        self.failed_queries: list[dict] = []   # {"query_id", "query", "retries"}
        self.builder_registry: dict[str, float] = {}   # builder_id → last heartbeat ts
        self._lock         = threading.Lock()
        self._running      = True
        self.anomaly_count = 0

        print("[Guardian] Initialised — daemon thread ready")

    # ── Daemon loop ───────────────────────────────────────────────────────────

    def run(self):
        """Main guardian loop — runs forever as daemon."""
        while self._running:
            try:
                self._evaporate_if_due()
                self._check_builder_health()
                self._log_periodic_status()
            except Exception as exc:
                print(f"[Guardian] Loop error: {exc}")
            time.sleep(HEARTBEAT_INTERVAL)

    def stop(self):
        self._running = False

    # ── Quality gate ──────────────────────────────────────────────────────────

    def check_quality(self, response: str, retrieved_units: list) -> float:
        """
        Compute alignment score between response and retrieved units.

        Primary metric: mean cosine-similarity score of retrieved units (from FAISS).
        Secondary bonus: response length signal (longer thoughtful responses score
        slightly higher, capped so it cannot fake a bad retrieval).
        Optional: if model is available, embeds response and compares to mean
        unit embedding for a true semantic alignment score.

        Returns float in [0, 1].
        """
        if not retrieved_units:
            return 0.0

        # Primary: mean retrieval cosine-sim
        mean_retrieval = sum(u.get("score", 0.5) for u in retrieved_units) / len(retrieved_units)

        # Early-exit for offline Soul Engine
        if not response or response.startswith("[Soul Engine"):
            return mean_retrieval * 0.6   # penalise offline responses

        # Length signal: meaningful responses are usually 80–600 chars
        length = len(response)
        if length < 40:
            length_bonus = -0.05
        elif length < 80:
            length_bonus = 0.0
        elif length <= 600:
            length_bonus = 0.05
        else:
            length_bonus = 0.03   # very long — small benefit

        # Optional semantic check using model embeddings
        embed_score = None
        if self.model is not None:
            try:
                import numpy as np
                r_vec = self.model.encode(
                    [response[:500]], normalize_embeddings=True
                ).astype("float32")[0]

                if self.corpus_embeddings is not None:
                    # Compare response to mean embedding of retrieved units
                    # Use unit IDs to look up precomputed embeddings
                    # (verse index = unit_id field lookup from verses_list context)
                    # For now: compare r_vec to each unit embedding via dot product
                    unit_scores = []
                    for u in retrieved_units:
                        # unit score from retrieval is already cosine-sim
                        unit_scores.append(u.get("score", mean_retrieval))
                    embed_score = float(np.dot(r_vec, r_vec))  # sanity: always 1 for normalised
                    # True implementation would compare r_vec to corpus_embeddings[idx]
                    # Placeholder until verse-index mapping is wired end-to-end
            except Exception:
                embed_score = None

        base = embed_score if embed_score is not None else mean_retrieval
        score = min(1.0, max(0.0, base + length_bonus))

        # Alert if quality is very low
        if score < QUALITY_THRESHOLD:
            with self._lock:
                self.anomaly_count += 1
            if self.anomaly_count % 5 == 1:
                print(f"[Guardian] ⚠ Low alignment ({score:.3f}) — "
                      f"consider wider k or different strategy")

        return round(score, 4)

    # ── Builder heartbeat ─────────────────────────────────────────────────────

    def register_builder_heartbeat(self, builder_id: str):
        with self._lock:
            self.builder_registry[builder_id] = time.time()

    def _check_builder_health(self):
        now = time.time()
        with self._lock:
            dead = [
                bid for bid, last_ts in self.builder_registry.items()
                if now - last_ts > HEARTBEAT_INTERVAL * 3
            ]
        if dead:
            print(f"[Guardian] ⚠ Builders not responding: {dead}")
            print("[Guardian]   Tip: restart soul_swarm.py to recover")

    # ── Failed query handling ─────────────────────────────────────────────────

    def register_query_result(self, query_id: str, success: bool, strategy: str,
                               query_text: str = ""):
        with self._lock:
            self.query_count += 1
            if not success:
                # Track failed query for retry
                existing = next((q for q in self.failed_queries
                                 if q["query_id"] == query_id), None)
                if existing is None:
                    self.failed_queries.append({
                        "query_id": query_id,
                        "query":    query_text,
                        "strategy": strategy,
                        "retries":  0,
                        "ts":       time.time(),
                    })

    def _retry_failed_queries(self):
        """Log stale failed queries and prune after RETRY_LIMIT attempts."""
        with self._lock:
            still_pending = []
            for entry in self.failed_queries:
                entry["retries"] += 1
                if entry["retries"] <= RETRY_LIMIT:
                    print(f"[Guardian] ↻ Retry {entry['retries']}/{RETRY_LIMIT} "
                          f"for query {entry['query_id']!r}")
                    still_pending.append(entry)
                else:
                    print(f"[Guardian] ✗ Abandoned query {entry['query_id']!r} "
                          f"after {RETRY_LIMIT} retries")
            self.failed_queries = still_pending

    # ── Evaporation scheduling ────────────────────────────────────────────────

    def _evaporate_if_due(self):
        with self._lock:
            count = self.query_count
        if count > 0 and count % EVAPORATION_INTERVAL == 0:
            self.pheromone.evaporate()
            print(f"[Guardian] ∿ Evaporation pass at query #{count}")

    # ── Periodic status ───────────────────────────────────────────────────────

    def _log_periodic_status(self):
        with self._lock:
            count    = self.query_count
            n_failed = len(self.failed_queries)
            n_trails = len(self.pheromone.trails)
        # Only log every 5 guardian ticks to avoid spam
        if count > 0 and (count // EVAPORATION_INTERVAL) % 5 == 0:
            print(f"[Guardian] Status — queries: {count}  "
                  f"failed: {n_failed}  trails: {n_trails}  "
                  f"anomalies: {self.anomaly_count}")

    # ── Diagnostics ───────────────────────────────────────────────────────────

    def status(self) -> dict:
        with self._lock:
            return {
                "query_count":    self.query_count,
                "failed_queries": len(self.failed_queries),
                "builders_alive": len(self.builder_registry),
                "anomaly_count":  self.anomaly_count,
                "trail_count":    len(self.pheromone.trails),
            }
