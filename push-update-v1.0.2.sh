#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# push-update-v1.0.2.sh
#
# Commits the v1.0.2 electron fixes + (optionally) updated version.json /
# install.sh to the bucks-browser git repo, then pushes to origin.
#
# BEFORE running this script you must:
#   1. Pin the new tarball to IPFS and get a new CID:
#        ipfs add --pin bucks\ browser/bucks-browser-dist.tar.gz
#      or upload via web3.storage / nft.storage, etc.
#   2. Set NEW_CID below (or export it as an env var before running).
#   3. Optionally update bucks.global/version.json manually with the new CID.
#
# Usage:
#   NEW_CID=bafybei... bash push-update-v1.0.2.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

REPO_DIR="$HOME/Desktop/Bucks Core/bucks browser"
ROOT_DIR="$HOME/Desktop/Bucks Core"

# New CID — override via env var or set here
NEW_CID="${NEW_CID:-}"

cd "$REPO_DIR"

# ── Remove stale git lock if present ─────────────────────────────────────────
if [ -f ".git/index.lock" ]; then
  echo "⚠️  Removing stale .git/index.lock"
  rm ".git/index.lock"
fi

echo "Branch: $(git rev-parse --abbrev-ref HEAD)"
echo ""

# ── Stage the 5 fixed electron files ─────────────────────────────────────────
git add \
  electron/messages-ui.js \
  electron/index.html \
  electron/preload.js \
  electron/main.js \
  electron/renderer.js

echo "✅ Staged 5 electron fixes"

# ── Update version.json and install.sh if a new CID was provided ─────────────
if [ -n "$NEW_CID" ]; then
  echo "📌 Updating version.json and install.sh with CID: $NEW_CID"

  python3 - <<PYEOF
import json, sys
path = "$ROOT_DIR/bucks.global/version.json"
with open(path) as f:
    d = json.load(f)
d["version"] = "1.0.2"
d["cid"] = "$NEW_CID"
d["notes"] = "Fix: messaging peer list, model selector IPC, chat bar cleanup, preload API"
d["releasedAt"] = "2026-08-01T00:00:00Z"
with open(path, "w") as f:
    json.dump(d, f, indent=2)
    f.write("\n")
print("  wrote bucks.global/version.json")
PYEOF

  # Patch BUCKS_CID in install.sh
  sed -i '' "s|BUCKS_CID=\"bafybeih2lm3hmtc7j7nkvju2gxy4ty5v6o5d7evrasqkr27s5fak3ssv5q\"|BUCKS_CID=\"$NEW_CID\"|g" \
    "$ROOT_DIR/install.sh"
  sed -i '' "s|BUCKS_CID=\"bafybeih2lm3hmtc7j7nkvju2gxy4ty5v6o5d7evrasqkr27s5fak3ssv5q\"|BUCKS_CID=\"$NEW_CID\"|g" \
    "$ROOT_DIR/bucks.global/install"

  git add \
    "$ROOT_DIR/bucks.global/version.json" \
    "$ROOT_DIR/install.sh" \
    "$ROOT_DIR/bucks.global/install" \
    2>/dev/null || true

  echo "✅ version.json + install.sh updated and staged"
else
  echo "⚠️  No NEW_CID set — skipping version.json / install.sh update."
  echo "    Run IPFS pin first, then re-run with: NEW_CID=<cid> bash push-update-v1.0.2.sh"
fi

# ── Commit ────────────────────────────────────────────────────────────────────
echo ""
git status --short
echo ""

if [ -n "$NEW_CID" ]; then
  COMMIT_MSG="fix(v1.0.2): messaging peer list, model selector IPC, chat bar cleanup, preload API"
else
  COMMIT_MSG="fix(v1.0.2): messaging peer list, model selector IPC, chat bar cleanup, preload API [pending IPFS pin]"
fi

git commit -m "$COMMIT_MSG"
echo "✅ Committed: $COMMIT_MSG"

# ── Push ──────────────────────────────────────────────────────────────────────
git push origin HEAD
echo ""
echo "✅ Pushed to origin/$(git rev-parse --abbrev-ref HEAD)"
echo ""
if [ -z "$NEW_CID" ]; then
  echo "⚠️  REMINDER: tarball is built at:"
  echo "     ~/Desktop/Bucks Core/bucks browser/bucks-browser-dist.tar.gz (38 MB)"
  echo "   Pin it to IPFS, then re-run this script with NEW_CID=<cid>"
  echo "   to update version.json, install.sh, and bucks.global/install."
fi
