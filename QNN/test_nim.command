#!/bin/bash
# NIM connection test — double-click to run
cd "$(dirname "$0")"

echo ""
echo "=== NIM Connection & Latency Test ==="
echo ""

python3 - <<'PYEOF'
import os, sys, time
from pathlib import Path

# Load env from the QNN folder
env_file = Path(__file__).parent / ".env"  if "__file__" in dir() else Path(".env")
# Fallback: load from CWD
from dotenv import load_dotenv
load_dotenv(".env")

api_key = os.getenv("NVIDIA_API_KEY", "")
if not api_key:
    print("ERROR: NVIDIA_API_KEY not found in .env")
    sys.exit(1)
print(f"API key: {api_key[:12]}...  (loaded)")

from soul_nim import NIMClient

print("\n--- Connecting to NIM ---")
try:
    nim = NIMClient()
except Exception as e:
    print(f"FAIL: {e}")
    sys.exit(1)

# --- Chat latency test ---
prompt = "In one sentence, what is wisdom and patience in the face of hardship?"
print(f"\nPrompt: {prompt!r}")

times = []
for i in range(3):
    text, ms = nim.generate(prompt, max_tokens=100)
    times.append(ms)
    if i == 0:
        print(f"\nResponse: {text}")
    print(f"  Run {i+1}: {ms} ms")

avg_nim = sum(times) // len(times)
print(f"  NIM avg: {avg_nim} ms  (model: {nim.active_model})")

# --- Embed test ---
print("\n--- Embed Dimension Check ---")
ok = nim.probe_embed()

# --- Ollama comparison ---
print("\n--- Ollama Comparison ---")
import requests
ollama_ms = None
try:
    r = requests.get("http://127.0.0.1:11434/api/tags", timeout=3)
    models = r.json().get("models", []) if r.status_code == 200 else []
    if models:
        model = models[0]["name"]
        t0 = time.time()
        r2 = requests.post("http://127.0.0.1:11434/api/generate", json={
            "model": model, "prompt": prompt, "stream": False,
            "options": {"temperature": 0.7, "num_predict": 100}
        }, timeout=120)
        ollama_ms = int((time.time() - t0) * 1000)
        if r2.status_code == 200:
            ollama_text = r2.json().get("response", "").strip()
            print(f"Ollama model : {model}")
            print(f"Ollama resp  : {ollama_text[:200]}")
            print(f"Ollama latency: {ollama_ms} ms")
        else:
            print(f"Ollama HTTP {r2.status_code}")
    else:
        print("Ollama: not running or no model loaded")
except Exception as e:
    print(f"Ollama: not reachable ({e})")

# --- Final summary ---
print("\n==============================")
print("   LATENCY COMPARISON")
print("==============================")
print(f"  NIM    : {avg_nim:>5} ms  ({nim.active_model})")
if ollama_ms:
    print(f"  Ollama : {ollama_ms:>5} ms")
    ratio = ollama_ms / max(avg_nim, 1)
    if ratio > 1:
        print(f"  → NIM is {ratio:.1f}x faster than Ollama")
    else:
        print(f"  → Ollama is {1/ratio:.1f}x faster than NIM")
else:
    print("  Ollama : not available for comparison")
print(f"\n  NIM embed : dim={nim.embed_dim}  safe_for_FAISS={nim.embed_enabled}")
print("\n=== Test complete ===")
PYEOF

echo ""
read -p "Press Enter to close..."
