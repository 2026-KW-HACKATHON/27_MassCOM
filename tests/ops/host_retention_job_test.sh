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
  exec)
    case "$4" in
      dist/postgres/retention-command.js)
        [[ "${FAKE_DOCKER_EXEC_FAIL:-}" != 1 ]] || exit 1
        echo 'RETENTION_RUN'
        ;;
      dist/showcase/host-seed-command.js)
        [[ "$*" == 'exec container-abc node dist/showcase/host-seed-command.js' ]] || exit 2
        [[ ! -t 0 && ! -t 1 ]] || exit 2
        python3 -c 'import os, stat, sys; fd = os.fstat(0); sys.exit(not (stat.S_ISCHR(fd.st_mode) and fd.st_rdev == os.stat("/dev/null").st_rdev))' || exit 2
        if [[ "${FAKE_NOISY_OUTPUT:-}" == 1 ]]; then
          echo "DATABASE_URL=$DATABASE_URL"
          echo "PRIVATE_DEMO_SETTING=$PRIVATE_DEMO_SETTING" >&2
        fi
        printf '%s\n' "${FAKE_SEED_OUTPUT-SHOWCASE_HOST_SEEDED}"
        [[ "${FAKE_SEED_FAIL:-}" != 1 ]] || exit 1
        ;;
      *) exit 2 ;;
    esac
    ;;
esac
DOCKER
chmod +x "$scratch/bin/docker"
# 가짜 flock(Issue #412): 백업 작업과 나누는 잠금. 호출 인자를 남기고 FAKE_FLOCK_FAIL=1이면 시간 초과처럼 실패한다.
cat > "$scratch/bin/flock" <<'FLOCK'
#!/usr/bin/env bash
echo "$*" >> "${FAKE_FLOCK_LOG:-/dev/null}"
[[ "${FAKE_FLOCK_FAIL:-}" != 1 ]]
FLOCK
chmod +x "$scratch/bin/flock"

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
  PATH="$scratch/bin:$PATH" FAKE_DOCKER_LOG="$scratch/docker.log" MASSCOM_DOCKER="$scratch/bin/docker" FAKE_FLOCK_LOG="$scratch/flock.log" \
    MASSCOM_LOCK_FILE="$scratch/maintenance.lock" MASSCOM_BACKUP_DIR="$scratch/backups" MASSCOM_RETENTION_TEST=1 "$@" bash "$script"
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
  expected_calls=2
  if [[ "$label" == showcase ]]; then
    expected_calls=3
    [[ "$(sed -n 3p "$scratch/docker.log")" == 'exec container-abc node dist/showcase/host-seed-command.js' ]] \
      || fail "$label: seed must run after retention in the same container, without TTY or attached stdin"
    grep -qx SHOWCASE_SEED_STEP_SUCCEEDED <<<"$out" || fail "$label: seed success result is missing"
  fi
  [[ "$(wc -l < "$scratch/docker.log" | tr -d ' ')" == "$expected_calls" ]] || fail "$label: unexpected extra docker calls"
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
  if [[ "$label" == showcase ]]; then
    grep -qx 'exec container-abc node dist/showcase/host-seed-command.js' "$scratch/docker.log" || fail "$label: failed retention skipped seed"
    grep -qx SHOWCASE_SEED_STEP_SUCCEEDED "$scratch/out" || fail "$label: seed result after failed retention is missing"

    # seed는 종료 0과 정확한 완료 줄이 모두 필요하다. 어떤 실패라도 백업 정리는 계속한다.
    for seed_error in 'FAKE_SEED_FAIL=1' 'FAKE_SEED_OUTPUT=' 'FAKE_SEED_OUTPUT=prefix SHOWCASE_HOST_SEEDED' 'FAKE_SEED_OUTPUT=SHOWCASE_HOST_SEEDED suffix'; do
      make_backups "$scratch/backups"; : > "$scratch/docker.log"
      if run_job "$script" env "$seed_error" >"$scratch/out" 2>"$scratch/err"; then fail "$label: seed error '$seed_error' must fail the job"; fi
      grep -qx SHOWCASE_SEED_STEP_FAILED "$scratch/err" || fail "$label: seed failure is not named"
      grep -qx RETENTION_RUN "$scratch/out" || fail "$label: seed failure lost the retention output"
      expect_files "$scratch/backups" "$label failed-seed" "${kept_after_run[@]}"
      grep -q $'^BACKUPS_DELETED\t3$' "$scratch/out" || fail "$label: seed failure skipped backup cleanup"
    done

    # 시드 단계의 stdout/stderr에 환경값이 섞여도 출력하지 않는다(정리 명령의 개수 출력은 전처럼 남는다). 완료 줄은 여러 줄 중 정확히 일치하면 된다.
    make_backups "$scratch/backups"
    run_job "$script" env FAKE_NOISY_OUTPUT=1 DATABASE_URL='postgresql://private-demo-value/db' PRIVATE_DEMO_SETTING='private-secret-value' \
      FAKE_SEED_OUTPUT=$'extra output\nSHOWCASE_HOST_SEEDED\nmore output' >"$scratch/out" 2>"$scratch/err" || fail "$label: exact seed line among noisy output was rejected"
    [[ ! -s "$scratch/err" ]] || fail "$label: container stderr reached the output"
    [[ "$(cat "$scratch/out")" == $'RETENTION_RUN\nSHOWCASE_SEED_STEP_SUCCEEDED\nBACKUPS_DELETED\t3' ]] || fail "$label: seed step output reached the job output"
    for failed_step in FAKE_DOCKER_EXEC_FAIL=1 FAKE_SEED_FAIL=1; do
      make_backups "$scratch/backups"
      if run_job "$script" env "$failed_step" FAKE_NOISY_OUTPUT=1 DATABASE_URL='postgresql://private-demo-value/db' \
          PRIVATE_DEMO_SETTING='private-secret-value' FAKE_SEED_OUTPUT='private-secret-value' >"$scratch/out" 2>"$scratch/err"; then fail "$label: noisy failed command must fail"; fi
      if grep -Eq 'private-demo-value|private-secret-value|DATABASE_URL|PRIVATE_DEMO_SETTING|SHOWCASE_HOST_SEEDED' "$scratch/out" "$scratch/err"; then fail "$label: failed command output leaked"; fi
    done
  fi

  # 일일 백업 보관 하한(Issue #412): 나이와 상관없이 가장 최근 daily-*.dump 3개와 sha256은 남기고, 더 오래된 일일 백업·.part·다른 오래된 덤프는 지운다.
  rm -rf "$scratch/backups"; mkdir -p "$scratch/backups"; : > "$scratch/docker.log"; : > "$scratch/flock.log"
  for ts in 20260701 20260702 20260703 20260704 20260705; do
    : > "$scratch/backups/daily-${ts}T185000Z.dump";        age "$scratch/backups/daily-${ts}T185000Z.dump" $((90 * day))
    : > "$scratch/backups/daily-${ts}T185000Z.dump.sha256"; age "$scratch/backups/daily-${ts}T185000Z.dump.sha256" $((90 * day))
  done
  : > "$scratch/backups/daily-20260601T185000Z.dump.part"; age "$scratch/backups/daily-20260601T185000Z.dump.part" $((90 * day))
  : > "$scratch/backups/database-before-bbbbbbbbbbbb.dump.XyZ"; age "$scratch/backups/database-before-bbbbbbbbbbbb.dump.XyZ" $((90 * day))
  : > "$scratch/backups/runtime-before-bbbbbbbbbbbb.env.QqQ"; age "$scratch/backups/runtime-before-bbbbbbbbbbbb.env.QqQ" $((90 * day))
  out="$(run_job "$script" env)" || fail "$label: floor run failed"
  grep -q $'^BACKUPS_DELETED\t6$' <<<"$out" || fail "$label: expected 2 old dumps, 2 sidecars, the part file and the old pre-deploy dump deleted, got: $out"
  expect_files "$scratch/backups" "$label daily floor" daily-20260703T185000Z.dump daily-20260703T185000Z.dump.sha256 \
    daily-20260704T185000Z.dump daily-20260704T185000Z.dump.sha256 daily-20260705T185000Z.dump daily-20260705T185000Z.dump.sha256 runtime-before-bbbbbbbbbbbb.env.QqQ
  out="$(run_job "$script" env)" || fail "$label: second floor run failed"
  grep -q $'^BACKUPS_DELETED\t0$' <<<"$out" || fail "$label: the newest three daily backups were not kept on a second run"
  # 일일 백업이 3개보다 적으면 전부 남는다.
  rm -rf "$scratch/backups"; mkdir -p "$scratch/backups"
  for ts in 20260704 20260705; do : > "$scratch/backups/daily-${ts}T185000Z.dump"; age "$scratch/backups/daily-${ts}T185000Z.dump" $((200 * day)); done
  out="$(run_job "$script" env)" || fail "$label: short floor run failed"
  grep -q $'^BACKUPS_DELETED\t0$' <<<"$out" || fail "$label: fewer than three daily backups must all be kept"
  # 파일 이름의 시각 순서가 기준이다(수정 시각이 아니다): 이름이 가장 최근인 파일이 가장 오래 전에 수정됐어도 남는다.
  rm -rf "$scratch/backups"; mkdir -p "$scratch/backups"
  for ts in 20260701 20260702 20260703 20260704; do : > "$scratch/backups/daily-${ts}T185000Z.dump"; age "$scratch/backups/daily-${ts}T185000Z.dump" $(((ts - 20260700) * day + 40 * day)); done
  out="$(run_job "$script" env)" || fail "$label: name-order floor run failed"
  expect_files "$scratch/backups" "$label floor by name" daily-20260702T185000Z.dump daily-20260703T185000Z.dump daily-20260704T185000Z.dump
  # 파일을 지우는 단계는 백업 작업과 나누는 잠금을 잡는다. 잠금을 못 잡으면 아무것도 지우지 않고 실패로 알리지만 DB 정리는 한다.
  grep -qx -- '-w 600 9' "$scratch/flock.log" || fail "$label: the file step did not take the shared maintenance lock"
  make_backups "$scratch/backups"; : > "$scratch/docker.log"
  if run_job "$script" env FAKE_FLOCK_FAIL=1 >"$scratch/out" 2>"$scratch/err"; then fail "$label: a lock timeout must fail the job"; fi
  grep -q RETENTION_LOCK_TIMEOUT "$scratch/err" || fail "$label: lock timeout is not named"
  grep -q '^exec container-abc ' "$scratch/docker.log" || fail "$label: the DB step must still run when the lock is not available"
  expect_files "$scratch/backups" "$label lock timeout" database-before-aaaaaaaaaaaa.dump.AbC123 pre-old-20260801.dump pre-edge-over.dump "${kept_after_run[@]}"

  # 컨테이너가 없거나 둘이면 어느 DB인지 모르므로 실행하지 않는다(그래도 백업은 정리한다).
  for ps_output in '' 'one\ntwo'; do
    make_backups "$scratch/backups"; : > "$scratch/docker.log"
    if run_job "$script" env "FAKE_DOCKER_PS=$ps_output" >"$scratch/out" 2>"$scratch/err"; then fail "$label: ambiguous container must fail"; fi
    grep -q RETENTION_API_CONTAINER_NOT_FOUND_OR_AMBIGUOUS "$scratch/err" || fail "$label: missing container is not named"
    grep -q '^exec ' "$scratch/docker.log" && fail "$label: retention ran without exactly one container"
    if [[ "$label" == showcase ]]; then
      grep -qx SHOWCASE_SEED_STEP_SKIPPED "$scratch/err" || fail "$label: skipped seed result is missing"
    fi
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
  grep -q "^lock_file='/run/lock/masscom-db-maintenance.lock'\$" "$script" || fail "$label: wrong shared lock file"
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
      RestrictAddressFamilies=AF_UNIX ProtectClock=yes ProtectHostname=yes ProtectKernelLogs=yes RestrictNamespaces=yes \
      SystemCallArchitectures=native "ReadWritePaths=$default_backup /run/lock"; do
    grep -qx "$directive" "$service_file" || fail "$label: service is missing $directive"
  done
  [[ "$(grep -c '^ReadWritePaths=' "$service_file")" == 1 ]] || fail "$label: service may write to more than one place"
  if grep -Eq '^(ProtectSystem=(full|true)|InaccessiblePaths|TemporaryFileSystem|PrivateNetwork|RuntimeDirectory|ProtectProc|ProcSubset)' "$service_file"; then
    fail "$label: a sandbox setting could block the docker socket"
  fi
  grep -q "^name='$unit'\$" "$install_file" || fail "$label: installer uses another unit name"
  grep -q '"\$systemctl_bin" enable --now "\$name.timer"' "$install_file" || fail "$label: installer does not enable the timer"
  grep -q '"\$systemctl_bin" is-enabled "\$name.timer"' "$install_file" || fail "$label: installer does not verify the timer is enabled"
  grep -q -- '--verify)' "$install_file" || fail "$label: installer has no read-only verify mode"
  if [[ "$label" == showcase ]]; then
    grep -q 'host-seed-command.js' "$install_file" || fail "$label: verify does not check the installed seed step"
    grep -q 'SHOWCASE_HOST_SEEDED' "$install_file" || fail "$label: verify does not check the seed success marker"
  fi
  grep -q 'show -p Result --value "\$name.service"' "$install_file" || fail "$label: verify does not report the last run result"
  grep -q 'show -p ExecMainStartTimestamp --value "\$name.service"' "$install_file" || fail "$label: verify does not tell a never-run job from a successful one"
  grep -q 'last run result:' "$install_file" || fail "$label: verify does not print the last run result"
  grep -q 'MASSCOM_RETENTION_TEST:-}" == 1' "$install_file" || fail "$label: installer overrides are not gated behind the test flag"

  # --verify를 가짜 systemctl과 임시 유닛 폴더로 실제 실행해 성공과 실패 경로를 모두 확인한다(실패는 종료 코드 1).
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
      ExecMainStartTimestamp) echo "${FAKE_STARTED-Wed 2026-09-30 19:20:01 UTC}" ;;
    esac ;;
esac
FAKE
  chmod +x "$verify_dir/systemctl"
  run_verify() {
    env MASSCOM_RETENTION_TEST=1 MASSCOM_SYSTEMCTL="$verify_dir/systemctl" MASSCOM_UNIT_DIR="$verify_dir/units" \
      MASSCOM_SBIN_DIR="$verify_dir/sbin" "$@" bash "$install_file" --verify
  }
  out="$(run_verify)" || fail "$label: --verify failed for a healthy, already-run job"
  grep -q '^last run result: success$' <<<"$out" || fail "$label: --verify did not report the last run result"
  grep -q '^verified: ' <<<"$out" || fail "$label: --verify did not confirm a healthy job"
  for bad in 'FAKE_RESULT=exit-code' 'FAKE_RESULT=failed' 'FAKE_STARTED=' 'FAKE_ENABLED=disabled'; do
    set +e; bad_out="$(run_verify "$bad" 2>&1)"; code=$?; set -e
    [[ "$code" == 1 ]] || fail "$label: --verify accepted '$bad' (exit $code)"
    case "$bad" in
      FAKE_RESULT=*) grep -q 'last run result: ' <<<"$bad_out" && grep -q 'did not succeed' <<<"$bad_out" || fail "$label: a failed last run was not reported: $bad_out" ;;
      FAKE_STARTED=) grep -q 'has not run yet' <<<"$bad_out" || fail "$label: a never-run job was reported as fine: $bad_out" ;;
      FAKE_ENABLED=*) grep -q 'is not enabled' <<<"$bad_out" || fail "$label: a disabled timer was not reported: $bad_out" ;;
    esac
    if grep -q '^verified: ' <<<"$bad_out"; then fail "$label: '$bad' still printed a verified line"; fi
  done
  # 설치된 스크립트가 이 릴리스와 다르면(오래된 설치) 실패한다.
  if [[ "$label" == showcase ]]; then
    sed '/node dist\/showcase\/host-seed-command.js/d' "$script" > "$verify_dir/sbin/$unit"
    if run_verify >/dev/null 2>&1; then fail "$label: --verify accepted an installed script without seed"; fi
    cp "$script" "$verify_dir/sbin/$unit"
  fi
  echo '# drift' >> "$verify_dir/sbin/$unit"
  if run_verify >/dev/null 2>&1; then fail "$label: --verify accepted a stale installed script"; fi
  # 시험 표시가 없으면 재정의가 무시되고 root가 아니면 --verify도 멈춘다.
  if [[ "$(id -u)" != 0 ]]; then
    if env MASSCOM_SYSTEMCTL="$verify_dir/systemctl" MASSCOM_UNIT_DIR="$verify_dir/units" MASSCOM_SBIN_DIR="$verify_dir/sbin" \
        bash "$install_file" --verify >/dev/null 2>&1; then fail "$label: --verify honoured overrides without the test flag"; fi
  fi
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
# 설치한 작업을 한 번 실행하고 마지막 결과가 success인지 읽는다(그 밖의 systemctl 호출은 없다).
grep -q 'systemctl start masscom-retention.service' "$deploy" || fail "production deploy does not run the installed job once"
grep -q 'systemctl show -p Result --value masscom-retention.service' "$deploy" || fail "production deploy does not read the first run result"
if grep -n 'systemctl' "$deploy" | grep -v '^[0-9]*:[[:space:]]*#' \
    | grep -vE 'systemctl (is-enabled masscom-retention\.timer|start masscom-retention\.service|show -p Result --value masscom-retention\.service)' \
    | grep -q .; then
  fail "production deploy calls systemctl for more than is-enabled, one start and a Result read of the retention job"
fi
# 웹 전용 배포는 서버 시스템 설정을 건드리지 않는다.
if grep -Eq 'host-jobs|systemctl|masscom-retention' "$repo_root/scripts/deploy-lightsail-web.sh"; then
  fail "web-only deploy must not touch the host job"
fi

echo 'host retention job tests passed'
