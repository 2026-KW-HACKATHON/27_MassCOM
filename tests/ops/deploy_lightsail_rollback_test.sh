#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
scratch="$(mktemp -d -t masscom-full-rollback.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT
old_commit="$(printf '1%.0s' {1..40})"
new_commit="$(printf '2%.0s' {1..40})"
old_release="$scratch/opt/masscom/releases/${old_commit:0:12}"
new_release="$scratch/opt/masscom/releases/${new_commit:0:12}"
showcase_caddyfile="$scratch/opt/masscom-showcase/releases/036f31f/infra/lightsail/Caddyfile"
runtime="$scratch/opt/masscom/runtime.env"
temporary="$scratch/new-runtime.env"
mkdir -p "$old_release/infra/lightsail" "$old_release/site/public" \
  "$new_release/infra/lightsail" "$scratch/opt/masscom/web" "$(dirname "$showcase_caddyfile")"
old_release="$(cd "$old_release" && pwd -P)"
new_release="$(cd "$new_release" && pwd -P)"
touch "$old_release/infra/lightsail/compose.yml" "$new_release/infra/lightsail/compose.yml" \
  "$new_release/infra/lightsail/Caddyfile"
# 배포가 새 릴리스의 host-jobs/install.sh를 실행한다(Issue #253). 시험은 실제 systemd 대신 호출만 기록하는 대역을 둔다.
mkdir -p "$new_release/infra/lightsail/host-jobs"
cat >"$new_release/infra/lightsail/host-jobs/install.sh" <<'INSTALL'
#!/usr/bin/env bash
echo "install $*" >>"$scratch/job-calls"
[[ "$failure" != job_install_fail ]]
INSTALL
printf 'demo-api.masscom.kr { reverse_proxy showcase-api:3000 }\n' >"$showcase_caddyfile"
ln -s "$old_release" "$scratch/opt/masscom/current"
ln -s "$old_release" "$scratch/opt/masscom/web/current"
printf '%s\n' "$old_commit" >"$scratch/opt/masscom/DEPLOYED_COMMIT"
printf '%s\n' "$old_commit" >"$scratch/opt/masscom/web/DEPLOYED_COMMIT"
printf 'OLD_ENV=1\n' >"$runtime"
printf 'NEW_ENV=1\n' >"$temporary"
candidate_release="$scratch/opt/masscom/releases/candidate-${new_commit:0:12}"

awk '/REMOTE_RELEASE_PREFLIGHT/ { if (found) exit; found=1; next } found { print }' \
  "$repo_root/scripts/deploy-lightsail.sh" >"$scratch/preflight.sh"
[[ -s "$scratch/preflight.sh" ]] || { echo 'missing remote release preflight' >&2; exit 1; }
run_preflight_case() {
  local images="$1"
  status=0
  out="$({
    sudo() { "$@"; }
    docker() {
      [[ "$*" == image\ ls* ]] || return 1
      printf '%s\n' "$images"
    }
    source "$scratch/preflight.sh" "$candidate_release" "${new_commit:0:12}"
  } 2>&1)" || status=$?
}
run_preflight_case ''
[[ "$status" == 0 ]]
mkdir -p "$candidate_release"
run_preflight_case ''
[[ "$status" != 0 ]] || { echo 'existing release path was accepted' >&2; exit 1; }
rmdir "$candidate_release"
run_preflight_case "masscom-api:${new_commit:0:12}"
[[ "$status" != 0 ]] || { echo 'existing API image tag was accepted' >&2; exit 1; }
run_preflight_case "masscom-production-web:${new_commit:0:12}"
[[ "$status" != 0 ]] || { echo 'existing web image tag was accepted' >&2; exit 1; }

awk '/^set -Eeuo pipefail$/ { remote=1 } remote && /^REMOTE$/ { exit } remote { print }' \
  "$repo_root/scripts/deploy-lightsail.sh" |
  sed "s#/opt/masscom#$scratch/opt/masscom#g" >"$scratch/remote.sh"
[[ -s "$scratch/remote.sh" ]]

run_remote_case() {
  local failure="$1"
  status=0
  rm -f "$scratch/pg-recreated" "$scratch/job-calls" "$scratch/systemctl-calls"
  (
  caddy_mount_source="$showcase_caddyfile"
  site_mount_source="$old_release/site/public"
  showcase_failed=false
  sudo() {
    if [[ "$1" == env ]]; then
      shift
      while [[ "$1" == *=* ]]; do shift; done
    elif [[ "$1" == install && "$2" == -o ]]; then
      shift 5
      command install "$@"
      return $?
    fi
    "$@"
  }
  docker() {
    printf '%s\n' "$*" >>"$scratch/docker-calls"
    case "$1" in
      image)
        if [[ "$failure" == collision ]]; then echo "masscom-api:${new_commit:0:12}"; fi ;;
      ps)
        case "${*: -1}" in
          *service=api) echo api-id ;;
          *service=production-web) echo web-id ;;
          *service=caddy) echo caddy-id ;;
          *service=postgres) echo postgres-id ;;
        esac ;;
      inspect)
        case "$*" in
          *postgres-id)
            # 로그 설정: 기본은 이미 맞게 떠 있고, pg_old·pg_stuck·pg_up_fail은 옛 설정으로 뜬 컨테이너다(다시 만들면 맞아진다, pg_stuck 제외).
            fixed=true
            case "$failure" in
              pg_old|pg_up_fail|pg_volume_changed|pg_empty_schema|pg_verbosity_wrong|pg_old_migrate_fail|pg_minstmt_wrong|pg_show_fail|\
              pg_psql_fail|pg_inspect_fail|pg_empty_before|pg_blank_before)
                [[ -e "$scratch/pg-recreated" ]] || fixed=false ;;
              pg_stuck) fixed=false ;;
            esac
            if [[ "$*" == *Mounts* ]]; then
              # docker inspect 자체가 실패하는 경우(다시 만들기 전): 명령 치환 안의 실패가 되돌림을 한 번만 돌려야 한다.
              if [[ "$failure" == pg_inspect_fail && ! -e "$scratch/pg-recreated" ]]; then return 1; fi
              # 데이터 볼륨 이름: pg_volume_changed는 다시 만든 컨테이너가 다른 볼륨을 물게 된다.
              if [[ "$failure" == pg_volume_changed && -e "$scratch/pg-recreated" ]]; then echo masscom_postgres_data_other
              else echo masscom_postgres_data; fi
            elif [[ "$*" == *HostConfig.LogConfig* ]]; then
              if [[ "$fixed" == true ]]; then echo '{"max-file":"3","max-size":"10m"}'; else echo '{}'; fi
            elif [[ "$fixed" == true ]]; then
              echo '["postgres","-c","log_error_verbosity=terse","-c","log_min_error_statement=panic"]'
            else echo '["postgres"]'; fi ;;
          *api-id) echo "masscom-api:${old_commit:0:12}" ;;
          *web-id) echo "masscom-production-web:${old_commit:0:12}" ;;
          *caddy-id)
            if [[ "$*" == *State.Running* ]]; then echo true
            elif [[ "$*" == *NetworkSettings.Networks* ]]; then echo true
            elif [[ "$*" == *Config.Image* ]]; then echo 'caddy:2.10.2-alpine'
            elif [[ "$*" == */etc/caddy/Caddyfile* ]]; then echo "$caddy_mount_source"
            else echo "$site_mount_source"; fi ;;
        esac ;;
      exec)
        if [[ "$*" == *pg_dump* ]]; then printf 'mock archive'
        elif [[ "$*" == *pg_restore* && "$failure" == backup ]]; then return 5
        else cat >/dev/null; fi ;;
      compose)
        if [[ "$*" == *'up -d --no-deps --wait --wait-timeout 120 postgres'* ]]; then
          : >"$scratch/pg-recreated"
          if [[ "$failure" == pg_up_fail && "$*" != *"${old_commit:0:12}"* ]]; then return 7; fi
        elif [[ "$*" == *psql* ]]; then
          case "$*" in
            *schema_migrations*)
              # 데이터 지문: 마이그레이션 개수|마지막 파일. pg_empty_schema는 다시 만든 컨테이너의 데이터가 비어 있고,
              # pg_empty_before·pg_blank_before는 다시 만들기 전부터 비어 있으며(보호 확인), pg_psql_fail은 psql 자체가 실패한다.
              if [[ "$failure" == pg_psql_fail && ! -e "$scratch/pg-recreated" ]]; then return 1
              elif [[ "$failure" == pg_empty_before && ! -e "$scratch/pg-recreated" ]]; then echo '0|'
              elif [[ "$failure" == pg_blank_before && ! -e "$scratch/pg-recreated" ]]; then echo ''
              elif [[ "$failure" == pg_empty_schema && -e "$scratch/pg-recreated" ]]; then echo '0|'
              else echo '35|0033_account_consents.sql'; fi ;;
            *log_error_verbosity*) if [[ "$failure" == pg_verbosity_wrong ]]; then echo default; else echo terse; fi ;;
            *)
              # SHOW log_min_error_statement: pg_minstmt_wrong은 panic이 아닌 값, pg_show_fail은 SHOW 자체의 실패다.
              if [[ "$failure" == pg_minstmt_wrong ]]; then echo notice
              elif [[ "$failure" == pg_show_fail ]]; then return 1
              else echo panic; fi ;;
          esac
        fi
        if [[ "$*" == *'up -d --no-deps --force-recreate caddy'* ]]; then
          for arg in "$@"; do
            if [[ "$arg" == *caddy-rollback-* ]]; then
              caddy_mount_source="$(awk '/source:/ { source=$2 } /target: \/etc\/caddy\/Caddyfile/ { print source; exit }' "$arg")"
            fi
          done
          site_mount_source="$old_release/site/public"
        elif [[ "$*" == *'up -d --no-deps caddy'* ]]; then
          caddy_mount_source="$new_release/infra/lightsail/Caddyfile"
          site_mount_source="$new_release/site/public"
        fi
        if [[ "$*" == *'run --rm -T migrate'* && ( "$failure" == migrate || "$failure" == pg_old_migrate_fail ) ]]; then return 9; fi ;;
    esac
  }
  sleep() { :; }
  systemctl() {
    printf '%s\n' "$*" >>"$scratch/systemctl-calls"
    case "$1" in
      is-enabled) if [[ "$failure" == job_disabled ]]; then echo disabled; else echo enabled; fi ;;
      start) if [[ "$failure" == job_run_fail ]]; then return 1; fi ;;
      show) if [[ "$failure" == job_result_bad ]]; then echo exit-code; else echo success; fi ;;
    esac
  }
  curl() {
    printf '%s\n' "$*" >>"$scratch/curl-calls"
    if [[ "$failure" == transient_showcase && "$*" == *https://demo-api.masscom.kr/health* &&
          "$showcase_failed" == false ]]; then
      showcase_failed=true
      return 22
    fi
    if [[ "$failure" == showcase && "$*" == *https://demo-api.masscom.kr/health* &&
          "$caddy_mount_source" == "$new_release/infra/lightsail/Caddyfile" ]]; then return 22; fi
  }
  export scratch old_commit new_commit old_release new_release showcase_caddyfile \
    failure caddy_mount_source site_mount_source showcase_failed
  export -f sudo docker curl sleep systemctl
  bash "$scratch/remote.sh" "$new_release" "$runtime" "$temporary" \
    "${new_commit:0:12}" "$new_commit" "$old_commit"
  ) >"$scratch/out" 2>&1 || status=$?
  out="$(<"$scratch/out")"
}
run_remote_case migrate
[[ "$status" == 9 ]] || {
  echo "expected migration failure, got $status: $out" >&2
  sed -n '1,80p' "$scratch/docker-calls" >&2
  exit 1
}
grep -q 'DB_MIGRATION_MANUAL_RECOVERY_REQUIRED' <<<"$out"
grep -q 'FULL_DEPLOY_REVERTED' <<<"$out"
grep -qx 'OLD_ENV=1' "$runtime"
grep -qx "$old_commit" "$scratch/opt/masscom/DEPLOYED_COMMIT"
grep -qx "$old_commit" "$scratch/opt/masscom/web/DEPLOYED_COMMIT"
[[ "$(readlink "$scratch/opt/masscom/current")" == "$old_release" ]]
[[ "$(readlink "$scratch/opt/masscom/web/current")" == "$old_release" ]]
grep -q "$old_release/infra/lightsail/compose.yml up -d --no-deps --force-recreate.* api production-web" \
  "$scratch/docker-calls"
grep -q "$new_release/infra/lightsail/compose.yml -f .* up -d --no-deps --force-recreate caddy" \
  "$scratch/docker-calls"
rollback_override="$(find "$scratch/opt/masscom/backups" -name 'caddy-rollback*' -print -quit)"
[[ -n "$rollback_override" ]]
grep -q "source: $old_release/site/public" "$rollback_override"
grep -q 'source: .*caddyfile-before-' "$rollback_override"
caddyfile_backup="$(find "$scratch/opt/masscom/backups" -name 'caddyfile-before-*' -print -quit)"
cmp "$showcase_caddyfile" "$caddyfile_backup"
grep -q 'masscom_showcase_edge' "$scratch/docker-calls"
grep -q 'https://demo-api.masscom.kr/health' "$scratch/curl-calls"
[[ "$(find "$scratch/opt/masscom/backups" -name '*.dump.*' | wc -l | tr -d ' ')" == 1 ]]
printf 'NEW_ENV=1\n' >"$temporary"
: >"$scratch/docker-calls"
run_remote_case backup
[[ "$status" == 5 ]] || { echo "expected backup validation failure, got $status: $out" >&2; exit 1; }
# `! grep` does not trip `set -e`, so the no-build/no-migrate guards fail explicitly.
if grep -q 'build api production-web\|run --rm -T migrate' "$scratch/docker-calls"; then
  echo 'backup validation failure still built images or ran migrate' >&2
  exit 1
fi
grep -qx 'OLD_ENV=1' "$runtime"
printf 'NEW_ENV=1\n' >"$temporary"
: >"$scratch/docker-calls"
run_remote_case collision
[[ "$status" == 1 ]] || { echo "existing tag after upload was accepted: $out" >&2; exit 1; }
grep -q 'IMAGE_TAG_ALREADY_EXISTS' <<<"$out"
if grep -q 'build api production-web\|run --rm -T migrate' "$scratch/docker-calls"; then
  echo 'image tag collision still built images or ran migrate' >&2
  exit 1
fi
grep -qx 'OLD_ENV=1' "$runtime"
printf 'NEW_ENV=1\n' >"$temporary"
: >"$scratch/docker-calls"
run_remote_case showcase
[[ "$status" == 1 ]] || { echo "expected post-Caddy showcase failure, got $status: $out" >&2; exit 1; }
grep -q 'FULL_DEPLOY_REVERTED' <<<"$out"
grep -q 'source: .*caddyfile-before-' "$rollback_override"
grep -qx 'OLD_ENV=1' "$runtime"
grep -q 'https://demo-api.masscom.kr/health' "$scratch/curl-calls"
printf 'NEW_ENV=1\n' >"$temporary"
: >"$scratch/docker-calls"
run_remote_case transient_showcase
[[ "$status" == 0 ]] || { echo "transient showcase failure did not recover: $out" >&2; exit 1; }
grep -qx "$new_commit" "$scratch/opt/masscom/DEPLOYED_COMMIT"
grep -qx "$new_commit" "$scratch/opt/masscom/web/DEPLOYED_COMMIT"
[[ "$(readlink "$scratch/opt/masscom/current")" == "$new_release" ]]
# 정리 작업: 성공한 배포는 새 릴리스의 install.sh를 실행하고 timer가 켜졌는지 읽기 전용으로 확인하며, 로그 설정이 이미 맞으면 PostgreSQL은 건드리지 않는다.
grep -qx "install " "$scratch/job-calls" || { echo 'successful deploy did not install the retention job' >&2; exit 1; }
grep -qx 'is-enabled masscom-retention.timer' "$scratch/systemctl-calls" || { echo 'successful deploy did not verify the timer' >&2; exit 1; }
# 설치한 작업을 한 번 실행하고(start) 그 뒤에 마지막 결과(Result)를 읽는다.
[[ "$(grep -nx 'start masscom-retention.service' "$scratch/systemctl-calls" | cut -d: -f1)" -lt "$(grep -nx 'show -p Result --value masscom-retention.service' "$scratch/systemctl-calls" | cut -d: -f1)" ]] || {
  echo 'the first run must happen before its result is read' >&2
  exit 1
}
grep -q 'HOST_JOB_ENABLED masscom-retention.timer' <<<"$out"
[[ ! -e "$scratch/pg-recreated" ]] || { echo 'postgres was recreated although its log settings were current' >&2; exit 1; }
if grep -q 'wait-timeout 120 postgres' "$scratch/docker-calls"; then echo 'unneeded postgres recreation' >&2; exit 1; fi
# 배포가 systemd에 직접 하는 일은 읽기 전용 확인, 설치한 작업의 첫 실행, 그 결과 읽기뿐이다(활성화·중지·재시작은 install.sh만 한다).
if grep -vxE 'is-enabled masscom-retention.timer|start masscom-retention.service|show -p Result --value masscom-retention.service' "$scratch/systemctl-calls" | grep -q .; then
  echo 'deploy changed systemd directly instead of running the installer' >&2
  exit 1
fi

reset_live_state() {
  ln -sfn "$old_release" "$scratch/opt/masscom/current"
  ln -sfn "$old_release" "$scratch/opt/masscom/web/current"
  printf '%s\n' "$old_commit" >"$scratch/opt/masscom/DEPLOYED_COMMIT"
  printf '%s\n' "$old_commit" >"$scratch/opt/masscom/web/DEPLOYED_COMMIT"
  printf 'OLD_ENV=1\n' >"$runtime"
  printf 'NEW_ENV=1\n' >"$temporary"
  : >"$scratch/docker-calls"
}
line_of() { grep -n -- "$1" "$scratch/docker-calls" | head -1 | cut -d: -f1; }

# PostgreSQL이 옛 로그 설정으로 떠 있으면 사전 백업 뒤 마이그레이션 앞에서 그것만 한 번 다시 만들고 확인한다.
reset_live_state
run_remote_case pg_old
[[ "$status" == 0 ]] || { echo "old postgres log settings blocked the deploy: $out" >&2; exit 1; }
grep -q 'POSTGRES_RECREATED_FOR_LOG_SETTINGS' <<<"$out"
[[ -e "$scratch/pg-recreated" ]]
[[ "$(grep -c 'wait-timeout 120 postgres' "$scratch/docker-calls")" == 1 ]] || { echo 'postgres must be recreated exactly once' >&2; exit 1; }
grep 'wait-timeout 120 postgres' "$scratch/docker-calls" | grep -q -- '--no-deps' || { echo 'postgres recreation pulled in dependencies' >&2; exit 1; }
dump_line="$(line_of pg_dump)"; recreate_line="$(line_of 'wait-timeout 120 postgres')"; migrate_line="$(line_of 'run --rm -T migrate')"
[[ -n "$dump_line" && -n "$recreate_line" && -n "$migrate_line" && "$dump_line" -lt "$recreate_line" && "$recreate_line" -lt "$migrate_line" ]] || {
  echo "postgres recreation must come after the backup and before the migration ($dump_line $recreate_line $migrate_line)" >&2
  exit 1
}
grep -q 'HOST_JOB_ENABLED' <<<"$out"

# PostgreSQL 다시 만들기 전후 확인이 어긋나거나 실패하면 마이그레이션 없이 이전 릴리스로 **한 번만** 되돌린다.
# 되돌림이 두 번 돌면(명령 치환 안의 실패가 ERR 트랩을 하위 셸과 부모에서 각각 걸면) FULL_DEPLOY_REVERTED와 Caddy 재생성이 두 번 나온다.
assert_reverted_once() {
  local mode="$1" label="$2" recreated="$3" expected_status="${4:-}"
  reset_live_state
  run_remote_case "$mode"
  [[ "$status" != 0 ]] || { echo "$mode did not fail the deploy" >&2; exit 1; }
  if [[ -n "$expected_status" ]]; then [[ "$status" == "$expected_status" ]] || { echo "$mode status was $status, expected $expected_status" >&2; exit 1; }; fi
  [[ "$(grep -c 'FULL_DEPLOY_REVERTED' <<<"$out")" == 1 ]] || { echo "$mode: rollback did not report exactly once: $out" >&2; exit 1; }
  [[ "$(grep -c 'up -d --no-deps --force-recreate caddy' "$scratch/docker-calls")" == 1 ]] || {
    echo "$mode: rollback ran more than once (caddy was force-recreated more than once)" >&2
    exit 1
  }
  if [[ -n "$label" ]]; then
    grep -q "POSTGRES_DATA_CHECK_FAILED: $label" <<<"$out" || { echo "$mode did not name the failed check '$label': $out" >&2; exit 1; }
  fi
  if grep -q 'run --rm -T migrate' "$scratch/docker-calls"; then echo "$mode still ran the migration" >&2; exit 1; fi
  # 어떤 실패에서도 데이터를 지우지 않는다: 볼륨·컨테이너 묶음을 지우는 호출이 없다.
  if grep -Eq 'volume (rm|prune)| down( |$)|--volumes|compose .* rm ' "$scratch/docker-calls"; then
    echo "$mode: the rollback removed a volume or container set instead of keeping the data" >&2
    exit 1
  fi
  if [[ "$recreated" == yes ]]; then
    [[ -e "$scratch/pg-recreated" ]] || { echo "$mode: expected postgres to have been recreated" >&2; exit 1; }
    grep -q "$old_release/infra/lightsail/compose.yml.* up -d --no-deps --wait --wait-timeout 120 postgres" "$scratch/docker-calls" || {
      echo "$mode did not put postgres back to the old release definition" >&2
      exit 1
    }
  else
    # 다시 만들기 전에 멈춘다: PostgreSQL을 건드리지 않았고 되돌릴 것도 없다.
    [[ ! -e "$scratch/pg-recreated" ]] || { echo "$mode: postgres was recreated although the guard should have stopped first" >&2; exit 1; }
    if grep -q 'wait-timeout 120 postgres' "$scratch/docker-calls"; then echo "$mode touched postgres" >&2; exit 1; fi
  fi
  grep -qx 'OLD_ENV=1' "$runtime"
  [[ "$(readlink "$scratch/opt/masscom/current")" == "$old_release" ]]
}
#            모드              실패한 확인             다시 만들었나
assert_reverted_once pg_stuck          log_settings            yes
assert_reverted_once pg_volume_changed volume                  yes
assert_reverted_once pg_empty_schema   fingerprint             yes
assert_reverted_once pg_verbosity_wrong verbosity              yes
assert_reverted_once pg_minstmt_wrong  min_error_statement     yes
assert_reverted_once pg_show_fail      min_error_statement     yes
assert_reverted_once pg_up_fail        ''                      yes 7
# 다시 만들기 전 보호 확인: 지문이 비었거나(0| 또는 빈 값) docker inspect·psql 자체가 실패하면 PostgreSQL을 건드리지 않고 되돌린다.
assert_reverted_once pg_empty_before   baseline                no
assert_reverted_once pg_blank_before   baseline                no
assert_reverted_once pg_psql_fail      baseline                no
assert_reverted_once pg_inspect_fail   baseline                no
# 재생성은 됐지만 마이그레이션이 실패하면(9) PostgreSQL을 이전 릴리스의 정의로 되돌리고 볼륨은 지우지 않는다.
reset_live_state
run_remote_case pg_old_migrate_fail
[[ "$status" == 9 ]] || { echo "migration failure after a postgres recreation returned $status: $out" >&2; exit 1; }
grep -q 'DB_MIGRATION_MANUAL_RECOVERY_REQUIRED' <<<"$out"
grep -q 'FULL_DEPLOY_REVERTED' <<<"$out"
grep -q 'run --rm -T migrate' "$scratch/docker-calls"
[[ "$(grep -c 'wait-timeout 120 postgres' "$scratch/docker-calls")" == 2 ]] || { echo 'postgres must be recreated once and put back once' >&2; exit 1; }
grep -q "$old_release/infra/lightsail/compose.yml.* up -d --no-deps --wait --wait-timeout 120 postgres" "$scratch/docker-calls" || {
  echo 'postgres was not put back to the old release definition after the migration failed' >&2
  exit 1
}
if grep -Eq 'volume (rm|prune)| down( |$)|--volumes|compose .* rm ' "$scratch/docker-calls"; then
  echo 'the rollback removed a volume or container set instead of keeping the data' >&2
  exit 1
fi
grep -qx 'OLD_ENV=1' "$runtime"
[[ "$(readlink "$scratch/opt/masscom/current")" == "$old_release" ]]

# 정리 작업 설치가 실패하거나 timer가 꺼져 있으면 배포는 실패로 알리지만 이미 올라간 릴리스는 되돌리지 않는다.
for mode in job_install_fail job_disabled job_run_fail job_result_bad; do
  reset_live_state
  run_remote_case "$mode"
  [[ "$status" == 1 ]] || { echo "$mode expected failure 1, got $status: $out" >&2; exit 1; }
  grep -q 'HOST_JOB_INSTALL_FAILED' <<<"$out" || { echo "$mode did not name the retention job failure: $out" >&2; exit 1; }
  if grep -q 'FULL_DEPLOY_REVERTED' <<<"$out"; then echo "$mode rolled back a live release" >&2; exit 1; fi
  grep -qx "$new_commit" "$scratch/opt/masscom/DEPLOYED_COMMIT"
  [[ "$(readlink "$scratch/opt/masscom/current")" == "$new_release" ]]
done
echo 'Lightsail full rollback mock passed'
