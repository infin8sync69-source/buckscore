#!/usr/bin/env python3
"""Part B: Quran semantic search — embeddings, FAISS index, clustering, RAG Q&A."""

import json
import os
import sys
import time

import numpy as np
import requests


# ── helpers ───────────────────────────────────────────────────────────────────

def fetch_with_retry(url, max_retries=4, backoff=2):
    for attempt in range(max_retries):
        try:
            r = requests.get(url, timeout=120)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            if attempt < max_retries - 1:
                wait = backoff ** attempt
                print(f"    retry {attempt + 1} in {wait}s … ({e})")
                time.sleep(wait)
            else:
                raise


print("=" * 60)
print("PART B — Quran Semantic Search System")
print("=" * 60)

# ── B1: verse data ────────────────────────────────────────────────────────────

print("\n[B1] Downloading verse data (Arabic + English) …")

VERSES_FILE = "quran_verses.json"

if os.path.exists(VERSES_FILE):
    print(f"  ✓ Loading cached {VERSES_FILE} …")
    with open(VERSES_FILE) as fh:
        verses = json.load(fh)
    print(f"  ✓ {len(verses):,} verses loaded")
else:
    print("  Fetching Arabic (Uthmani) …")
    ar_data = fetch_with_retry("https://api.alquran.cloud/v1/quran/quran-uthmani")
    print("  Fetching English (Sahih International) …")
    en_data = fetch_with_retry("https://api.alquran.cloud/v1/quran/en.sahih")

    ar_map = {s["number"]: s for s in ar_data["data"]["surahs"]}
    en_map = {s["number"]: s for s in en_data["data"]["surahs"]}

    verses = []
    for n in range(1, 115):
        ar_s, en_s = ar_map[n], en_map[n]
        for ar_a, en_a in zip(ar_s["ayahs"], en_s["ayahs"]):
            verses.append(dict(
                surah=n,
                surah_name=ar_s["englishName"],
                surah_name_arabic=ar_s["name"],
                verse=ar_a["numberInSurah"],
                arabic=ar_a["text"],
                translation=en_a["text"],
            ))

    with open(VERSES_FILE, "w", encoding="utf-8") as fh:
        json.dump(verses, fh, ensure_ascii=False, indent=2)
    print(f"  ✓ Saved {len(verses):,} verses → {VERSES_FILE}")

# ── B2: embeddings ────────────────────────────────────────────────────────────

print("\n[B2] Generating embeddings (all-MiniLM-L6-v2) …")

from sentence_transformers import SentenceTransformer

EMBED_FILE  = "quran_embeddings.npy"
embed_model = SentenceTransformer("all-MiniLM-L6-v2")

if os.path.exists(EMBED_FILE):
    print(f"  ✓ Loading cached {EMBED_FILE} …")
    embeddings = np.load(EMBED_FILE)
else:
    texts = [
        f"Surah {v['surah_name']}, Verse {v['verse']}: {v['translation']}"
        for v in verses
    ]
    print(f"  Encoding {len(texts):,} verses …")
    embeddings = embed_model.encode(
        texts, batch_size=64, show_progress_bar=True, convert_to_numpy=True
    )
    np.save(EMBED_FILE, embeddings)

print(f"  ✓ Embeddings shape: {embeddings.shape}")

# ── B3: FAISS index ───────────────────────────────────────────────────────────

print("\n[B3] Building FAISS index (cosine similarity) …")

import faiss

FAISS_FILE = "quran.faiss"
emb_norm   = embeddings.copy().astype("float32")
faiss.normalize_L2(emb_norm)

if os.path.exists(FAISS_FILE):
    print(f"  ✓ Loading cached {FAISS_FILE} …")
    index = faiss.read_index(FAISS_FILE)
else:
    dim   = emb_norm.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(emb_norm)
    faiss.write_index(index, FAISS_FILE)

print(f"  ✓ FAISS index: {index.ntotal:,} vectors, dim={index.d}")


# ── search function ───────────────────────────────────────────────────────────

def search(query: str, top_k: int = 5) -> list:
    q = embed_model.encode([query]).astype("float32")
    faiss.normalize_L2(q)
    scores, idxs = index.search(q, top_k)
    return [
        {**verses[i], "score": float(s)}
        for s, i in zip(scores[0], idxs[0])
    ]


# ── B4: thematic clustering ───────────────────────────────────────────────────

print("\n[B4] Thematic clustering (K-Means, 30 clusters) …")

from sklearn.cluster import KMeans

LABELS_FILE    = "cluster_labels.npy"
CENTROIDS_FILE = "kmeans_centroids.npy"

if os.path.exists(LABELS_FILE) and os.path.exists(CENTROIDS_FILE):
    labels    = np.load(LABELS_FILE)
    centroids = np.load(CENTROIDS_FILE)
    print(f"  ✓ Loaded cached clustering")
else:
    print("  Running KMeans (n_clusters=30, n_init=10) …")
    km        = KMeans(n_clusters=30, random_state=42, n_init=10)
    km.fit(emb_norm)
    labels    = km.labels_
    centroids = km.cluster_centers_
    np.save(LABELS_FILE,    labels)
    np.save(CENTROIDS_FILE, centroids)
    print(f"  ✓ Done (inertia={km.inertia_:.1f})")

# Build representative-verse lookup for every cluster
cluster_themes = {}
for cid in range(30):
    idxs = np.where(labels == cid)[0]
    if not len(idxs):
        continue
    sims  = emb_norm[idxs] @ centroids[cid]
    top3  = idxs[np.argsort(sims)[::-1][:3]]
    cluster_themes[cid] = [verses[i] for i in top3]

print(f"  ✓ Cluster themes built for 30 clusters")

# ── B5: UMAP visualization ────────────────────────────────────────────────────

print("\n[B5] UMAP visualization …")

CLUSTER_IMG = "theme_clusters.png"
try:
    import umap
    import matplotlib.pyplot as plt
    import matplotlib.cm as cm

    print("  Running UMAP (may take ~1 min) …")
    reducer = umap.UMAP(n_components=2, random_state=42, n_neighbors=15, min_dist=0.1)
    pts     = reducer.fit_transform(emb_norm)

    fig, ax = plt.subplots(figsize=(16, 12))
    tab20   = cm.tab20(np.linspace(0, 1, 20))
    set3    = cm.Set3(np.linspace(0, 1, 12))
    colors  = list(tab20) + list(set3[:10])

    for cid in range(30):
        m = labels == cid
        ax.scatter(pts[m, 0], pts[m, 1],
                   c=[colors[cid]], s=3, alpha=0.55, label=f"C{cid + 1}")

    ax.set_title(
        "Quran Verse Clusters — UMAP Projection\n"
        "6,236 verses · 30 thematic clusters · all-MiniLM-L6-v2 embeddings",
        fontsize=13, fontweight="bold",
    )
    ax.set_xlabel("UMAP dimension 1")
    ax.set_ylabel("UMAP dimension 2")
    ax.legend(loc="upper right", ncol=5, fontsize=6, markerscale=4,
              framealpha=0.8)
    plt.tight_layout()
    plt.savefig(CLUSTER_IMG, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  ✓ Saved {CLUSTER_IMG}")

except ImportError:
    print("  ⚠  umap-learn not available — skipping UMAP plot")
except Exception as e:
    print(f"  ⚠  UMAP failed: {e}")

# ── B6: LLM providers & RAG ───────────────────────────────────────────────────

print("\n[B6] Setting up RAG Q&A …")


def _call_gemini(key: str, prompt: str) -> str:
    import google.generativeai as genai
    genai.configure(api_key=key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    return model.generate_content(prompt).text


def _call_openai(key: str, prompt: str) -> str:
    import openai
    c = openai.OpenAI(api_key=key)
    return c.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=600,
    ).choices[0].message.content


def _call_anthropic(key: str, prompt: str) -> str:
    import anthropic
    c = anthropic.Anthropic(api_key=key)
    return c.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    ).content[0].text


_PROVIDERS = [
    ("GEMINI_API_KEY",    _call_gemini),
    ("OPENAI_API_KEY",    _call_openai),
    ("ANTHROPIC_API_KEY", _call_anthropic),
]


def call_llm(prompt: str) -> str:
    for env_var, fn in _PROVIDERS:
        key = os.environ.get(env_var)
        if key:
            try:
                return fn(key, prompt)
            except Exception as e:
                print(f"    [{env_var}] error: {e}")
    return (
        "⚠  No AI provider configured.\n"
        "   Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY."
    )


def ask_quran(question: str) -> dict:
    relevant = search(question, top_k=5)
    ctx = "\n".join(
        f"[{r['surah_name']} {r['surah']}:{r['verse']}] {r['translation']}"
        for r in relevant
    )
    prompt = f"""You are a Quranic scholar. Answer the question based ONLY on the verses provided below.

Question: {question}

Relevant verses:
{ctx}

Give a clear, concise answer with specific verse citations (Surah:Verse format)."""
    return {"question": question, "answer": call_llm(prompt), "sources": relevant}


print("  ✓ RAG system ready")

# ── Demo run ──────────────────────────────────────────────────────────────────

print("\n" + "=" * 60)
print("Running demo queries …")
print("=" * 60)

_lines = [
    "=" * 60,
    "QURAN SEMANTIC SEARCH — DEMO OUTPUT",
    "=" * 60,
]


def _tee(*args):
    """Print and append to demo lines."""
    txt = " ".join(str(a) for a in args)
    print(txt)
    _lines.append(txt)


def demo_search(query):
    _tee(f"\n{'─' * 50}")
    _tee(f"SEARCH: {query}")
    _tee("─" * 50)
    for r in search(query, top_k=5):
        _tee(f"  [{r['surah_name']} {r['surah']}:{r['verse']}]  score={r['score']:.3f}")
        tr = r["translation"]
        _tee(f"    {tr[:115]}{'…' if len(tr) > 115 else ''}")


def demo_ask(question):
    _tee(f"\n{'─' * 50}")
    _tee(f"ASK: {question}")
    _tee("─" * 50)
    result = ask_quran(question)
    _tee("Answer:")
    _tee(result["answer"])
    _tee("\nSources:")
    for r in result["sources"]:
        _tee(f"  [{r['surah_name']} {r['surah']}:{r['verse']}] "
             f"{r['translation'][:80]}…")


demo_search("mercy and compassion")
demo_search("Day of Judgment")
demo_ask("What does the Quran say about patience?")
demo_ask("How should Muslims treat their parents?")

# Top 5 cluster themes
_tee(f"\n{'─' * 50}")
_tee("TOP 5 THEMATIC CLUSTERS")
_tee("─" * 50)
for cid in range(5):
    cnt  = int(np.sum(labels == cid))
    reps = cluster_themes.get(cid, [])
    _tee(f"\nCluster {cid + 1}  ({cnt} verses):")
    for v in reps[:2]:
        _tee(f"  [{v['surah_name']} {v['surah']}:{v['verse']}] "
             f"{v['translation'][:90]}…")

with open("demo_output.txt", "w", encoding="utf-8") as fh:
    fh.write("\n".join(_lines) + "\n")
print("\n  ✓ Saved demo_output.txt")

# ── Final summary ─────────────────────────────────────────────────────────────

print("\n" + "=" * 60)
print("PART B COMPLETE")
print("=" * 60)
print(f"  Verses loaded    : {len(verses):,}")
print(f"  Embeddings shape : {embeddings.shape}")
print(f"  FAISS vectors    : {index.ntotal:,}")
print(f"  Clusters         : 30 thematic groups")
print(f"  Files created    : quran_verses.json, quran_embeddings.npy,")
print(f"                     quran.faiss, cluster_labels.npy,")
print(f"                     kmeans_centroids.npy, theme_clusters.png,")
print(f"                     demo_output.txt")
print("=" * 60)
