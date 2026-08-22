#!/bin/bash
# Pinned build-time ASAR CLI. First-run extraction uses asar-file.js and never npm.
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "asar-cli: Node.js is required" >&2
  exit 1
fi
if ! command -v npx >/dev/null 2>&1; then
  echo "asar-cli: npx is required" >&2
  exit 1
fi

if node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22 || (a===22 && b>=12) ? 0 : 1)'; then
  ASAR_PACKAGE="@electron/asar@4.3.0"
else
  ASAR_PACKAGE="@electron/asar@3.4.1"
fi

exec npx --yes --package "$ASAR_PACKAGE" asar "$@"
