#!/usr/bin/env bash
# Backup/restore drill: dumps a database, restores it into a scratch "<name>_restore_test"
# database, and checks that migrations and per-table row counts survived. The scratch database
# is dropped afterwards; the source is only read. Without a backup-file argument the dump is a
# temporary file deleted at the end; pass a path to keep it (it contains real data). A kept dump is written
# as mode 0600 to a temporary file in the same directory and renamed into place only when pg_dump succeeded,
# so a failed dump never truncates an earlier backup at that path.
#
# Usage: DRILL_DATABASE_URL=postgresql://user@host:5432/masscom scripts/db-restore-drill.sh [backup-file]
#        DRILL_DATABASE_URL=...                                  scripts/db-restore-drill.sh --restore-only <backup-file>
#   --restore-only  restores an existing backup (e.g. a daily-*.dump from masscom-backup) into a scratch database, without dumping the source or
#                   writing anything to the file: pg_restore must exit 0, schema_migrations must not be empty, and the set of tables must equal the live
#                   database's. It prints the elapsed seconds (the restore time to expect in a real recovery). Row counts are not compared, since a
#                   backup is older than the live data; a deploy that adds a table makes the previous backup fail the table-set check until the next backup.
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
restore_only=""
if [[ "${1:-}" == --restore-only ]]; then restore_only=1; shift; fi
own_backup=""
if [[ -n "$restore_only" ]]; then
  # The file is only read: it must exist before any database is touched, and nothing below may remove or replace it.
  backup="${1:-}"
  [[ -n "$backup" && -f "$backup" && -r "$backup" ]] || { echo "--restore-only needs the path of an existing backup file" >&2; exit 1; }
else
  if [[ -n "${1:-}" ]]; then backup="$1"; else backup="$(mktemp -t masscom-backup.XXXXXX)"; own_backup=1; fi
  # `mv` would move the dump *into* a directory and the cleanup could not find it again, so a directory is refused before anything is written.
  if [[ -d "$backup" ]]; then echo "backup path is a directory: $backup" >&2; exit 1; fi
  # mv would replace a symlink instead of writing through it, so a linked path is refused too.
  if [[ -L "$backup" ]]; then echo "backup path is a symlink: $backup" >&2; exit 1; fi
fi
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
query="${url#"$base"}"
# libpq query parameters override URI path/authority; inspect every decoded key,
# including duplicates, before passing the otherwise unchanged TLS query to any client.
remaining_query="${query#\?}"
while [[ -n "$remaining_query" ]]; do
  query_pair="${remaining_query%%&*}"
  if [[ "$remaining_query" == *'&'* ]]; then remaining_query="${remaining_query#*&}"; else remaining_query=""; fi
  query_key="${query_pair%%=*}"
  # Restrict the encoded form before printf so raw backslash escapes cannot be interpreted.
  [[ "$query_key" =~ ^([A-Za-z0-9_]|%[0-9A-Fa-f]{2})+$ && "$query_key" != *%00* ]] || {
    echo 'invalid database URL query key' >&2; exit 1;
  }
  printf -v query_key '%b' "${query_key//%/\\x}"
  case "$(LC_ALL=C tr '[:upper:]' '[:lower:]' <<<"$query_key")" in
    dbname|service|host|hostaddr|port)
      echo 'database-selecting query key is not allowed' >&2; exit 1 ;;
  esac
done
source_db="${base##*/}"
if [[ -z "$source_db" || "$source_db" == "$base" ]]; then
  echo "DRILL_DATABASE_URL must name a database" >&2
  exit 1
fi
[[ "$source_db" =~ ^[A-Za-z0-9_]+$ ]] || { echo "database name must be letters, digits or underscores: $source_db" >&2; exit 1; }
# The process id keeps two drills apart and means an existing database is never dropped by name.
scratch_db="${source_db%_test}_$$_restore_test"
server="${base%/*}"
scratch_url="$server/$scratch_db$query"
admin_url="$server/postgres$query"

counts_sql="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
  FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
snapshot() {
  pg psql "$1" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 \
    --command "$counts_sql" --command 'SELECT filename FROM schema_migrations ORDER BY filename'
}

if [[ -z "$restore_only" ]]; then
  # Dump beside the target (same filesystem, so the rename is atomic) and move it into place only on success.
  backup_part="$(mktemp "$backup.part.XXXXXX")"
  pg pg_dump --format=custom --no-owner "$url" >"$backup_part"
  mv -f "$backup_part" "$backup"
  backup_part=""
  echo "backup: $backup ($(wc -c <"$backup" | tr -d ' ') bytes)"
  echo "sha256: $(shasum -a 256 "$backup" | cut -d' ' -f1)"
  echo "server: $(pg psql "$url" --no-psqlrc --tuples-only --no-align --command 'SHOW server_version')"
else
  echo "backup: $backup ($(wc -c <"$backup" | tr -d ' ') bytes, restore only)"
fi

restore_started=$SECONDS
pg psql "$admin_url" --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
  --command "CREATE DATABASE \"$scratch_db\"" >/dev/null
created_scratch=1
pg pg_restore --no-owner --exit-on-error --dbname "$scratch_url" <"$backup"

if [[ -n "$restore_only" ]]; then
  # pg_restore exited 0 (set -e). A restore that left no migration history, or a different set of tables than the live database, is not a usable backup.
  scalar() { pg psql "$1" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 --command "$2"; }
  tables_sql="SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  if ! migrations="$(scalar "$scratch_url" 'SELECT count(*) FROM schema_migrations')" || ! [[ "$migrations" =~ ^[0-9]+$ ]] || [[ "$migrations" -eq 0 ]]; then
    echo "restore drill FAILED: schema_migrations is missing or empty after the restore" >&2
    exit 1
  fi
  if ! live_tables="$(scalar "$url" "$tables_sql")" || [[ -z "${live_tables//[[:space:]]/}" ]]; then
    echo "restore drill FAILED: live table list query failed or is empty" >&2
    exit 1
  fi
  if ! scratch_tables="$(scalar "$scratch_url" "$tables_sql")" || [[ -z "${scratch_tables//[[:space:]]/}" ]]; then
    echo "restore drill FAILED: restored table list query failed or is empty" >&2
    exit 1
  fi
  if ! diff <(printf '%s\n' "$live_tables") <(printf '%s\n' "$scratch_tables"); then
    echo "restore drill FAILED: restored tables differ from the live database (< live only, > backup only)" >&2
    exit 1
  fi
  echo "restore-only drill passed: $(printf '%s\n' "$scratch_tables" | wc -l | tr -d ' ') tables match the live database, $migrations migrations, restored in $((SECONDS - restore_started)) seconds"
  exit 0  # the EXIT trap drops the scratch database; the backup file is untouched
fi

# Process substitution does not propagate snapshot failures to diff; check each query first.
if ! source_snapshot="$(snapshot "$url")"; then
  echo "restore drill FAILED: source snapshot query failed" >&2
  exit 1
fi
if [[ -z "${source_snapshot//[[:space:]]/}" ]]; then
  echo "restore drill FAILED: source snapshot is empty" >&2
  exit 1
fi
if ! scratch_snapshot="$(snapshot "$scratch_url")"; then
  echo "restore drill FAILED: scratch snapshot query failed" >&2
  exit 1
fi
if [[ -z "${scratch_snapshot//[[:space:]]/}" ]]; then
  echo "restore drill FAILED: scratch snapshot is empty" >&2
  exit 1
fi
if ! diff <(printf '%s\n' "$source_snapshot") <(printf '%s\n' "$scratch_snapshot"); then
  echo "restore drill FAILED: restored data differs from the source" >&2
  exit 1
fi
echo "restore drill passed: $(printf '%s\n' "$scratch_snapshot" | wc -l | tr -d ' ') table counts and migration versions match"
