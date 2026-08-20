#!/usr/bin/env bash
# Metro for a physical phone from a cloud container (spec §10).
#
# Why a cloudflared quick tunnel and not the obvious options:
#   * `expo start --tunnel` uses ngrok, which refuses to run when an Expo access
#     token is set ("Cannot use ngrok with a robot user").
#   * Codespaces / devcontainer port forwarding answers the phone with 404,
#     because the forwarded origin is not the origin Metro advertises.
# A quick tunnel needs no account and gives Metro a public origin to advertise
# via EXPO_PACKAGER_PROXY_URL, which is the piece everything else gets wrong.
set -euo pipefail

PORT="${PORT:-8081}"
LOG="$(mktemp -t cloudflared-XXXX.log)"

cleanup() {
  echo "› stopping"
  pkill -f "cloudflared tunnel --url" 2>/dev/null || true
  pkill -f "expo start" 2>/dev/null || true
}
trap cleanup EXIT

echo "› killing stragglers on :$PORT"
pkill -f "expo start" 2>/dev/null || true
pkill -f "cloudflared tunnel --url" 2>/dev/null || true
if command -v fuser >/dev/null 2>&1; then fuser -k "${PORT}/tcp" 2>/dev/null || true; fi
sleep 1

if ! command -v cloudflared >/dev/null 2>&1; then
  cat >&2 <<'MSG'
cloudflared is not installed. Install it, then re-run:

  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

Do NOT substitute `expo start --tunnel`: ngrok refuses when EXPO_TOKEN is set.
MSG
  exit 1
fi

echo "› opening cloudflared quick tunnel to :$PORT"
cloudflared tunnel --url "http://localhost:${PORT}" --no-autoupdate > "$LOG" 2>&1 &

URL=""
for _ in $(seq 1 40); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done

if [ -z "$URL" ]; then
  echo "cloudflared never printed a tunnel URL. Its log:" >&2
  cat "$LOG" >&2
  exit 1
fi

echo "› tunnel: $URL"
echo "› open this in the dev client on the phone:  ${URL/https:\/\//exp+quranhabit:\/\/expo-development-client\/?url=https://}"

export EXPO_PACKAGER_PROXY_URL="$URL"
export REACT_NATIVE_PACKAGER_HOSTNAME="${URL#https://}"
exec npx expo start --dev-client --port "$PORT"
