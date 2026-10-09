#!/usr/bin/env bash
# Bucks Files — HOST setup. Run this ONCE on the machine that owns the cluster.
# Puts the host on Tailscale (so peers anywhere can reach it) and writes the
# bootstrap address into cluster-config.env for the join script to use.
#
#   bash setup-host.sh
#
set -euo pipefail
cd "$(dirname "$0")"
source ./cluster-config.env

say() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }

# Homebrew -------------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  say "Installing Homebrew…"
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
  [ -x /usr/local/bin/brew ]    && eval "$(/usr/local/bin/brew shellenv)"
fi

# Tailscale (free private network across machines) ---------------------------
if ! command -v tailscale >/dev/null 2>&1 && [ ! -d /Applications/Tailscale.app ]; then
  say "Installing Tailscale…"
  brew install --cask tailscale
fi
TS=$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)

say "Connecting to Tailscale (a browser login window will open)…"
sudo "$TS" up || "$TS" up || true
TS_IP=$("$TS" ip -4 2>/dev/null | head -1)
[ -z "$TS_IP" ] && { echo "Could not get Tailscale IP — finish the login, then re-run."; exit 1; }

# Make sure ipfs + cluster exist and are running -----------------------------
command -v ipfs >/dev/null 2>&1 || brew install ipfs
command -v ipfs-cluster-service >/dev/null 2>&1 || brew install ipfs-cluster
[ -d "$HOME/.ipfs" ] || ipfs init
pgrep -f "ipfs daemon" >/dev/null 2>&1 || { ipfs daemon >/tmp/ipfs.log 2>&1 & sleep 5; }
export CLUSTER_SECRET
[ -f "$HOME/.ipfs-cluster/service.json" ] || ipfs-cluster-service init
pgrep -f "ipfs-cluster-service daemon" >/dev/null 2>&1 || { ipfs-cluster-service daemon >/tmp/ipfs-cluster.log 2>&1 & sleep 5; }

# Build + save the bootstrap address peers will use --------------------------
PEER_ID=$(curl -s http://127.0.0.1:9094/id | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
[ -z "$PEER_ID" ] && { echo "Cluster API not responding on :9094"; exit 1; }
BOOTSTRAP="/ip4/${TS_IP}/tcp/9096/p2p/${PEER_ID}"
# write it back into the shared config
/usr/bin/sed -i '' "s#^BOOTSTRAP=.*#BOOTSTRAP=\"${BOOTSTRAP}\"#" ./cluster-config.env

say "Host ready. Tailscale IP: ${TS_IP}"
echo "Bootstrap address saved to cluster-config.env:"
echo "  ${BOOTSTRAP}"
echo
echo "Now share this whole folder with each peer and have them run:"
echo "  bash join-cluster.sh"
