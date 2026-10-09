"""
SQLite-backed persistent memory layer with automatic Supabase PostgreSQL cloud syncing and local-first fallback.
Handles: conversation sessions, user preferences, interaction history (RAG), feedback, and plan steps.
"""
import sqlite3
import json
import time
import math
import re
import os
from pathlib import Path
from typing import Optional

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    PSYCOPG2_AVAILABLE = True
except ImportError:
    PSYCOPG2_AVAILABLE = False

# Local database setup
MEMORY_DIR = Path.home() / ".bucks" / "agent-memory"
MEMORY_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = MEMORY_DIR / "bucks.db"

# Cloud database setup
POSTGRES_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:yP._p2EH6*_d-B-@db.gyhzcmiuuzvjmwyhmamk.supabase.co:5432/postgres"
)

# Connection state
_pg_conn_instance = None
_postgres_active = False

def _get_pg_conn():
    global _pg_conn_instance, _postgres_active
    if not PSYCOPG2_AVAILABLE:
        _postgres_active = False
        return None

    if _pg_conn_instance is not None:
        try:
            # Check connection health quickly
            with _pg_conn_instance.cursor() as cur:
                cur.execute("SELECT 1")
            _postgres_active = True
            return _pg_conn_instance
        except Exception:
            try:
                _pg_conn_instance.close()
            except Exception:
                pass
            _pg_conn_instance = None

    try:
        # Connect to Supabase PostgreSQL with a short 3-second timeout
        conn = psycopg2.connect(POSTGRES_URL, connect_timeout=3)
        conn.autocommit = True
        _pg_conn_instance = conn
        _postgres_active = True
        return conn
    except Exception as e:
        print(f"[Supabase Database] Connection offline, using local SQLite: {e}")
        _postgres_active = False
        _pg_conn_instance = None
        return None

def check_postgres_active() -> bool:
    return _get_pg_conn() is not None

def _execute(query: str, params: tuple = (), fetch_all: bool = False, fetch_one: bool = False):
    """
    Executes a query against Supabase PostgreSQL if online, falling back to local SQLite.
    Automatically handles placeholder conversion ('?' to '%s') and conflict operations.
    """
    if check_postgres_active():
        try:
            conn = _get_pg_conn()
            pg_query = query.replace("?", "%s")
            
            # Map SQLite "INSERT OR REPLACE" to PG conflict updates
            if "INSERT OR REPLACE INTO preferences" in query:
                pg_query = (
                    "INSERT INTO preferences (key, value, updated_at) VALUES (%s, %s, %s) "
                    "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at"
                )
            elif "INSERT OR REPLACE INTO interactions" in query:
                pg_query = (
                    "INSERT INTO interactions (task_id, prompt, response, agent, score, ts) VALUES (%s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (task_id) DO UPDATE SET prompt = EXCLUDED.prompt, response = EXCLUDED.response, "
                    "agent = EXCLUDED.agent, score = EXCLUDED.score, ts = EXCLUDED.ts"
                )

            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(pg_query, params)
                if fetch_all:
                    return [dict(r) for r in cur.fetchall()]
                if fetch_one:
                    row = cur.fetchone()
                    return dict(row) if row else None
                return None
        except Exception as e:
            print(f"[Supabase Database] Query execution failed, falling back to SQLite: {e}")
            # Fall back to SQLite below

    # SQLite connection path
    with sqlite3.connect(str(DB_PATH)) as c:
        c.row_factory = sqlite3.Row
        cur = c.cursor()
        cur.execute(query, params)
        if fetch_all:
            return [dict(r) for r in cur.fetchall()]
        if fetch_one:
            row = cur.fetchone()
            return dict(row) if row else None
        c.commit()
        return None

def _init_db():
    # 1. Try PostgreSQL first
    if check_postgres_active():
        print("[Supabase Database] Connected! Initializing PostgreSQL schemas...")
        try:
            conn = _get_pg_conn()
            with conn.cursor() as cur:
                cur.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    messages   TEXT NOT NULL DEFAULT '[]',
                    context    TEXT NOT NULL DEFAULT '{}',
                    created_at DOUBLE PRECISION NOT NULL,
                    updated_at DOUBLE PRECISION NOT NULL
                );

                CREATE TABLE IF NOT EXISTS preferences (
                    key        TEXT PRIMARY KEY,
                    value      TEXT NOT NULL,
                    updated_at DOUBLE PRECISION NOT NULL
                );

                CREATE TABLE IF NOT EXISTS interactions (
                    task_id    TEXT PRIMARY KEY,
                    prompt     TEXT NOT NULL,
                    response   TEXT NOT NULL,
                    agent      TEXT NOT NULL DEFAULT 'unknown',
                    score      INTEGER NOT NULL DEFAULT 0,
                    ts         DOUBLE PRECISION NOT NULL
                );

                CREATE TABLE IF NOT EXISTS plan_steps (
                    plan_id    TEXT NOT NULL,
                    step_idx   INTEGER NOT NULL,
                    goal       TEXT NOT NULL,
                    status     TEXT NOT NULL DEFAULT 'pending',
                    result     TEXT,
                    ts         DOUBLE PRECISION,
                    PRIMARY KEY (plan_id, step_idx)
                );
                """)
            print("[Supabase Database] PostgreSQL tables successfully initialized.")
            return
        except Exception as e:
            print(f"[Supabase Database] PostgreSQL tables initialization failed: {e}. Falling back to SQLite...")

    # 2. Local SQLite fallback
    print("[SQLite Database] Initializing local SQLite database...")
    with sqlite3.connect(str(DB_PATH)) as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            messages   TEXT NOT NULL DEFAULT '[]',
            context    TEXT NOT NULL DEFAULT '{}',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS preferences (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS interactions (
            task_id    TEXT PRIMARY KEY,
            prompt     TEXT NOT NULL,
            response   TEXT NOT NULL,
            agent      TEXT NOT NULL DEFAULT 'unknown',
            score      INTEGER NOT NULL DEFAULT 0,
            ts         REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plan_steps (
            plan_id    TEXT NOT NULL,
            step_idx   INTEGER NOT NULL,
            goal       TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'pending',
            result     TEXT,
            ts         REAL,
            PRIMARY KEY (plan_id, step_idx)
        );
        """)
    print("[SQLite Database] Local SQLite database successfully initialized.")

# Run database setup on import
_init_db()


# ── Session management ────────────────────────────────────────────────────────

class SessionStore:
    def get_or_create(self, session_id: str) -> dict:
        row = _execute("SELECT * FROM sessions WHERE session_id=?", (session_id,), fetch_one=True)
        if row:
            return {
                "session_id": row["session_id"],
                "messages": json.loads(row["messages"]),
                "context": json.loads(row["context"])
            }
        now = time.time()
        _execute("INSERT INTO sessions VALUES (?,?,?,?,?)", (session_id, "[]", "{}", now, now))
        return {"session_id": session_id, "messages": [], "context": {}}

    def append_message(self, session_id: str, role: str, content: str, meta: dict = None):
        session = self.get_or_create(session_id)
        msg = {"role": role, "content": content, "ts": time.time()}
        if meta:
            msg.update(meta)
        session["messages"].append(msg)
        # Keep last 40 messages in session
        if len(session["messages"]) > 40:
            session["messages"] = session["messages"][-40:]
        _execute(
            "UPDATE sessions SET messages=?, updated_at=? WHERE session_id=?",
            (json.dumps(session["messages"]), time.time(), session_id)
        )

    def get_recent(self, session_id: str, n: int = 8) -> list[dict]:
        session = self.get_or_create(session_id)
        return session["messages"][-n:]

    def set_context(self, session_id: str, key: str, value):
        session = self.get_or_create(session_id)
        session["context"][key] = value
        _execute(
            "UPDATE sessions SET context=?, updated_at=? WHERE session_id=?",
            (json.dumps(session["context"]), time.time(), session_id)
        )

    def clear(self, session_id: str):
        _execute("DELETE FROM sessions WHERE session_id=?", (session_id,))


# ── User preferences ──────────────────────────────────────────────────────────

class PreferenceStore:
    def get(self, key: str, default=None):
        row = _execute("SELECT value FROM preferences WHERE key=?", (key,), fetch_one=True)
        if row:
            return json.loads(row["value"])
        return default

    def set(self, key: str, value):
        _execute("INSERT OR REPLACE INTO preferences VALUES (?,?,?)", (key, json.dumps(value), time.time()))

    def get_all(self) -> dict:
        rows = _execute("SELECT key, value FROM preferences", fetch_all=True) or []
        return {r["key"]: json.loads(r["value"]) for r in rows}

    def build_preference_prompt(self) -> str:
        prefs = self.get_all()
        if not prefs:
            return ""
        lines = []
        if "language" in prefs:
            lines.append(f"Respond in {prefs['language']}.")
        if "tone" in prefs:
            lines.append(f"Use a {prefs['tone']} tone.")
        if "expertise" in prefs:
            lines.append(f"The user's expertise level is {prefs['expertise']}.")
        if "domains" in prefs:
            lines.append(f"The user is interested in: {', '.join(prefs['domains'])}.")
        if "location" in prefs:
            lines.append(f"User location context: {prefs['location']}.")
        return "\n".join(lines)


# ── Interaction history + BM25 retrieval ──────────────────────────────────────

class InteractionStore:
    def store(self, task_id: str, prompt: str, response: str, agent: str):
        _execute("INSERT OR REPLACE INTO interactions VALUES (?,?,?,?,?,?)", (task_id, prompt, response, agent, 0, time.time()))

    def update_score(self, task_id: str, score: int, correction: str = None):
        if correction:
            _execute(
                "UPDATE interactions SET score=?, response=response||? WHERE task_id=?",
                (score, f"\n[Correction: {correction}]", task_id)
            )
        else:
            _execute("UPDATE interactions SET score=? WHERE task_id=?", (score, task_id))

    def retrieve_similar(self, query: str, k: int = 4) -> list[dict]:
        rows = _execute("SELECT prompt, response, agent, score FROM interactions ORDER BY ts DESC LIMIT 200", fetch_all=True) or []
        if not rows:
            return []

        query_tokens = set(re.findall(r'\w+', query.lower()))
        scored = []
        for row in rows:
            doc = f"{row['prompt']} {row['response']}".lower()
            doc_tokens = re.findall(r'\w+', doc)
            doc_len = len(doc_tokens)
            tf_scores = {}
            for t in doc_tokens:
                tf_scores[t] = tf_scores.get(t, 0) + 1

            score = 0.0
            k1, b, avgdl = 1.5, 0.75, 100
            for token in query_tokens:
                if token in tf_scores:
                    tf = tf_scores[token]
                    idf = math.log((len(rows) + 1) / 1.5)
                    score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / avgdl))

            # Boost highly-rated interactions
            score *= (1 + max(0, row["score"]) * 0.1)
            if score > 0:
                scored.append({
                    "prompt": row["prompt"],
                    "response": row["response"][:300],
                    "agent": row["agent"],
                    "bm25": score
                })

        scored.sort(key=lambda x: x["bm25"], reverse=True)
        return scored[:k]

    def count(self) -> int:
        row = _execute("SELECT COUNT(*) as cnt FROM interactions", fetch_one=True)
        return row["cnt"] if row else 0


# ── Plan step store ───────────────────────────────────────────────────────────

class PlanStore:
    def save_plan(self, plan_id: str, steps: list[str]):
        _execute("DELETE FROM plan_steps WHERE plan_id=?", (plan_id,))
        for i, step in enumerate(steps):
            _execute("INSERT INTO plan_steps VALUES (?,?,?,?,?,?)", (plan_id, i, step, "pending", None, None))

    def update_step(self, plan_id: str, step_idx: int, status: str, result: str = None):
        _execute(
            "UPDATE plan_steps SET status=?, result=?, ts=? WHERE plan_id=? AND step_idx=?",
            (status, result, time.time(), plan_id, step_idx)
        )

    def get_plan(self, plan_id: str) -> list[dict]:
        return _execute("SELECT * FROM plan_steps WHERE plan_id=? ORDER BY step_idx", (plan_id,), fetch_all=True) or []


# ── Singleton accessors ───────────────────────────────────────────────────────

sessions      = SessionStore()
preferences   = PreferenceStore()
interactions  = InteractionStore()
plan_store    = PlanStore()
