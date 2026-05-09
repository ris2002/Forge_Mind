#!/usr/bin/env bash
# Build ForgeMind as a self-contained desktop app (Tauri v2 + PyInstaller sidecar).
#
# Prerequisites:
#   - Python 3.11+ with project deps installed  (pip install -r backend/requirements.txt)
#   - PyInstaller: pip install pyinstaller
#   - Rust + Cargo (https://rustup.rs)
#   - Node.js 18+ with npm
#   - Tauri CLI: cargo install tauri-cli --version "^2"
#
# Usage:
#   bash scripts/build-desktop.sh
#
# Output:
#   src-tauri/target/release/bundle/<platform>/ForgeMind.*

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
TAURI_DIR="$ROOT/src-tauri"
BINARIES="$TAURI_DIR/binaries"

echo "==> [1/4] Building Python backend with PyInstaller..."
cd "$BACKEND"
pyinstaller forgemind.spec --distpath "$BACKEND/dist" --workpath "$BACKEND/build" --clean

# Determine Rust target triple for sidecar naming convention
TRIPLE=$(rustc -vV | grep host | awk '{print $2}')
echo "    Rust target triple: $TRIPLE"

# Copy binary into src-tauri/binaries with the required triple suffix
mkdir -p "$BINARIES"
cp "$BACKEND/dist/forgemind-backend" "$BINARIES/forgemind-backend-${TRIPLE}"
echo "    Sidecar binary placed at: binaries/forgemind-backend-${TRIPLE}"

echo "==> [2/4] Installing frontend dependencies..."
cd "$FRONTEND"
npm install

echo "==> [3/4] Building frontend..."
npm run build

echo "==> [4/4] Building Tauri desktop bundle..."
cd "$ROOT"
cargo tauri build

echo ""
echo "Done! Find your app bundle in:"
echo "  $TAURI_DIR/target/release/bundle/"
