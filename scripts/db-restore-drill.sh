#!/usr/bin/env bash
# Backup/restore drill: dumps a database, restores it into a scratch "<name>_restore_test"
# database, and checks that migrations and per-table row counts survived. The scratch database
# is dropped afterwards; the source is only read. Without a backup-file argument the dump is a
# temporary file deleted at the end; pass a path to keep it (it contains real data). A kept dump is written
# as mode 0600 to a temporary file in the same directory and renamed into place only when pg_dump succeeded,
# so a failed dump never truncates an earlier backup at that path.
#
# Usage: DRILL_DATABASE_URL=postgresql://user@host:5432/masscom scripts/db-restore-drill.sh [--overwrite] [backup-file]
#        DRILL_DATABASE_URL=...                                  scripts/db-restore-drill.sh --restore-only <backup-file>
#   Options go first and are matched exactly (`--restore-only=FILE`, an unknown `-x`, or anything after the single file argument is refused).
#   A dump never replaces an existing path, and never lands in a /opt/masscom*/backups folder as *.dump, unless --overwrite is given: a forgotten
#   --restore-only must not overwrite a real backup with a fresh dump. An existing file inside such a backups folder is never replaced, not even
#   with --overwrite (dump to another path).
#   --restore-only  restores an existing backup (e.g. a daily-*.dump from masscom-backup) into a scratch database, without dumping the source or
#                   writing anything to the file: pg_restore must exit 0, schema_migrations must not be empty, and the set of tables must equal the live
#                   database's. It prints the elapsed seconds (the restore time to expect in a real recovery). Row counts are not compared, since a
#                   backup is older than the live data; a deploy that adds a table makes the previous backup fail the table-set check until the next backup.
#                   Before the scratch database is created it requires free space of at least 3x the backup file size on the filesystem that holds the
#                   server's data directory (the server reports it via SHOW data_directory; df runs where the PostgreSQL tools run: inside the container
#                   with PG_EXEC, otherwise on this machine when the URL points at it; a container behind a published local port needs PG_EXEC, or df
#                   measures this machine's path of the same name). When that cannot be measured (remote server without PG_EXEC, SHOW or df not
#                   permitted) the check is skipped with a note on stderr instead of guessed.
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
overwrite=""
usage_error() { echo "$1" >&2; echo "usage: db-restore-drill.sh [--overwrite] [backup-file] | --restore-only <backup-file>" >&2; exit 2; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --restore-only) restore_only=1 ;;
    --overwrite) overwrite=1 ;;
    -*) usage_error "unknown option: $1" ;;
    *) break ;;
  esac
  shift
done
[[ $# -le 1 ]] || usage_error "too many arguments: options go first, then at most one backup file"
[[ -z "$restore_only$overwrite" || "$restore_only" != "$overwrite" ]] || usage_error "--restore-only never writes the file, so it cannot be combined with --overwrite"
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
  # Variables used below are set before created_scratch, so this only runs once they exist. Only this drill's own scratch database is touched:
  # its leftover connections are ended first (same psql run, so one admin connection), then it is dropped. A database that already existed under
  # that name was never created here, created_scratch stays empty and neither statement is sent.
  pg psql "$admin_url" --no-psqlrc --quiet --set ON_ERROR_STOP=1 \
    --command "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$scratch_db' AND pid <> pg_backend_pid()" \
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

if [[ -z "$restore_only" && -z "$own_backup" ]]; then
  # Before any database is touched. A path that already exists is only replaced with --overwrite, and an existing file inside a production backup
  # folder is never replaced (--overwrite does not lift that); a new *.dump there is only written with --overwrite. The leading * accepts any prefix before
  # /opt, so the match also holds for the resolved path of a symlinked parent.
  [[ -n "$overwrite" || ! -e "$backup" ]] || { echo "refusing to overwrite existing path: $backup (did you forget --restore-only? pass --overwrite to replace it)" >&2; exit 1; }
  backup_dir_real="$(cd "$(dirname "$backup")" 2>/dev/null && pwd -P || true)"
  for backup_candidate in "$backup" "${backup_dir_real:+$backup_dir_real/${backup##*/}}"; do
    case "$backup_candidate" in
      */opt/masscom*/backups/*)
        [[ ! -e "$backup" ]] || { echo "refusing to replace an existing file in a backup folder: $backup_candidate (--overwrite does not apply there; dump to another path)" >&2; exit 1; }
        case "${backup_candidate##*/}" in
          *.dump|*.dump.*)
            [[ -n "$overwrite" ]] || { echo "refusing to write a dump into a backup folder: $backup_candidate (pass --overwrite if this is intended)" >&2; exit 1; } ;;
        esac ;;
    esac
  done
fi
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

if [[ -n "$restore_only" ]]; then
  # Free space (see the header): the restore writes a full copy of the dump's contents plus indexes and WAL, so 3x the file size must be free where the server keeps its data.
  hostport="${server#*://}"; hostport="${hostport##*@}"
  if [[ "$hostport" == \[* ]]; then host="${hostport#\[}"; host="${host%%\]*}"; else host="${hostport%%:*}"; fi
  measurable=""
  if [[ -n "${PG_EXEC:-}" ]]; then measurable=1; else case "$host" in ''|localhost|127.0.0.1|::1) measurable=1 ;; esac; fi
  free_kb=""
  if [[ -n "$measurable" ]] \
      && datadir="$(pg psql "$admin_url" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 --command 'SHOW data_directory' 2>/dev/null)" \
      && [[ "$datadir" == /* ]]; then
    free_kb="$(pg df -Pk "$datadir" 2>/dev/null | awk 'NR == 2 { print $4 }')" || free_kb=""
  fi
  need_bytes=$(( $(wc -c <"$backup" | tr -d ' ') * 3 ))
  if [[ "$free_kb" =~ ^[0-9]+$ ]]; then
    if (( free_kb * 1024 < need_bytes )); then
      echo "restore drill FAILED: not enough free space for --restore-only: $((free_kb * 1024)) bytes free where the server keeps its data, need at least 3x the backup size ($need_bytes bytes)" >&2
      exit 1
    fi
  else
    echo "free-space check skipped: the server's data directory cannot be measured from here (remote server without PG_EXEC, or SHOW data_directory / df not permitted)" >&2
  fi
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
