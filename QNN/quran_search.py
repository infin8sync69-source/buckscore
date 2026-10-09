#!/usr/bin/env python3
"""Quran Semantic Search — Interactive CLI (local Ollama RAG edition).

Usage:
    python quran_search.py

Commands:
    search <query>    — FAISS top-5 verses by semantic similarity
    ask <question>    — RAG question answering via local Ollama (no API key needed)
    cluster           — show 30 thematic clusters
    models            — list available Ollama models
    quit              — exit

Environment variables (optional):
    OLLAMA_HOST       — Ollama base URL   (default: http://localhost:11434)
    OLLAMA_MODEL      — model to use      (default: auto-detected)
"""

import json
import os
import sys

import numpy as np

# ── startup checks ────────────────────────────────────────────────────────────

REQUIRED = ("quran_verses.json", "quran_embeddings.npy", "quran.faiss")
missing  = [f for f in REQUIRED if not os.path.exists(f)]
if missing:
    print("Missing files (run 'python part_b_embeddings.py' first):")
    for f in missing:
        print(f"  ✗ {f}")
    sys.exit(1)

print("Loading Quran Search System … ", end="", flush=True)

import faiss
from sentence_transformers import SentenceTransformer

from ollama_rag import OllamaRAG

with open("quran_verses.json") as fh:
    verses = json.load(fh)

emb_raw = np.load("quran_embeddings.npy").astype("float32")
faiss.normalize_L2(emb_raw)        # in-place, for cluster lookup
index   = faiss.read_index("quran.faiss")
model   = SentenceTransformer("all-MiniLM-L6-v2")

cl_labels    = np.load("cluster_labels.npy")    if os.path.exists("cluster_labels.npy")    else None
cl_centroids = np.load("kmeans_centroids.npy") if os.path.exists("kmeans_centroids.npy") else None

# ── initialise Ollama (non-blocking — we'll check availability on first 'ask') ─
rag = OllamaRAG()

print("done.\n")


# ── core functions ────────────────────────────────────────────────────────────

def search(query: str, top_k: int = 5) -> list:
    """Return top-k verses most semantically similar to *query*."""
    q = model.encode([query]).astype("float32")
    faiss.normalize_L2(q)
    scores, idxs = index.search(q, top_k)
    return [{**verses[i], "score": float(s)} for s, i in zip(scores[0], idxs[0])]


def ask_quran(question: str) -> dict:
    """Retrieve top-5 verses via FAISS, then ask Ollama to answer *question*."""
    relevant = search(question, top_k=5)

    context = "\n".join(
        f"[{r['surah_name']} {r['surah']}:{r['verse']}] {r['translation']}"
        for r in relevant
    )

    prompt = (
        "You are a Quran scholar. Using ONLY the verses provided, give a "
        "concise, thoughtful answer with verse citations in Surah:Verse format.\n\n"
        f"Question: {question}\n\n"
        "Relevant verses:\n"
        f"{context}"
    )

    if not rag.is_available():
        answer = (
            "⚠  Ollama is not running. Start it with:\n"
            "     ollama serve\n"
            "   Then pull a model:\n"
            "     ollama pull llama3\n"
            "   (Top-5 relevant verses are shown below.)"
        )
    else:
        # Show a loading hint — local models may take a few seconds to respond
        active_model = rag.model or "unknown"
        print(f"  🤖  Asking {active_model} … (this may take a moment)", flush=True)
        try:
            answer = rag.generate(prompt)
        except RuntimeError as exc:
            answer = f"⚠  {exc}"

    return {"answer": answer, "sources": relevant}


def show_clusters():
    if cl_labels is None or cl_centroids is None:
        print("  Cluster data not found — run part_b_embeddings.py first.")
        return
    print(f"\n{'─' * 60}")
    print("30 Thematic Clusters")
    print("─" * 60)
    for cid in range(30):
        idxs = np.where(cl_labels == cid)[0]
        cnt  = len(idxs)
        sims = emb_raw[idxs] @ cl_centroids[cid]
        rep  = verses[idxs[np.argmax(sims)]]
        print(f"\n  [{cid + 1:2d}]  {cnt:4d} verses — "
              f"{rep['surah_name']} {rep['surah']}:{rep['verse']}")
        tr = rep["translation"]
        print(f"       \"{tr[:88]}{'…' if len(tr) > 88 else ''}\"")


def show_models():
    """Print available Ollama models (and which one will be used for RAG)."""
    models_list = rag.list_models()
    if not models_list:
        print("\n  ⚠  No Ollama models found (is Ollama running?)")
        print("  Install Ollama: https://ollama.ai")
        print("  Pull a model:   ollama pull llama3")
        return
    print(f"\n  Ollama models ({len(models_list)} installed):")
    active = rag.model
    for m in models_list:
        marker = "  ← active" if m == active else ""
        print(f"    • {m}{marker}")


# ── REPL ──────────────────────────────────────────────────────────────────────

# Show Ollama status at startup
_ollama_models = rag.list_models()
if _ollama_models:
    _active = rag.model
    print(f"🤖  Ollama: {len(_ollama_models)} model(s) available — using {_active!r}")
else:
    print("💡  Ollama not detected. 'ask' will show sources only.")
    print("    To enable RAG: install Ollama, then run: ollama pull llama3")

print()
print("🕌  Quran Semantic Search & RAG  (local Ollama — no API key needed)")
print("=" * 60)
print("Commands:")
print("  search <query>    — find verses by meaning")
print("  ask <question>    — RAG answer via local Ollama")
print("  cluster           — show 30 thematic clusters")
print("  models            — list available Ollama models")
print("  quit              — exit")
print()

while True:
    try:
        line = input("> ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\nGoodbye!")
        break

    if not line:
        continue

    if line.lower() in ("quit", "exit", "q"):
        print("Goodbye!")
        break

    elif line.lower() == "cluster":
        show_clusters()

    elif line.lower() == "models":
        show_models()

    elif line.lower().startswith("search "):
        q = line[7:].strip()
        if not q:
            print("  Usage: search <query>")
            continue
        results = search(q)
        print(f"\nResults for \"{q}\":")
        for i, r in enumerate(results, 1):
            print(f"\n  {i}. [{r['surah_name']} {r['surah']}:{r['verse']}]  "
                  f"score={r['score']:.3f}")
            print(f"     {r['arabic']}")
            print(f"     {r['translation']}")

    elif line.lower().startswith("ask "):
        q = line[4:].strip()
        if not q:
            print("  Usage: ask <question>")
            continue
        print(f"\nRetrieving relevant verses …")
        result = ask_quran(q)
        print(f"\n💬  Answer:\n{result['answer']}")
        print("\n📖  Sources:")
        for r in result["sources"]:
            print(f"  [{r['surah_name']} {r['surah']}:{r['verse']}] "
                  f"{r['translation'][:90]}{'…' if len(r['translation']) > 90 else ''}")

    else:
        print("  Unknown command. Try: search, ask, cluster, models, quit")
