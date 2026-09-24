#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd -P)"
mode="${1:---deploy}"
[[ "$mode" == '--dry-run' || "$mode" == '--deploy' ]] || {
  echo 'usage: deploy-lightsail-web.sh [--dry-run|--deploy]' >&2
  exit 2
}

host="${MASSCOM_LIGHTSAIL_HOST:?MASSCOM_LIGHTSAIL_HOST is required}"
identity_file="${MASSCOM_LIGHTSAIL_KEY_FILE:?MASSCOM_LIGHTSAIL_KEY_FILE is required}"
runtime_env="${MASSCOM_RUNTIME_ENV_FILE:?MASSCOM_RUNTIME_ENV_FILE is required}"
capacity_evidence="${MASSCOM_WEB_CAPACITY_EVIDENCE_FILE:?MASSCOM_WEB_CAPACITY_EVIDENCE_FILE is required}"

require_private_file() {
  local path="$1" label="$2" mode_value
  [[ -f "$path" ]] || { echo "$label is missing" >&2; exit 1; }
  if mode_value="$(stat -f '%Lp' "$path" 2>/dev/null)"; then :; else
    mode_value="$(stat -c '%a' "$path")"
  fi
  [[ "$mode_value" == '400' || "$mode_value" == '600' ]] || {
    echo "$label must be private (mode 400 or 600)" >&2
    exit 1
  }
}
require_private_file "$identity_file" 'SSH identity file'
require_private_file "$runtime_env" 'runtime environment file'
require_private_file "$capacity_evidence" 'capacity evidence file'

for name in MASSCOM_API_DOMAIN POSTGRES_PASSWORD GOOGLE_OAUTH_CLIENT_IDS \
  ACCOUNT_DELETION_HMAC_SECRET MERCHANT_REFERENCE_HMAC_SECRET; do
  grep -Eq "^${name}=.+$" "$runtime_env" || {
    echo "runtime environment is missing $name" >&2
    exit 1
  }
done

node - "$capacity_evidence" <<'NODE'
const fs = require('node:fs');
try {
  const record = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const age = Date.now() - Date.parse(record.checkedAt);
  if (record.instance !== 'masscom-api-seoul' ||
      record.billingStatus !== 'WITHIN_APPROVED_CREDIT' ||
      !Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000 ||
      !Number.isFinite(record.availableMiB) || record.availableMiB < 512 ||
      !Number.isFinite(record.diskFreeGiB) || record.diskFreeGiB < 2) {
    throw new Error();
  }
} catch {
  console.error('WEB_CAPACITY_EVIDENCE_INVALID');
  process.exitCode = 1;
}
NODE

commit="$(git -C "$repo_root" rev-parse --verify HEAD)"
echo "target: ubuntu@$host"
echo "web release: $commit"
echo "mode: ${mode#--}"

if [[ "$mode" == '--dry-run' ]]; then
  echo 'remote checks: NOT_RUN'
  exit 0
fi

source_paths=(
  apps/production-web
  infra/lightsail
  scripts/build-public-site.mjs
  scripts/deploy-lightsail-web.sh
  scripts/lightsail-web-rollback.sh
  docs/index.html docs/open.html docs/privacy.html docs/account-deletion.html
  docs/presentation.html docs/.well-known/assetlinks.json docs/assets
  docs/evidence/android-collection.png docs/evidence/android-merchant-list.png
  docs/evidence/screenshots/android-account-settings.png
  docs/evidence/screenshots/android-nft-finalized.png
)
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=all -- "${source_paths[@]}")" ]]; then
  echo 'web deployment source paths must match the committed revision' >&2
  exit 1
fi

known_hosts="${MASSCOM_KNOWN_HOSTS_FILE:-$HOME/.ssh/known_hosts}"
[[ -f "$known_hosts" ]] || { echo 'verified SSH known_hosts file is required' >&2; exit 1; }
ssh_options=(
  -i "$identity_file"
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$known_hosts"
  -o ConnectTimeout=15
)
target="ubuntu@$host"

ssh "${ssh_options[@]}" "$target" bash -s <<'REMOTE_PREFLIGHT'
set -euo pipefail
test -f /opt/masscom/DEPLOYED_COMMIT
test -f /opt/masscom/runtime.env
test -f /opt/masscom/current/infra/lightsail/compose.yml
command -v docker >/dev/null
available_mib="$(free -m | awk '/^Mem:/ {print $7}')"
disk_free_kib="$(df -Pk /opt | awk 'NR==2 {print $4}')"
[[ "$available_mib" =~ ^[0-9]+$ && "$available_mib" -ge 512 ]]
[[ "$disk_free_kib" =~ ^[0-9]+$ && "$disk_free_kib" -ge 2097152 ]]
api_id="$(sudo docker ps -q --filter label=com.docker.compose.project=masscom --filter label=com.docker.compose.service=api)"
db_id="$(sudo docker ps -q --filter label=com.docker.compose.project=masscom --filter label=com.docker.compose.service=postgres)"
[[ -n "$api_id" && -n "$db_id" && "$api_id" != *$'\n'* && "$db_id" != *$'\n'* ]]
curl -fsS --max-time 8 https://api.masscom.kr/health >/dev/null
REMOTE_PREFLIGHT

release_id="${commit:0:12}"
previous_web_commit="$(ssh "${ssh_options[@]}" "$target" \
  'sudo cat /opt/masscom/web/DEPLOYED_COMMIT 2>/dev/null || true')"
if [[ "$previous_web_commit" == "$commit" ]]; then
  actual_state="$(ssh "${ssh_options[@]}" "$target" bash -s -- "$release_id" <<'REMOTE_STATE'
set -euo pipefail
web_tag="$1"
web_id="$(sudo docker ps -q --filter label=com.docker.compose.project=masscom --filter label=com.docker.compose.service=production-web)"
caddy_id="$(sudo docker ps -q --filter label=com.docker.compose.project=masscom --filter label=com.docker.compose.service=caddy)"
release="$(readlink -f /opt/masscom/web/current 2>/dev/null || true)"
if [[ -n "$web_id" && -n "$caddy_id" && -n "$release" &&
      "$(sudo docker inspect --format '{{.Config.Image}}' "$web_id")" == "masscom-production-web:$web_tag" &&
      "$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/srv/masscom"}}{{.Source}}{{end}}{{end}}' "$caddy_id")" == "$release/site/public" ]]; then
  echo MATCH
else
  echo MISMATCH
fi
REMOTE_STATE
)"
  if [[ "$actual_state" == 'MATCH' ]]; then
    echo 'web release already deployed; no containers changed'
    exit 0
  fi
  echo 'web release marker disagrees with running services; reconciling' >&2
fi

scratch="$(mktemp -d -t masscom-web-release.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/site"
node "$repo_root/scripts/build-public-site.mjs" "$scratch/site/public" >/dev/null

remote_release="/opt/masscom/web/releases/$release_id"
ssh "${ssh_options[@]}" "$target" \
  "sudo install -d -m 0755 '$remote_release' && sudo chown ubuntu:ubuntu '$remote_release'"
COPYFILE_DISABLE=1 tar -C "$repo_root" -czf - apps/production-web infra/lightsail \
  scripts/lightsail-web-rollback.sh scripts/lightsail-web-probe-guard.sh \
  -C "$scratch" site \
  | ssh "${ssh_options[@]}" "$target" "tar -xzf - -C '$remote_release'"

ssh "${ssh_options[@]}" "$target" bash -s -- "$remote_release" "$release_id" "$commit" <<'REMOTE_DEPLOY'
set -Eeuo pipefail
release="$1"
web_tag="$2"
commit="$3"
runtime_env=/opt/masscom/runtime.env
api_commit="$(sudo cat /opt/masscom/DEPLOYED_COMMIT)"
[[ "$api_commit" =~ ^[0-9a-f]{40}$ ]]
api_tag="${api_commit:0:12}"
old_release="$(readlink -f /opt/masscom/web/current 2>/dev/null || true)"
if [[ -z "$old_release" ]]; then
  old_release="$(readlink -f /opt/masscom/current)"
fi
test -f "$old_release/infra/lightsail/compose.yml"
old_web_tag="$(basename "$old_release")"

compose_new() {
  sudo env MASSCOM_IMAGE_TAG="$api_tag" MASSCOM_WEB_IMAGE_TAG="$web_tag" \
    docker compose -p masscom --env-file "$runtime_env" \
    -f "$release/infra/lightsail/compose.yml" "$@" </dev/null
}
compose_old() {
  sudo env MASSCOM_IMAGE_TAG="$api_tag" MASSCOM_WEB_IMAGE_TAG="$old_web_tag" \
    docker compose -p masscom --env-file "$runtime_env" \
    -f "$old_release/infra/lightsail/compose.yml" "$@" </dev/null
}
service_id() {
  sudo docker ps -q --filter label=com.docker.compose.project=masscom \
    --filter "label=com.docker.compose.service=$1"
}
service_snapshot() {
  local id
  id="$(service_id "$1")"
  [[ -n "$id" && "$id" != *$'\n'* ]]
  sudo docker inspect --format \
    '{{.Id}}|{{.Image}}|{{.RestartCount}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' \
    "$id"
}
api_before="$(service_snapshot api)"
db_before="$(service_snapshot postgres)"
previous_web_id="$(service_id production-web)"
if [[ -n "$previous_web_id" ]]; then
  [[ "$previous_web_id" != *$'\n'* ]]
  compose_old config --services | grep -qx 'production-web'
  current_web_image="$(sudo docker inspect --format '{{.Config.Image}}' "$previous_web_id")"
  [[ "$current_web_image" == "masscom-production-web:$old_web_tag" ]]
fi

web_change_started='false'
changing_caddy='false'
probe_id=''
source "$release/scripts/lightsail-web-rollback.sh"
source "$release/scripts/lightsail-web-probe-guard.sh"
trap 'web_rollback "$?"' ERR

probe_web_routes() {
  probe_id="$(sudo docker run --rm -d \
    --name "masscom-web-probe-$web_tag-$$" \
    --network masscom_default \
    -e MASSCOM_API_DOMAIN=:8081 -e MASSCOM_WEB_DOMAIN=:8080 \
    -p 127.0.0.1::8080 \
    -v "$release/infra/lightsail/Caddyfile:/etc/caddy/Caddyfile:ro" \
    -v "$release/site/public:/srv/masscom:ro" \
    caddy:2.10.2-alpine)"
  local address ready status
  address="$(sudo docker port "$probe_id" 8080/tcp)"
  ready='false'
  for _attempt in $(seq 1 30); do
    if curl -fsS --max-time 2 "http://$address/" >/dev/null 2>&1; then
      ready='true'
      break
    fi
    sleep 1
  done
  [[ "$ready" == 'true' ]]
  for path in / /open /privacy /account-deletion /presentation /app/ /app/assets/production.mjs; do
    curl -fsS --max-time 8 "http://$address$path" >/dev/null
  done
  curl -fsS --max-time 8 "http://$address/.well-known/assetlinks.json" \
    | cmp - "$release/site/public/.well-known/assetlinks.json"
  curl -fsSI --max-time 8 "http://$address/.well-known/assetlinks.json" \
    | grep -Eqi '^content-type: application/json'
  for path in /HANDOFF.md /TEST_STATUS.md /claim /mint /api/web/unknown; do
    status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://$address$path")"
    [[ "$status" == '404' ]]
  done
  local content_type cache_control
  IFS='|' read -r status content_type cache_control <<< "$(
    curl -sS -o /dev/null -w '%{http_code}|%{content_type}|%header{cache-control}' \
      --max-time 8 "http://$address/api/web/collection"
  )"
  web_collection_probe_accepts "$status" "$content_type" "$cache_control"
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://$address/merchants")"
  [[ "$status" == '200' ]]
  sudo docker stop "$probe_id" >/dev/null
  probe_id=''
}

sudo docker run --rm \
  -v "$release/infra/lightsail/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null
compose_new config >/dev/null
compose_new build production-web
web_change_started='true'
compose_new up -d --no-deps production-web
compose_new exec -T production-web node -e \
  "fetch('http://127.0.0.1:4173/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
probe_web_routes

changing_caddy='true'
compose_new up -d --no-deps --force-recreate caddy
[[ "$(service_snapshot api)" == "$api_before" ]]
[[ "$(service_snapshot postgres)" == "$db_before" ]]
live_caddy_id="$(service_id caddy)"
[[ -n "$live_caddy_id" ]]
[[ "$(sudo docker inspect --format '{{.State.Running}}' "$live_caddy_id")" == 'true' ]]
[[ "$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/srv/masscom"}}{{.Source}}{{end}}{{end}}' "$live_caddy_id")" == "$release/site/public" ]]
curl -fsS --max-time 8 https://api.masscom.kr/health >/dev/null

sudo install -d -m 0755 /opt/masscom/web
sudo ln -sfn "$release" /opt/masscom/web/current
printf '%s\n' "$commit" | sudo tee /opt/masscom/web/DEPLOYED_COMMIT >/dev/null
trap - ERR
echo 'Lightsail web release staged; apex DNS unchanged'
REMOTE_DEPLOY

echo "Lightsail web deployment staged: $commit"
