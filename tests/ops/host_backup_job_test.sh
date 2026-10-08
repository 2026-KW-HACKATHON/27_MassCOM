#!/usr/bin/env bash
# Issue #412: 운영·시연 호스트의 일일 DB 백업 작업을 가짜 docker와 임시 폴더로 실행해 컨테이너 선택, 덤프 명령, 검증, 파일 이름·권한·sha256,
# 실패 처리, 정리 작업과의 이름 맞물림, systemd 유닛·설치 스크립트를 확인한다. 서버에는 아무것도 설치하지 않는다. host_retention_job_test.sh에서 복제했다.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

fail() { echo "host backup job test failed: $1" >&2; exit 1; }

mkdir -p "$scratch/bin"
# 가짜 docker: ps는 컨테이너 id를 주고, pg_dump는 덤프 내용을 stdout으로, pg_restore --list는 stdin을 읽어 확인한다.
cat > "$scratch/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  ps) [[ -z "${FAKE_DOCKER_PS-container-abc}" ]] || printf '%b\n' "${FAKE_DOCKER_PS-container-abc}" ;;
  exec)
    if [[ "$2" == -i ]]; then shift; fi
    case "$3" in
      pg_dump)
        [[ ! -t 0 && ! -t 1 ]] || exit 2
        [[ "${FAKE_DUMP_EMPTY:-}" != 1 ]] || exit 0
        printf 'PGDMP'
        [[ "${FAKE_DUMP_FAIL:-}" != 1 ]] || { echo 'pg_dump: error: connection failed' >&2; exit 1; }
        printf ' fake dump contents\n'
        ;;
      pg_restore)
        cat > "$FAKE_RESTORE_STDIN"
        [[ "${FAKE_LIST_FAIL:-}" != 1 ]] || { echo 'pg_restore: error: unsupported version' >&2; exit 1; }
        echo '; Archive created'
        ;;
      node)
        # 정리 작업과 맞물림을 보는 시험용: 정리 명령과 시연 시드 명령에 정상 응답한다.
        case "$4" in
          dist/postgres/retention-command.js) echo RETENTION_RUN ;;
          dist/showcase/host-seed-command.js) echo SHOWCASE_HOST_SEEDED ;;
          *) exit 2 ;;
        esac
        ;;
      *) exit 2 ;;
    esac
    ;;
esac
DOCKER
# 가짜 date: FAKE_DATE가 있으면 그 시각 문자열을 준다(같은 초에 두 번 실행한 경우를 만든다). 없으면 진짜 date다.
cat > "$scratch/bin/date" <<'DATE'
#!/usr/bin/env bash
if [[ -n "${FAKE_DATE:-}" && "$*" == '-u +%Y%m%dT%H%M%SZ' ]]; then echo "$FAKE_DATE"; else exec /bin/date "$@"; fi
DATE
chmod +x "$scratch/bin/docker" "$scratch/bin/date"

age() {
  python3 - "$1" "$2" <<'PY'
import os, sys, time
stamp = time.time() - int(sys.argv[2]) * 60
os.utime(sys.argv[1], (stamp, stamp), follow_symlinks=False)
PY
}
mode_of() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
hash_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum <"$1" | cut -d' ' -f1; else shasum -a 256 <"$1" | cut -d' ' -f1; fi; }
day=1440

run_job() {
  local script="$1"; shift
  # 재정의(가짜 docker·임시 백업 폴더)는 MASSCOM_BACKUP_TEST=1을 명시할 때만 받아들여진다. umask 022는 보통 셸의 값이고 스크립트가 이에 기대면 안 된다.
  ( umask 022
    PATH="$scratch/bin:$PATH" FAKE_DOCKER_LOG="$scratch/docker.log" FAKE_RESTORE_STDIN="$scratch/restore-stdin" MASSCOM_DOCKER="$scratch/bin/docker" \
      MASSCOM_BACKUP_DIR="$scratch/backups" MASSCOM_BACKUP_TEST=1 "$@" bash "$script" )
}
reset() { rm -rf "$scratch/backups"; mkdir -p "$scratch/backups"; : > "$scratch/docker.log"; : > "$scratch/restore-stdin"; }
files_in() { (cd "$scratch/backups" && find . -mindepth 1 | sed 's|^\./||' | sort); }

for variant in 'lightsail|infra/lightsail/host-jobs|masscom|postgres|masscom-backup|masscom-retention|/opt/masscom/backups|masscom|masscom|18:50' \
               'showcase|infra/showcase-host/host-jobs|masscom-showcase|postgres|masscom-showcase-backup|masscom-showcase-retention|/opt/masscom-showcase/backups|masscom_showcase|masscom_showcase|19:05'; do
  IFS='|' read -r label directory project service unit retention_unit default_backup db_user db_name timer_time <<<"$variant"
  script="$repo_root/$directory/masscom-backup.sh"
  retention_script="$repo_root/$directory/masscom-retention.sh"
  bash -n "$script"

  # 정상 실행: 컨테이너를 레이블로 골라 그 안에서 덤프·검증하고, 완성된 덤프와 sha256만 남긴다.
  reset
  out="$(run_job "$script" env)" || fail "$label: healthy run failed"
  [[ "$(sed -n 1p "$scratch/docker.log")" == "ps -q --filter label=com.docker.compose.project=$project --filter label=com.docker.compose.service=$service --filter label=com.docker.compose.oneoff=False" ]] \
    || fail "$label: container is not selected by compose labels"
  [[ "$(sed -n 2p "$scratch/docker.log")" == "exec container-abc pg_dump --format=custom --no-owner -U $db_user -d $db_name" ]] \
    || fail "$label: pg_dump is not run inside the database container with the stack's user and database"
  [[ "$(sed -n 3p "$scratch/docker.log")" == 'exec -i container-abc pg_restore --list' ]] || fail "$label: the dump is not verified with pg_restore --list"
  [[ "$(wc -l < "$scratch/docker.log" | tr -d ' ')" == 3 ]] || fail "$label: unexpected extra docker calls"
  dump="$(cd "$scratch/backups" && ls daily-*.dump 2>/dev/null)"
  [[ "$dump" =~ ^daily-[0-9]{8}T[0-9]{6}Z\.dump$ ]] || fail "$label: dump name is not daily-<UTC>.dump: $dump"
  [[ "$(files_in)" == "$dump"$'\n'"$dump.sha256" ]] || fail "$label: wrong files remain: $(files_in | tr '\n' ' ')"
  [[ "$(cat "$scratch/backups/$dump")" == 'PGDMP fake dump contents' ]] || fail "$label: dump contents are wrong"
  cmp -s "$scratch/backups/$dump" "$scratch/restore-stdin" || fail "$label: pg_restore --list did not read the dump that was kept"
  [[ "$(cat "$scratch/backups/$dump.sha256")" == "$(hash_of "$scratch/backups/$dump")  $dump" ]] || fail "$label: sha256 sidecar does not match the dump"
  [[ "$(mode_of "$scratch/backups/$dump")" == 600 && "$(mode_of "$scratch/backups/$dump.sha256")" == 600 ]] || fail "$label: backup files are not 0600 under umask 022"
  [[ "$out" == "BACKUP_OK"$'\t'"$(wc -c < "$scratch/backups/$dump" | tr -d ' ')" ]] || fail "$label: unexpected output: $out"
  if grep -Eq 'daily|dump|sha256' <<<"$out"; then fail "$label: a file name reached the output"; fi
  # 이름은 정리 작업의 삭제 범위(`*.dump`·`*.dump.*`)에 들어간다.
  case "$dump" in *.dump) ;; *) fail "$label: dump is outside the retention glob *.dump" ;; esac
  case "$dump.sha256" in *.dump.*) ;; *) fail "$label: sidecar is outside the retention glob *.dump.*" ;; esac

  # 같은 초에 두 번 실행해도 앞의 백업을 덮어쓰지 않는다. 끝까지 가지 못한 실행의 .part도 남지 않는다.
  reset
  run_job "$script" env FAKE_DATE=20261008T185000Z >/dev/null || fail "$label: first fixed-time run failed"
  before="$(cat "$scratch/backups/daily-20261008T185000Z.dump.sha256")"
  : > "$scratch/docker.log"
  if run_job "$script" env FAKE_DATE=20261008T185000Z FAKE_DUMP_FAIL=1 >"$scratch/out" 2>"$scratch/err"; then fail "$label: an existing target must fail the run"; fi
  grep -qx BACKUP_TARGET_EXISTS "$scratch/err" || fail "$label: existing target is not named"
  [[ "$(wc -l < "$scratch/docker.log" | tr -d ' ')" == 1 ]] || fail "$label: an existing target still ran the dump"
  [[ "$(cat "$scratch/backups/daily-20261008T185000Z.dump.sha256")" == "$before" ]] || fail "$label: an earlier backup was changed"

  # 정리 작업과 맞물림: 31일 지난 일일 백업은 덤프·sha256·남은 .part 모두 정리 작업이 지우고, 어제 것은 남는다.
  reset
  run_job "$script" env FAKE_DATE=20260901T185000Z >/dev/null || fail "$label: old backup run failed"
  run_job "$script" env FAKE_DATE=20261007T185000Z >/dev/null || fail "$label: recent backup run failed"
  : > "$scratch/backups/daily-20260801T185000Z.dump.part"
  for old in daily-20260901T185000Z.dump daily-20260901T185000Z.dump.sha256 daily-20260801T185000Z.dump.part; do age "$scratch/backups/$old" $((31 * day)); done
  retention_out="$(PATH="$scratch/bin:$PATH" FAKE_DOCKER_LOG="$scratch/docker.log" FAKE_RESTORE_STDIN="$scratch/restore-stdin" MASSCOM_DOCKER="$scratch/bin/docker" \
    MASSCOM_BACKUP_DIR="$scratch/backups" MASSCOM_RETENTION_TEST=1 bash "$retention_script")" || fail "$label: retention run failed"
  grep -q $'^BACKUPS_DELETED\t3$' <<<"$retention_out" || fail "$label: retention did not delete exactly the old dump, sidecar and leftover part: $retention_out"
  [[ "$(files_in)" == $'daily-20261007T185000Z.dump\ndaily-20261007T185000Z.dump.sha256' ]] || fail "$label: retention left the wrong backups: $(files_in | tr '\n' ' ')"

  # 덤프가 실패하거나 비었거나 검증에 실패하면 종료 코드 1이고 .part·sha256 같은 절반짜리 파일을 남기지 않는다. 앞의 백업은 그대로다.
  for case_spec in 'FAKE_DUMP_FAIL=1|BACKUP_DUMP_FAILED' 'FAKE_DUMP_EMPTY=1|BACKUP_DUMP_EMPTY' 'FAKE_LIST_FAIL=1|BACKUP_VERIFY_FAILED'; do
    IFS='|' read -r injected marker <<<"$case_spec"
    reset
    run_job "$script" env FAKE_DATE=20261007T185000Z >/dev/null || fail "$label: setup run failed"
    expected_files="$(files_in)"
    if run_job "$script" env FAKE_DATE=20261008T185000Z "$injected" >"$scratch/out" 2>"$scratch/err"; then fail "$label: $injected must fail the job"; fi
    grep -qx "$marker" "$scratch/err" || fail "$label: $injected is not named $marker: $(cat "$scratch/err")"
    [[ "$(files_in)" == "$expected_files" ]] || fail "$label: $injected left a partial file: $(files_in | tr '\n' ' ')"
    [[ ! -s "$scratch/out" ]] || fail "$label: a failed run printed to stdout"
    if grep -q BACKUP_OK "$scratch/out" "$scratch/err"; then fail "$label: a failed run reported success"; fi
  done

  # 컨테이너가 없거나 둘이면 어느 DB인지 모르므로 받지 않는다. 백업 폴더가 없거나 심볼릭 링크여도 받지 않는다.
  for ps_output in '' 'one\ntwo'; do
    reset
    if run_job "$script" env "FAKE_DOCKER_PS=$ps_output" >"$scratch/out" 2>"$scratch/err"; then fail "$label: ambiguous container must fail"; fi
    grep -qx BACKUP_POSTGRES_CONTAINER_NOT_FOUND_OR_AMBIGUOUS "$scratch/err" || fail "$label: missing container is not named"
    grep -q '^exec ' "$scratch/docker.log" && fail "$label: a dump ran without exactly one container"
    [[ -z "$(files_in)" ]] || fail "$label: a backup file appeared without a container"
  done
  rm -rf "$scratch/backups"; : > "$scratch/docker.log"
  if run_job "$script" env >"$scratch/out" 2>"$scratch/err"; then fail "$label: a missing backup folder must fail"; fi
  grep -qx BACKUP_DIR_MISSING "$scratch/err" || fail "$label: missing backup folder is not named"
  [[ ! -s "$scratch/docker.log" ]] || fail "$label: a missing backup folder still called docker"
  mkdir -p "$scratch/real-backups"; ln -s "$scratch/real-backups" "$scratch/backups"
  if run_job "$script" env >"$scratch/out" 2>"$scratch/err"; then fail "$label: a symlinked backup folder must fail"; fi
  [[ -z "$(ls -A "$scratch/real-backups")" ]] || fail "$label: a backup was written through a symlinked folder"
  rm -rf "$scratch/backups" "$scratch/real-backups"

  # 시험 표시 없이는 재정의가 무시된다: systemd 환경에 무엇이 있든 기본 경로·compose 이름·docker만 쓴다.
  mkdir -p "$scratch/backups"; : > "$scratch/docker.log"
  set +e
  PATH="$scratch/bin:$PATH" FAKE_DOCKER_LOG="$scratch/docker.log" MASSCOM_DOCKER=/bin/false MASSCOM_BACKUP_DIR="$scratch/backups" \
    MASSCOM_COMPOSE_PROJECT=other MASSCOM_POSTGRES_SERVICE=other MASSCOM_DB_USER=other MASSCOM_DB_NAME=other bash "$script" >"$scratch/out" 2>"$scratch/err"
  set -e
  if [[ -d "$default_backup" && -w "$default_backup" ]]; then fail "$label: this machine has the real backup folder; test would touch it"; fi
  grep -qx BACKUP_DIR_MISSING "$scratch/err" || fail "$label: the default backup folder was not used without the test flag"
  [[ -z "$(files_in)" ]] || fail "$label: an override wrote into the temporary folder without the test flag"

  # 저장소의 기본값이 실제 서버 경로와 compose 이름을 가리킨다.
  grep -q "^project='$project'\$" "$script" || fail "$label: wrong default compose project"
  grep -q "^service='$service'\$" "$script" || fail "$label: wrong default service"
  grep -q "^db_user='$db_user'\$" "$script" || fail "$label: wrong default database user"
  grep -q "^db_name='$db_name'\$" "$script" || fail "$label: wrong default database"
  grep -q "^backup_dir='$default_backup'\$" "$script" || fail "$label: wrong default backup folder"
  grep -q 'MASSCOM_BACKUP_TEST:-}" == 1' "$script" || fail "$label: overrides are not gated behind the test flag"
  grep -q '^umask 077$' "$script" || fail "$label: the job does not set umask 077"
  compose="$repo_root/${directory%/host-jobs}/compose.yml"
  grep -q "^name: $project\$" "$compose" || fail "$label: compose project name differs from the job's"
  grep -q "^  $service:\$" "$compose" || fail "$label: compose service name differs from the job's"
  grep -q "^      POSTGRES_USER: $db_user\$" "$compose" || fail "$label: compose database user differs from the job's"
  grep -q "^      POSTGRES_DB: $db_name\$" "$compose" || fail "$label: compose database name differs from the job's"
  # 이 작업이 지우는 것은 자기가 만든 .part·sha256뿐이다: 다른 삭제 수단을 쓰지 않는다.
  if grep -Eq 'rm -[a-z]*r|find |xargs|-delete' "$script"; then fail "$label: the backup job deletes more than its own unfinished files"; fi

  # systemd 유닛과 설치 스크립트는 같은 이름·경로를 쓴다.
  service_file="$repo_root/$directory/$unit.service"
  timer_file="$repo_root/$directory/$unit.timer"
  install_file="$repo_root/$directory/install.sh"
  grep -q "^ExecStart=/usr/local/sbin/$unit\$" "$service_file" || fail "$label: service does not run the installed script"
  grep -q '^Type=oneshot$' "$service_file" || fail "$label: service is not oneshot"
  grep -Fqx "OnCalendar=*-*-* $timer_time:00 UTC" "$timer_file" || fail "$label: timer is not daily at $timer_time UTC"
  grep -q '^Persistent=true$' "$timer_file" || fail "$label: timer does not catch up a missed run"
  grep -q '^WantedBy=timers.target$' "$timer_file" || fail "$label: timer is not installable"
  for directive in UMask=0077 NoNewPrivileges=yes PrivateTmp=yes PrivateDevices=yes ProtectSystem=strict ProtectHome=read-only \
      ProtectKernelTunables=yes ProtectKernelModules=yes ProtectControlGroups=yes RestrictSUIDSGID=yes LockPersonality=yes \
      RestrictAddressFamilies=AF_UNIX ProtectClock=yes ProtectHostname=yes ProtectKernelLogs=yes RestrictNamespaces=yes \
      SystemCallArchitectures=native "ReadWritePaths=$default_backup"; do
    grep -qx "$directive" "$service_file" || fail "$label: service is missing $directive"
  done
  [[ "$(grep -c '^ReadWritePaths=' "$service_file")" == 1 ]] || fail "$label: service may write to more than one place"
  if grep -Eq '^(ProtectSystem=(full|true)|InaccessiblePaths|TemporaryFileSystem|PrivateNetwork|RuntimeDirectory|ProtectProc|ProcSubset)' "$service_file"; then
    fail "$label: a sandbox setting could block the docker socket"
  fi
  # 백업은 정리 작업보다 먼저 돈다(새 백업이 생긴 뒤에 오래된 것을 지운다).
  retention_time="$(sed -n 's/^OnCalendar=\*-\*-\* \([0-9:]*\) UTC$/\1/p' "$repo_root/$directory/$retention_unit.timer")"
  [[ "$timer_time" < "$retention_time" ]] || fail "$label: the backup ($timer_time) does not run before retention ($retention_time)"
  grep -q 'backup_name=' "$install_file" || fail "$label: installer cannot install the backup job"
  grep -q "^backup_name='$unit'\$" "$install_file" || fail "$label: installer uses another backup unit name"
  [[ -x "$script" && -x "$install_file" ]] || fail "$label: scripts are not executable"

  # install.sh <백업 이름> --verify를 가짜 systemctl과 임시 유닛 폴더로 실제 실행한다. 성공과 실패 경로, 정리 작업 설치와 섞이지 않음.
  verify_dir="$scratch/verify-$label"
  rm -rf "$verify_dir"; mkdir -p "$verify_dir/units" "$verify_dir/sbin"
  cp "$script" "$verify_dir/sbin/$unit"
  cp "$service_file" "$timer_file" "$verify_dir/units/"
  cat > "$verify_dir/systemctl" <<'FAKE'
#!/usr/bin/env bash
case "$1" in
  is-enabled) echo "${FAKE_ENABLED:-enabled}"; [[ "${FAKE_ENABLED:-enabled}" == enabled ]] ;;
  show)
    case "$3" in
      Result) echo "${FAKE_RESULT-success}" ;;
      ExecMainStartTimestamp) echo "${FAKE_STARTED-Wed 2026-10-08 18:50:01 UTC}" ;;
    esac ;;
esac
FAKE
  chmod +x "$verify_dir/systemctl"
  run_verify() {
    env MASSCOM_RETENTION_TEST=1 MASSCOM_SYSTEMCTL="$verify_dir/systemctl" MASSCOM_UNIT_DIR="$verify_dir/units" \
      MASSCOM_SBIN_DIR="$verify_dir/sbin" "$@" bash "$install_file" "$unit" --verify
  }
  out="$(run_verify)" || fail "$label: --verify failed for a healthy, already-run backup job"
  grep -q '^last run result: success$' <<<"$out" || fail "$label: --verify did not report the last run result"
  grep -q "^verified: $unit.timer " <<<"$out" || fail "$label: --verify did not confirm the backup timer"
  for bad in 'FAKE_RESULT=exit-code' 'FAKE_STARTED=' 'FAKE_ENABLED=disabled'; do
    set +e; bad_out="$(run_verify "$bad" 2>&1)"; code=$?; set -e
    [[ "$code" == 1 ]] || fail "$label: --verify accepted '$bad' (exit $code)"
    if grep -q '^verified: ' <<<"$bad_out"; then fail "$label: '$bad' still printed a verified line"; fi
  done
  # 설치된 스크립트가 이 릴리스와 다르면 실패한다. 정리 작업 스크립트로는 대신할 수 없다.
  cp "$retention_script" "$verify_dir/sbin/$unit"
  if run_verify >/dev/null 2>&1; then fail "$label: --verify accepted the retention script as the backup job"; fi
  cp "$script" "$verify_dir/sbin/$unit"
  echo '# drift' >> "$verify_dir/sbin/$unit"
  if run_verify >/dev/null 2>&1; then fail "$label: --verify accepted a stale installed backup script"; fi
  # 인자 없는 설치는 여전히 정리 작업이다(운영 배포 스크립트가 인자 없이 부른다): 백업 유닛은 검사하지 않는다.
  mkdir -p "$verify_dir/ret-units" "$verify_dir/ret-sbin"
  cp "$retention_script" "$verify_dir/ret-sbin/$retention_unit"
  cp "$repo_root/$directory/$retention_unit.service" "$repo_root/$directory/$retention_unit.timer" "$verify_dir/ret-units/"
  out="$(env MASSCOM_RETENTION_TEST=1 MASSCOM_SYSTEMCTL="$verify_dir/systemctl" MASSCOM_UNIT_DIR="$verify_dir/ret-units" \
    MASSCOM_SBIN_DIR="$verify_dir/ret-sbin" bash "$install_file" --verify)" || fail "$label: install.sh without a name no longer verifies the retention job"
  grep -q "^verified: $retention_unit.timer " <<<"$out" || fail "$label: install.sh without a name does not target the retention job"
  # root가 아니면 아무것도 바꾸지 않고 멈춘다.
  if [[ "$(id -u)" != 0 ]]; then
    if bash "$install_file" "$unit" >/dev/null 2>&1; then fail "$label: installer ran without root"; fi
  fi
done

# 이 PR은 운영 배포 스크립트의 게이트를 바꾸지 않는다: 백업 작업은 소유자가 호스트에 직접 설치한다.
if grep -q 'masscom-backup' "$repo_root/scripts/deploy-lightsail.sh"; then
  fail 'production deploy references the backup job; the deploy gate change is a separate, tested follow-up'
fi

echo 'host backup job tests passed'
