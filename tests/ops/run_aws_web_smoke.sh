#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
scratch="$(mktemp -d -t masscom-aws-web-smoke.XXXXXX)"
project="masscom-aws-web-smoke-$$"
compose="$repo_root/infra/lightsail/web-smoke.compose.yml"
export MASSCOM_PUBLIC_SITE="$scratch/public"

cleanup() {
  docker compose -p "$project" -f "$compose" down --volumes >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT

node "$repo_root/scripts/build-public-site.mjs" "$MASSCOM_PUBLIC_SITE"
docker compose -p "$project" -f "$compose" up -d --build

ready='false'
for _attempt in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:8089/ >/dev/null 2>&1; then
    ready='true'
    break
  fi
  sleep 1
done
[[ "$ready" == 'true' ]] || { echo 'web smoke Caddy did not become ready' >&2; exit 1; }

for path in / /open /privacy /account-deletion /presentation /app/ /app/assets/production.mjs /app/assets/mascot-stamp.png /admin/ /admin/assets/mascot-stamp.png /merchant/ /merchant/assets/merchant.mjs /merchant/assets/mascot-stamp.png /preview/ /preview/assets/showcase.css; do
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:8089$path")"
  [[ "$status" == '200' ]] || { echo "$path returned $status" >&2; exit 1; }
done
app_redirect="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 8 http://127.0.0.1:8089/app)"
[[ "$app_redirect" == '308 http://127.0.0.1:8089/app/' ]] || {
  echo "/app redirect mismatch: $app_redirect" >&2
  exit 1
}
preview_redirect="$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 8 http://127.0.0.1:8089/preview)"
[[ "$preview_redirect" == '308 http://127.0.0.1:8089/preview/' ]] || {
  echo "/preview redirect mismatch: $preview_redirect" >&2
  exit 1
}
curl -fsS --max-time 8 http://127.0.0.1:8089/preview/ | cmp - "$MASSCOM_PUBLIC_SITE/preview/index.html"
curl -fsS --max-time 8 http://127.0.0.1:8089/preview/assets/showcase.css \
  | cmp - "$MASSCOM_PUBLIC_SITE/preview/assets/showcase.css"

curl -fsS --max-time 8 http://127.0.0.1:8089/.well-known/assetlinks.json \
  | cmp - "$MASSCOM_PUBLIC_SITE/.well-known/assetlinks.json"
curl -fsSI --max-time 8 http://127.0.0.1:8089/.well-known/assetlinks.json \
  | grep -Eqi '^content-type: application/json'

for path in /HANDOFF.md /TEST_STATUS.md /evidence/showcase-host-local-2026-09-24.json /preview/.vercel/project.json /preview/.env.local /claim /mint /merchants/1 /api/web/unknown /api/claim /api/mint; do
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:8089$path")"
  [[ "$status" == '404' ]] || { echo "$path unexpectedly returned $status" >&2; exit 1; }
done

# The explicit browser-session routes reach the absent API in this web-only smoke.
for path in /api/web/auth/start /api/web/auth/callback /api/web/logout /api/web/collection /api/web/badges; do
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:8089$path")"
  [[ "$status" == '502' ]] || { echo "$path unexpectedly returned $status" >&2; exit 1; }
done

merchant_status="$(curl -s -o "$scratch/merchants.json" -w '%{http_code}' --max-time 8 http://127.0.0.1:8089/merchants)"
[[ "$merchant_status" == '200' || "$merchant_status" == '502' ]] || {
  echo "GET /merchants unexpectedly returned $merchant_status" >&2
  exit 1
}
if [[ "$merchant_status" == '200' ]]; then
  node -e "const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(!Array.isArray(p.merchants)||p.merchants.some(m=>m.demo!==false||Object.keys(m).sort().join(',')!=='businessHours,demo,menuItems,name,roadAddress,story'))process.exit(1)" "$scratch/merchants.json"
fi

status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST http://127.0.0.1:8089/merchants)"
[[ "$status" == '405' ]] || { echo "POST /merchants unexpectedly returned $status" >&2; exit 1; }

containers="$(docker compose -p "$project" -f "$compose" ps --services --status running | sort)"
[[ "$containers" == $'caddy\nproduction-web' ]] || {
  echo 'web smoke unexpectedly started API or DB' >&2
  exit 1
}

echo 'AWS web local Caddy routes verified without API/DB containers'
