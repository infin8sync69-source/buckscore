#!/bin/bash
# Soul of the World Swarm — one-command setup
# Usage: bash soul_setup.sh
# Installs all dependencies, verifies corpus files, and checks Ollama.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          Soul of the World — Swarm Setup                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Step 1: Python version check ─────────────────────────────────────────────
PYTHON=$(command -v python3 || command -v python)
if [ -z "$PYTHON" ]; then
    echo "ERROR: Python 3 not found. Install Python 3.10+ and retry."
    exit 1
fi
PY_VERSION=$($PYTHON --version 2>&1)
echo "Python: $PY_VERSION"

# ── Step 2: Install requirements ─────────────────────────────────────────────
echo ""
echo "Installing requirements..."
$PYTHON -m pip install -r soul_requirements.txt --break-system-packages -q
echo "✓  Requirements installed"

# ── Step 3: Verify core imports ───────────────────────────────────────────────
echo ""
echo "Verifying imports..."
$PYTHON - <<'EOF'
import sys
ok = True
checks = [
    ("numpy",               "numpy"),
    ("bm25s",               "bm25s"),
    ("qdrant_client",       "qdrant-client"),
    ("sentence_transformers","sentence-transformers"),
    ("faiss",               "faiss-cpu"),
    ("requests",            "requests"),
]
for mod, pkg in checks:
    try:
        __import__(mod)
        print(f"  ✓  {pkg}")
    except ImportError:
        print(f"  ✗  {pkg}  (run: pip install {pkg} --break-system-packages)")
        ok = False

# Optional
for mod, pkg in [("dspy", "dspy-ai")]:
    try:
        __import__(mod)
        print(f"  ✓  {pkg} (optional)")
    except ImportError:
        print(f"  -  {pkg} (optional — install for prompt optimization)")

if not ok:
    sys.exit(1)
EOF

# ── Step 4: Verify corpus files ───────────────────────────────────────────────
echo ""
echo "Verifying corpus files..."

check_file() {
    if [ -f "$1" ]; then
        SIZE=$(du -sh "$1" | cut -f1)
        echo "  ✓  $1  ($SIZE)"
    else
        echo "  ✗  $1  MISSING"
        MISSING=1
    fi
}

MISSING=0
check_file "quran_verses.json"
check_file "quran_bge_m3.faiss"
check_file "quran_bge_m3_embeddings.npy"
check_file "soul_cid_map.json"
check_file "soul_corpus_dag.json"

if [ "$MISSING" -eq 1 ]; then
    echo ""
    echo "⚠  Some corpus files are missing. Run soul_corpus_builder.py to rebuild."
fi

# ── Step 5: Check Ollama ──────────────────────────────────────────────────────
echo ""
echo "Checking Ollama (Soul Engine)..."
if curl -sf http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
    MODEL=$(curl -sf http://127.0.0.1:11434/api/tags | $PYTHON -c "
import sys, json
data = json.load(sys.stdin)
models = data.get('models', [])
print(models[0]['name'] if models else 'no model loaded')
")
    echo "  ✓  Ollama running  (model: $MODEL)"
else
    echo "  ⚠  Ollama not running — start with: ollama serve"
    echo "      Then load a model: ollama pull llama3 (or any model)"
fi

# ── Step 6: Smoke test ────────────────────────────────────────────────────────
echo ""
echo "Running evaluator smoke test..."
$PYTHON soul_evaluator.py
echo ""

# ── Step 7: Final status ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Setup complete. To launch the swarm:                       ║"
echo "║                                                              ║"
echo "║  python soul_swarm.py --interactive                          ║"
echo "║  python soul_swarm.py --query \"What is wisdom?\"             ║"
echo "║  python soul_swarm.py --status                              ║"
echo "║  python soul_swarm.py --bench                               ║"
echo "║  python soul_swarm.py --use-qdrant --interactive            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
