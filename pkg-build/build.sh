#!/bin/bash
# -------------------------------------------------------
# build.sh — Build the Bucks macOS .pkg installer
# Run from inside pkg-build/:  bash build.sh
# Or from project root:        bash pkg-build/build.sh
# -------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_PKG="$PROJECT_ROOT/Install Bucks.pkg"

cd "$SCRIPT_DIR"

echo "▶  Building component package..."
pkgbuild \
  --nopayload \
  --scripts  scripts/ \
  --identifier com.bucks.browser.installer \
  --version   1.0.0 \
  component.pkg

echo "▶  Building distribution package with wizard UI..."
productbuild \
  --distribution distribution.xml \
  --resources    resources/ \
  --package-path . \
  "$OUTPUT_PKG"

# Clean up intermediate artifact
rm -f component.pkg

SIZE=$(du -sh "$OUTPUT_PKG" | awk '{print $1}')
echo ""
echo "✅  Built: $OUTPUT_PKG"
echo "    Size:  $SIZE"
