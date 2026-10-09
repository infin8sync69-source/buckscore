#!/usr/bin/env python3
"""
Soul Engine — REST API
Exposes the swarm as a public HTTP endpoint for bucks.global chat widget.

Run:
    uvicorn soul_api:app --host 0.0.0.0 --port 8000 --reload

Deploy (Fly.io):
    fly launch --name soul-engine-api
    fly deploy

Deploy (Railway):
    Connect GitHub repo, set NVIDIA_API_KEY env var, Railway auto-detects Procfile.
"""

import os
import sys
import time
import hashlib
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# ── Environment ───────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))
sys.path.insert(0, BASE_DIR)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Soul Engine API",
    version="1.0.0",
    description="Proprietary neural architecture trained on an ancient corpus of human wisdom.",
    docs_url=None,   # disable Swagger UI in production
    redoc_url=None,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://bucks.global",
        "https://www.bucks.global",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://127.0.0.1:5500",   # Live Server / VS Code
    ],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# ── Rate limiting (in-memory, per IP) ─────────────────────────────────────────
# TODO: replace with Redis for multi-instance deployments
_rate_buckets: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT     = 10   # max requests
RATE_WINDOW    = 60   # seconds


def _check_rate(ip: str) -> None:
    now = time.time()
    bucket = _rate_buckets[ip]
    # Purge entries older than the window
    _rate_buckets[ip] = [t for t in bucket if now - t < RATE_WINDOW]
    if len(_rate_buckets[ip]) >= RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded: max {RATE_LIMIT} requests per {RATE_WINDOW}s."
        )
    _rate_buckets[ip].append(now)


# ── Lazy-load swarm (heavy model, load once at first request) ─────────────────
_swarm = None


def get_swarm():
    global _swarm
    if _swarm is None:
        print("[soul_api] Loading AdaptiveBuilder swarm — first request, please wait…")
        from soul_adaptive_builder import AdaptiveBuilder
        _swarm = AdaptiveBuilder()
        print("[soul_api] Swarm ready.")
    return _swarm


# ── Request / Response models ─────────────────────────────────────────────────

class ChatRequest(BaseModel):
    query:      str
    session_id: str = ""


class Citation(BaseModel):
    label:   str   # "Reference 1", "Reference 2", … (never exposes internal IDs)
    excerpt: str   # first 200 chars of the unit text


class ChatResponse(BaseModel):
    response:    str
    citations:   list[Citation]
    quality:     float
    strategy:    str
    latency_ms:  int


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Lightweight health check — used by Fly.io / Railway monitors."""
    return {"status": "ok", "service": "Soul Engine API", "ts": int(time.time())}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request):
    """
    Main chat endpoint.  Accepts a natural-language query and returns a
    response grounded in the Soul of the World corpus.

    Body:
        { "query": "...", "session_id": "" }

    Returns:
        { "response": "...", "citations": [...], "quality": 0.xx,
          "strategy": "dense|pheromone|layer|keyword", "latency_ms": 123 }
    """
    # Rate-limit by IP
    client_ip = request.client.host if request.client else "unknown"
    _check_rate(client_ip)

    # Input validation
    q = (req.query or "").strip()
    if len(q) < 3:
        raise HTTPException(status_code=400, detail="Query too short (min 3 chars).")
    if len(q) > 500:
        raise HTTPException(status_code=400, detail="Query too long (max 500 chars).")

    # Run the swarm
    t0 = time.time()
    try:
        swarm  = get_swarm()
        result = swarm.query(q)
    except Exception as exc:
        print(f"[soul_api] Swarm error: {exc}")
        raise HTTPException(status_code=500, detail="Soul Engine temporarily unavailable.")

    latency_ms = int((time.time() - t0) * 1000)

    # Build sanitised citations — never expose internal layer/unit IDs publicly
    raw_citations = result.get("citations", [])
    citations: list[Citation] = []
    for i, c in enumerate(raw_citations[:3], start=1):
        text = c.get("text", "").strip()
        if text:
            citations.append(Citation(
                label   = f"Reference {i}",
                excerpt = text[:200],
            ))

    return ChatResponse(
        response   = result.get("response", ""),
        citations  = citations,
        quality    = round(result.get("alignment_score", 0.0), 3),
        strategy   = result.get("strategy", "dense"),
        latency_ms = latency_ms,
    )


# ── Dev entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
