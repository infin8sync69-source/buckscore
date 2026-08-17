#!/usr/bin/env bash
# build-mac.sh — Build bucksminer for macOS (Intel + Apple Silicon).
# Produces a universal binary via lipo if both toolchains are available.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
DIST="$ROOT/dist"
CMD="$ROOT/cmd/bucksminer"
VERSION="${1:-0.1.0}"
LDFLAGS="-s -w -X 'main.Version=${VERSION}'"

mkdir -p "$DIST"

echo "Building macOS amd64…"
GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" \
  -o "$DIST/bucksminer-darwin-amd64" "$CMD"

echo "Building macOS arm64 (Apple Silicon)…"
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags "$LDFLAGS" \
  -o "$DIST/bucksminer-darwin-arm64" "$CMD"

# Create a universal binary if lipo is available.
if command -v lipo &>/dev/null; then
  echo "Creating universal binary via lipo…"
  lipo -create -output "$DIST/bucksminer-darwin-universal" \
    "$DIST/bucksminer-darwin-amd64" \
    "$DIST/bucksminer-darwin-arm64"
  echo "✓ bucksminer-darwin-universal"
fi

echo "macOS build complete."
ls -lh "$DIST"/bucksminer-darwin-*
