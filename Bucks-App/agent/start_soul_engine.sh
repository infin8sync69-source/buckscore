#!/usr/bin/env bash
#
# start_soul_engine.sh — launch the Bucks Soul Engine on :8765.
#
# By default this runs a fully EMBEDDED model (llama-cpp-python) — no
# separate service to install or run, and RAM-tiered so it also works on
# edge devices. The GGUF weights download once to ~/.bucks/models/ on
# first run.
#
# Usage:
#   ./start_soul_engine.sh                       # embedded model (default)
#   SLM_MODEL=llama3.2:1b ./start_soul_engine.sh  # force a specific edge tier
#   MODEL_PROVIDER=ollama ./start_soul_engine.sh  # use a local Ollama server instead
#
set -euo pipefail
cd "$(dirname "$0")"

PROVIDER="${MODEL_PROVIDER:-nim}"
PORT="${BUCKS_PORT:-8765}"

# 1. Ensure a venv with deps exists
if [ ! -x ".venv/bin/python" ]; then
  echo "→ Creating venv and installing deps…"
  PYTHON_EXE="python3"
  if command -v python3.11 &>/dev/null; then
    PYTHON_EXE="python3.11"
  elif command -v python3.12 &>/dev/null; then
    PYTHON_EXE="python3.12"
  fi
  echo "→ Using Python executable: $PYTHON_EXE"
  $PYTHON_EXE -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet fastapi "uvicorn[standard]" httpx beautifulsoup4 ddgs \
    llama-cpp-python huggingface-hub psutil \
    aiohttp cryptography chromadb
fi

# 2. If explicitly pointed at Ollama, make sure it's actually reachable.
if [ "$PROVIDER" = "ollama" ]; then
  MODEL="${BUCKS_MODEL:-hermes3:latest}"
  if ! curl -s --max-time 3 http://localhost:11434/api/tags >/dev/null; then
    echo "⚠️  MODEL_PROVIDER=ollama but Ollama isn't running. Start it first:  ollama serve"
    exit 1
  fi
  if ! curl -s http://localhost:11434/api/tags | grep -q "${MODEL%%:*}"; then
    echo "→ Pulling model ${MODEL} (one-time)…"
    ollama pull "${MODEL}"
  fi
  echo "→ Soul Engine starting on http://localhost:${PORT} (provider: ollama, model: ${MODEL})"
  MODEL_PROVIDER="ollama" BUCKS_MODEL="${MODEL}" exec .venv/bin/python -m uvicorn soul_engine:app \
    --host 127.0.0.1 --port "${PORT}"
fi

echo "→ Soul Engine starting on http://localhost:${PORT} (provider: edge, embedded model — first run downloads weights to ~/.bucks/models/)"
MODEL_PROVIDER="edge" exec .venv/bin/python -m uvicorn soul_engine:app \
  --host 127.0.0.1 --port "${PORT}"
