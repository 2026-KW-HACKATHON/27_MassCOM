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
  PATH="$scratch/bin:$PATH" FAKE_DOCKER_LOG="$scratch/docker.log" MASSCOM_DOCKER="$scratch/bin/docker" \
    MASSCOM_BACKUP_DIR="$scratch/backups" "$@" bash "$script"
}

for variant in 'lightsail|infra/lightsail/host-jobs|masscom|api|masscom-retention|/opt/masscom/backups' \
               'showcase|infra/showcase-host/host-jobs|masscom-showcase|showcase-api|masscom-showcase-retention|/opt/masscom-showcase/backups'; do
  IFS='|' read -r label directory project service unit default_backup <<<"$variant"
  script="$repo_root/$directory/masscom-retention.sh"
  bash -n "$script" "$repo_root/$directory/install.sh"

  # 정상 실행: 컨테이너를 레이블로 골라 그 안에서 정리 명령을 실행하고 오래된 백업만 지운다.
  make_backups "$scratch/backups"; : > "$scratch/docker.log"
  out="$(run_job "$script" env)" || fail "$label: healthy run failed"
  [[ "$(sed -n 1p "$scratch/docker.log")" == "ps -q --filter label=com.docker.compose.project=$project --filter label=com.docker.compose.service=$service" ]] \
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

  # 저장소의 기본값이 실제 서버 경로와 compose 이름을 가리킨다.
  grep -q "project=\"\${MASSCOM_COMPOSE_PROJECT:-$project}\"" "$script" || fail "$label: wrong default compose project"
  grep -q "service=\"\${MASSCOM_API_SERVICE:-$service}\"" "$script" || fail "$label: wrong default service"
  grep -q "backup_dir=\"\${MASSCOM_BACKUP_DIR:-$default_backup}\"" "$script" || fail "$label: wrong default backup folder"
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
  grep -q "^name='$unit'\$" "$install_file" || fail "$label: installer uses another unit name"
  grep -q 'systemctl enable --now "\$name.timer"' "$install_file" || fail "$label: installer does not enable the timer"
  [[ -x "$install_file" && -x "$script" ]] || fail "$label: scripts are not executable"
  # 설치 스크립트는 root가 아니면 아무것도 바꾸지 않고 멈춘다(이 시험이 서버 설정을 건드리지 않는다는 증거).
  if [[ "$(id -u)" != 0 ]]; then
    if bash "$install_file" >/dev/null 2>&1; then fail "$label: installer ran without root"; fi
  fi
done

# 배포 스크립트는 정리 작업을 설치하지 않는다: 서버 시스템 설정은 소유자가 한 번 손으로 바꾼다.
if grep -Eq 'host-jobs|systemctl|masscom-retention' "$repo_root/scripts/deploy-lightsail.sh" "$repo_root/scripts/deploy-lightsail-web.sh"; then
  fail "deploy scripts must not install the host job"
fi

echo 'host retention job tests passed'
