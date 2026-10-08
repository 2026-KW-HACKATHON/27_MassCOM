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
# Free-space probe of --restore-only (Issue #412 review): answered before the URL log so the admin-connection counts stay "create + drop".
if [[ "$*" == *'SHOW data_directory'* ]]; then
  if [[ -n "${FAKE_SHOW_LOG:-}" ]]; then printf '%s\n' "$1" >>"$FAKE_SHOW_LOG"; fi
  [[ "${FAKE_DATADIR_FAIL:-}" != 1 ]] || { echo 'ERROR:  must be superuser or have privileges of pg_read_all_settings' >&2; exit 1; }
  echo "${FAKE_DATADIR-/var/lib/postgresql/data}"; exit 0
fi
if [[ -n "${FAKE_PG_URL_LOG:-}" ]]; then printf '%s\n' "$1" >>"$FAKE_PG_URL_LOG"; fi
if [[ -n "${FAKE_PG_SQL_LOG:-}" ]]; then printf '%s\n' "$*" >>"$FAKE_PG_SQL_LOG"; fi
# The scratch name is taken (Issue #412 review): CREATE DATABASE fails, so nothing of this drill exists to clean up.
if [[ "${FAKE_CREATE_EXISTS:-}" == 1 && "$*" == *'CREATE DATABASE'* ]]; then echo 'ERROR:  database already exists' >&2; exit 1; fi
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
# df and a PG_EXEC wrapper: FAKE_DF_AVAIL_KB (default: plenty) is what df reports as available, FAKE_DF_FAIL=1 makes df fail; the wrapper logs what it is asked to run.
cat >"$fakebin/df" <<'FAKE'
#!/usr/bin/env bash
if [[ -n "${FAKE_DF_LOG:-}" ]]; then printf '%s\n' "$*" >>"$FAKE_DF_LOG"; fi
[[ "${FAKE_DF_FAIL:-}" != 1 ]] || { echo 'df: no such file or directory' >&2; exit 1; }
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/fake 999999999 1 %s 1%% /\n' "${FAKE_DF_AVAIL_KB:-900000000}"
FAKE
cat >"$fakebin/pgwrap" <<'FAKE'
#!/usr/bin/env bash
if [[ -n "${FAKE_WRAP_LOG:-}" ]]; then printf '%s\n' "$*" >>"$FAKE_WRAP_LOG"; fi
exec "$@"
FAKE
chmod +x "$fakebin/pg_dump" "$fakebin/psql" "$fakebin/pg_restore" "$fakebin/df" "$fakebin/pgwrap"

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
out="$(FAKE_PG_DUMP_FAIL=1 run_drill --overwrite "$work/keep.dump" 2>&1)" || status=$?
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
out="$(run_drill --overwrite "$work/keep.dump" 2>&1)" || status=$?
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
    out="$(FAKE_PG_URL_LOG="$url_log" FAKE_PG_SNAPSHOT_MODE="$snapshot_mode" FAKE_PG_SNAPSHOT_SIDE="$snapshot_side" run_drill --overwrite "$work/snapshot.dump" 2>&1)" || status=$?
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

# Issue #412 리뷰: --restore-only 는 scratch DB를 만들기 전에, 서버 데이터 디렉터리가 있는 곳에 백업 크기의 3배 이상 여유가 있는지 본다.
# 서버가 알려 준 data_directory(SHOW data_directory)를 PostgreSQL 도구가 도는 곳에서 df -Pk 로 잰다. 잴 수 없으면 알리고 건너뛴다.
df_log="$scratch/df.log"; show_log="$scratch/show.log"; wrap_log="$scratch/wrap.log"
head -c 1024 /dev/zero >"$work/ro-1k.dump"   # 3배 = 3072바이트 = 정확히 3 KiB
space_run() {   # 인자: 백업 파일, 그다음 환경 변수 낱말들. 종료 코드는 status, 출력은 out.
  local file="$1"; shift
  : >"$url_log"; : >"$df_log"; : >"$show_log"; : >"$wrap_log"; status=0
  out="$( export FAKE_PG_URL_LOG="$url_log" FAKE_DF_LOG="$df_log" FAKE_SHOW_LOG="$show_log" FAKE_WRAP_LOG="$wrap_log"; for kv in "$@"; do export "$kv"; done
          run_drill --restore-only "$file" 2>&1 )" || status=$?
}
# 경계: 정확히 3배는 통과한다. df 는 서버가 알려 준 경로를 -Pk 로 재고, 데이터 디렉터리 질의는 admin 연결로 간다.
space_run "$work/ro-1k.dump" FAKE_DF_AVAIL_KB=3
[[ "$status" == 0 ]] || { echo "exactly 3x free space was refused ($status): $out" >&2; exit 1; }
[[ "$(cat "$df_log")" == '-Pk /var/lib/postgresql/data' ]] || { echo "df was not run on the server's data directory: $(cat "$df_log")" >&2; exit 1; }
[[ "$(cat "$show_log")" == 'postgresql://drill@127.0.0.1:1/postgres' ]] || { echo "data directory was not asked over the admin connection: $(cat "$show_log")" >&2; exit 1; }
if grep -q 'free-space check skipped' <<<"$out"; then echo 'a measurable free-space check was skipped' >&2; exit 1; fi
scratch_dropped free-space-boundary
# 3배에 1KiB 모자라면 거절하고, scratch DB는 만들지 않는다(DB 연결 기록이 비어 있다): 파일은 그대로다.
space_run "$work/ro-1k.dump" FAKE_DF_AVAIL_KB=2
[[ "$status" == 1 ]] || { echo "less than 3x free space was not refused ($status): $out" >&2; exit 1; }
grep -q 'not enough free space for --restore-only' <<<"$out" || { echo "low free space was not reported: $out" >&2; exit 1; }
grep -q 'need at least 3x the backup size (3072 bytes)' <<<"$out" || { echo "the needed size is not reported: $out" >&2; exit 1; }
[[ ! -s "$url_log" ]] || { echo "the scratch database was created although free space was short: $(cat "$url_log")" >&2; exit 1; }
if grep -q 'restore-only drill passed' <<<"$out"; then echo 'low free space still printed success' >&2; exit 1; fi
space_run "$work/ro.dump" FAKE_DF_AVAIL_KB=0
[[ "$status" == 1 && ! -s "$url_log" ]] && grep -q 'not enough free space' <<<"$out" || { echo "no free space at all was not refused before CREATE: $out" >&2; exit 1; }
ro_intact low-free-space
# 잴 수 없으면(권한 없음, df 실패, 절대 경로가 아님) 알리고 건너뛴다: 복원은 계속된다.
for unmeasurable in FAKE_DATADIR_FAIL=1 FAKE_DF_FAIL=1 FAKE_DATADIR=relative/path; do
  space_run "$work/ro.dump" "$unmeasurable" FAKE_DF_AVAIL_KB=0
  [[ "$status" == 0 ]] || { echo "an unmeasurable data directory ($unmeasurable) stopped the drill ($status): $out" >&2; exit 1; }
  grep -q 'free-space check skipped' <<<"$out" || { echo "skipped check was not announced ($unmeasurable): $out" >&2; exit 1; }
  grep -q 'restore-only drill passed' <<<"$out" || { echo "drill did not finish after skipping ($unmeasurable): $out" >&2; exit 1; }
done
# 원격 서버(URL 호스트가 이 PC가 아님)는 PG_EXEC 없이 이 PC의 디스크를 재지 않는다. PG_EXEC 가 있으면 도구가 도는 곳에서 잰다. IPv6 루프백은 이 PC다.
remote_url='postgresql://drill@db.example.com:5432/masscom_test'
space_run "$work/ro.dump" DRILL_DATABASE_URL="$remote_url" FAKE_DF_AVAIL_KB=0
[[ "$status" == 0 && ! -s "$df_log" && ! -s "$show_log" ]] && grep -q 'free-space check skipped' <<<"$out" || { echo "a remote server's data directory was measured on this machine: $out" >&2; exit 1; }
space_run "$work/ro.dump" DRILL_DATABASE_URL="$remote_url" PG_EXEC="$fakebin/pgwrap" FAKE_DF_AVAIL_KB=0
[[ "$status" == 1 ]] && grep -q 'not enough free space' <<<"$out" || { echo "PG_EXEC did not make a remote URL measurable: $out" >&2; exit 1; }
grep -Fxq 'df -Pk /var/lib/postgresql/data' "$wrap_log" || { echo "df did not run through the PG_EXEC prefix: $(cat "$wrap_log")" >&2; exit 1; }
grep -q '^psql ' "$wrap_log" || { echo "psql did not run through the PG_EXEC prefix" >&2; exit 1; }
space_run "$work/ro.dump" DRILL_DATABASE_URL='postgresql://drill@[::1]:5432/masscom_test' FAKE_DF_AVAIL_KB=0
[[ "$status" == 1 && -s "$df_log" ]] || { echo "an IPv6 loopback URL was not treated as this machine: $out" >&2; exit 1; }
ro_intact free-space-variants
echo "free-space tests passed (3x boundary; refused before CREATE; unmeasurable and remote cases skipped with a note; PG_EXEC prefix used)"

echo "restore-only tests passed ($ro_cases failure cases rejected; the backup file and the source were left alone)"


# Issue #412 리뷰: 인자 안전장치. 옵션은 앞에서 정확히 일치해야 하고, 덤프는 --overwrite 없이 기존 경로나 운영 백업 폴더의 *.dump를 덮지 않는다.
printf 'REAL BACKUP' >"$work/guard.dump"
chmod 644 "$work/guard.dump"
guard_before="$(cksum <"$work/guard.dump")"
guard_intact() {
  [[ "$(<"$work/guard.dump")" == 'REAL BACKUP' && "$(cksum <"$work/guard.dump")" == "$guard_before" && "$(mode_of "$work/guard.dump")" == 644 && "$(leftovers)" == 0 ]] \
    || { echo "an argument mistake changed the existing backup ($1)" >&2; exit 1; }
}
guard_cases=0
# 라벨|기대 종료 코드|기대 문구|인자... (인자는 공백 없는 낱말)
for guard_case in \
    "wrong-order|2|too many arguments|$work/guard.dump --restore-only" \
    "equals-form|2|unknown option: --restore-only=$work/guard.dump|--restore-only=$work/guard.dump" \
    "extra-after-file|2|too many arguments|--restore-only $work/guard.dump extra" \
    "unknown-option|2|unknown option: --restore-onl|--restore-onl $work/guard.dump" \
    "unknown-short|2|unknown option: -f|-f $work/guard.dump" \
    "restore-only-overwrite|2|cannot be combined with --overwrite|--restore-only --overwrite $work/guard.dump" \
    "forgot-flag|1|refusing to overwrite existing path|$work/guard.dump" \
    "backup-folder|1|refusing to write a dump into a backup folder|/opt/masscom-t5/backups/daily-20261008T000000Z.dump" \
    "backup-folder-part|1|refusing to write a dump into a backup folder|/opt/masscom-t5/backups/x.dump.sha256"; do
  IFS='|' read -r guard_label guard_code guard_message guard_args <<<"$guard_case"
  : >"$url_log"
  status=0
  # shellcheck disable=SC2086 # guard_args is a list of words without spaces
  out="$(FAKE_PG_URL_LOG="$url_log" run_drill $guard_args 2>&1)" || status=$?
  [[ "$status" == "$guard_code" ]] || { echo "$guard_label: exit $status, wanted $guard_code: $out" >&2; exit 1; }
  grep -qF -- "$guard_message" <<<"$out" || { echo "$guard_label: message '$guard_message' missing: $out" >&2; exit 1; }
  [[ ! -s "$url_log" ]] || { echo "$guard_label: the database was touched before the refusal" >&2; exit 1; }
  guard_intact "$guard_label"
  guard_cases=$((guard_cases + 1))
done
# --overwrite 로 명시하면 새 *.dump 는 운영 백업 폴더 규칙을 통과한다(폴더가 없으므로 다른 이유로 멈춘다).
status=0
out="$(run_drill --overwrite /opt/masscom-t5/backups/daily-20261008T000000Z.dump 2>&1)" || status=$?
[[ "$status" != 0 ]] && ! grep -q 'refusing to write a dump into a backup folder' <<<"$out" || { echo '--overwrite did not lift the backup-folder rule for a new file' >&2; exit 1; }
# Issue #412 리뷰: 백업 폴더 안의 이미 있는 파일은 --overwrite 로도 바꾸지 않는다(이름과 상관없이, 상대 경로·심볼릭 링크 상위 폴더로 줘도). DB에는 닿지 않는다.
folder="$work/opt/masscom-t5/backups"
mkdir -p "$folder"
printf 'REAL BACKUP' >"$folder/daily-20261008T000000Z.dump"
printf 'REAL SIDECAR' >"$folder/daily-20261008T000000Z.dump.sha256"
printf 'REAL NOTES' >"$folder/notes.txt"
ln -s "$folder" "$work/folder-link"
folder_cases=0
for protected in "$folder/daily-20261008T000000Z.dump" "$folder/daily-20261008T000000Z.dump.sha256" "$folder/notes.txt"     "opt/masscom-t5/backups/daily-20261008T000000Z.dump" "$work/folder-link/daily-20261008T000000Z.dump"; do
  : >"$url_log"
  status=0
  out="$(FAKE_PG_URL_LOG="$url_log" run_drill --overwrite "$protected" 2>&1)" || status=$?
  [[ "$status" == 1 ]] || { echo "--overwrite replaced or mishandled an existing file in a backup folder ($protected): exit $status: $out" >&2; exit 1; }
  grep -qF 'refusing to replace an existing file in a backup folder' <<<"$out" || { echo "backup-folder refusal missing for $protected: $out" >&2; exit 1; }
  [[ ! -s "$url_log" ]] || { echo "the database was touched before the backup-folder refusal ($protected)" >&2; exit 1; }
  [[ "$(<"$folder/daily-20261008T000000Z.dump")" == 'REAL BACKUP' && "$(<"$folder/daily-20261008T000000Z.dump.sha256")" == 'REAL SIDECAR' \
     && "$(<"$folder/notes.txt")" == 'REAL NOTES' && "$(leftovers)" == 0 ]] || { echo "a backup-folder file changed ($protected)" >&2; exit 1; }
  folder_cases=$((folder_cases + 1))
done
# 같은 폴더에 새 *.dump 를 쓰는 것은 --overwrite 가 있을 때만 된다(없으면 거절). 다른 경로의 --overwrite(위 5번)는 그대로 된다.
status=0
out="$(run_drill "$folder/new.dump" 2>&1)" || status=$?
[[ "$status" == 1 && ! -e "$folder/new.dump" ]] && grep -qF 'refusing to write a dump into a backup folder' <<<"$out" || { echo "a new dump in a backup folder was written without --overwrite: $out" >&2; exit 1; }
status=0
out="$(run_drill --overwrite "$folder/new.dump" 2>&1)" || status=$?
[[ "$status" == 0 && "$(<"$folder/new.dump")" == NEWDUMP ]] || { echo "--overwrite did not allow a new dump in a backup folder ($status): $out" >&2; exit 1; }
# scratch DB 이름이 이미 쓰이고 있으면(CREATE DATABASE 실패) 아무것도 지우지 않는다: DROP 0번, 연결 종료 0번, 종료 코드 0이 아님, 파일 그대로.
sql_log="$scratch/sql.log"
: >"$sql_log"
status=0
out="$(FAKE_PG_SQL_LOG="$sql_log" FAKE_CREATE_EXISTS=1 run_drill --restore-only "$work/ro.dump" 2>&1)" || status=$?
[[ "$status" != 0 ]] || { echo "restore-only passed although the scratch database already existed: $out" >&2; exit 1; }
[[ "$(grep -c 'DROP DATABASE' "$sql_log" || true)" == 0 ]] || { echo 'a DROP DATABASE was sent although CREATE DATABASE failed' >&2; exit 1; }
[[ "$(grep -c 'pg_terminate_backend' "$sql_log" || true)" == 0 ]] || { echo 'connections were terminated although CREATE DATABASE failed' >&2; exit 1; }
ro_intact create-exists
: >"$sql_log"
status=0
out="$(FAKE_PG_SQL_LOG="$sql_log" FAKE_CREATE_EXISTS=1 run_drill --overwrite "$work/create-exists.dump" 2>&1)" || status=$?
[[ "$status" != 0 && "$(grep -c 'DROP DATABASE' "$sql_log" || true)" == 0 ]] || { echo 'dump mode sent DROP although CREATE DATABASE failed' >&2; exit 1; }

# 정상 종료 때는 이 드릴의 scratch DB 하나만, 연결을 끊은 같은 psql 실행에서 지운다.
: >"$sql_log"
status=0
out="$(FAKE_PG_SQL_LOG="$sql_log" run_drill --restore-only "$work/ro.dump" 2>&1)" || status=$?
[[ "$status" == 0 ]] || { echo "restore-only failed while checking the drop statements: $out" >&2; exit 1; }
drop_line="$(grep 'DROP DATABASE' "$sql_log")"
[[ "$(printf '%s\n' "$drop_line" | wc -l | tr -d ' ')" == 1 ]] || { echo 'expected exactly one DROP DATABASE' >&2; exit 1; }
[[ "$drop_line" =~ pg_terminate_backend\(pid\)\ FROM\ pg_stat_activity\ WHERE\ datname\ =\ \'masscom_[0-9]+_restore_test\'\ AND\ pid\ \<\>\ pg_backend_pid\(\) ]] \
  || { echo "the connection-ending statement is not limited to the scratch database: $drop_line" >&2; exit 1; }
[[ "$drop_line" == *'DROP DATABASE IF EXISTS "masscom_'*'_restore_test"'* && "$drop_line" == *pg_terminate_backend*DROP\ DATABASE* ]] || { echo "connections must be ended before the drop: $drop_line" >&2; exit 1; }
if grep -q "datname = 'masscom_test'\|datname = 'postgres'" <<<"$drop_line"; then echo 'the statement mentions a database other than the scratch one' >&2; exit 1; fi
echo "argument-safety tests passed ($guard_cases refused argument forms; $folder_cases existing backup-folder files kept despite --overwrite; no DROP when CREATE fails; scratch-only connection ending)"


echo "restore drill backup-file tests passed ($rejected_queries unsafe queries refused; TLS query preserved; $snapshot_cases invalid snapshot cases rejected)"
