#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STANDALONE_DIR="$ROOT_DIR/.next/standalone"
STATIC_SRC="$ROOT_DIR/.next/static"
STATIC_DEST="$STANDALONE_DIR/.next/static"
PUBLIC_DIR="$ROOT_DIR/public"
PUBLIC_DEST="$STANDALONE_DIR/public"

log() {
  echo "[portal-build] $*"
}

log "Starting standalone build in $ROOT_DIR"
cd "$ROOT_DIR"

if [[ -f package-lock.json ]]; then
  log "Detected package-lock.json, running npm ci"
  npm ci
else
  log "No package-lock.json found, running npm install"
  npm install
fi

log "Running npm run build"
npm run build

log "Preparing standalone assets"
mkdir -p "$STANDALONE_DIR/.next"
rm -rf "$STATIC_DEST"
cp -r "$STATIC_SRC" "$STANDALONE_DIR/.next/"

if [[ -d "$PUBLIC_DIR" ]]; then
  log "Copying public/ into standalone bundle"
  rm -rf "$PUBLIC_DEST"
  cp -r "$PUBLIC_DIR" "$STANDALONE_DIR/"
else
  log "No public/ directory found, skipping public asset copy"
fi

log "Standalone build completed successfully"
