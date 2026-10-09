#!/usr/bin/env bash
# Pull required Ollama models for Bucks agent.
# Run once after installing Ollama: https://ollama.com/download

set -e

echo "=== Bucks Agent — Ollama model setup ==="

command -v ollama >/dev/null 2>&1 || { echo "ERROR: ollama not found. Install from https://ollama.com/download"; exit 1; }

# Ensure Ollama server is running
ollama serve &>/dev/null & OLLAMA_PID=$!
sleep 2

pull() {
  echo "Pulling $1 ..."
  ollama pull "$1"
}

# Embedding model — required for RAG and Quran soul indexing
pull nomic-embed-text

# Edge SLM — default (Arabic support for Quran soul grounding)
# Change SLM_MODEL env var to select a different one
pull qwen2.5:3b

echo ""
echo "Optional lighter models (run manually if RAM < 4 GB):"
echo "  ollama pull llama3.2:1b    # 0.6 GB"
echo "  ollama pull smollm2:1.7b   # 1.0 GB"
echo "  ollama pull qwen2.5:1.5b   # 1.0 GB"
echo ""
echo "=== Setup complete. ==="

# If we started ollama, leave it running (it daemonises itself)
