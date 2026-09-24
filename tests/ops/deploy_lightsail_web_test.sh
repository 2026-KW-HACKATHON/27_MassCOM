#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
deploy="$repo_root/scripts/deploy-lightsail-web.sh"
guard="$repo_root/scripts/lightsail-web-probe-guard.sh"
[[ -f "$deploy" ]] || { echo 'web-only deploy script is missing' >&2; exit 1; }

source "$guard"
for accepted in 401 404 503; do
  web_collection_probe_accepts "$accepted" 'application/json; charset=utf-8' 'no-store'
done
for rejected in \
  '200|application/json; charset=utf-8|no-store' \
  '502|application/json; charset=utf-8|no-store' \
  '404|text/plain|no-store' \
  '404|application/json; charset=utf-8|public, max-age=60'; do
  IFS='|' read -r status content_type cache_control <<< "$rejected"
  if web_collection_probe_accepts "$status" "$content_type" "$cache_control"; then
    echo "unsafe web collection probe response accepted: $status" >&2
    exit 1
  fi
done

scratch="$(mktemp -d -t masscom-web-deploy-test.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT
key="$scratch/key.pem"
runtime="$scratch/runtime.env"
evidence="$scratch/capacity.json"
printf 'not-a-real-key\n' > "$key"
printf '%s=%s\n' \
  MASSCOM_API_DOMAIN api.masscom.kr \
  POSTGRES_PASSWORD test-only-value \
  GOOGLE_OAUTH_CLIENT_IDS 123-test.apps.googleusercontent.com \
  ACCOUNT_DELETION_HMAC_SECRET test-only-deletion-secret-at-least-32-bytes \
  MERCHANT_REFERENCE_HMAC_SECRET test-only-reference-secret-at-least-32-bytes \
  > "$runtime"
printf '{"instance":"masscom-api-seoul","checkedAt":"%s","billingStatus":"WITHIN_APPROVED_CREDIT","availableMiB":1024,"diskFreeGiB":40}\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$evidence"
chmod 600 "$key" "$runtime" "$evidence"

common_env=(
  MASSCOM_LIGHTSAIL_HOST=example.invalid
  MASSCOM_LIGHTSAIL_KEY_FILE="$key"
  MASSCOM_RUNTIME_ENV_FILE="$runtime"
  MASSCOM_WEB_CAPACITY_EVIDENCE_FILE="$evidence"
)

output="$(env "${common_env[@]}" bash "$deploy" --dry-run)"
[[ "$output" == *'mode: dry-run'* && "$output" == *'remote checks: NOT_RUN'* ]] || {
  echo 'dry-run did not separate local validation from remote proof' >&2
  exit 1
}

if env "${common_env[@]:0:3}" bash "$deploy" --dry-run >/dev/null 2>&1; then
  echo 'dry-run accepted missing cost/capacity evidence' >&2
  exit 1
fi
chmod 644 "$evidence"
if env "${common_env[@]}" bash "$deploy" --dry-run >/dev/null 2>&1; then
  echo 'dry-run accepted world-readable capacity evidence' >&2
  exit 1
fi
chmod 600 "$evidence"
bash -n "$deploy"
awk '/^set -Eeuo pipefail$/ {inside=1} /^REMOTE_DEPLOY$/ {inside=0} inside {print}' "$deploy" > "$scratch/remote.sh"
bash -n "$scratch/remote.sh"
grep -q 'compose_new up -d --no-deps production-web' "$scratch/remote.sh"
grep -q 'compose_new up -d --no-deps --force-recreate caddy' "$scratch/remote.sh"
grep -q 'source "$release/scripts/lightsail-web-rollback.sh"' "$scratch/remote.sh"
grep -q 'source "$release/scripts/lightsail-web-probe-guard.sh"' "$scratch/remote.sh"
grep -q 'web_change_started=' "$scratch/remote.sh"
grep -q 'service_snapshot api' "$scratch/remote.sh"
grep -q 'service_snapshot postgres' "$scratch/remote.sh"
grep -q 'probe_web_routes' "$scratch/remote.sh"
grep -q 'web_collection_probe_accepts' "$scratch/remote.sh"
grep -q 'web_rollback' "$scratch/remote.sh"
if grep -Eq 'compose_new (build|up).*\b(api|postgres|migrate)\b' "$scratch/remote.sh"; then
  echo 'web-only deploy script would modify API or database services' >&2
  exit 1
fi
bash "$repo_root/tests/ops/lightsail_web_rollback_test.sh"

echo 'Lightsail web-only deploy preflight verified'
