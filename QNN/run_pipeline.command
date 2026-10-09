#!/bin/bash
# run_pipeline.command — double-click in Finder to run the NIM+QNN pipeline
# macOS opens this in a new Terminal window automatically

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NIM + QNN Collaborative App Pipeline"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Change to the QNN directory (where .env and all modules live)
cd "$HOME/Desktop/QNN" || { echo "ERROR: ~/Desktop/QNN not found"; exit 1; }

# Load .env if present (export all vars)
if [ -f .env ]; then
  set -o allexport
  source .env
  set +o allexport
  echo "✓ Loaded .env"
fi

# Check Python
if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 not found in PATH"
  read -p "Press enter to close..."
  exit 1
fi

echo "✓ Python: $(python3 --version)"
echo "✓ Working dir: $(pwd)"
echo ""

# Run the pipeline, tee to log
python3 soul_pipeline.py 2>&1 | tee pipeline_run.log

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Pipeline finished. Log saved to pipeline_run.log"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Press enter to close this window..."
