#!/usr/bin/env python3
"""
Soul of the World — Builder Agent (Minimum Viable)
Pipeline: embed query → FAISS search → fetch unit content → Soul Engine → pheromone update
"""
import json, os, sys, time, requests
import numpy as np
from pathlib import Path
from dotenv import load_dotenv

# QNN_PATH env var lets users install the Soul Engine outside ~/Desktop/QNN.
QNN_BASE = os.environ.get('QNN_PATH', os.path.expanduser('~/Desktop/QNN'))
load_dotenv(os.path.join(QNN_BASE, '.env'))

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))   # ensure local imports work

from soul_pheromone import PheromoneManager

OLLAMA_URL  = 'http://127.0.0.1:11434/api/generate'
OLLAMA_TAGS = 'http://127.0.0.1:11434/api/tags'

# ── NIM singleton (module-level; shared by AdaptiveBuilder via import) ────────
try:
    from soul_nim import get_nim_client
    _NIM = get_nim_client()
except Exception:
    _NIM = None

# Lazy-load heavy deps
try:
    import faiss
    from sentence_transformers import SentenceTransformer
    HAS_FAISS = True
except ImportError:
    HAS_FAISS = False
    print("Warning: faiss or sentence-transformers not found. Retrieval disabled.")


class BuilderAgent:
    def __init__(self):
        print("Soul of the World — Builder Agent")
        print("=" * 50)
        self._load_corpus()
        self._load_retrieval()
        self.pheromone = PheromoneManager(BASE / 'soul_pheromones.json')
        print("Agent ready.\n")

    # ── Initialisation ───────────────────────────────────────────────────────

    def _load_corpus(self):
        print("Loading corpus...")
        verses = json.loads((BASE / 'quran_verses.json').read_text(encoding='utf-8'))
        self.verses_list = verses
        self.verse_map   = {f"{v['surah']}:{v['verse']}": v for v in verses}

        cid_path = BASE / 'soul_cid_map.json'
        if cid_path.exists():
            self.cid_map = json.loads(cid_path.read_text(encoding='utf-8'))
            print(f"  CID map: {len(self.cid_map):,} entries")
        else:
            self.cid_map = {}
            print("  Warning: soul_cid_map.json missing — run soul_ipfs_pinner.py")

    def _load_retrieval(self):
        if not HAS_FAISS:
            self.model = None
            self.index = None
            return

        idx_path = BASE / 'quran_bge_m3.faiss'
        if not idx_path.exists():
            print(f"  Warning: FAISS index not found at {idx_path}")
            self.index = None
            self.model = None
            return

        print("Loading FAISS index...")
        self.index = faiss.read_index(str(idx_path))
        print(f"  {self.index.ntotal:,} vectors  dim={self.index.d}")

        print("Loading BGE-M3 encoder...")
        self.model = SentenceTransformer('BAAI/bge-m3')
        print("  Encoder ready")

    # ── Retrieval ─────────────────────────────────────────────────────────────

    def _embed(self, text: str) -> np.ndarray:
        return self.model.encode([text], normalize_embeddings=True).astype('float32')

    def _search(self, query: str, k: int = 5) -> list[dict]:
        if self.index is None or self.model is None:
            return []
        vec = self._embed(query)
        distances, indices = self.index.search(vec, k)
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx < 0 or idx >= len(self.verses_list):
                continue
            v = self.verses_list[idx]
            results.append({
                'id':         f"{v['surah']}:{v['verse']}",
                'layer':      v['surah'],
                'unit':       v['verse'],
                'layer_name': v['surah_name'],
                'text_ar':    v['arabic'],
                'text_en':    v['translation'],
                'score':      float(dist),
            })
        return results

    def _get_cid(self, unit_id: str) -> str:
        return self.cid_map.get(f'unit:{unit_id}', f'sha256:local:{unit_id}')

    # ── Soul Engine ───────────────────────────────────────────────────────────

    def _detect_model(self) -> str | None:
        try:
            r = requests.get(OLLAMA_TAGS, timeout=3)
            if r.status_code == 200:
                models = r.json().get('models', [])
                return models[0]['name'] if models else None
        except Exception:
            pass
        return None

    def _call_soul_engine(self, prompt: str, temperature: float = 0.7) -> str:
        """Generate via Soul Engine: NIM cloud first, Ollama fallback."""
        global _NIM
        if _NIM is not None:
            try:
                text, _ = _NIM.generate(prompt, temperature=temperature, max_tokens=400)
                return text
            except Exception as e:
                print(f"⚠ NIM error: {e} — falling back to Ollama")

        # Ollama fallback
        model = self._detect_model()
        if model is None:
            return '[Soul Engine offline — Ollama not running or no model loaded]'
        try:
            r = requests.post(OLLAMA_URL, json={
                'model':   model,
                'prompt':  prompt,
                'stream':  False,
                'options': {'temperature': temperature, 'num_predict': 400},
            }, timeout=90)
            if r.status_code == 200:
                return r.json().get('response', '').strip()
            return f'[Soul Engine error: HTTP {r.status_code}]'
        except Exception as e:
            return f'[Soul Engine error: {e}]'

    # ── Main query pipeline ───────────────────────────────────────────────────

    def query(self, user_query: str, k: int = 5) -> dict:
        t0 = time.time()

        # 1. Retrieve relevant units
        hits = self._search(user_query, k=k)

        # 2. Build context + citation list
        context_lines = []
        cid_path      = []
        citations     = []

        for hit in hits:
            cid = self._get_cid(hit['id'])
            cid_path.append(cid)
            context_lines.append(
                f"[{hit['layer_name']} {hit['layer']}:{hit['unit']}] {hit['text_en']}"
            )
            citations.append({
                'ref':   f"{hit['layer_name']} {hit['layer']}:{hit['unit']}",
                'text':  hit['text_en'],
                'cid':   cid,
                'score': round(hit['score'], 4),
            })

        context = '\n'.join(context_lines)

        # 3. Build prompt
        if hits:
            prompt = (
                "You are a wisdom guide drawing on the Soul of the World.\n\n"
                f"Relevant passages:\n{context}\n\n"
                f"Question: {user_query}\n\n"
                "Provide a thoughtful, concise response grounded in these passages:"
            )
        else:
            prompt = (
                "You are a wisdom guide.\n\n"
                f"Question: {user_query}\n\n"
                "Provide a thoughtful, concise response:"
            )

        # 4. Generate
        response = self._call_soul_engine(prompt)

        elapsed = time.time() - t0

        # 5. Pheromone update — quality ≈ mean similarity score
        if cid_path:
            quality = min(1.0, sum(h['score'] for h in hits) / max(len(hits), 1))
            self.pheromone.reinforce(cid_path, len(cid_path), quality)

        return {
            'query':     user_query,
            'response':  response,
            'citations': citations,
            'cid_path':  cid_path,
            'elapsed':   round(elapsed, 2),
        }


# ── Entry point ───────────────────────────────────────────────────────────────

TEST_QUERIES = [
    "What is the nature of wisdom and guidance?",
    "How should one express gratitude?",
    "What does patience mean in the face of hardship?",
    "How was the universe and humanity created?",
    "What is the path to inner peace and tranquility?",
]


def run_tests(agent: BuilderAgent):
    print(f"Running {len(TEST_QUERIES)} test queries...\n")
    for i, q in enumerate(TEST_QUERIES, 1):
        print(f"\n{'━'*60}")
        print(f"QUERY {i}: {q}")
        print('━' * 60)
        result = agent.query(q)

        print(f"\nRESPONSE:\n{result['response']}")

        print(f"\nCITATIONS ({len(result['citations'])}):")
        for c in result['citations']:
            print(f"  [{c['ref']}]  score={c['score']}")
            print(f"  {c['text'][:110]}...")
            print(f"  CID: {c['cid'][:52]}...")

        print(f"\nElapsed: {result['elapsed']}s")

    # Pheromone summary after all queries
    print(f"\n{'━'*60}")
    print("PHEROMONE TRAILS (top 10 after all queries):")
    s = agent.pheromone.summary()
    print(f"  Tracked: {s['tracked']}  Queries: {s['queries']}  "
          f"Max: {s['max']}  Mean: {s['mean']}")
    for cid, strength in agent.pheromone.strongest_paths(10):
        print(f"  {strength:.6f}  {cid[:58]}...")


def run_interactive(agent: BuilderAgent):
    while True:
        try:
            q = input('\nQuery (or quit): ').strip()
        except (KeyboardInterrupt, EOFError):
            break
        if not q or q.lower() in ('quit', 'exit', 'q'):
            break
        result = agent.query(q)
        print(f"\n{'━'*60}")
        print(f"RESPONSE:\n{result['response']}")
        print(f"\nCITATIONS ({len(result['citations'])}):")
        for c in result['citations']:
            print(f"  [{c['ref']}] score={c['score']}  {c['text'][:90]}...")
        print(f"\nElapsed: {result['elapsed']}s")
        print(f"Pheromone trails: {agent.pheromone.summary()}")


if __name__ == '__main__':
    agent = BuilderAgent()
    if '--interactive' in sys.argv:
        run_interactive(agent)
    else:
        run_tests(agent)
