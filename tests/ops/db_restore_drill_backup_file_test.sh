#!/usr/bin/env bash
# Backup-file handling of scripts/db-restore-drill.sh (Issue #263, audit item C07). No database needed:
# fake pg_dump / psql / pg_restore on PATH stand in for PostgreSQL, so this runs anywhere (CI included).
# A kept dump must be mode 0600 even under umask 022, and a failed pg_dump must leave an earlier file at
# that path untouched (a plain `>` would truncate it and create a new file as 0644).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
drill="$repo_root/scripts/db-restore-drill.sh"
scratch="$(mktemp -d -t masscom-drill-file.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT
fakebin="$scratch/bin"
work="$scratch/work"
mkdir -p "$fakebin" "$work"

cat >"$fakebin/pg_dump" <<'FAKE'
#!/usr/bin/env bash
if [[ -n "${FAKE_PG_URL_LOG:-}" ]]; then printf 'pg_dump:%s\n' "${@: -1}" >>"$FAKE_PG_URL_LOG"; fi
if [[ "${FAKE_PG_DUMP_FAIL:-}" == 1 ]]; then
  printf 'PARTIAL'
  echo 'pg_dump: error: connection to server failed' >&2
  exit 1
fi
printf 'NEWDUMP'
FAKE
# 조회 명령에만 실패·빈 결과·불일치를 주입한다. 생성·삭제·버전 조회는 정상 동작한다.
cat >"$fakebin/psql" <<'FAKE'
#!/usr/bin/env bash
if [[ -n "${FAKE_PG_URL_LOG:-}" ]]; then printf '%s\n' "$1" >>"$FAKE_PG_URL_LOG"; fi
if [[ "$*" == *'SELECT filename FROM schema_migrations ORDER BY filename'* ]]; then
  side=source
  if [[ "${1%%\?*}" == *_restore_test ]]; then side=scratch; fi
  if [[ -n "${FAKE_PG_SNAPSHOT_LOG:-}" ]]; then echo "$side" >>"$FAKE_PG_SNAPSHOT_LOG"; fi
  if [[ "${FAKE_PG_SNAPSHOT_SIDE:-}" == "$side" || "${FAKE_PG_SNAPSHOT_SIDE:-}" == both ]]; then
    case "${FAKE_PG_SNAPSHOT_MODE:-}" in
      fail) echo fake; echo 'psql: snapshot query failed' >&2; exit 9 ;;
      empty) exit 0 ;;
      whitespace) printf ' \t\n'; exit 0 ;;
      mismatch) echo different; exit 0 ;;
    esac
  fi
fi
# --restore-only queries (Issue #412): migration count of the restored database and the table list of both databases.
if [[ "$*" == *'SELECT count(*) FROM schema_migrations'* ]]; then echo "${FAKE_RO_MIGRATIONS-3}"; exit 0; fi
if [[ "$*" == *'SELECT table_name FROM information_schema.tables'* ]]; then
  side=source
  if [[ "${1%%\?*}" == *_restore_test ]]; then side=scratch; fi
  if [[ "${FAKE_RO_TABLES_SIDE:-}" == "$side" || "${FAKE_RO_TABLES_SIDE:-}" == both ]]; then
    case "${FAKE_RO_TABLES_MODE:-}" in
      fail) echo accounts; echo 'psql: table list query failed' >&2; exit 9 ;;
      empty) exit 0 ;;
      extra) printf 'accounts\nextra_table\nschema_migrations\n'; exit 0 ;;
    esac
  fi
  printf 'accounts\nschema_migrations\n'; exit 0
fi
echo fake
FAKE
cat >"$fakebin/pg_restore" <<'FAKE'
#!/usr/bin/env bash
if [[ -n "${FAKE_PG_URL_LOG:-}" ]]; then
  next_db=""
  for arg in "$@"; do
    if [[ "$next_db" == 1 ]]; then printf 'pg_restore:%s\n' "$arg" >>"$FAKE_PG_URL_LOG"; next_db=""; fi
    if [[ "$arg" == --dbname ]]; then next_db=1; fi
  done
fi
cat >/dev/null
if [[ "${FAKE_PG_RESTORE_FAIL:-}" == 1 ]]; then echo 'pg_restore: error: could not execute query' >&2; exit 1; fi
FAKE
chmod +x "$fakebin/pg_dump" "$fakebin/psql" "$fakebin/pg_restore"

# Mode in octal, GNU (Linux CI) and BSD (macOS) stat.
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }

run_drill() {
  # umask 022 is what the caller's shell usually has; the script must not depend on it.
  ( umask 022
    cd "$work"
    PATH="$fakebin:$PATH" DRILL_DATABASE_URL="${DRILL_DATABASE_URL:-postgresql://drill@127.0.0.1:1/masscom_test}" bash "$drill" "$@" )
}
leftovers() { find "$work" -name '*.part.*' | wc -l | tr -d ' '; }

# 1. New file: mode 0600, contents from the dump, no temporary file left behind.
status=0
out="$(run_drill "$work/new.dump" 2>&1)" || status=$?
[[ "$status" == 0 ]] || { echo "successful drill failed ($status): $out" >&2; exit 1; }
grep -q 'restore drill passed' <<<"$out"
[[ "$(<"$work/new.dump")" == NEWDUMP ]] || { echo 'new dump has wrong contents' >&2; exit 1; }
[[ "$(mode_of "$work/new.dump")" == 600 ]] || { echo "new dump mode is $(mode_of "$work/new.dump"), expected 600" >&2; exit 1; }
[[ "$(leftovers)" == 0 ]] || { echo 'temporary dump file left behind after success' >&2; exit 1; }

# 2. A bare file name (directory ".") works the same way.
status=0
out="$(run_drill bare.dump 2>&1)" || status=$?
[[ "$status" == 0 ]] || { echo "bare-name drill failed ($status): $out" >&2; exit 1; }
[[ "$(mode_of "$work/bare.dump")" == 600 ]] || { echo 'bare-name dump is not 0600' >&2; exit 1; }
[[ "$(leftovers)" == 0 ]] || { echo 'temporary dump file left behind (bare name)' >&2; exit 1; }

# 3. pg_dump fails and an earlier backup exists: it is kept byte for byte (contents and mode) and nothing is left over.
printf 'PREVIOUS' >"$work/keep.dump"
chmod 644 "$work/keep.dump"
status=0
out="$(FAKE_PG_DUMP_FAIL=1 run_drill "$work/keep.dump" 2>&1)" || status=$?
[[ "$status" != 0 ]] || { echo "drill passed although pg_dump failed: $out" >&2; exit 1; }
grep -q 'connection to server failed' <<<"$out" || { echo "failure was not caused by the fake pg_dump: $out" >&2; exit 1; }
[[ "$(<"$work/keep.dump")" == PREVIOUS ]] || { echo 'failed dump replaced or truncated the existing backup' >&2; exit 1; }
[[ "$(mode_of "$work/keep.dump")" == 644 ]] || { echo 'failed dump changed the existing backup mode' >&2; exit 1; }
[[ "$(leftovers)" == 0 ]] || { echo 'partial dump left behind after failure' >&2; exit 1; }

# 4. pg_dump fails and there is no earlier file: no file appears at the target path.
status=0
out="$(FAKE_PG_DUMP_FAIL=1 run_drill "$work/missing.dump" 2>&1)" || status=$?
[[ "$status" != 0 ]] || { echo "drill passed although pg_dump failed (no earlier file): $out" >&2; exit 1; }
[[ ! -e "$work/missing.dump" ]] || { echo 'failed dump created the target path' >&2; exit 1; }
[[ "$(leftovers)" == 0 ]] || { echo 'partial dump left behind (no earlier file)' >&2; exit 1; }

# 5. A later successful drill replaces the earlier backup and the result is 0600.
status=0
out="$(run_drill "$work/keep.dump" 2>&1)" || status=$?
[[ "$status" == 0 ]] || { echo "replacing drill failed ($status): $out" >&2; exit 1; }
[[ "$(<"$work/keep.dump")" == NEWDUMP ]] || { echo 'successful drill did not replace the existing backup' >&2; exit 1; }
[[ "$(mode_of "$work/keep.dump")" == 600 ]] || { echo 'replaced backup is not 0600' >&2; exit 1; }

# 6. A directory as the path is refused before anything is written: nothing is moved into it and nothing is left next to it.
mkdir "$work/adir"
status=0
out="$(run_drill "$work/adir" 2>&1)" || status=$?
[[ "$status" != 0 ]] || { echo "drill accepted a directory as the backup path: $out" >&2; exit 1; }
grep -q 'backup path is a directory' <<<"$out" || { echo "directory refusal was not reported: $out" >&2; exit 1; }
[[ -z "$(ls -A "$work/adir")" ]] || { echo 'a dump was written into the directory' >&2; exit 1; }
[[ "$(leftovers)" == 0 ]] || { echo 'temporary dump left behind for a directory path' >&2; exit 1; }
ln -s "$work/adir" "$work/adir-link"
status=0
out="$(run_drill "$work/adir-link" 2>&1)" || status=$?
[[ "$status" != 0 ]] || { echo "drill accepted a symlink to a directory as the backup path: $out" >&2; exit 1; }
[[ -z "$(ls -A "$work/adir")" ]] || { echo 'a dump was written into the directory through a symlink' >&2; exit 1; }
printf 'LINK TARGET\n' >"$work/link-target.dump"
ln -s "$work/link-target.dump" "$work/file-link.dump"
status=0
out="$(run_drill "$work/file-link.dump" 2>&1)" || status=$?
[[ "$status" != 0 ]] || { echo "drill accepted a symlink to a file as the backup path: $out" >&2; exit 1; }
grep -q 'backup path is a symlink' <<<"$out" || { echo "symlink refusal was not reported: $out" >&2; exit 1; }
[[ -L "$work/file-link.dump" && "$(cat "$work/link-target.dump")" == 'LINK TARGET' ]] || { echo 'symlink or its target was changed' >&2; exit 1; }

# 7. Without a path the temporary dump is private and gone at the end.
status=0
out="$(TMPDIR="$work" run_drill 2>&1)" || status=$?
[[ "$status" == 0 ]] || { echo "temporary-dump drill failed ($status): $out" >&2; exit 1; }
[[ -z "$(find "$work" -name 'masscom-backup.*' -print -quit)" ]] || { echo 'temporary dump outlived the drill' >&2; exit 1; }

# DB 선택 키는 중복·대소문자·percent encoding과 무관하게 첫 DB 호출 전에 거절한다.
url_log="$scratch/urls.log"
rejected_queries=0
for unsafe_query in \
  'dbname=masscom' 'dbname=' 'DBNAME=masscom' 'DbNaMe=masscom' \
  '%64bname=masscom' 'd%62name=masscom' 'db%6Eame=masscom' \
  '%64%62%6e%61%6d%65=masscom' '%44%42%4E%41%4D%45=masscom' \
  'dbname=masscom_test&dbname=masscom' \
  'dbname=masscom_test&sslmode=verify-full&%64bname=masscom' \
  'service=production' 'SERVICE=production' '%73ervice=production' \
  'host=other-db' 'HOST=other-db' '%68ost=other-db' \
  'hostaddr=127.0.0.2' 'HOSTADDR=127.0.0.2' '%68ostaddr=127.0.0.2' \
  'port=5433' 'PORT=5433' '%70ort=5433'; do
  : >"$url_log"
  printf 'PREVIOUS' >"$work/rejected.dump"
  status=0
  out="$(FAKE_PG_URL_LOG="$url_log" DRILL_DATABASE_URL="postgresql://drill@127.0.0.1:1/masscom_test?sslmode=verify-full&$unsafe_query" run_drill "$work/rejected.dump" 2>&1)" || status=$?
  [[ "$status" != 0 ]] || { echo 'drill accepted a database-selecting query key' >&2; exit 1; }
  grep -q 'database-selecting query key is not allowed' <<<"$out" || { echo "query refusal failed for an unrelated reason: $out" >&2; exit 1; }
  [[ ! -s "$url_log" ]] || { echo 'unsafe URL reached a PostgreSQL command' >&2; exit 1; }
  [[ "$(<"$work/rejected.dump")" == PREVIOUS && "$(leftovers)" == 0 ]] || { echo 'query refusal changed a backup or left a partial dump' >&2; exit 1; }
  rejected_queries=$((rejected_queries + 1))
done

# TLS 옵션과 인코딩된 값은 scratch DB 생성·복원·조회·삭제 연결에도 원문 그대로 유지한다.
: >"$url_log"
tls_query='?sslmode=verify-full&sslrootcert=/tmp/test-ca.pem&sslcert=/tmp/client%20cert.pem&sslkey=/tmp/dbname%3Dkey.pem&connect_timeout=3'
status=0
out="$(FAKE_PG_URL_LOG="$url_log" DRILL_DATABASE_URL="postgresql://drill@127.0.0.1:1/masscom_test$tls_query" run_drill "$work/tls.dump" 2>&1)" || status=$?
[[ "$status" == 0 ]] || { echo "TLS drill failed ($status): $out" >&2; exit 1; }
grep -Fxq "pg_dump:postgresql://drill@127.0.0.1:1/masscom_test$tls_query" "$url_log" || { echo 'source dump lost TLS options' >&2; exit 1; }
[[ "$(grep -Fxc "postgresql://drill@127.0.0.1:1/postgres$tls_query" "$url_log" || true)" -eq 2 ]] || { echo 'admin create/drop connections lost TLS options' >&2; exit 1; }
scratch_url="$(grep -E '^pg_restore:postgresql://drill@127\.0\.0\.1:1/masscom_[0-9]+_restore_test\?' "$url_log")"
[[ "${scratch_url#pg_restore:}" == *"$tls_query" ]] || { echo 'restore connection lost TLS options' >&2; exit 1; }
grep -Fxq "${scratch_url#pg_restore:}" "$url_log" || { echo 'scratch snapshot lost TLS options' >&2; exit 1; }

# Issue #401: 한쪽·양쪽 조회 오류(부분 출력 포함)와 빈 출력은 비교 성공으로 숨기지 않는다.
snapshot_cases=0
for snapshot_mode in fail empty whitespace; do
  for snapshot_side in source scratch both; do
    : >"$url_log"
    status=0
    out="$(FAKE_PG_URL_LOG="$url_log" FAKE_PG_SNAPSHOT_MODE="$snapshot_mode" FAKE_PG_SNAPSHOT_SIDE="$snapshot_side" run_drill "$work/snapshot.dump" 2>&1)" || status=$?
    [[ "$status" != 0 ]] || { echo "drill accepted $snapshot_mode snapshot ($snapshot_side): $out" >&2; exit 1; }
    grep -q 'restore drill FAILED' <<<"$out" || { echo "snapshot failure was not reported: $out" >&2; exit 1; }
    if grep -q 'restore drill passed' <<<"$out"; then echo "snapshot failure printed success: $out" >&2; exit 1; fi
    [[ "$(grep -Fxc 'postgresql://drill@127.0.0.1:1/postgres' "$url_log" || true)" -eq 2 ]] || { echo 'snapshot failure skipped scratch cleanup' >&2; exit 1; }
    [[ "$(leftovers)" == 0 ]] || { echo 'snapshot failure left a partial dump' >&2; exit 1; }
    snapshot_cases=$((snapshot_cases + 1))
  done
done

# 서로 다른 정상 출력은 실패하고, 성공 안내는 검증한 두 조회만 사용한다.
status=0
out="$(FAKE_PG_SNAPSHOT_MODE=mismatch FAKE_PG_SNAPSHOT_SIDE=scratch run_drill "$work/mismatch.dump" 2>&1)" || status=$?
[[ "$status" != 0 ]] || { echo "drill accepted mismatched snapshots: $out" >&2; exit 1; }
grep -q 'restored data differs from the source' <<<"$out" || { echo "snapshot mismatch was not reported: $out" >&2; exit 1; }
snapshot_log="$scratch/snapshots.log"
out="$(FAKE_PG_SNAPSHOT_LOG="$snapshot_log" run_drill "$work/verified.dump" 2>&1)"
grep -q 'restore drill passed: 1 table counts and migration versions match' <<<"$out"
[[ "$(cat "$snapshot_log")" == $'source\nscratch' ]] || { echo 'success message queried an unverified snapshot again' >&2; exit 1; }

# Issue #412: --restore-only 는 있는 백업 파일만 읽어 scratch DB에 복원한다. 원본 DB는 읽기만 하고(덤프 없음) 파일은 건드리지 않으며,
# pg_restore 종료 0, 비어 있지 않은 schema_migrations, 원본과 같은 테이블 집합을 모두 요구하고, 끝나면 scratch DB를 지우고 걸린 초를 출력한다.
printf 'EXISTING BACKUP' >"$work/ro.dump"
chmod 644 "$work/ro.dump"
ro_before="$(cksum <"$work/ro.dump")"
ro_intact() {
  [[ "$(<"$work/ro.dump")" == 'EXISTING BACKUP' && "$(cksum <"$work/ro.dump")" == "$ro_before" && "$(mode_of "$work/ro.dump")" == 644 && "$(leftovers)" == 0 ]] \
    || { echo "--restore-only changed, replaced or removed the backup file ($1)" >&2; exit 1; }
}
scratch_dropped() {
  [[ "$(grep -Fxc 'postgresql://drill@127.0.0.1:1/postgres' "$url_log" || true)" -eq 2 ]] || { echo "scratch database was not created and dropped exactly once ($1)" >&2; exit 1; }
}

: >"$url_log"
status=0
out="$(FAKE_PG_URL_LOG="$url_log" run_drill --restore-only "$work/ro.dump" 2>&1)" || status=$?
[[ "$status" == 0 ]] || { echo "restore-only drill failed ($status): $out" >&2; exit 1; }
grep -Eq '^restore-only drill passed: 2 tables match the live database, 3 migrations, restored in [0-9]+ seconds$' <<<"$out" || { echo "restore-only success line is wrong: $out" >&2; exit 1; }
if grep -q 'restore drill passed' <<<"$out"; then echo 'restore-only printed the full-drill success line' >&2; exit 1; fi
if grep -q '^pg_dump:' "$url_log"; then echo 'restore-only dumped the source database' >&2; exit 1; fi
grep -q '^pg_restore:postgresql://drill@127.0.0.1:1/masscom_[0-9]*_restore_test$' "$url_log" || { echo 'restore-only did not restore into a scratch database' >&2; exit 1; }
scratch_dropped success
ro_intact success

# 파일이 없거나 디렉터리이거나 인자가 없으면 DB를 건드리기 전에 거절한다.
for ro_bad in "$work/does-not-exist.dump" "$work/adir" ''; do
  : >"$url_log"
  status=0
  if [[ -n "$ro_bad" ]]; then out="$(FAKE_PG_URL_LOG="$url_log" run_drill --restore-only "$ro_bad" 2>&1)" || status=$?
  else out="$(FAKE_PG_URL_LOG="$url_log" run_drill --restore-only 2>&1)" || status=$?; fi
  [[ "$status" != 0 ]] || { echo "restore-only accepted '$ro_bad' as a backup file" >&2; exit 1; }
  grep -q -- '--restore-only needs the path of an existing backup file' <<<"$out" || { echo "restore-only refusal was not reported for '$ro_bad': $out" >&2; exit 1; }
  [[ ! -s "$url_log" ]] || { echo "restore-only touched the database before refusing '$ro_bad'" >&2; exit 1; }
done
ro_intact refusals

# 복원 실패, 빈 schema_migrations(0건·숫자 아님), 테이블 집합 불일치·조회 실패·빈 목록은 모두 실패이고 scratch DB는 지워지며 파일은 그대로다.
ro_cases=0
for ro_case in \
    'FAKE_PG_RESTORE_FAIL=1|could not execute query|pg_restore' \
    'FAKE_RO_MIGRATIONS=0|schema_migrations is missing or empty|migrations' \
    'FAKE_RO_MIGRATIONS=|schema_migrations is missing or empty|migrations' \
    'FAKE_RO_MIGRATIONS=fake|schema_migrations is missing or empty|migrations' \
    'FAKE_RO_TABLES_MODE=extra FAKE_RO_TABLES_SIDE=scratch|restored tables differ from the live database|tables' \
    'FAKE_RO_TABLES_MODE=extra FAKE_RO_TABLES_SIDE=source|restored tables differ from the live database|tables' \
    'FAKE_RO_TABLES_MODE=fail FAKE_RO_TABLES_SIDE=source|live table list query failed or is empty|tables' \
    'FAKE_RO_TABLES_MODE=empty FAKE_RO_TABLES_SIDE=source|live table list query failed or is empty|tables' \
    'FAKE_RO_TABLES_MODE=fail FAKE_RO_TABLES_SIDE=scratch|restored table list query failed or is empty|tables' \
    'FAKE_RO_TABLES_MODE=empty FAKE_RO_TABLES_SIDE=scratch|restored table list query failed or is empty|tables'; do
  IFS='|' read -r ro_env ro_message ro_name <<<"$ro_case"
  : >"$url_log"
  status=0
  # shellcheck disable=SC2086 # ro_env holds one or two NAME=value words
  out="$( export FAKE_PG_URL_LOG="$url_log" $ro_env; run_drill --restore-only "$work/ro.dump" 2>&1 )" || status=$?
  [[ "$status" != 0 ]] || { echo "restore-only passed although $ro_env: $out" >&2; exit 1; }
  grep -q "$ro_message" <<<"$out" || { echo "restore-only failure for $ro_env was not reported as '$ro_message': $out" >&2; exit 1; }
  if grep -q 'restore-only drill passed' <<<"$out"; then echo "restore-only printed success although $ro_env" >&2; exit 1; fi
  scratch_dropped "$ro_env"
  ro_intact "$ro_env"
  ro_cases=$((ro_cases + 1))
done

# 데이터베이스를 고르는 URL 쿼리 키는 --restore-only에서도 첫 DB 호출 전에 거절한다.
: >"$url_log"
status=0
out="$(FAKE_PG_URL_LOG="$url_log" DRILL_DATABASE_URL='postgresql://drill@127.0.0.1:1/masscom_test?dbname=masscom' run_drill --restore-only "$work/ro.dump" 2>&1)" || status=$?
[[ "$status" != 0 ]] && grep -q 'database-selecting query key is not allowed' <<<"$out" && [[ ! -s "$url_log" ]] || { echo 'restore-only accepted a database-selecting query key' >&2; exit 1; }
ro_intact query-key
echo "restore-only tests passed ($ro_cases failure cases rejected; the backup file and the source were left alone)"


echo "restore drill backup-file tests passed ($rejected_queries unsafe queries refused; TLS query preserved; $snapshot_cases invalid snapshot cases rejected)"
