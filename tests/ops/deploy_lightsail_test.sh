#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
deploy="$repo_root/scripts/deploy-lightsail.sh"
[[ -f "$deploy" ]] || { echo "missing deploy script" >&2; exit 1; }
scratch="$(mktemp -d -t masscom-lightsail-deploy.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT
clean_repo="$scratch/clean-deploy-repo"
mkdir -p "$clean_repo/scripts"
cp "$deploy" "$clean_repo/scripts/deploy-lightsail.sh"
git -C "$clean_repo" init -q
git -C "$clean_repo" add .
git -C "$clean_repo" -c user.email=t@example.invalid -c user.name=Test \
  commit -q -m 'clean deploy source fixture'
deploy="$clean_repo/scripts/deploy-lightsail.sh"

key="$scratch/default.pem"
runtime="$scratch/runtime.env"
evidence="$scratch/compatibility.evidence"
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
printf 'from=%040d\nto=%s\nbackward_compatible=yes\n' 0 \
  "$(git -C "$clean_repo" rev-parse HEAD)" >"$evidence"
chmod 600 "$evidence"

if bash "$deploy" --dry-run >/dev/null 2>&1; then
  echo "deploy script accepted missing connection inputs" >&2
  exit 1
fi

out="$({
  MASSCOM_LIGHTSAIL_HOST=example.invalid \
    MASSCOM_LIGHTSAIL_KEY_FILE="$key" \
    MASSCOM_RUNTIME_ENV_FILE="$runtime" \
    MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE="$evidence" \
    bash "$deploy" --dry-run
} 2>&1)"
grep -q 'target: ubuntu@example.invalid' <<<"$out"
grep -q 'mode: dry-run' <<<"$out"
if grep -q 'DO_NOT_PRINT_THIS_VALUE' <<<"$out"; then
  echo "deploy dry-run leaked a runtime secret" >&2
  exit 1
fi
if MASSCOM_LIGHTSAIL_HOST=example.invalid \
  MASSCOM_LIGHTSAIL_KEY_FILE="$key" \
  MASSCOM_RUNTIME_ENV_FILE="$runtime" \
  bash "$deploy" --dry-run >/dev/null 2>&1; then
  echo 'deploy dry-run accepted missing compatibility evidence' >&2
  exit 1
fi
printf 'from=%040d\nto=%040d\nbackward_compatible=yes\n' 0 0 >"$evidence"
if MASSCOM_LIGHTSAIL_HOST=example.invalid \
  MASSCOM_LIGHTSAIL_KEY_FILE="$key" \
  MASSCOM_RUNTIME_ENV_FILE="$runtime" \
  MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE="$evidence" \
  bash "$deploy" --dry-run >/dev/null 2>&1; then
  echo 'deploy dry-run accepted compatibility evidence for another commit' >&2
  exit 1
fi
printf 'from=%040d\nto=%s\nbackward_compatible=yes\n' 0 \
  "$(git -C "$clean_repo" rev-parse HEAD)" >"$evidence"

dirty_repo="$scratch/dirty-deploy-repo"
mkdir -p "$dirty_repo/scripts" "$dirty_repo/apps/api/src" "$dirty_repo/infra/lightsail"
cp "$deploy" "$dirty_repo/scripts/deploy-lightsail.sh"
printf 'tracked source\n' >"$dirty_repo/apps/api/src/fixture.ts"
printf 'tracked infra\n' >"$dirty_repo/infra/lightsail/fixture.yml"
git -C "$dirty_repo" init -q
git -C "$dirty_repo" add .
git -C "$dirty_repo" -c user.email=t@example.invalid -c user.name=Test \
  commit -q -m 'deploy source fixture'
dirty_evidence="$scratch/dirty-compatibility.evidence"
printf 'from=%040d\nto=%s\nbackward_compatible=yes\n' 0 \
  "$(git -C "$dirty_repo" rev-parse HEAD)" >"$dirty_evidence"
chmod 600 "$dirty_evidence"
printf 'dirty source\n' >>"$dirty_repo/apps/api/src/fixture.ts"
status=0
out="$({
  MASSCOM_LIGHTSAIL_HOST=example.invalid \
    MASSCOM_LIGHTSAIL_KEY_FILE="$key" \
    MASSCOM_RUNTIME_ENV_FILE="$runtime" \
    MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE="$dirty_evidence" \
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
  MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE="$evidence" \
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
grep -q 'node "$repo_root/scripts/build-public-site.mjs"' "$deploy" || {
  echo 'full API release omits the approved public site bundle' >&2
  exit 1
}
grep -q 'compose_new build api production-web' "$deploy" || {
  echo 'full API release does not build its web service' >&2
  exit 1
}
grep -q 'compose_new up -d --no-deps caddy' "$deploy" || {
  echo 'full API release does not start the matched web/Caddy pair' >&2
  exit 1
}
grep -q '/opt/masscom/web/DEPLOYED_COMMIT' "$deploy" || {
  echo 'full API release does not update web deployment provenance' >&2
  exit 1
}
grep -q 'MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE' "$deploy" || {
  echo 'full deployment does not require migration compatibility evidence' >&2
  exit 1
}
grep -q 'pg_dump --format=custom' "$deploy" || {
  echo 'full deployment has no pre-migration database backup gate' >&2
  exit 1
}
grep -q "trap 'rollback" "$deploy" || {
  echo 'full deployment has no failure rollback' >&2
  exit 1
}
grep -q 'DB_MIGRATION_MANUAL_RECOVERY_REQUIRED' "$deploy" || {
  echo 'full deployment omits the migration recovery warning' >&2
  exit 1
}
awk '/REMOTE_RELEASE_PREFLIGHT/ { if (!gate) gate=NR } /sudo mkdir/ { if (!write) write=NR } END { exit !(gate && write && gate < write) }' "$deploy" || {
  echo 'release collision gate must run before remote release creation' >&2
  exit 1
}
awk '/pg_dump --format=custom/ { if (!dump) dump=NR } /POSTGRES_RECREATED_FOR_LOG_SETTINGS/ { recreate=NR } /^compose_no_stdin run --rm -T migrate/ { migrate=NR } END { exit !(dump && recreate && migrate && dump < recreate && recreate < migrate) }' "$deploy" || {
  echo 'postgres log-setting recreation must come after the pre-migration backup and before the migration' >&2
  exit 1
}
grep -q 'postgres_log_settings_ok' "$deploy" && grep -q 'compose_new up -d --no-deps --wait --wait-timeout 120 postgres' "$deploy" || {
  echo 'full deployment does not recreate only postgres when its log settings are stale' >&2
  exit 1
}
grep -q 'systemctl is-enabled masscom-retention.timer' "$deploy" && grep -q 'HOST_JOB_INSTALL_FAILED' "$deploy" || {
  echo 'full deployment does not verify the retention timer after the release is live' >&2
  exit 1
}
bash "$repo_root/tests/ops/deploy_lightsail_rollback_test.sh"
echo "Lightsail deployment script tests passed"
