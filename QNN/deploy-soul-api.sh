#!/bin/bash
set -e
echo "=== Soul Engine API — Fly.io Deployment ==="

# ── Check / install flyctl ─────────────────────────────────────────────────────
if ! command -v fly &>/dev/null && ! command -v flyctl &>/dev/null; then
    echo "Installing flyctl..."
    curl -L https://fly.io/install.sh | sh
    export PATH="$HOME/.fly/bin:$PATH"
fi

FLY=$(command -v fly 2>/dev/null || command -v flyctl 2>/dev/null)
echo "Using: $FLY ($($FLY version --client 2>/dev/null | head -1))"

# ── Load secrets from .env ─────────────────────────────────────────────────────
ENV_FILE="$HOME/Desktop/QNN/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found"
    exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "$NVIDIA_API_KEY" ]]; then
    echo "ERROR: NVIDIA_API_KEY not found in $ENV_FILE"
    exit 1
fi
echo "NVIDIA_API_KEY: loaded (${#NVIDIA_API_KEY} chars)"

# ── Navigate to deploy directory ───────────────────────────────────────────────
DEPLOY_DIR="$HOME/Desktop/QNN/soul-api-deploy"
cd "$DEPLOY_DIR"
echo "Deploy dir: $DEPLOY_DIR"

# ── Step 1: Authenticate ───────────────────────────────────────────────────────
echo ""
echo "Step 1: Authenticate with Fly.io"
if $FLY auth whoami &>/dev/null; then
    echo "Already authenticated as: $($FLY auth whoami)"
else
    echo "Opening browser for login..."
    $FLY auth login
fi

# ── Step 2: Create app ─────────────────────────────────────────────────────────
echo ""
echo "Step 2: Create app (skip if already exists)"
$FLY apps create soul-engine-api --org personal 2>/dev/null || echo "App already exists — continuing."

# ── Step 3: Set secret ─────────────────────────────────────────────────────────
echo ""
echo "Step 3: Setting NVIDIA_API_KEY secret..."
$FLY secrets set NVIDIA_API_KEY="$NVIDIA_API_KEY" --app soul-engine-api

# ── Step 4: Deploy ─────────────────────────────────────────────────────────────
echo ""
echo "Step 4: Building and deploying Docker image..."
echo "  (BGE-M3 pre-download makes first build ~10 mins — subsequent builds are fast)"
$FLY deploy --app soul-engine-api --remote-only

# ── Step 5: Status ────────────────────────────────────────────────────────────
echo ""
echo "Step 5: Deployment status"
$FLY status --app soul-engine-api

echo ""
echo "================================================================"
echo "Soul Engine API is LIVE at:"
echo "  https://soul-engine-api.fly.dev"
echo ""
echo "Health check:"
echo "  curl https://soul-engine-api.fly.dev/health"
echo ""
echo "Next — update bucks.global frontend:"
echo "  In ~/Desktop/Bucks\\ Core/buck-global-site/index.html, set:"
echo "    window.SOUL_API_URL = 'https://soul-engine-api.fly.dev';"
echo "  Then:"
echo "    cd ~/Desktop/Bucks\\ Core/buck-global-site && vercel --prod"
echo "================================================================"
