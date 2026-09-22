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
printf '%s=%s\n' \
  MASSCOM_API_DOMAIN api.masscom.kr \
  POSTGRES_PASSWORD DO_NOT_PRINT_THIS_VALUE \
  GOOGLE_OAUTH_CLIENT_IDS 123-test.apps.googleusercontent.com \
  ACCOUNT_DELETION_HMAC_SECRET aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  MERCHANT_REFERENCE_HMAC_SECRET bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
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

dirty_repo="$scratch/dirty-deploy-repo"
mkdir -p "$dirty_repo/scripts" "$dirty_repo/apps/api/src" "$dirty_repo/infra/lightsail"
cp "$deploy" "$dirty_repo/scripts/deploy-lightsail.sh"
printf 'tracked source\n' >"$dirty_repo/apps/api/src/fixture.ts"
printf 'tracked infra\n' >"$dirty_repo/infra/lightsail/fixture.yml"
git -C "$dirty_repo" init -q
git -C "$dirty_repo" add .
git -C "$dirty_repo" -c user.email=t@example.invalid -c user.name=Test \
  commit -q -m 'deploy source fixture'
printf 'dirty source\n' >>"$dirty_repo/apps/api/src/fixture.ts"
status=0
out="$({
  MASSCOM_LIGHTSAIL_HOST=example.invalid \
    MASSCOM_LIGHTSAIL_KEY_FILE="$key" \
    MASSCOM_RUNTIME_ENV_FILE="$runtime" \
    bash "$dirty_repo/scripts/deploy-lightsail.sh" --dry-run
} 2>&1)" || status=$?
[[ "$status" == 1 ]] || {
  echo "deploy script accepted source bytes that differ from the recorded commit" >&2
  exit 1
}
grep -qF 'deployment source paths must be clean' <<<"$out" || {
  echo "dirty deployment source failed for an unrelated reason: $out" >&2
  exit 1
}

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
grep -q '^compose_no_stdin()' "$deploy" || {
  echo "deploy script has no shared stdin-closing Compose wrapper" >&2
  exit 1
}
grep -q 'compose_no_stdin run --rm -T migrate' "$deploy" || {
  echo "migration container can consume the remaining remote deploy script from stdin" >&2
  exit 1
}
grep -q 'compose_no_stdin exec -T api node -e' "$deploy" || {
  echo "health check container can consume the remaining remote deploy script from stdin" >&2
  exit 1
}
echo "Lightsail deployment script tests passed"
