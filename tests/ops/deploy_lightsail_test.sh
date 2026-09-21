#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
deploy="$repo_root/scripts/deploy-lightsail.sh"
[[ -f "$deploy" ]] || { echo "missing deploy script" >&2; exit 1; }
scratch="$(mktemp -d -t masscom-lightsail-deploy.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT

key="$scratch/default.pem"
runtime="$scratch/runtime.env"
printf 'not-a-real-key\n' >"$key"
printf '%s\n' \
  'MASSCOM_API_DOMAIN=api.masscom.kr' \
  'POSTGRES_PASSWORD=DO_NOT_PRINT_THIS_VALUE' \
  'GOOGLE_OAUTH_CLIENT_IDS=123-test.apps.googleusercontent.com' \
  'ACCOUNT_DELETION_HMAC_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  'MERCHANT_REFERENCE_HMAC_SECRET=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' \
  >"$runtime"
chmod 400 "$key"
chmod 600 "$runtime"

if bash "$deploy" --dry-run >/dev/null 2>&1; then
  echo "deploy script accepted missing connection inputs" >&2
  exit 1
fi

out="$({
  MASSCOM_LIGHTSAIL_HOST=example.invalid \
    MASSCOM_LIGHTSAIL_KEY_FILE="$key" \
    MASSCOM_RUNTIME_ENV_FILE="$runtime" \
    bash "$deploy" --dry-run
} 2>&1)"
grep -q 'target: ubuntu@example.invalid' <<<"$out"
grep -q 'mode: dry-run' <<<"$out"
if grep -q 'DO_NOT_PRINT_THIS_VALUE' <<<"$out"; then
  echo "deploy dry-run leaked a runtime secret" >&2
  exit 1
fi

chmod 644 "$runtime"
if MASSCOM_LIGHTSAIL_HOST=example.invalid \
  MASSCOM_LIGHTSAIL_KEY_FILE="$key" \
  MASSCOM_RUNTIME_ENV_FILE="$runtime" \
  bash "$deploy" --dry-run >/dev/null 2>&1; then
  echo "deploy script accepted a group/world-readable runtime file" >&2
  exit 1
fi

bash -n "$deploy"
grep -q '^COPYFILE_DISABLE=1 tar ' "$deploy" || {
  echo "deploy archive does not disable macOS AppleDouble metadata" >&2
  exit 1
}
echo "Lightsail deployment script tests passed"
