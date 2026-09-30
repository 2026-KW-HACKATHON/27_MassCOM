#!/usr/bin/env bash
# Backup/restore drill: dumps a database, restores it into a scratch "<name>_restore_test"
# database, and checks that migrations and per-table row counts survived. The scratch database
# is dropped afterwards; the source is only read. Without a backup-file argument the dump is a
# temporary file deleted at the end; pass a path to keep it (it contains real data). A kept dump is written
# as mode 0600 to a temporary file in the same directory and renamed into place only when pg_dump succeeded,
# so a failed dump never truncates an earlier backup at that path.
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
# A dump holds real data: nothing this script creates is readable by other users (a plain `>` would be 0644 under umask 022).
umask 077

url="${DRILL_DATABASE_URL:?DRILL_DATABASE_URL is required}"
own_backup=""
if [[ -n "${1:-}" ]]; then backup="$1"; else backup="$(mktemp -t masscom-backup.XXXXXX)"; own_backup=1; fi
created_scratch=""
backup_part=""
drop_scratch() {
  # A dump holds real data: the temporary one never outlives the drill. A path the caller gave is theirs,
  # but an unfinished dump next to it (pg_dump failed or the drill was interrupted) is removed.
  if [[ -n "$backup_part" ]]; then rm -f "$backup_part"; fi
  if [[ -n "$own_backup" ]]; then rm -f "$backup"; fi
  [[ -n "$created_scratch" ]] || return 0
  # Variables used below are set before created_scratch, so this only runs once they exist.
  pg psql "$admin_url" --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    --command "DROP DATABASE IF EXISTS \"$scratch_db\"" >/dev/null
}
# A scratch database that cannot be dropped still holds a copy of the data, so that is a failure
# even when the comparison passed.
cleanup() {
  local status=$?
  drop_scratch || { echo "could not drop the scratch database; remove it by hand" >&2; status=1; }
  exit "$status"
}
trap cleanup EXIT
# bash 3.2 (macOS) treats an empty array as unbound under `set -u`, so the prefix is a function.
read -r -a pg_prefix <<<"${PG_EXEC:-} "
pg() { if [[ -n "${PG_EXEC:-}" ]]; then "${pg_prefix[@]}" "$@"; else "$@"; fi; }

base="${url%%\?*}"
source_db="${base##*/}"
if [[ -z "$source_db" || "$source_db" == "$base" ]]; then
  echo "DRILL_DATABASE_URL must name a database" >&2
  exit 1
fi
[[ "$source_db" =~ ^[A-Za-z0-9_]+$ ]] || { echo "database name must be letters, digits or underscores: $source_db" >&2; exit 1; }
# The process id keeps two drills apart and means an existing database is never dropped by name.
scratch_db="${source_db%_test}_$$_restore_test"
server="${base%/*}"
scratch_url="$server/$scratch_db"
admin_url="$server/postgres"

counts_sql="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
snapshot() {
  pg psql "$1" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 \
    --command "$counts_sql" --command 'SELECT filename FROM schema_migrations ORDER BY filename'
}

# Dump beside the target (same filesystem, so the rename is atomic) and move it into place only on success.
backup_part="$(mktemp "$backup.part.XXXXXX")"
pg pg_dump --format=custom --no-owner "$url" >"$backup_part"
mv -f "$backup_part" "$backup"
backup_part=""
echo "backup: $backup ($(wc -c <"$backup" | tr -d ' ') bytes)"
echo "sha256: $(shasum -a 256 "$backup" | cut -d' ' -f1)"
echo "server: $(pg psql "$url" --no-psqlrc --tuples-only --no-align --command 'SHOW server_version')"

pg psql "$admin_url" --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
  --command "CREATE DATABASE \"$scratch_db\"" >/dev/null
created_scratch=1
pg pg_restore --no-owner --exit-on-error --dbname "$scratch_url" <"$backup"

if ! diff <(snapshot "$url") <(snapshot "$scratch_url"); then
  echo "restore drill FAILED: restored data differs from the source" >&2
  exit 1
fi
echo "restore drill passed: $(snapshot "$scratch_url" | wc -l | tr -d ' ') table counts and migration versions match"
