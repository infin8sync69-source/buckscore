#!/bin/bash
# Bucks — Pin to IPFS + get CID
# Run this ONCE on your Mac to publish Bucks to IPFS
# Then share the CID with anyone to let them install with:
#   curl -fsSL https://ipfs.io/ipfs/CID/install.sh | bash

set -e

BUCKS_DIR="$(cd "$(dirname "$0")" && pwd)"
TARBALL="$BUCKS_DIR/bucks-browser-dist.tar.gz"

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║    Bucks → IPFS Pin + CID Generator  ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# ── Check for the tarball ──────────────────────────────────────────────────────
if [ ! -f "$TARBALL" ]; then
  echo "Building source tarball first..."
  cd "$BUCKS_DIR"
  tar -czf bucks-browser-dist.tar.gz \
    --exclude="bucks browser/node_modules" \
    --exclude="bucks browser/electron/node_modules" \
    --exclude="bucks browser/agent/.venv" \
    --exclude="bucks browser/agent/__pycache__" \
    --exclude="bucks browser/.git" \
    "bucks browser/" && \
  echo "✅ Tarball created: $(ls -lh bucks-browser-dist.tar.gz | awk '{print $5}')"
fi

echo "Tarball: $(ls -lh "$TARBALL" | awk '{print $5}')"
echo ""

# ── Option 1: Use local IPFS node (kubo) ──────────────────────────────────────
if command -v ipfs &>/dev/null; then
  echo "✅ IPFS daemon found"

  # Ensure daemon is running
  if ! ipfs swarm peers &>/dev/null 2>&1; then
    echo "Starting IPFS daemon..."
    ipfs daemon &
    sleep 5
  fi

  echo "Adding to IPFS..."
  mkdir -p /tmp/bucks-ipfs-dist
  cp "$TARBALL" /tmp/bucks-ipfs-dist/bucks-browser-dist.tar.gz
  cp "$BUCKS_DIR/install.sh" /tmp/bucks-ipfs-dist/install.sh

  CID=$(ipfs add -r --cid-version=1 --quieter /tmp/bucks-ipfs-dist)
  echo ""
  echo "════════════════════════════════════════"
  echo "  IPFS CID: $CID"
  echo "════════════════════════════════════════"
  echo ""
  echo "Install command for any device:"
  echo "  curl -fsSL https://ipfs.io/ipfs/$CID/install.sh | bash"
  echo ""
  echo "Direct download:"
  echo "  https://ipfs.io/ipfs/$CID/bucks-browser-dist.tar.gz"
  echo ""

  # ── Pin to Pinata (optional) ─────────────────────────────────────────────────
  echo "To pin permanently on Pinata (free):"
  echo "  1. Go to https://app.pinata.cloud → sign up free"
  echo "  2. Get your JWT from API Keys"
  echo "  3. Run:"
  echo "     curl -X POST https://api.pinata.cloud/pinning/pinByHash \\"
  echo "       -H 'Authorization: Bearer YOUR_JWT' \\"
  echo "       -H 'Content-Type: application/json' \\"
  echo "       -d '{\"hashToPin\":\"$CID\"}'"
  echo ""
  exit 0
fi

# ── Option 2: Install kubo via Homebrew ────────────────────────────────────────
echo "IPFS not found. Installing kubo via Homebrew..."
if command -v brew &>/dev/null; then
  brew install ipfs
  ipfs init
  echo "IPFS installed. Re-run this script."
  exit 0
fi

# ── Option 3: Pinata upload directly (needs JWT) ──────────────────────────────
echo ""
echo "No IPFS or Homebrew found."
echo ""
echo "OPTION A — Upload via Pinata web UI (easiest):"
echo "  1. Go to https://app.pinata.cloud → sign up free (1GB free)"
echo "  2. Click 'Upload' → upload: $TARBALL"
echo "  3. Also upload: $BUCKS_DIR/install.sh"
echo "  4. After upload, pin the folder and copy the CID"
echo ""
echo "OPTION B — Upload via Pinata API (if you have a JWT):"
echo "  export PINATA_JWT=your_jwt_here"
echo "  curl -X POST https://api.pinata.cloud/pinning/pinFileToIPFS \\"
echo "    -H 'Authorization: Bearer \$PINATA_JWT' \\"
echo "    -F 'file=@$TARBALL' | python3 -m json.tool"
echo ""
echo "OPTION C — Web3.storage (free 5GB):"
echo "  npm install -g @web3-storage/w3cli"
echo "  w3 login your@email.com"
echo "  w3 up $TARBALL"
echo ""
