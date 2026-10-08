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

read -r -a pg_prefix <<<"${PG_EXEC:-} "
pg() { if [[ -n "${PG_EXEC:-}" ]]; then "${pg_prefix[@]}" "$@"; else "$@"; fi; }
base="${url%%\?*}"
query="${url#"$base"}"
left="$(pg psql "${base%/*}/postgres$query" --no-psqlrc -tAc "SELECT count(*) FROM pg_database WHERE datname LIKE '%\_restore\_test'")"
[[ "$left" == "0" ]] || { echo "scratch database was left behind" >&2; exit 1; }

# A restore that does not match the source must fail the drill.
tampered="$(mktemp -t drill-tampered.XXXXXX)"
awk '/^if ! source_snapshot=/{print "pg psql \"$scratch_url\" --no-psqlrc --quiet --command \"DELETE FROM schema_migrations WHERE filename = (SELECT max(filename) FROM schema_migrations)\" >/dev/null"} {print}' "$drill" >"$tampered"
cmp -s "$drill" "$tampered" && { echo "tamper injection point not found in the drill script" >&2; exit 1; }
if tampered_out="$(bash "$tampered" 2>&1)"; then
  echo "drill passed although the restored database was altered" >&2
  exit 1
fi
grep -q 'restore drill FAILED' <<<"$tampered_out" || { echo "tampered drill failed for an unrelated reason: $tampered_out" >&2; exit 1; }
rm -f "$tampered"

# Issue #412: --restore-only restores an existing backup into a scratch database without dumping the source or touching the file.
kept="$(mktemp -t drill-kept.XXXXXX)"
extra_table_dropped() { pg psql "$url" --no-psqlrc -qc 'DROP TABLE IF EXISTS drill_restore_only_extra' >/dev/null 2>&1 || true; }
trap 'extra_table_dropped; rm -f "$kept" "$kept.nodata" "$kept.garbage"' EXIT
bash "$drill" "$kept" >/dev/null
kept_sum="$(shasum -a 256 "$kept")"
no_scratch() { [[ "$(pg psql "${base%/*}/postgres$query" --no-psqlrc -tAc "SELECT count(*) FROM pg_database WHERE datname LIKE '%\_restore\_test'")" == 0 ]] || { echo "scratch database was left behind ($1)" >&2; exit 1; }; }

out="$(bash "$drill" --restore-only "$kept")"
grep -Eq '^restore-only drill passed: [0-9]+ tables match the live database, [0-9]+ migrations, restored in [0-9]+ seconds$' <<<"$out" \
  || { echo "restore-only success line is wrong: $out" >&2; exit 1; }
[[ "$(shasum -a 256 "$kept")" == "$kept_sum" ]] || { echo "--restore-only changed the backup file" >&2; exit 1; }
no_scratch success

# A file that is not a backup fails and leaves nothing behind.
printf 'not a dump' >"$kept.garbage"
if bash "$drill" --restore-only "$kept.garbage" >/dev/null 2>&1; then echo "restore-only accepted a file that is not a dump" >&2; exit 1; fi
[[ -f "$kept.garbage" ]] || { echo "restore-only removed the file it was given" >&2; exit 1; }
no_scratch garbage

# A backup whose schema_migrations is empty restores with exit 0 but is not a usable backup.
pg pg_dump --format=custom --no-owner --exclude-table-data=schema_migrations "$url" >"$kept.nodata"
if nodata_out="$(bash "$drill" --restore-only "$kept.nodata" 2>&1)"; then echo "restore-only accepted a backup with an empty schema_migrations" >&2; exit 1; fi
grep -q 'schema_migrations is missing or empty' <<<"$nodata_out" || { echo "empty schema_migrations was not reported: $nodata_out" >&2; exit 1; }
no_scratch nodata

# The live database gained a table after the backup: the table sets differ.
pg psql "$url" --no-psqlrc -qc 'CREATE TABLE drill_restore_only_extra (id integer)' >/dev/null
if extra_out="$(bash "$drill" --restore-only "$kept" 2>&1)"; then echo "restore-only accepted a backup that lacks a live table" >&2; exit 1; fi
grep -q 'restored tables differ from the live database' <<<"$extra_out" || { echo "table set mismatch was not reported: $extra_out" >&2; exit 1; }
extra_table_dropped
no_scratch extra-table

echo "restore drill tests passed"
