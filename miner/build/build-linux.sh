#!/usr/bin/env bash
# build-linux.sh — Build bucksminer for Linux (x86-64 and ARM64).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
DIST="$ROOT/dist"
CMD="$ROOT/cmd/bucksminer"
VERSION="${1:-0.1.0}"
LDFLAGS="-s -w -X 'main.Version=${VERSION}'"

mkdir -p "$DIST"

echo "Building Linux amd64…"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" \
  -o "$DIST/bucksminer-linux-amd64" "$CMD"

echo "Building Linux arm64…"
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" \
  -o "$DIST/bucksminer-linux-arm64" "$CMD"

# Compress with UPX if available.
if command -v upx &>/dev/null; then
  for f in "$DIST/bucksminer-linux-amd64" "$DIST/bucksminer-linux-arm64"; do
    upx --best --lzma "$f" && echo "Compressed: $f"
  done
fi

echo "Linux build complete."
ls -lh "$DIST"/bucksminer-linux-*
