#!/usr/bin/env bash
# Bucks Agent Server — one-shot startup script
# Usage: ./start.sh [--slm | --ollama | --litai]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Resolve provider ────────────────────────────────────────────────────────
PROVIDER="${1:-}"
case "$PROVIDER" in
  --slm)    export MODEL_PROVIDER=slm ;;
  --ollama) export MODEL_PROVIDER=ollama ;;
  --litai)  export MODEL_PROVIDER=litai ;;
  "")       PROVIDER="" ;;   # use .env / env var
  *) echo "Unknown flag: $1  (use --slm, --ollama, or --litai)"; exit 1 ;;
esac

# ── Load .env if present ────────────────────────────────────────────────────
[ -f .env ] && set -a && source .env && set +a

PROVIDER="${MODEL_PROVIDER:-slm}"
echo "==> Starting Bucks Agent Server with provider: $PROVIDER"

# ── Ensure Ollama is running for local providers ────────────────────────────
if [[ "$PROVIDER" == "ollama" || "$PROVIDER" == "slm" ]]; then
    if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
        echo "==> Starting Ollama..."
        ollama serve &>/tmp/ollama.log &
        sleep 3
    fi

    SLM="${SLM_MODEL:-qwen2.5:3b}"
    if ! ollama list 2>/dev/null | grep -q "$SLM"; then
        echo "==> Pulling $SLM (first run — this may take a few minutes)..."
        ollama pull "$SLM"
    else
        echo "==> $SLM already available."
    fi
fi

# ── Activate virtualenv ─────────────────────────────────────────────────────
if [ -d .venv ]; then
    source .venv/bin/activate
fi

# ── Launch server ───────────────────────────────────────────────────────────
echo "==> Launching FastAPI on http://localhost:3000"
exec uvicorn server:app --host 0.0.0.0 --port 3000 --reload
