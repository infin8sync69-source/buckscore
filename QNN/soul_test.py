#!/usr/bin/env python3
"""
Soul of the World — Phase A Live Test
Uses pre-computed BGE-M3 embeddings from the .npy file as query vectors.
This exercises the full pipeline (FAISS → context → Soul Engine → pheromone)
without requiring a GPU or torch at runtime.

Each "test query" is seeded by a manually chosen verse index whose embedding
is semantically representative of the topic, then FAISS finds the top-k
most resonant units across the entire corpus.
"""
import json, sys, time, requests
import numpy as np
import faiss
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from soul_pheromone import PheromoneManager

BASE = Path(__file__).parent

OLLAMA_URL  = 'http://127.0.0.1:11434/api/generate'
OLLAMA_TAGS = 'http://127.0.0.1:11434/api/tags'

# ── Seed verse indices for each test topic ────────────────────────────────────
# Format: (topic_label, verse_index_in_flat_list)
# Index 0 = 1:1; Surah 2 starts at index 7 (after 7-verse Surah 1).
# Surah 3 starts at 7+286=293; Surah 13 (Ra'd) at index ~1755.
SEED_QUERIES = [
    ("wisdom and guidance",      5),      # 1:6  — guide us to the straight path
    ("gratitude and praise",     1),      # 1:2  — all praise, Lord of the worlds
    ("patience in hardship",     159),    # 2:153 — seek help through patience
    ("creation of the universe", 261),    # 2:255 — Ayat al-Kursi / Throne verse
    ("inner peace and trust",    1734),   # 13:28 — hearts find rest in remembrance
]

def load_resources():
    print("Loading resources...")
    verses    = json.loads((BASE / 'quran_verses.json').read_text(encoding='utf-8'))
    cid_map   = json.loads((BASE / 'soul_cid_map.json').read_text(encoding='utf-8'))
    embs      = np.load(str(BASE / 'quran_bge_m3_embeddings.npy')).astype('float32')
    index     = faiss.read_index(str(BASE / 'quran_bge_m3.faiss'))
    pheromone = PheromoneManager(BASE / 'soul_pheromones.json')
    print(f"  Verses:     {len(verses):,}")
    print(f"  Embeddings: {embs.shape}")
    print(f"  FAISS:      {index.ntotal:,} vectors  dim={index.d}")
    print(f"  CID map:    {len(cid_map):,} entries")
    return verses, cid_map, embs, index, pheromone

def detect_model() -> str | None:
    try:
        r = requests.get(OLLAMA_TAGS, timeout=3)
        if r.status_code == 200:
            models = r.json().get('models', [])
            return models[0]['name'] if models else None
    except Exception:
        pass
    return None

def call_soul_engine(prompt: str, model: str) -> str:
    try:
        r = requests.post(OLLAMA_URL, json={
            'model':   model,
            'prompt':  prompt,
            'stream':  False,
            'options': {'temperature': 0.7, 'num_predict': 350},
        }, timeout=90)
        if r.status_code == 200:
            return r.json().get('response', '').strip()
        return f'[HTTP {r.status_code}]'
    except Exception as e:
        return f'[Ollama error: {e}]'

def run_query(topic, seed_idx, verses, cid_map, embs, index, pheromone, model, k=5):
    t0 = time.time()

    # Query vector = pre-computed embedding of the seed verse
    q_vec = embs[seed_idx:seed_idx+1].copy()
    faiss.normalize_L2(q_vec)

    distances, indices = index.search(q_vec, k)
    hits = []
    for dist, idx in zip(distances[0], indices[0]):
        if idx < 0 or idx >= len(verses):
            continue
        v = verses[idx]
        uid = f"{v['surah']}:{v['verse']}"
        hits.append({
            'id':         uid,
            'layer_name': v['surah_name'],
            'layer':      v['surah'],
            'unit':       v['verse'],
            'text_en':    v['translation'],
            'cid':        cid_map.get(f'unit:{uid}', f'sha256:local:{uid}'),
            'score':      float(dist),
        })

    # Build context
    context = '\n'.join(
        f"[{h['layer_name']} {h['layer']}:{h['unit']}] {h['text_en']}"
        for h in hits
    )

    # Generate response
    if model:
        prompt = (
            f"You are a wisdom guide drawing on the Soul of the World.\n\n"
            f"Relevant passages about {topic}:\n{context}\n\n"
            f"Question: What does the Soul of the World teach about {topic}?\n\n"
            f"Provide a thoughtful, concise response grounded in these passages:"
        )
        response = call_soul_engine(prompt, model)
    else:
        response = '[Soul Engine offline — showing retrieved passages only]'

    # Pheromone update
    cid_path = [h['cid'] for h in hits]
    quality  = float(np.mean([h['score'] for h in hits]))
    pheromone.reinforce(cid_path, len(cid_path), quality)

    return {
        'topic':   topic,
        'seed':    f"{verses[seed_idx]['surah']}:{verses[seed_idx]['verse']} — {verses[seed_idx]['translation'][:60]}...",
        'hits':    hits,
        'response': response,
        'elapsed': round(time.time() - t0, 2),
    }

def main():
    print("Soul of the World — Phase A Live Test")
    print("=" * 60)

    verses, cid_map, embs, index, pheromone = load_resources()

    model = detect_model()
    print(f"Soul Engine: {model or 'offline'}")
    print()

    for topic, seed_idx in SEED_QUERIES:
        print(f"\n{'━'*60}")
        print(f"QUERY: {topic.upper()}")
        print('━' * 60)

        result = run_query(topic, seed_idx, verses, cid_map, embs, index, pheromone, model)

        print(f"Seed unit: {result['seed']}")
        print(f"\nTop {len(result['hits'])} resonant units:")
        for h in result['hits']:
            print(f"  [{h['layer_name']} {h['layer']}:{h['unit']}]  score={h['score']:.4f}")
            print(f"  {h['text_en'][:110]}...")
            print(f"  CID: {h['cid'][:52]}...")

        print(f"\nSOUL ENGINE RESPONSE:")
        print(result['response'])
        print(f"\nElapsed: {result['elapsed']}s")

    # Pheromone summary
    print(f"\n{'━'*60}")
    print("PHEROMONE TRAILS — top 10 after all queries:")
    s = pheromone.summary()
    print(f"  Tracked: {s['tracked']}  Queries: {s['queries']}  "
          f"Max: {s['max']:.6f}  Mean: {s['mean']:.6f}")
    print()
    for cid, strength in pheromone.strongest_paths(10):
        print(f"  {strength:.6f}  {cid[:58]}...")

if __name__ == '__main__':
    main()
