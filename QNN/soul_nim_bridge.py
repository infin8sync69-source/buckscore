#!/usr/bin/env python3
"""
soul_nim_bridge.py — Captures NIM responses as QNN training examples

When NIM answers a query that QNN also attempted, the NIM response
is logged as a high-quality reference answer. QNN's DSPy optimizer
then uses these NIM-generated examples to improve its own prompts.

This closes the learning loop:
  User query → QNN (attempt) + NIM (reference) → log both → DSPy trains → QNN improves

Entry format is schema-compatible with soul_learning_log.py so all
existing tools (generate_training_dataset, DSPy optimizer, stats) work
on NIM entries without modification.
"""

import hashlib
import json
import time
from pathlib import Path

BASE              = Path(__file__).parent
INTERACTIONS_LOG  = BASE / "soul_interactions.jsonl"
BRIDGE_LOG        = BASE / "nim_bridge_log.jsonl"
KNOWLEDGE_FILE    = BASE / "bucks_knowledge.jsonl"

# NIM responses start at 0.80 corpus_alignment_score — good but not
# yet validated by the local FAISS corpus, so lower than a strong
# swarm hit (which can reach 0.90+).
NIM_BASELINE_QUALITY = 0.80

# Minimum response length to bother logging
MIN_RESPONSE_LEN = 100


def _already_logged(query_hash: str) -> bool:
    """Return True if a NIM entry for this query_hash already exists."""
    if not INTERACTIONS_LOG.exists():
        return False
    with open(INTERACTIONS_LOG, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                if rec.get("source") == "nim" and rec.get("query_hash") == query_hash:
                    return True
            except json.JSONDecodeError:
                continue
    return False


def capture_nim_response(
    query: str,
    nim_response: str,
    qnn_response: str = None,
    nim_model: str = "unknown",
) -> str | None:
    """
    Log a NIM response as a training example for QNN.

    Writes a schema-compatible entry to soul_interactions.jsonl so that:
    - generate_training_dataset() can export it for LoRA training
    - _load_examples() in soul_dspy_optimizer.py can use it for DSPy compilation

    Args:
        query:        The original user query
        nim_response: NIM's response text
        qnn_response: QNN's response (if available, stored for comparison)
        nim_model:    Which NIM model responded (e.g. nvidia/llama-3.1-nemotron-70b-instruct)

    Returns:
        query_hash if logged, None if skipped (too short, error, or duplicate)
    """
    # Skip trivial or error responses
    if not nim_response or len(nim_response.strip()) < MIN_RESPONSE_LEN:
        return None

    # Deduplicate: one NIM entry per unique query
    query_hash = hashlib.md5(query.encode("utf-8")).hexdigest()[:8]
    if _already_logged(query_hash):
        return None

    now_ts = int(time.time())

    # Schema-compatible entry — all fields present so existing readers don't break
    entry = {
        # ── Core fields (same as LearningLogger.log()) ───────────────────────
        "timestamp":              now_ts,
        "query":                  query,
        "strategy_used":          "nim",
        "retrieved_cids":         [],
        "retrieved_layers":       [],
        "response_preview":       nim_response[:200],
        "response_full":          nim_response,
        "corpus_alignment_score": NIM_BASELINE_QUALITY,
        "eval_scores":            {},
        "response_length":        len(nim_response),
        "latency_ms":             0,
        "pheromone_delta":        {},
        "user_signal":            None,
        # ── Bridge-specific fields ────────────────────────────────────────────
        "source":                 "nim",
        "nim_model":              nim_model,
        "query_hash":             query_hash,
        "estimated_quality":      NIM_BASELINE_QUALITY,
        "qnn_response":           qnn_response,
        "learning_eligible":      True,
    }

    with open(INTERACTIONS_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # Audit log — lightweight record so we can inspect bridge activity separately
    audit = {
        "timestamp":       now_ts,
        "query_hash":      query_hash,
        "nim_model":       nim_model,
        "response_length": len(nim_response),
        "logged":          True,
    }
    with open(BRIDGE_LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(audit) + "\n")

    return query_hash


def capture_bucks_knowledge(
    component: str,
    description: str,
    code_snippet: str = None,
) -> None:
    """
    Log an architectural fact about Bucks for QNN to reference.

    When Claude builds a component in Bucks, call this so QNN can
    answer architecture questions about the system it lives inside.

    Args:
        component:    e.g. "app-store", "soul-bridge", "agent-interface"
        description:  What it does and why it exists
        code_snippet: Optional key code pattern or API surface
    """
    entry = {
        "timestamp":    int(time.time()),
        "type":         "bucks_architecture",
        "component":    component,
        "description":  description,
        "code_snippet": code_snippet,
        "source":       "claude_build",
    }
    with open(KNOWLEDGE_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def get_bridge_stats() -> dict:
    """Return stats on NIM examples captured and DSPy readiness."""
    nim_count     = 0
    total_quality = 0.0

    if INTERACTIONS_LOG.exists():
        with open(INTERACTIONS_LOG, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    if rec.get("source") == "nim":
                        nim_count     += 1
                        total_quality += rec.get("estimated_quality",
                                                  rec.get("corpus_alignment_score", 0.8))
                except json.JSONDecodeError:
                    continue

    return {
        "nim_examples_captured": nim_count,
        "avg_estimated_quality": round(total_quality / nim_count, 3) if nim_count else 0.0,
        "ready_for_dspy":        nim_count >= 5,  # DSPy BootstrapFewShot minimum
    }


# ── CLI self-test ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    stats = get_bridge_stats()
    print("NIM Bridge Stats:")
    print(f"  Examples captured : {stats['nim_examples_captured']}")
    print(f"  Avg quality       : {stats['avg_estimated_quality']}")
    print(f"  DSPy ready        : {stats['ready_for_dspy']}")
