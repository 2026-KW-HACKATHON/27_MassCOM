#!/usr/bin/env bash
# Backup/restore drill: dumps a database, restores it into a scratch "<name>_restore_test"
# database, and checks that migrations and per-table row counts survived. The scratch database
# is dropped afterwards; the source is only read.
#
# Usage: DRILL_DATABASE_URL=postgresql://user@host:5432/masscom scripts/db-restore-drill.sh [backup-file]
#   PGPASSWORD   pass the password this way, not inside the URL (URLs show up in `ps`).
#   PG_EXEC      prefix for the PostgreSQL client tools when they are not on PATH, e.g.
#                PG_EXEC='docker exec -i -e PGPASSWORD masscom-postgres-test'
#                The URL must then be reachable from where the tools run.
#
# ponytail: counts are compared against the live source, so run it while writes are quiet;
# compare against a snapshot if the drill must run under load.

set -euo pipefail

url="${DRILL_DATABASE_URL:?DRILL_DATABASE_URL is required}"
backup="${1:-$(mktemp -t masscom-backup.XXXXXX)}"
read -r -a pg <<<"${PG_EXEC:-}"

base="${url%%\?*}"
source_db="${base##*/}"
if [[ -z "$source_db" || "$source_db" == "$base" ]]; then
  echo "DRILL_DATABASE_URL must name a database" >&2
  exit 1
fi
scratch_db="${source_db%_test}_restore_test"
server="${base%/*}"
scratch_url="$server/$scratch_db"
admin_url="$server/postgres"

counts_sql="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
snapshot() {
  "${pg[@]}" psql "$1" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 \
    --command "$counts_sql" --command 'SELECT filename FROM schema_migrations ORDER BY filename'
}
drop_scratch() {
  "${pg[@]}" psql "$admin_url" --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    --command "DROP DATABASE IF EXISTS \"$scratch_db\"" >/dev/null
}
trap drop_scratch EXIT

"${pg[@]}" pg_dump --format=custom --no-owner "$url" >"$backup"
echo "backup: $backup ($(wc -c <"$backup" | tr -d ' ') bytes)"
echo "sha256: $(shasum -a 256 "$backup" | cut -d' ' -f1)"
echo "server: $("${pg[@]}" psql "$url" --no-psqlrc --tuples-only --no-align --command 'SHOW server_version')"

drop_scratch
"${pg[@]}" psql "$admin_url" --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
  --command "CREATE DATABASE \"$scratch_db\"" >/dev/null
"${pg[@]}" pg_restore --no-owner --exit-on-error --dbname "$scratch_url" <"$backup"

if ! diff <(snapshot "$url") <(snapshot "$scratch_url"); then
  echo "restore drill FAILED: restored data differs from the source" >&2
  exit 1
fi
echo "restore drill passed: $(snapshot "$scratch_url" | wc -l | tr -d ' ') table counts and migration versions match"
