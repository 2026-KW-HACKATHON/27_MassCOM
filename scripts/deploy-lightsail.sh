#!/usr/bin/env bash
set -euo pipefail

require_private_file() {
  local path="$1"
  local label="$2"
  local mode_value
  if mode_value="$(stat -f '%Lp' "$path" 2>/dev/null)"; then
    :
  else
    mode_value="$(stat -c '%a' "$path")"
  fi
  [[ "$mode_value" == "400" || "$mode_value" == "600" ]] || {
    echo "$label must have mode 400 or 600" >&2
    exit 1
  }
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---deploy}"
[[ "$mode" == "--deploy" || "$mode" == "--dry-run" ]] || {
  echo "usage: $0 [--deploy|--dry-run]" >&2
  exit 2
}

host="${MASSCOM_LIGHTSAIL_HOST:?MASSCOM_LIGHTSAIL_HOST is required}"
identity_file="${MASSCOM_LIGHTSAIL_KEY_FILE:?MASSCOM_LIGHTSAIL_KEY_FILE is required}"
runtime_env="${MASSCOM_RUNTIME_ENV_FILE:?MASSCOM_RUNTIME_ENV_FILE is required}"

[[ -f "$identity_file" ]] || { echo "SSH identity file not found" >&2; exit 1; }
[[ -f "$runtime_env" ]] || { echo "runtime environment file not found" >&2; exit 1; }
require_private_file "$identity_file" "SSH identity file"
require_private_file "$runtime_env" "runtime environment file"

for name in \
  MASSCOM_API_DOMAIN \
  POSTGRES_PASSWORD \
  GOOGLE_OAUTH_CLIENT_IDS \
  ACCOUNT_DELETION_HMAC_SECRET \
  MERCHANT_REFERENCE_HMAC_SECRET; do
  grep -Eq "^${name}=.+$" "$runtime_env" || {
    echo "runtime environment is missing $name" >&2
    exit 1
  }
done

deployment_paths=(
  apps/api/package.json
  apps/api/package-lock.json
  apps/api/tsconfig.json
  apps/api/src
  apps/api/migrations
  infra/lightsail
)
deployment_status="$(git -C "$repo_root" status --porcelain --untracked-files=all -- "${deployment_paths[@]}")"
if [[ -n "$deployment_status" ]]; then
  echo 'deployment source paths must be clean so deployed bytes match the recorded commit' >&2
  printf '%s\n' "$deployment_status" >&2
  exit 1
fi

commit="$(git -C "$repo_root" rev-parse --verify HEAD)"
release_id="${commit:0:12}"
target="ubuntu@$host"
remote_release="/opt/masscom/releases/$release_id"
remote_env="/opt/masscom/runtime.env"
remote_tmp_env="/tmp/masscom-runtime-$release_id.env"
ssh_options=(
  -i "$identity_file"
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=accept-new
  -o UserKnownHostsFile="${MASSCOM_KNOWN_HOSTS_FILE:-/tmp/masscom-lightsail-known-hosts}"
  -o ConnectTimeout=15
)

echo "target: $target"
echo "release: $commit"
echo "mode: ${mode#--}"

if [[ "$mode" == "--dry-run" ]]; then
  exit 0
fi

ssh "${ssh_options[@]}" "$target" \
  "sudo install -d -m 0755 '$remote_release' && sudo chown -R ubuntu:ubuntu '$remote_release'"

COPYFILE_DISABLE=1 tar -C "$repo_root" -czf - "${deployment_paths[@]}" \
  | ssh "${ssh_options[@]}" "$target" "tar -xzf - -C '$remote_release'"

scp "${ssh_options[@]}" -q "$runtime_env" "$target:$remote_tmp_env"

ssh "${ssh_options[@]}" "$target" bash -s -- \
  "$remote_release" "$remote_env" "$remote_tmp_env" "$release_id" "$commit" <<'REMOTE'
set -euo pipefail

release="$1"
runtime_env="$2"
temporary_env="$3"
release_id="$4"
commit="$5"
compose_file="$release/infra/lightsail/compose.yml"

if ! command -v docker >/dev/null 2>&1 || ! sudo docker compose version >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2
fi
sudo systemctl enable --now docker

sudo install -o root -g root -m 600 "$temporary_env" "$runtime_env"
rm -f "$temporary_env"

compose() {
  sudo env MASSCOM_IMAGE_TAG="$release_id" \
    docker compose --env-file "$runtime_env" -f "$compose_file" "$@"
}
compose_no_stdin() {
  compose "$@" </dev/null
}

compose build api
compose up -d postgres
compose_no_stdin run --rm -T migrate
compose up -d api caddy
compose_no_stdin exec -T api node -e \
  "fetch('http://127.0.0.1:3000/health').then(async r=>{if(!r.ok)throw new Error('HTTP '+r.status);const b=await r.json();if(b.status!=='ok')throw new Error('unexpected health payload')}).catch(e=>{console.error(e.message);process.exit(1)})"

sudo ln -sfn "$release" /opt/masscom/current
printf '%s\n' "$commit" | sudo tee /opt/masscom/DEPLOYED_COMMIT >/dev/null
compose ps
REMOTE

echo "Lightsail deployment completed: $commit"
