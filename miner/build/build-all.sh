#!/usr/bin/env bash
# build-all.sh — Cross-platform build script for bucksminer.
#
# Produces binaries in ../dist/ for Linux (amd64, arm64), macOS (amd64, arm64),
# and Windows (amd64).
#
# Usage:
#   ./build/build-all.sh [version]
#
# Prerequisites: Go 1.22+, optionally UPX for compression.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
DIST="$ROOT/dist"
CMD="$ROOT/cmd/bucksminer"

VERSION="${1:-$(git -C "$ROOT" describe --tags --always --dirty 2>/dev/null || echo "0.1.0")}"
COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "dev")"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

LDFLAGS="-s -w \
  -X 'main.Version=$VERSION' \
  -X 'main.GitCommit=$COMMIT' \
  -X 'main.BuildDate=$BUILD_DATE'"

echo "========================================"
echo " bucksminer build — v${VERSION}"
echo " Commit: ${COMMIT}  Date: ${BUILD_DATE}"
echo "========================================"

mkdir -p "$DIST"

build_target() {
  local os=$1
  local arch=$2
  local ext="${3:-}"
  local name="bucksminer-${os}-${arch}${ext}"

  echo "→ Building $name …"
  GOOS="$os" GOARCH="$arch" CGO_ENABLED=0 \
    go build \
      -trimpath \
      -ldflags "$LDFLAGS" \
      -o "$DIST/$name" \
      "$CMD"

  # Compress with UPX if available (reduces binary size by ~70%).
  if command -v upx &>/dev/null && [ -z "$ext" ]; then
    upx --best --lzma "$DIST/$name" 2>/dev/null || true
  fi

  local size
  size=$(du -sh "$DIST/$name" | cut -f1)
  echo "   ✓ $name ($size)"
}

# Linux
build_target linux  amd64
build_target linux  arm64

# macOS
build_target darwin amd64
build_target darwin arm64

# Windows
build_target windows amd64 ".exe"

echo ""
echo "========================================"
echo " Build complete. Binaries in: $DIST/"
ls -lh "$DIST/"
echo "========================================"
