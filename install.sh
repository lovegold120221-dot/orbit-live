#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ENGINE="$ROOT/engine"

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
command -v git >/dev/null || { echo "git is required." >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose v2 is required." >&2; exit 1; }

if [ ! -d "$ENGINE/.git" ]; then
  git clone --depth 1 https://github.com/jitsi/docker-jitsi-meet.git "$ENGINE"
else
  git -C "$ENGINE" pull --ff-only
fi

cp "$ROOT/docker-compose.override.yml" "$ENGINE/docker-compose.override.yml"
rm -rf "$ENGINE/orbit-web" "$ENGINE/translator" "$ENGINE/donation-gateway"
cp -R "$ROOT/orbit-web" "$ENGINE/orbit-web"
cp -R "$ROOT/translator" "$ENGINE/translator"
cp -R "$ROOT/donation-gateway" "$ENGINE/donation-gateway"

NEW_ENV=0
if [ ! -f "$ENGINE/.env" ]; then
  cp "$ENGINE/env.example" "$ENGINE/.env"
  NEW_ENV=1
fi

set_env() {
  local key="$1" value="$2" file="$ENGINE/.env" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { found=0 }
    index($0, k "=") == 1 { print k "=" v; found=1; next }
    { print }
    END { if (!found) print k "=" v }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

set_env JITSI_IMAGE_VERSION unstable
set_env ENABLE_AUDIO_TRANSLATION 1
set_env AUDIO_TRANSLATION_DUCKED_VOLUME "${AUDIO_TRANSLATION_DUCKED_VOLUME:-0.00}"
set_env ORBITAI_TRANSLATION_MODEL gemini-3.5-live-translate-preview
set_env DONATION_DEFAULT_CURRENCY usd
set_env DONATION_ALLOWED_CURRENCIES usd,php,eur
set_env DONATION_MIN_MINOR 100
set_env DONATION_MAX_MINOR 100000000

if ! grep -q '^ORBITAI_API_KEY=' "$ENGINE/.env"; then
  printf '\n# OrbitAI live translation\nORBITAI_API_KEY=replace_me\n' >> "$ENGINE/.env"
fi
if ! grep -q '^STRIPE_SECRET_KEY=' "$ENGINE/.env"; then
  printf '\n# Orbit Donation Gateway\nSTRIPE_SECRET_KEY=replace_me\nSTRIPE_WEBHOOK_SECRET=\n' >> "$ENGINE/.env"
fi

if [ "$NEW_ENV" -eq 1 ]; then
  (cd "$ENGINE" && ./gen-passwords.sh)
fi

CONFIG_DIR="$(grep '^CONFIG=' "$ENGINE/.env" | tail -1 | cut -d= -f2- || true)"
CONFIG_DIR="${CONFIG_DIR:-$HOME/.orbit-meet-cfg}"
CONFIG_DIR="${CONFIG_DIR/#\$HOME/$HOME}"
mkdir -p "$CONFIG_DIR"/{web/letsencrypt,transcripts,prosody/config,prosody/prosody-plugins-custom,jicofo,jvb,jigasi,jibri}

echo "Orbit installed into: $ENGINE"
echo "Next: edit $ENGINE/.env and set PUBLIC_URL, ORBITAI_API_KEY, and STRIPE_SECRET_KEY, then run ./start.sh"
