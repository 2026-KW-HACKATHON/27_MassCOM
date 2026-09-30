#!/usr/bin/env bash
# Issue #253: 운영·시연 호스트의 매일 정리 작업 스크립트를 가짜 docker와 임시 폴더로 실행해
# 컨테이너 선택, 실행 명령, 지우는 백업의 범위, 실패 처리, 출력 범위를 확인한다. 서버에는 아무것도 설치하지 않는다.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

fail() { echo "host retention job test failed: $1" >&2; exit 1; }

mkdir -p "$scratch/bin"
cat > "$scratch/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  ps) [[ -z "${FAKE_DOCKER_PS-container-abc}" ]] || printf '%b\n' "${FAKE_DOCKER_PS-container-abc}" ;;
  exec) [[ "${FAKE_DOCKER_EXEC_FAIL:-}" != 1 ]] || exit 1; echo 'RETENTION_RUN' ;;
esac
DOCKER
chmod +x "$scratch/bin/docker"

# 파일의 수정 시각을 "지금부터 N분 전"으로 맞춘다(BSD·GNU 어디서나 되도록 python으로).
age() {
  python3 - "$1" "$2" <<'PY'
import os, sys, time
stamp = time.time() - int(sys.argv[2]) * 60
os.utime(sys.argv[1], (stamp, stamp), follow_symlinks=False)
PY
}
day=1440

make_backups() {
  local dir="$1"
  rm -rf "$dir" "$scratch/outside"
  mkdir -p "$dir/showcase-edge-old" "$scratch/outside"
  : > "$dir/database-before-aaaaaaaaaaaa.dump.AbC123"; age "$dir/database-before-aaaaaaaaaaaa.dump.AbC123" $((45 * day))
  : > "$dir/pre-old-20260801.dump";                     age "$dir/pre-old-20260801.dump" $((31 * day))
  : > "$dir/pre-edge-over.dump";                        age "$dir/pre-edge-over.dump" $((30 * day + 10))
  : > "$dir/pre-edge-under.dump";                       age "$dir/pre-edge-under.dump" $((30 * day - 10))
  : > "$dir/pre-recent.dump";                           age "$dir/pre-recent.dump" $((2 * day))
  : > "$dir/runtime-before-aaaaaaaaaaaa.env.XyZ789";    age "$dir/runtime-before-aaaaaaaaaaaa.env.XyZ789" $((90 * day))
  : > "$dir/caddyfile-before-aaaaaaaaaaaa.Q1w2E3";      age "$dir/caddyfile-before-aaaaaaaaaaaa.Q1w2E3" $((90 * day))
  : > "$dir/caddy-rollback-aaaaaaaaaaaa.yml.R4t5Y6";    age "$dir/caddy-rollback-aaaaaaaaaaaa.yml.R4t5Y6" $((90 * day))
  : > "$dir/notes.dumpling";                            age "$dir/notes.dumpling" $((90 * day))
  : > "$dir/nested-dump-keeps";                         age "$dir/nested-dump-keeps" $((90 * day))
  : > "$dir/showcase-edge-old/inner.dump";              age "$dir/showcase-edge-old/inner.dump" $((90 * day))
  : > "$scratch/outside/target.dump";                   age "$scratch/outside/target.dump" $((90 * day))
  ln -s "$scratch/outside/target.dump" "$dir/link.dump"
}

expect_files() {
  local dir="$1" label="$2"; shift 2
  local expected actual
  expected="$(printf '%s\n' "$@" | sort)"
  actual="$(cd "$dir" && find . -mindepth 1 \( -type f -o -type l \) | sed 's|^\./||' | sort)"
  [[ "$expected" == "$actual" ]] || { printf 'expected:\n%s\nactual:\n%s\n' "$expected" "$actual" >&2; fail "$label: wrong files remain"; }
}

kept_after_run=(
  pre-edge-under.dump pre-recent.dump runtime-before-aaaaaaaaaaaa.env.XyZ789 caddyfile-before-aaaaaaaaaaaa.Q1w2E3
  caddy-rollback-aaaaaaaaaaaa.yml.R4t5Y6 notes.dumpling nested-dump-keeps showcase-edge-old/inner.dump link.dump
)

run_job() {
  local script="$1"; shift
  # 재정의(가짜 docker·임시 백업 폴더·기간)는 MASSCOM_RETENTION_TEST=1을 명시할 때만 받아들여진다.
  PATH="$scratch/bin:$PATH" FAKE_DOCKER_LOG="$scratch/docker.log" MASSCOM_DOCKER="$scratch/bin/docker" \
    MASSCOM_BACKUP_DIR="$scratch/backups" MASSCOM_RETENTION_TEST=1 "$@" bash "$script"
}

for variant in 'lightsail|infra/lightsail/host-jobs|masscom|api|masscom-retention|/opt/masscom/backups' \
               'showcase|infra/showcase-host/host-jobs|masscom-showcase|showcase-api|masscom-showcase-retention|/opt/masscom-showcase/backups'; do
  IFS='|' read -r label directory project service unit default_backup <<<"$variant"
  script="$repo_root/$directory/masscom-retention.sh"
  bash -n "$script" "$repo_root/$directory/install.sh"

  # 정상 실행: 컨테이너를 레이블로 골라 그 안에서 정리 명령을 실행하고 오래된 백업만 지운다.
  make_backups "$scratch/backups"; : > "$scratch/docker.log"
  out="$(run_job "$script" env)" || fail "$label: healthy run failed"
  [[ "$(sed -n 1p "$scratch/docker.log")" == "ps -q --filter label=com.docker.compose.project=$project --filter label=com.docker.compose.service=$service --filter label=com.docker.compose.oneoff=False" ]] \
    || fail "$label: container is not selected by compose labels"
  [[ "$(sed -n 2p "$scratch/docker.log")" == 'exec container-abc node dist/postgres/retention-command.js run' ]] \
    || fail "$label: retention command is not run inside the API container"
  [[ "$(wc -l < "$scratch/docker.log" | tr -d ' ')" == 2 ]] || fail "$label: unexpected extra docker calls"
  expect_files "$scratch/backups" "$label" "${kept_after_run[@]}"
  [[ -e "$scratch/outside/target.dump" ]] || fail "$label: a symlink target outside the backup folder was deleted"
  grep -q $'^BACKUPS_DELETED\t3$' <<<"$out" || fail "$label: expected exactly three deleted backups, got: $out"
  grep -q '^RETENTION_RUN$' <<<"$out" || fail "$label: the retention command output is missing"
  if grep -Eq 'database-before|pre-old|AbC123|dump\.' <<<"$out"; then fail "$label: a backup file name reached the output"; fi

  # 두 번째 실행은 지울 것이 없다.
  out="$(run_job "$script" env)" || fail "$label: second run failed"
  grep -q $'^BACKUPS_DELETED\t0$' <<<"$out" || fail "$label: second run should delete nothing"

  # DB 정리가 실패해도 백업 정리는 하고, 실패는 종료 코드로 알린다.
  make_backups "$scratch/backups"; : > "$scratch/docker.log"
  if run_job "$script" env FAKE_DOCKER_EXEC_FAIL=1 >"$scratch/out" 2>"$scratch/err"; then fail "$label: a failed retention command must fail the job"; fi
  grep -q RETENTION_DB_STEP_FAILED "$scratch/err" || fail "$label: failed DB step is not named"
  expect_files "$scratch/backups" "$label failed-db" "${kept_after_run[@]}"

  # 컨테이너가 없거나 둘이면 어느 DB인지 모르므로 실행하지 않는다(그래도 백업은 정리한다).
  for ps_output in '' 'one\ntwo'; do
    make_backups "$scratch/backups"; : > "$scratch/docker.log"
    if run_job "$script" env "FAKE_DOCKER_PS=$ps_output" >"$scratch/out" 2>"$scratch/err"; then fail "$label: ambiguous container must fail"; fi
    grep -q RETENTION_API_CONTAINER_NOT_FOUND_OR_AMBIGUOUS "$scratch/err" || fail "$label: missing container is not named"
    grep -q '^exec ' "$scratch/docker.log" && fail "$label: retention ran without exactly one container"
    expect_files "$scratch/backups" "$label no-container" "${kept_after_run[@]}"
  done

  # 백업 폴더가 없으면 실패로 알리고 DB 정리는 그대로 한다. 기간 값이 잘못되면 아무것도 하지 않는다.
  rm -rf "$scratch/backups"; : > "$scratch/docker.log"
  if run_job "$script" env >"$scratch/out" 2>"$scratch/err"; then fail "$label: a missing backup folder must fail"; fi
  grep -q RETENTION_BACKUP_DIR_MISSING "$scratch/err" || fail "$label: missing backup folder is not named"
  grep -q '^exec container-abc ' "$scratch/docker.log" || fail "$label: DB step must still run"
  make_backups "$scratch/backups"; : > "$scratch/docker.log"
  for days in 0 -3 abc 3.5; do
    set +e; run_job "$script" env "MASSCOM_BACKUP_RETENTION_DAYS=$days" >/dev/null 2>&1; code=$?; set -e
    [[ "$code" == 2 ]] || fail "$label: retention days '$days' was accepted"
  done
  [[ ! -s "$scratch/docker.log" ]] || fail "$label: an invalid setting still called docker"

  # 시험 표시 없이는 재정의가 무시된다: systemd 환경에 무엇이 있든 기본 경로·기간·docker만 쓴다(임시 폴더의 백업은 그대로).
  make_backups "$scratch/backups"; : > "$scratch/docker.log"
  set +e
  PATH="$scratch/bin:$PATH" FAKE_DOCKER_LOG="$scratch/docker.log" MASSCOM_DOCKER=/bin/false MASSCOM_BACKUP_DIR="$scratch/backups" \
    MASSCOM_BACKUP_RETENTION_DAYS=1 MASSCOM_COMPOSE_PROJECT=other MASSCOM_API_SERVICE=other bash "$script" >"$scratch/out" 2>"$scratch/err"
  set -e
  expect_files "$scratch/backups" "$label without test flag" "${kept_after_run[@]}" pre-edge-over.dump database-before-aaaaaaaaaaaa.dump.AbC123 pre-old-20260801.dump
  grep -q "project=$project " "$scratch/docker.log" || fail "$label: an override changed the compose project without the test flag"
  if [[ -d "$default_backup" && -w "$default_backup" ]]; then fail "$label: this machine has the real backup folder; test would touch it"; fi
  grep -q RETENTION_BACKUP_DIR_MISSING "$scratch/err" || fail "$label: the default backup folder was not used without the test flag"

  # 저장소의 기본값이 실제 서버 경로와 compose 이름을 가리킨다.
  grep -q "^project='$project'\$" "$script" || fail "$label: wrong default compose project"
  grep -q "^service='$service'\$" "$script" || fail "$label: wrong default service"
  grep -q "^backup_dir='$default_backup'\$" "$script" || fail "$label: wrong default backup folder"
  grep -q '^retention_days=30$' "$script" || fail "$label: wrong default retention days"
  grep -q 'MASSCOM_RETENTION_TEST:-}" == 1' "$script" || fail "$label: overrides are not gated behind the test flag"
  # 지우는 일은 find 한 명령이다: 골라 둔 이름을 나중에 rm에 넘기지 않는다.
  grep -q -- '-mmin "+\$((retention_days \* 1440))" -delete' "$script" || fail "$label: backups are not deleted by find itself"
  if grep -Eq '(^|[^a-z])rm( |$)|xargs' "$script"; then fail "$label: the job deletes through a separate rm/xargs step"; fi
  grep -q "^name: $project\$" "$repo_root/${directory%/host-jobs}/compose.yml" || fail "$label: compose project name differs from the job's"
  grep -q "^  $service:\$" "$repo_root/${directory%/host-jobs}/compose.yml" || fail "$label: compose service name differs from the job's"

  # systemd 유닛과 설치 스크립트는 같은 이름·경로를 쓴다.
  service_file="$repo_root/$directory/$unit.service"
  timer_file="$repo_root/$directory/$unit.timer"
  install_file="$repo_root/$directory/install.sh"
  grep -q "^ExecStart=/usr/local/sbin/$unit\$" "$service_file" || fail "$label: service does not run the installed script"
  grep -q '^Type=oneshot$' "$service_file" || fail "$label: service is not oneshot"
  grep -q '^OnCalendar=\*-\*-\* [0-9][0-9]:[0-9][0-9]:00 UTC$' "$timer_file" || fail "$label: timer is not a daily UTC schedule"
  grep -q '^Persistent=true$' "$timer_file" || fail "$label: timer does not catch up a missed run"
  grep -q '^WantedBy=timers.target$' "$timer_file" || fail "$label: timer is not installable"
  # root로 도는 유닛은 권한을 좁힌다. 쓸 수 있는 곳은 이 스택의 백업 폴더뿐이고 docker 소켓 연결을 막는 경로 설정은 없다.
  for directive in UMask=0077 NoNewPrivileges=yes PrivateTmp=yes PrivateDevices=yes ProtectSystem=strict ProtectHome=read-only \
      ProtectKernelTunables=yes ProtectKernelModules=yes ProtectControlGroups=yes RestrictSUIDSGID=yes LockPersonality=yes \
      "ReadWritePaths=$default_backup"; do
    grep -qx "$directive" "$service_file" || fail "$label: service is missing $directive"
  done
  [[ "$(grep -c '^ReadWritePaths=' "$service_file")" == 1 ]] || fail "$label: service may write to more than one place"
  if grep -Eq '^(ProtectSystem=(full|true)|InaccessiblePaths|TemporaryFileSystem|PrivateNetwork|RuntimeDirectory|ProtectProc|ProcSubset)' "$service_file"; then
    fail "$label: a sandbox setting could block the docker socket"
  fi
  grep -q "^name='$unit'\$" "$install_file" || fail "$label: installer uses another unit name"
  grep -q 'systemctl enable --now "\$name.timer"' "$install_file" || fail "$label: installer does not enable the timer"
  grep -q 'systemctl is-enabled "\$name.timer"' "$install_file" || fail "$label: installer does not verify the timer is enabled"
  grep -q -- '--verify)' "$install_file" || fail "$label: installer has no read-only verify mode"
  grep -q "^backup_dir='$default_backup'\$" "$install_file" || fail "$label: installer creates another backup folder"
  grep -q 'install -d -m 0700 -o root -g root "\$backup_dir"' "$install_file" || fail "$label: installer does not create the backup folder the unit writes to"
  [[ -x "$install_file" && -x "$script" ]] || fail "$label: scripts are not executable"
  # 설치 스크립트는 root가 아니면 아무것도 바꾸지 않고 멈춘다(이 시험이 서버 설정을 건드리지 않는다는 증거).
  if [[ "$(id -u)" != 0 ]]; then
    if bash "$install_file" >/dev/null 2>&1; then fail "$label: installer ran without root"; fi
  fi
done

# 운영 배포 스크립트는 정리 작업을 배포한 릴리스의 install.sh로 설치·갱신하고, systemctl은 읽기 전용 is-enabled만 직접 부른다.
deploy="$repo_root/scripts/deploy-lightsail.sh"
grep -q 'sudo bash "\$release/infra/lightsail/host-jobs/install.sh"' "$deploy" || fail "production deploy does not install the host job"
grep -q 'systemctl is-enabled masscom-retention.timer' "$deploy" || fail "production deploy does not verify the timer"
if grep -n 'systemctl' "$deploy" | grep -v 'systemctl is-enabled masscom-retention.timer' | grep -v '^[0-9]*:[[:space:]]*#' | grep -q .; then
  fail "production deploy calls systemctl for more than the read-only is-enabled check"
fi
# 웹 전용 배포는 서버 시스템 설정을 건드리지 않는다.
if grep -Eq 'host-jobs|systemctl|masscom-retention' "$repo_root/scripts/deploy-lightsail-web.sh"; then
  fail "web-only deploy must not touch the host job"
fi

echo 'host retention job tests passed'
