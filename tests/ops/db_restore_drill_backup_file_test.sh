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
# Both database snapshots read the same fixed text, so the drill's comparison passes.
cat >"$fakebin/psql" <<'FAKE'
#!/usr/bin/env bash
if [[ -n "${FAKE_PG_URL_LOG:-}" ]]; then printf '%s\n' "$1" >>"$FAKE_PG_URL_LOG"; fi
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

echo "restore drill backup-file tests passed ($rejected_queries unsafe queries refused; TLS query preserved)"
