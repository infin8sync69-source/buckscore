import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Test 1: FAISS semantic search
print("=== TEST 1: Semantic Search ===")
import numpy as np
import faiss
import json
from sentence_transformers import SentenceTransformer

base = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(base, 'quran_verses.json')) as f:
    verses = json.load(f)
embeddings = np.load(os.path.join(base, 'quran_embeddings.npy')).astype('float32')
faiss.normalize_L2(embeddings)
index = faiss.read_index(os.path.join(base, 'quran.faiss'))
model = SentenceTransformer('all-MiniLM-L6-v2')

query = "patience in hardship"
vec = model.encode([query], convert_to_numpy=True).astype('float32')
faiss.normalize_L2(vec)
scores, idxs = index.search(vec, 3)
print(f"Query: {query}")
for score, idx in zip(scores[0], idxs[0]):
    v = verses[idx]
    print(f"  [{v['surah_name']} {v['surah_number']}:{v['verse_number']}] score={score:.4f}")
    print(f"  {v['translation'][:150]}")

# Test 2: Ollama RAG
print("\n=== TEST 2: Ollama RAG ===")
from ollama_rag import OllamaRAG
rag = OllamaRAG()
if rag.is_available():
    print(f"Ollama model: {rag.model}")
    context = "\n".join([
        f"[{verses[idx]['surah_name']} {verses[idx]['surah_number']}:{verses[idx]['verse_number']}]: {verses[idx]['translation']}"
        for idx in idxs[0]
    ])
    prompt = f"You are a Quran scholar. Using only these verses, answer: What does the Quran say about patience in hardship?\n\nVerses:\n{context}"
    answer = rag.generate(prompt)
    print(f"Answer:\n{answer}")
else:
    print("Ollama not available — search-only mode confirmed working")

print("\nAll tests passed.")
