#!/usr/bin/env bash
#
# start_agent_server.sh — launch the Bucks Agent Server on :3000
#
set -euo pipefail
cd "$(dirname "$0")"

echo "→ Agent Server starting on http://localhost:3000"
MODEL_PROVIDER=ollama exec .venv/bin/python -m uvicorn server_lite:app --host 127.0.0.1 --port 3000
