#!/usr/bin/env python3
"""
Soul of the World — Swarm Launcher
Starts the minimum viable swarm: AdaptiveBuilder + Guardian + PheromoneManager.
Single command to bring the ecosystem alive.

Usage:
  python soul_swarm.py --interactive    # conversational mode
  python soul_swarm.py --query "..."    # single query
  python soul_swarm.py --status         # show adaptive params
  python soul_swarm.py --stats          # show learning stats
  python soul_swarm.py --use-qdrant     # use Qdrant HNSW instead of FAISS
  python soul_swarm.py --bench          # run benchmark (FAISS vs Qdrant latency)

Interactive commands:
  /status   — show adaptive parameters
  /stats    — show learning statistics
  /trails   — show top pheromone trails
  /eval     — show last interaction's RAGAS-style eval scores
  /quit     — exit
"""
import argparse
import json
import sys
import time
from pathlib import Path

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))


def boot_swarm(use_qdrant: bool = False):
    """Initialise all swarm components and return (builder, guardian, logger, pheromone)."""
    from soul_adaptive_builder import AdaptiveBuilder
    from soul_guardian         import GuardianAgent
    from soul_learning_log     import LearningLogger

    print("⟳  Initialising Soul Engine swarm...")

    # ── Core components ───────────────────────────────────────────────────────
    # AdaptiveBuilder loads corpus + FAISS + encoder + SwarmCore + SoulEvaluator
    builder   = AdaptiveBuilder()
    pheromone = builder.pheromone
    guardian  = GuardianAgent(
        pheromone_mgr    = pheromone,
        model            = builder.model,
        corpus_embeddings= builder.embeddings,
    )
    logger    = LearningLogger()

    # Wire guardian into builder
    builder.guardian = guardian
    guardian.start()

    # ── Optional: Qdrant HNSW store ───────────────────────────────────────────
    qdrant_store = None
    if use_qdrant:
        try:
            from soul_qdrant_store import SoulQdrantStore, HAS_QDRANT
            if HAS_QDRANT:
                qdrant_store = SoulQdrantStore(path=str(BASE / "qdrant_data"))
                emb_path = BASE / "quran_bge_m3_embeddings.npy"
                if emb_path.exists():
                    qdrant_store.load_from_npy(
                        str(emb_path), builder.verses_list, builder.cid_map
                    )
                    builder._qdrant_store = qdrant_store
                    print("✓  Qdrant HNSW store active")
                else:
                    print("⚠  Qdrant: embeddings file not found — using FAISS only")
            else:
                print("⚠  qdrant-client not installed — using FAISS only")
        except Exception as e:
            print(f"⚠  Qdrant init failed: {e} — using FAISS only")

    # ── Provider status ───────────────────────────────────────────────────────
    import soul_builder_agent as _sba
    nim = getattr(_sba, "_NIM", None)
    if nim is not None:
        print(f"✓  NIM: {nim.active_model}")
    else:
        print("⚠  NIM: unavailable")
    print(f"✓  Ollama: standby (fallback)")

    print(f"✓  Guardian active  (heartbeat {getattr(guardian, 'HEARTBEAT_INTERVAL', 30)}s)")
    print(f"✓  Builder ready    (k={builder.params['retrieval_k']}  T={builder.params['ollama_temperature']:.2f})")
    print(f"✓  Pheromone trails: {len(pheromone.trails)} CIDs tracked")
    trail_s = pheromone.summary()
    if trail_s.get("tracked", 0) > 0:
        print(f"   max τ={trail_s['max']}  mean τ={trail_s['mean']}")

    return builder, guardian, logger, pheromone


# ── Modes ─────────────────────────────────────────────────────────────────────

def mode_status(builder, guardian, logger, pheromone):
    print("\n── Swarm Status ──────────────────────────────────────")
    print(json.dumps(builder.status(), indent=2))


def mode_stats(builder, guardian, logger, pheromone):
    print("\n── Learning Stats ────────────────────────────────────")
    print(json.dumps(logger.get_stats(), indent=2))


def mode_single_query(query_text: str, builder, guardian, logger, pheromone):
    result = builder.query(query_text)
    print(f"\n{result['response']}")
    print()
    for c in result.get("citations", []):
        print(f"  ↳ [{c['ref']}]  sim={c['score']}")
    print()
    print(f"  Strategy : {result.get('strategy', '?')}")
    print(f"  Alignment: {result.get('alignment_score', 0):.3f}")
    print(f"  Latency  : {result.get('latency_ms', 0)} ms")
    print(f"  k={builder.params['retrieval_k']}  T={builder.params['ollama_temperature']:.2f}  "
          f"rolling_q={builder.params['rolling_avg_quality']:.3f}")
    ev = result.get("eval_scores", {})
    if ev:
        print(f"  RAG eval : faith={ev.get('faithfulness',0):.3f}  "
              f"relev={ev.get('answer_relevance',0):.3f}  "
              f"prec={ev.get('context_precision',0):.3f}  "
              f"composite={ev.get('composite',0):.3f}")


def mode_bench(builder, guardian, logger, pheromone):
    """Benchmark FAISS vs Qdrant latency on 5 queries, then show BM25 vs strategy stats."""
    import numpy as np

    BENCH_QUERIES = [
        "What is the nature of patience in hardship?",
        "How does the soul find peace and tranquility?",
        "What is the meaning of gratitude?",
        "How was the universe created?",
        "What is wisdom and how do we attain it?",
    ]

    print("\n── Benchmark: BM25 keyword strategy ─────────────────────────────────")
    for q in BENCH_QUERIES[:3]:
        t0 = time.time()
        r, _ = builder.swarm._strategy_keyword(q, k=5)
        ms = (time.time() - t0) * 1000
        top = r[0] if r else None
        top_text = top['text_en'][:60] if top else "no results"
        print(f"  {ms:5.1f}ms  {q[:40]:40s}  → {top_text}...")

    print("\n── Benchmark: Dense FAISS vs BM25 quality ───────────────────────────")
    for q in BENCH_QUERIES:
        q_vec = builder.swarm._embed(q)
        t0 = time.time()
        dense_r, _ = builder.swarm._strategy_dense(q_vec, k=5)
        dense_ms = (time.time() - t0) * 1000
        t0 = time.time()
        kw_r, _ = builder.swarm._strategy_keyword(q, k=5)
        kw_ms = (time.time() - t0) * 1000

        dense_q = sum(r["score"] for r in dense_r) / max(len(dense_r), 1) if dense_r else 0
        kw_q    = sum(r["score"] for r in kw_r)    / max(len(kw_r), 1)    if kw_r    else 0
        print(f"  Dense: {dense_ms:5.1f}ms  q={dense_q:.3f}   "
              f"BM25: {kw_ms:5.1f}ms  q={kw_q:.3f}   [{q[:35]}...]")

    qdrant_store = getattr(builder, "_qdrant_store", None)
    if qdrant_store:
        print("\n── Benchmark: FAISS vs Qdrant HNSW ──────────────────────────────────")
        for q in BENCH_QUERIES:
            q_vec = builder.swarm._embed(q)
            t0 = time.time()
            builder.swarm._strategy_dense(q_vec, k=5)
            faiss_ms = (time.time() - t0) * 1000
            t0 = time.time()
            qdrant_store.search(q_vec, k=5)
            qdrant_ms = (time.time() - t0) * 1000
            print(f"  FAISS: {faiss_ms:6.1f}ms   Qdrant: {qdrant_ms:6.1f}ms   [{q[:40]}...]")
    else:
        print("\n  (Qdrant bench skipped — run with --use-qdrant to enable)")

    print("\n── Strategy stats (current session) ─────────────────────────────────")
    stats = builder.swarm.strategy_stats()
    for strat, s in stats.items():
        print(f"  {strat:12s}  wins={s['wins']}  calls={s['calls']}  "
              f"win_rate={s['win_rate']:.3f}  avg_q={s['avg_quality']:.4f}")


def mode_interactive(builder, guardian, logger, pheromone):
    print("\n Soul of the World Swarm — interactive mode")
    print("  Commands: /status  /stats  /trails  /eval  /quit\n")

    _last_result = {}

    while True:
        try:
            q = input("Query › ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nSwarm paused. Run again to resume.")
            break

        if not q:
            continue

        # ── Built-in commands ──────────────────────────────────────────────
        if q == "/quit":
            print("Swarm shutdown.")
            break

        if q == "/status":
            print(json.dumps(builder.status(), indent=2))
            continue

        if q == "/stats":
            print(json.dumps(logger.get_stats(), indent=2))
            continue

        if q == "/trails":
            top = pheromone.strongest_paths(10)
            if not top:
                print("  No trails yet.")
            else:
                print("  Top pheromone trails:")
                for cid, strength in top:
                    print(f"    τ={strength:.5f}  {cid[:56]}…")
            continue

        if q == "/eval":
            ev = _last_result.get("eval_scores", {})
            if not ev:
                print("  No evaluation data yet — run a query first.")
            else:
                print("  Last interaction — RAGAS-style scores:")
                for metric, val in ev.items():
                    bar = "█" * int(float(val) * 20)
                    print(f"    {metric:22s} {val:.4f}  {bar}")
            continue

        # ── Query ──────────────────────────────────────────────────────────
        result = builder.query(q)
        _last_result = result
        print(f"\n{result['response']}\n")

        cites = result.get("citations", [])
        if cites:
            refs = " | ".join(
                f"[{c['ref']}] {c['score']:.3f}"
                for c in cites[:4]
            )
            print(f"  ↳ {refs}")

        strat = result.get("strategy", "?")
        align = result.get("alignment_score", 0)
        lat   = result.get("latency_ms", 0)
        k     = builder.params["retrieval_k"]
        T     = builder.params["ollama_temperature"]
        rq    = builder.params["rolling_avg_quality"]

        ev = result.get("eval_scores", {})
        ev_str = ""
        if ev:
            ev_str = f"  faith={ev.get('faithfulness',0):.2f}  relev={ev.get('answer_relevance',0):.2f}  comp={ev.get('composite',0):.2f}"

        print(f"  strategy={strat}  align={align:.3f}  {lat}ms  "
              f"k={k}  T={T:.2f}  avg_q={rq:.3f}{ev_str}")
        print()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Soul of the World — Swarm Launcher",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--query",       metavar="TEXT", help="Single query mode")
    parser.add_argument("--interactive", action="store_true", help="Interactive chat mode")
    parser.add_argument("--status",      action="store_true", help="Show swarm adaptive params")
    parser.add_argument("--stats",       action="store_true", help="Show learning stats")
    parser.add_argument("--use-qdrant",  action="store_true", help="Enable Qdrant HNSW store")
    parser.add_argument("--bench",       action="store_true", help="Run latency benchmarks")
    args = parser.parse_args()

    builder, guardian, logger, pheromone = boot_swarm(use_qdrant=args.use_qdrant)

    if args.status:
        mode_status(builder, guardian, logger, pheromone)

    elif args.stats:
        mode_stats(builder, guardian, logger, pheromone)

    elif args.bench:
        mode_bench(builder, guardian, logger, pheromone)

    elif args.query:
        mode_single_query(args.query, builder, guardian, logger, pheromone)

    elif args.interactive:
        mode_interactive(builder, guardian, logger, pheromone)

    else:
        parser.print_help()
        print("\nQuick start: python soul_swarm.py --interactive")


if __name__ == "__main__":
    main()
