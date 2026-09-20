#!/usr/bin/env bash
# Needs a disposable PostgreSQL: DRILL_DATABASE_URL (database name ending in _test), PGPASSWORD,
# and PG_EXEC when the client tools only exist inside a container.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
drill="$repo_root/scripts/db-restore-drill.sh"
url="${DRILL_DATABASE_URL:?DRILL_DATABASE_URL is required}"
[[ "${url%%\?*}" == *_test ]] || { echo "refusing to run against a database not ending in _test" >&2; exit 1; }

if DRILL_DATABASE_URL= bash "$drill" >/dev/null 2>&1; then
  echo "drill must refuse to run without a database URL" >&2
  exit 1
fi

out="$(bash "$drill")"
grep -q 'restore drill passed' <<<"$out"

read -r -a pg <<<"${PG_EXEC:-}"
base="${url%%\?*}"
left="$("${pg[@]}" psql "${base%/*}/postgres" --no-psqlrc -tAc "SELECT count(*) FROM pg_database WHERE datname LIKE '%\_restore\_test'")"
[[ "$left" == "0" ]] || { echo "scratch database was left behind" >&2; exit 1; }

# A restore that does not match the source must fail the drill.
tampered="$(mktemp -t drill-tampered.XXXXXX)"
awk '/^if ! diff /{print "\"${pg[@]}\" psql \"$scratch_url\" --no-psqlrc --quiet --command \"DELETE FROM schema_migrations WHERE filename = (SELECT max(filename) FROM schema_migrations)\" >/dev/null"} {print}' "$drill" >"$tampered"
if tampered_out="$(bash "$tampered" 2>&1)"; then
  echo "drill passed although the restored database was altered" >&2
  exit 1
fi
grep -q 'restore drill FAILED' <<<"$tampered_out" || { echo "tampered drill failed for an unrelated reason: $tampered_out" >&2; exit 1; }
rm -f "$tampered"

echo "restore drill tests passed"
