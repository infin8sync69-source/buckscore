#!/usr/bin/env python3
"""
soul_bridge.py — JSON-RPC 2.0 stdin/stdout bridge for Bucks Browser

Spawned once by Electron's soul-bridge.js and kept alive for the whole
session.  Loads the Soul Engine (AdaptiveBuilder) on startup — FAISS index,
BGE-M3 encoder, pheromone swarm — then serves JSON-RPC requests line-by-line
from stdin, writing JSON responses line-by-line to stdout.

Protocol:
  REQUEST  (stdin):   {"jsonrpc":"2.0","id":1,"method":"query","params":{"query":"..."}}
  RESPONSE (stdout):  {"jsonrpc":"2.0","id":1,"result":{...}}
  ERROR    (stdout):  {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"..."}}

Supported methods:
  ping      {}                       → "pong"
  query     {query, session_id?}     → full result dict
  reload    {}                       → reload model weights
  shutdown  {}                       → graceful exit

All diagnostic/verbose output goes to stderr so it never pollutes the
JSON protocol on stdout.
"""

import sys
import json
import time
import traceback
from pathlib import Path

# ── Bootstrap path ────────────────────────────────────────────────────────────
BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))

# ── Stderr logging helper (never touches stdout) ──────────────────────────────
def _log(msg: str):
    print(f"[SoulBridge] {msg}", file=sys.stderr, flush=True)

def _err(msg: str):
    print(f"[SoulBridge:ERROR] {msg}", file=sys.stderr, flush=True)

# ── Load Soul Engine once ─────────────────────────────────────────────────────
_log("Loading Soul Engine (AdaptiveBuilder)…")
_builder = None
_load_error = None

try:
    from soul_adaptive_builder import AdaptiveBuilder
    _builder = AdaptiveBuilder()
    _log("Soul Engine ready.")
except Exception as e:
    _load_error = str(e)
    _err(f"Failed to load AdaptiveBuilder: {e}")
    traceback.print_exc(file=sys.stderr)

# ── Interaction log for the reinforced learning loop ─────────────────────────
_INTERACTIONS_FILE = BASE / "soul_interactions.jsonl"

def _append_interaction(entry: dict):
    """Append one interaction record to the RL training log."""
    try:
        with open(_INTERACTIONS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        _err(f"Failed to write interaction log: {e}")

# ── JSON-RPC dispatch ─────────────────────────────────────────────────────────

def _handle_ping(_params: dict) -> str:
    return "pong"


def _handle_query(params: dict) -> dict:
    """
    Route a natural-language query through the full QNN swarm pipeline:
      1. AdaptiveBuilder.query()  (FAISS + BGE-M3 + pheromones + PSO adaptation)
      2. Return structured result with citations, quality score, and strategy used.
    """
    if _builder is None:
        raise RuntimeError(f"Soul Engine not loaded: {_load_error}")

    user_query = params.get("query", "")
    session_id = params.get("session_id")

    if not user_query:
        raise ValueError("'query' parameter is required and must be non-empty")

    t0     = time.time()
    result = _builder.query(user_query)
    latency = round((time.time() - t0) * 1000)   # ms

    # Normalise citations — strip any internal field names that would expose
    # implementation-specific vocabulary before sending to the renderer.
    citations = []
    for c in result.get("citations", []):
        citations.append({
            "ref"   : c.get("ref", ""),
            "text"  : c.get("text", ""),
            "cid"   : c.get("cid", ""),
            "score" : round(float(c.get("score", 0)), 4),
        })

    # Log to JSONL for the RL loop (no feedback rating yet — added later via
    # soul-log-feedback IPC when the user rates the response in the UI)
    query_id = f"{int(time.time()*1000)}-{abs(hash(user_query)) % 0xFFFF:04x}"
    # Soul Engine quality gate — reads alignment_score from local retrieval
    # AdaptiveBuilder.query() returns "alignment_score"; "quality" is the legacy key.
    quality_score = result.get("alignment_score", result.get("quality", 0.0))

    _append_interaction({
        "query_id"  : query_id,
        "session_id": session_id,
        "query"     : user_query,
        "response"  : result.get("response", ""),
        "strategy"  : result.get("strategy", ""),
        "quality"   : quality_score,
        "latency_ms": latency,
        "timestamp" : time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rating"    : None,       # filled in by soul-log-feedback later
        "correction": None,
    })

    return {
        "query_id"        : query_id,
        "response"        : result.get("response", ""),
        "citations"       : citations,
        "quality"         : round(float(quality_score), 4),
        "strategy"        : result.get("strategy", ""),
        "resonance_layers": result.get("resonance_layers", []),
        "latency_ms"      : latency,
        "source"          : "local",
    }


def _handle_reload(_params: dict) -> dict:
    """Hot-reload model weights after an RL update cycle."""
    global _builder, _load_error
    _log("Reloading AdaptiveBuilder…")
    try:
        from soul_adaptive_builder import AdaptiveBuilder
        _builder = AdaptiveBuilder()
        _load_error = None
        _log("Reload complete.")
        return {"ok": True}
    except Exception as e:
        _load_error = str(e)
        _err(f"Reload failed: {e}")
        return {"ok": False, "error": str(e)}


def _handle_shutdown(_params: dict) -> dict:
    _log("Shutdown requested — exiting.")
    return {"ok": True}


def _handle_evaluate(params: dict) -> dict:
    """
    Score a NIM response using the local evaluator so QNN can learn from NIM wins.
    Falls back to a conservative default score if the evaluator is unavailable.
    """
    query    = params.get("query", "")
    response = params.get("response", "")
    source   = params.get("source", "unknown")
    try:
        from soul_evaluator import SoulEvaluator
        evaluator = SoulEvaluator()
        score = evaluator.score(query, response)
        return {"score": score, "source": source}
    except Exception as e:
        _err(f"Evaluator unavailable: {e} — using default score")
        return {"score": 0.75, "source": source, "note": "evaluator unavailable, using default"}


def _handle_log_feedback(params: dict) -> dict:
    """Append a NIM interaction record to the RL training log."""
    _append_interaction(params)
    return {"ok": True}


_DISPATCH = {
    "ping"        : _handle_ping,
    "query"       : _handle_query,
    "reload"      : _handle_reload,
    "shutdown"    : _handle_shutdown,
    "evaluate"    : _handle_evaluate,
    "log_feedback": _handle_log_feedback,
}

# ── Main RPC loop ─────────────────────────────────────────────────────────────

def _send(obj: dict):
    """Write a JSON-RPC response to stdout (protocol channel)."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _error_response(rpc_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}}


def main():
    _log("Bridge ready — listening on stdin.")

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        rpc_id = None
        try:
            msg    = json.loads(line)
            rpc_id = msg.get("id")
            method = msg.get("method", "")
            params = msg.get("params", {})

            if method not in _DISPATCH:
                _send(_error_response(rpc_id, -32601, f"Method not found: {method}"))
                continue

            result = _DISPATCH[method](params)
            _send({"jsonrpc": "2.0", "id": rpc_id, "result": result})

            if method == "shutdown":
                sys.exit(0)

        except json.JSONDecodeError as e:
            _send(_error_response(rpc_id, -32700, f"Parse error: {e}"))
        except (ValueError, KeyError) as e:
            _send(_error_response(rpc_id, -32602, f"Invalid params: {e}"))
        except Exception as e:
            _err(traceback.format_exc())
            _send(_error_response(rpc_id, -32603, f"Internal error: {e}"))


if __name__ == "__main__":
    main()
