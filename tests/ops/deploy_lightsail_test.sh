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

# Issue #401: 하위 비호환 릴리스도 허용하되 자동 복귀 정책을 원격에 전달한다.
sed 's/backward_compatible=yes/backward_compatible=no/' "$evidence" >"$scratch/no.evidence"
chmod 600 "$scratch/no.evidence"
MASSCOM_LIGHTSAIL_HOST=example.invalid \
  MASSCOM_LIGHTSAIL_KEY_FILE="$key" \
  MASSCOM_RUNTIME_ENV_FILE="$runtime" \
  MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE="$scratch/no.evidence" \
  bash "$deploy" --dry-run >/dev/null
sed 's/backward_compatible=yes/backward_compatible=unknown/' "$evidence" >"$scratch/unknown.evidence"
chmod 600 "$scratch/unknown.evidence"
if MASSCOM_LIGHTSAIL_HOST=example.invalid \
  MASSCOM_LIGHTSAIL_KEY_FILE="$key" \
  MASSCOM_RUNTIME_ENV_FILE="$runtime" \
  MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE="$scratch/unknown.evidence" \
  bash "$deploy" --dry-run >/dev/null 2>&1; then
  echo '알 수 없는 migration 호환성 허용' >&2; exit 1
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
chmod 600 "$runtime"

# Issue #279: a missing verified known_hosts file must fail --deploy before any ssh/scp call
# (no falling back to accept-new and trusting whatever host key answers).
fake_bin="$scratch/fake-bin"
mkdir -p "$fake_bin"
remote_marker="$scratch/remote-was-called"
for stub in ssh scp; do
  cat >"$fake_bin/$stub" <<STUB
#!/usr/bin/env bash
echo "unexpected $stub invocation: \$*" >&2
touch "$remote_marker"
exit 90
STUB
  chmod +x "$fake_bin/$stub"
done
empty_home="$scratch/empty-home"
mkdir -p "$empty_home/.ssh"
status=0
out="$(HOME="$empty_home" PATH="$fake_bin:$PATH" \
  MASSCOM_KNOWN_HOSTS_FILE="$empty_home/.ssh/known_hosts" \
  MASSCOM_LIGHTSAIL_HOST=example.invalid \
  MASSCOM_LIGHTSAIL_KEY_FILE="$key" \
  MASSCOM_RUNTIME_ENV_FILE="$runtime" \
  MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE="$evidence" \
  bash "$deploy" --deploy 2>&1)" || status=$?
[[ "$status" == 1 ]] || {
  echo "deploy without a verified known_hosts file did not fail cleanly: $out" >&2
  exit 1
}
grep -qF 'verified SSH known_hosts file is required' <<<"$out" || {
  echo "missing known_hosts failure was not reported: $out" >&2
  exit 1
}
[[ ! -e "$remote_marker" ]] || {
  echo "deploy contacted the remote host before verifying known_hosts" >&2
  exit 1
}
grep -q 'StrictHostKeyChecking=yes' "$deploy" || {
  echo "full deploy no longer pins strict SSH host key checking" >&2
  exit 1
}
if grep -rq 'accept-new' "$deploy" "$repo_root/scripts"; then
  echo "a deploy script still trusts unknown SSH host keys via accept-new" >&2
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
grep -q 'postgres_data_volume' "$deploy" && grep -q 'postgres_data_fingerprint' "$deploy" &&
  grep -q 'postgres_setting log_error_verbosity' "$deploy" && grep -q 'postgres_setting log_min_error_statement' "$deploy" &&
  grep -q 'psql -U masscom -d masscom -Atc "SHOW \$1"' "$deploy" || {
  echo 'a recreated postgres is not checked for the same data volume, the same data and its log options' >&2
  exit 1
}
# 값을 읽는 도우미는 `$(trap - ERR; 도우미 …)`로만 부른다. 트랩을 끄지 않은 `$(도우미)`는 옛 bash(3.2)에서 실패한 명령 치환 안에서 되돌림을 한 번 더
# 돌린다(bash 5는 그렇지 않아 CI만으로는 걸리지 않으므로 여기서 모양으로도 막는다). 실패 이름은 POSTGRES_DATA_CHECK_FAILED로 남긴다.
if grep -Eq '\$\(postgres_(data_volume|data_fingerprint|setting)' "$deploy"; then
  echo 'a postgres helper is read through $(…) without switching the ERR trap off first (double rollback on old bash)' >&2
  exit 1
fi
[[ "$(grep -c 'trap - ERR; postgres_' "$deploy")" -ge 6 ]] || {
  echo 'the postgres data/setting reads must all switch the ERR trap off inside their substitution' >&2
  exit 1
}
for label in baseline log_settings volume fingerprint min_error_statement verbosity; do
  grep -q "postgres_check_failed $label" "$deploy" || { echo "postgres check '$label' does not name itself when it fails" >&2; exit 1; }
done
grep -q 'systemctl start masscom-retention.service' "$deploy" && grep -q 'systemctl show -p Result --value masscom-retention.service' "$deploy" || {
  echo 'full deployment does not run the installed retention job once and check its result' >&2
  exit 1
}
grep -q 'systemctl is-enabled masscom-retention.timer' "$deploy" && grep -q 'HOST_JOB_INSTALL_FAILED' "$deploy" || {
  echo 'full deployment does not verify the retention timer after the release is live' >&2
  exit 1
}
bash "$repo_root/tests/ops/deploy_lightsail_rollback_test.sh"
echo "Lightsail deployment script tests passed"
