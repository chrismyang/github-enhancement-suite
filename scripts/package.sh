#!/usr/bin/env bash
# Build a clean, store-ready zip of the extension.
# Includes ONLY what the manifest references at runtime: manifest.json, src/, and the icon PNGs.
# Excludes tests/, docs/, store-assets/, the icon SVG source, and dev cruft.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/ghes-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

zip -rq "$OUT" \
  manifest.json \
  src \
  icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png \
  -x '*.DS_Store'

echo "Built $OUT"
echo "Contents:"
unzip -l "$OUT"
