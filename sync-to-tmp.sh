#!/bin/bash
# Copy durable Grok Bot D js/sh scripts into the ephemeral runtime dir.
set -eu
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${GROKBOT_HACK:-/tmp/grokbot-hack}"
mkdir -p "$DEST"

copied=0
for f in "$SRC"/*.js "$SRC"/*.sh; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  cp -p "$f" "$DEST/$base"
  echo "synced $base"
  copied=$((copied + 1))
done

echo "synced $copied file(s) -> $DEST"
