#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
[ -d "$ROOT/engine" ] || "$ROOT/install.sh"
cd "$ROOT/engine"
if grep -q '^ORBITAI_API_KEY=replace_me$' .env || ! grep -q '^ORBITAI_API_KEY=' .env; then
  echo "Set ORBITAI_API_KEY in $PWD/.env first." >&2
  exit 1
fi
if grep -q '^STRIPE_SECRET_KEY=replace_me$' .env || ! grep -q '^STRIPE_SECRET_KEY=' .env; then
  echo "Set STRIPE_SECRET_KEY in $PWD/.env first." >&2
  exit 1
fi
docker compose up -d --build
printf '\nOrbit services:\n'
docker compose ps
