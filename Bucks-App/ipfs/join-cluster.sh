#!/usr/bin/env bash
# Bucks Files — PEER join. Run this on each new machine to install everything,
# join the private network + cluster, and open the file-manager UI.
#
#   bash join-cluster.sh
#
set -euo pipefail
cd "$(dirname "$0")"
source ./cluster-config.env

say() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }

if [ -z "${BOOTSTRAP:-}" ]; then
  echo "BOOTSTRAP is empty — run setup-host.sh on the host first, then re-share this folder."
  exit 1
fi

# 1. Homebrew ----------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  say "Installing Homebrew (you'll be asked for your login password)…"
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
  [ -x /usr/local/bin/brew ]    && eval "$(/usr/local/bin/brew shellenv)"
fi

# 2. Tailscale ---------------------------------------------------------------
if ! command -v tailscale >/dev/null 2>&1 && [ ! -d /Applications/Tailscale.app ]; then
  say "Installing Tailscale…"
  brew install --cask tailscale
fi
TS=$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)
if [ -n "${TS_AUTHKEY:-}" ]; then
  say "Joining Tailscale with auth key (no login needed)…"
  sudo "$TS" up --authkey="$TS_AUTHKEY" || "$TS" up --authkey="$TS_AUTHKEY"
else
  say "Connecting to Tailscale (a browser login window will open — use the SAME account/tailnet as the host)…"
  sudo "$TS" up || "$TS" up || true
fi

# 3. IPFS + cluster ----------------------------------------------------------
say "Installing ipfs + ipfs-cluster…"
command -v ipfs >/dev/null 2>&1 || brew install ipfs
command -v ipfs-cluster-service >/dev/null 2>&1 || brew install ipfs-cluster

[ -d "$HOME/.ipfs" ] || ipfs init
pgrep -f "ipfs daemon" >/dev/null 2>&1 || { say "Starting IPFS daemon…"; ipfs daemon >/tmp/ipfs.log 2>&1 & sleep 5; }

export CLUSTER_SECRET
[ -f "$HOME/.ipfs-cluster/service.json" ] || ipfs-cluster-service init
pgrep -f "ipfs-cluster-service daemon" >/dev/null 2>&1 || {
  say "Joining cluster via bootstrap peer…"
  ipfs-cluster-service daemon --bootstrap "$BOOTSTRAP" >/tmp/ipfs-cluster.log 2>&1 & sleep 6
}

# 4. UI ----------------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
  pgrep -f "node .*server.js" >/dev/null 2>&1 || { say "Starting file-manager UI…"; node server.js >/tmp/bucks-ui.log 2>&1 & sleep 2; }
  open "http://localhost:3939"
else
  echo "Node.js not found — install it to run the UI (brew install node), then: node server.js"
fi

# 5. Verify ------------------------------------------------------------------
say "Cluster peers:"
ipfs-cluster-ctl peers ls || true
say "Done. UI: http://localhost:3939"
