#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
node --check "$ROOT/orbit-web/orbit-live-translation.js"
node --check "$ROOT/orbit-web/orbit-translator-client.js"
node --check "$ROOT/orbit-web/orbit-pcm-worklet.js"
node --check "$ROOT/translator/src/server.mjs"
node --check "$ROOT/translator/src/audio.mjs"
node --check "$ROOT/translator/src/languages.mjs"
node --check "$ROOT/translator/src/listener-session.mjs"
node --check "$ROOT/translator/healthcheck.mjs"
node --check "$ROOT/donation-gateway/src/server.mjs"
node "$ROOT/tests/static-check.mjs"
node "$ROOT/tests/audio-check.mjs"
node --test "$ROOT/tests/translation.test.mjs"
if [ -d "$ROOT/tests/node_modules/jsdom" ]; then
  node --test "$ROOT/tests/ui.test.mjs"
else
  echo "DOM tests require: npm ci --prefix tests"
fi
echo "All local Orbit static checks passed."
if command -v docker >/dev/null 2>&1 && [ -d "$ROOT/engine" ]; then
  (cd "$ROOT/engine" && docker compose config >/dev/null)
  echo "Docker Compose config check passed."
else
  echo "Docker runtime check skipped (Docker/engine source not present in this environment)."
fi
