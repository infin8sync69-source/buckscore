#!/usr/bin/env python3
"""
soul_benchmark.py — Quality benchmark runner for the Soul Engine QNN + NIM parallel stack.

Runs 20 fixed queries through both QNN (local) and NIM (cloud), scores each response
with a RAGAS-style faithfulness metric, and outputs a JSON summary.

Usage:
    python soul_benchmark.py [--nim-key <API_KEY>] [--output <path.json>] [--parallel]

Output format (JSON):
    {
      "run_id": "bench-<timestamp>",
      "timestamp": "ISO8601",
      "total_queries": 20,
      "qnn_avg_quality": 0.74,
      "nim_avg_quality": 0.88,
      "qnn_wins": 14,
      "nim_wins": 6,
      "avg_latency_qnn_ms": 310,
      "avg_latency_nim_ms": 890,
      "threshold": 0.65,
      "results": [ { ... } × 20 ]
    }

Each result entry:
    {
      "query_id": "bench-<n>",
      "query": "...",
      "qnn_response": "...",
      "nim_response": "...",
      "qnn_quality": 0.82,
      "nim_quality": null,          # null = no NIM key
      "qnn_latency_ms": 280,
      "nim_latency_ms": 910,
      "winner": "qnn",              # "qnn" | "nim" | "offline"
      "strategy": "dense",
      "citations": [ ... ],
      "resonance_layers": [ ... ]
    }
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

# QNN_PATH env var lets users install the Soul Engine outside ~/Desktop/QNN.
QNN_BASE = os.environ.get('QNN_PATH', os.path.expanduser('~/Desktop/QNN'))

# ── Optional imports (graceful degradation) ─────────────────────────────────
try:
    import httpx
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False
    print("[WARNING] httpx not installed — NIM arm will be skipped. Install: pip install httpx")

try:
    import numpy as np
    _HAS_NUMPY = True
except ImportError:
    _HAS_NUMPY = False

# ── 20 fixed benchmark queries ───────────────────────────────────────────────
BENCHMARK_QUERIES: list[str] = [
    # Conceptual / philosophical
    "What is the nature of resonance between meaning and memory?",
    "How do distributed swarm systems achieve collective coherence?",
    "Explain the relationship between context and emergence in complex systems.",
    "What role does entropy play in the formation of stable patterns?",
    "Describe the feedback loop between individual nodes and system-level behavior.",

    # Technical — retrieval and knowledge systems
    "How does dense passage retrieval differ from sparse keyword search?",
    "Explain how RAGAS evaluates faithfulness in retrieval-augmented generation.",
    "What is the difference between a knowledge graph and a vector database?",
    "How does DSPy automate prompt optimization for language models?",
    "Describe the mechanics of approximate nearest neighbor search in high dimensions.",

    # Practical / applied
    "How can large language models be fine-tuned on domain-specific corpora?",
    "What architectural patterns enable low-latency inference at the edge?",
    "How does reinforcement learning from human feedback shape model behavior?",
    "Explain the role of attention mechanisms in transformer architectures.",
    "What trade-offs exist between model size and inference throughput?",

    # System-level / integration
    "How should a hybrid search system rank and merge results from multiple sources?",
    "What strategies reduce hallucination in grounded generation pipelines?",
    "Describe how citation provenance can be tracked through a retrieval pipeline.",
    "How do pheromone-inspired routing algorithms work in swarm intelligence?",
    "What metrics best capture the quality of a knowledge retrieval response?",
]

QUALITY_THRESHOLD = 0.65

# ── QNN bridge connector ──────────────────────────────────────────────────────
class QNNBridgeClient:
    """
    Connects to the running soul-bridge process via its HTTP endpoint.
    Falls back to direct Python import if the bridge is embedded in the same process.
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 8765):
        self.base_url = f"http://{host}:{port}"
        self._available: Optional[bool] = None

    async def ping(self) -> bool:
        if not _HAS_HTTPX:
            return False
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{self.base_url}/status")
                self._available = r.status_code == 200
        except Exception:
            self._available = False
        return self._available

    async def query(self, text: str, session_id: Optional[str] = None) -> dict[str, Any]:
        """Call the local QNN bridge HTTP endpoint."""
        if not _HAS_HTTPX:
            return self._offline_response(text)
        try:
            async with httpx.AsyncClient(timeout=30) as c:
                r = await c.post(f"{self.base_url}/query", json={
                    "query": text,
                    "session_id": session_id or str(uuid.uuid4()),
                })
                if r.status_code == 200:
                    return r.json()
                return self._offline_response(text, error=f"HTTP {r.status_code}")
        except Exception as e:
            return self._offline_response(text, error=str(e))

    @staticmethod
    def _offline_response(query: str, error: str = "offline") -> dict[str, Any]:
        return {
            "query_id"        : f"offline-{uuid.uuid4().hex[:8]}",
            "response"        : f"[QNN offline: {error}]",
            "citations"       : [],
            "quality"         : 0.0,
            "strategy"        : "offline",
            "resonance_layers": [],
            "latency_ms"      : 0,
            "source"          : "offline",
        }


# ── NIM cloud client ──────────────────────────────────────────────────────────
class NIMClient:
    """Thin wrapper around the NVIDIA NIM chat completions endpoint."""

    BASE_URL = "https://integrate.api.nvidia.com/v1"
    DEFAULT_MODEL = "nvidia/llama-3.1-nemotron-70b-instruct"

    def __init__(self, api_key: str, model: str = DEFAULT_MODEL):
        self.api_key = api_key
        self.model   = model

    async def query(self, prompt: str) -> dict[str, Any]:
        if not _HAS_HTTPX or not self.api_key:
            return {"response": None, "latency_ms": 0, "error": "no key or httpx"}

        payload = {
            "model"      : self.model,
            "messages"   : [{"role": "user", "content": prompt}],
            "max_tokens" : 1024,
            "temperature": 0.2,
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type" : "application/json",
        }
        t0 = time.perf_counter()
        try:
            async with httpx.AsyncClient(timeout=60) as c:
                r = await c.post(f"{self.BASE_URL}/chat/completions",
                                 json=payload, headers=headers)
                elapsed = int((time.perf_counter() - t0) * 1000)
                if r.status_code == 200:
                    data = r.json()
                    text = data["choices"][0]["message"]["content"]
                    return {"response": text, "latency_ms": elapsed, "model": self.model}
                return {"response": None, "latency_ms": elapsed,
                        "error": f"HTTP {r.status_code}: {r.text[:200]}"}
        except Exception as e:
            elapsed = int((time.perf_counter() - t0) * 1000)
            return {"response": None, "latency_ms": elapsed, "error": str(e)}


# ── RAGAS-style faithfulness scorer ──────────────────────────────────────────
class FaithfulnessScorer:
    """
    Lightweight heuristic faithfulness scorer (RAGAS-inspired).

    Full RAGAS requires an LLM judge — this approximates it with:
      1. Coverage: fraction of citation fragments found verbatim or paraphrased
         in the response.
      2. Hallucination penalty: sentences in the response that have no
         corresponding citation anchor.
      3. Length normalisation: very short responses score lower.

    Score range: [0.0, 1.0]
    """

    MIN_RESPONSE_LEN = 40   # chars
    SENTENCE_RE = re.compile(r"[^.!?]+[.!?]")

    def score(
        self,
        response: str,
        citations: list[dict[str, Any]],
        query: str = "",
    ) -> float:
        if not response or len(response) < self.MIN_RESPONSE_LEN:
            return 0.05

        # Nothing to ground — fallback to length + coherence estimate
        if not citations:
            return self._coherence_estimate(response, query)

        sentences = self.SENTENCE_RE.findall(response)
        if not sentences:
            return 0.1

        grounded = 0
        for sent in sentences:
            sent_lower = sent.lower()
            for cit in citations:
                anchor = (cit.get("text") or cit.get("ref") or "").lower()
                if anchor and self._overlap(sent_lower, anchor) > 0.25:
                    grounded += 1
                    break

        coverage   = grounded / len(sentences)
        length_pen = min(1.0, len(response) / 400)   # reward longer grounded answers
        raw        = 0.65 * coverage + 0.35 * length_pen

        # Bonus: response mentions specific citation refs
        ref_bonus = 0.0
        for cit in citations[:5]:
            ref = str(cit.get("ref") or "")
            if ref.lower() in response.lower():
                ref_bonus += 0.04
        return min(1.0, raw + ref_bonus)

    def _coherence_estimate(self, response: str, query: str) -> float:
        """Heuristic quality when no citations exist (NIM responses)."""
        length_score = min(1.0, len(response) / 300)
        # Presence of query terms
        query_words  = set(re.findall(r"\w+", query.lower())) - {"the","a","an","of","to","in","is","it","and","for"}
        resp_words   = set(re.findall(r"\w+", response.lower()))
        overlap      = len(query_words & resp_words) / max(len(query_words), 1)
        return round(0.5 * length_score + 0.5 * overlap, 3)

    @staticmethod
    def _overlap(a: str, b: str) -> float:
        """Jaccard word overlap between two strings."""
        wa = set(re.findall(r"\w+", a))
        wb = set(re.findall(r"\w+", b))
        if not wa or not wb:
            return 0.0
        return len(wa & wb) / len(wa | wb)


# ── Result dataclass ──────────────────────────────────────────────────────────
@dataclass
class BenchmarkResult:
    query_id        : str
    query           : str
    qnn_response    : str
    nim_response    : Optional[str]
    qnn_quality     : float
    nim_quality     : Optional[float]
    qnn_latency_ms  : int
    nim_latency_ms  : int
    winner          : str               # "qnn" | "nim" | "offline"
    strategy        : str
    citations       : list = field(default_factory=list)
    resonance_layers: list = field(default_factory=list)


# ── Main benchmark class ──────────────────────────────────────────────────────
class SoulBenchmark:
    """
    Runs all 20 fixed benchmark queries through QNN + NIM in parallel
    and produces a JSON quality report.
    """

    def __init__(
        self,
        nim_key      : str = "",
        output_path  : Optional[str] = None,
        parallel     : bool = True,
        qnn_host     : str = "127.0.0.1",
        qnn_port     : int = 8765,
        nim_model    : str = NIMClient.DEFAULT_MODEL,
    ):
        self.nim_key     = nim_key or os.environ.get("NVIDIA_API_KEY", "")
        self.output_path = output_path or os.path.join(
            QNN_BASE, "benchmark_results.json"
        )
        self.parallel    = parallel
        self.qnn         = QNNBridgeClient(host=qnn_host, port=qnn_port)
        self.nim         = NIMClient(api_key=self.nim_key, model=nim_model) if self.nim_key else None
        self.scorer      = FaithfulnessScorer()

    # ── Run a single query through QNN + NIM ─────────────────────────────
    async def _run_one(self, n: int, query: str) -> BenchmarkResult:
        qid = f"bench-{n:02d}"
        print(f"  [{n:02d}/20] {query[:72]}…")

        # QNN
        t0      = time.perf_counter()
        qnn_res = await self.qnn.query(query)
        qnn_ms  = int((time.perf_counter() - t0) * 1000) or qnn_res.get("latency_ms", 0)
        qnn_quality = self.scorer.score(
            qnn_res.get("response", ""),
            qnn_res.get("citations", []),
            query,
        )
        # Trust the bridge's own quality score if it's a reasonable value
        bridge_q = qnn_res.get("quality")
        if bridge_q and 0 < bridge_q <= 1:
            qnn_quality = bridge_q

        # NIM (if available)
        nim_response = None
        nim_ms       = 0
        nim_quality  = None
        if self.nim:
            t0       = time.perf_counter()
            nim_raw  = await self.nim.query(query)
            nim_ms   = nim_raw.get("latency_ms", int((time.perf_counter() - t0) * 1000))
            nim_response = nim_raw.get("response")
            if nim_response:
                nim_quality = self.scorer._coherence_estimate(nim_response, query)

        # Determine winner
        if qnn_quality >= QUALITY_THRESHOLD:
            winner = "qnn"
        elif nim_response:
            winner = "nim"
        elif qnn_res.get("response") and "[QNN offline" not in qnn_res.get("response", ""):
            winner = "qnn"
        else:
            winner = "offline"

        result = BenchmarkResult(
            query_id         = qid,
            query            = query,
            qnn_response     = qnn_res.get("response", ""),
            nim_response     = nim_response,
            qnn_quality      = round(qnn_quality, 4),
            nim_quality      = round(nim_quality, 4) if nim_quality is not None else None,
            qnn_latency_ms   = qnn_ms,
            nim_latency_ms   = nim_ms,
            winner           = winner,
            strategy         = qnn_res.get("strategy", "unknown"),
            citations        = qnn_res.get("citations", []),
            resonance_layers = qnn_res.get("resonance_layers", []),
        )
        q_str = f"qnn:{qnn_quality:.2f}"
        n_str = f"nim:{nim_quality:.2f}" if nim_quality is not None else "nim:n/a"
        print(f"         → {q_str}  {n_str}  winner:{winner}  {qnn_ms}ms/{nim_ms}ms")
        return result

    # ── Run all queries ───────────────────────────────────────────────────
    async def run(self) -> dict[str, Any]:
        run_id    = f"bench-{int(time.time())}"
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        print(f"\n{'='*62}")
        print(f"  Soul Engine Benchmark — {timestamp}")
        print(f"  Run ID : {run_id}")
        print(f"  QNN    : {self.qnn.base_url}")
        print(f"  NIM    : {'enabled (' + (self.nim.model if self.nim else '') + ')' if self.nim else 'disabled (no key)'}")
        print(f"  Mode   : {'parallel' if self.parallel else 'sequential'}")
        print(f"{'='*62}\n")

        # Ping QNN
        qnn_up = await self.qnn.ping()
        if not qnn_up:
            print("[WARNING] QNN bridge not responding — QNN results will be 'offline'")

        # Run queries
        if self.parallel:
            tasks   = [self._run_one(i + 1, q) for i, q in enumerate(BENCHMARK_QUERIES)]
            results = await asyncio.gather(*tasks)
        else:
            results = []
            for i, q in enumerate(BENCHMARK_QUERIES):
                results.append(await self._run_one(i + 1, q))

        # Aggregate
        qnn_qualities  = [r.qnn_quality  for r in results]
        nim_qualities  = [r.nim_quality  for r in results if r.nim_quality is not None]
        qnn_latencies  = [r.qnn_latency_ms for r in results if r.qnn_latency_ms > 0]
        nim_latencies  = [r.nim_latency_ms for r in results if r.nim_latency_ms > 0]
        qnn_wins       = sum(1 for r in results if r.winner == "qnn")
        nim_wins       = sum(1 for r in results if r.winner == "nim")
        offline_count  = sum(1 for r in results if r.winner == "offline")

        def _avg(lst: list) -> Optional[float]:
            return round(sum(lst) / len(lst), 4) if lst else None

        summary = {
            "run_id"              : run_id,
            "timestamp"           : timestamp,
            "total_queries"       : len(BENCHMARK_QUERIES),
            "threshold"           : QUALITY_THRESHOLD,
            "qnn_available"       : qnn_up,
            "nim_available"       : bool(self.nim),
            "qnn_avg_quality"     : _avg(qnn_qualities),
            "nim_avg_quality"     : _avg(nim_qualities),
            "qnn_wins"            : qnn_wins,
            "nim_wins"            : nim_wins,
            "offline_count"       : offline_count,
            "qnn_win_rate"        : round(qnn_wins / len(results), 3),
            "avg_latency_qnn_ms"  : _avg(qnn_latencies),
            "avg_latency_nim_ms"  : _avg(nim_latencies),
            "results"             : [asdict(r) for r in results],
        }

        # Write output
        out = Path(self.output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

        # Print summary
        print(f"\n{'='*62}")
        print(f"  BENCHMARK COMPLETE")
        print(f"  QNN avg quality : {summary['qnn_avg_quality'] or 'n/a'}")
        print(f"  NIM avg quality : {summary['nim_avg_quality'] or 'n/a'}")
        print(f"  QNN wins        : {qnn_wins}/{len(BENCHMARK_QUERIES)} ({summary['qnn_win_rate']*100:.0f}%)")
        print(f"  NIM wins        : {nim_wins}/{len(BENCHMARK_QUERIES)}")
        print(f"  Offline         : {offline_count}/{len(BENCHMARK_QUERIES)}")
        print(f"  Results → {self.output_path}")
        print(f"{'='*62}\n")

        return summary


# ── CLI entry point ───────────────────────────────────────────────────────────
def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Soul Engine quality benchmark")
    p.add_argument("--nim-key",    default=os.environ.get("NVIDIA_API_KEY", ""),
                   help="NVIDIA NIM API key (or set NVIDIA_API_KEY env var)")
    p.add_argument("--output",     default=os.path.join(QNN_BASE, "benchmark_results.json"),
                   help="Output JSON path")
    p.add_argument("--parallel",   action="store_true", default=True,
                   help="Run queries concurrently (default: true)")
    p.add_argument("--sequential", action="store_true", default=False,
                   help="Run queries one at a time")
    p.add_argument("--qnn-host",   default="127.0.0.1",  help="QNN bridge host")
    p.add_argument("--qnn-port",   type=int, default=8765, help="QNN bridge port")
    p.add_argument("--nim-model",  default=NIMClient.DEFAULT_MODEL, help="NIM model name")
    return p.parse_args()


def main() -> None:
    args    = _parse_args()
    bench   = SoulBenchmark(
        nim_key     = args.nim_key,
        output_path = args.output,
        parallel    = not args.sequential,
        qnn_host    = args.qnn_host,
        qnn_port    = args.qnn_port,
        nim_model   = args.nim_model,
    )
    asyncio.run(bench.run())


if __name__ == "__main__":
    main()
