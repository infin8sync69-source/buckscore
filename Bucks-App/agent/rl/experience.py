"""
ExperienceBuffer — SQLite-backed store of (state, action, reward) tuples.

Used by the RL policy to learn which agents/tools perform best
for which types of queries. Only floats within the floating memory layer —
it can never change frozen memory or soul signatures.
"""
import json
import logging
import sqlite3
import time
from pathlib import Path
from typing import List, Optional

log = logging.getLogger("bucks.rl.experience")

_DB_PATH = Path(__file__).parent.parent.parent / "data" / "experience.db"


def _ensure_dir() -> None:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)


class ExperienceBuffer:
    def __init__(self, db_path: Optional[Path] = None):
        self._db = db_path or _DB_PATH
        _ensure_dir()
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS experience (
                    task_id        TEXT PRIMARY KEY,
                    state_emb      TEXT,       -- JSON array of floats
                    action         TEXT,       -- agent_id or tool name
                    reward         REAL,
                    correction     TEXT,
                    timestamp      REAL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_reward ON experience(reward DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ts    ON experience(timestamp DESC)")

    # ── Write ─────────────────────────────────────────────────────────────────

    def add(
        self,
        task_id: str,
        state_embedding: List[float],
        action: str,
        reward: float,
        correction: Optional[str] = None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO experience
                    (task_id, state_emb, action, reward, correction, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    json.dumps(state_embedding),
                    action,
                    reward,
                    correction or "",
                    time.time(),
                ),
            )

    # ── Read ──────────────────────────────────────────────────────────────────

    def sample_positive(self, n: int = 10) -> List[dict]:
        """Return the top-n highest-reward experiences for few-shot injection."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM experience WHERE reward > 0 ORDER BY reward DESC LIMIT ?", (n,)
            ).fetchall()
        return [dict(r) for r in rows]

    def sample_near(self, state_embedding: List[float], n: int = 5) -> List[dict]:
        """Return experiences with state embeddings closest (cosine) to the query."""
        import math

        def cosine(a: List[float], b: List[float]) -> float:
            if not a or not b or len(a) != len(b):
                return 0.0
            dot   = sum(x * y for x, y in zip(a, b))
            mag_a = math.sqrt(sum(x * x for x in a))
            mag_b = math.sqrt(sum(x * x for x in b))
            return dot / (mag_a * mag_b) if mag_a and mag_b else 0.0

        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM experience").fetchall()

        scored = []
        for r in rows:
            try:
                emb = json.loads(r["state_emb"])
                sim = cosine(state_embedding, emb)
                scored.append((sim, dict(r)))
            except Exception:
                continue
        scored.sort(key=lambda x: x[0], reverse=True)
        return [item for _, item in scored[:n]]

    def count(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM experience").fetchone()[0]

    def stats(self) -> dict:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT AVG(reward) as avg_r, MAX(reward) as max_r, MIN(reward) as min_r FROM experience"
            ).fetchone()
        return {
            "count":      self.count(),
            "avg_reward": round(float(row["avg_r"] or 0), 3),
            "max_reward": round(float(row["max_r"] or 0), 3),
            "min_reward": round(float(row["min_r"] or 0), 3),
        }

    def clear(self) -> None:
        with self._conn() as conn:
            conn.execute("DELETE FROM experience")
        log.warning("Experience buffer cleared.")
