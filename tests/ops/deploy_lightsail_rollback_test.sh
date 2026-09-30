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
              pg_old|pg_up_fail) [[ -e "$scratch/pg-recreated" ]] || fixed=false ;;
              pg_stuck) fixed=false ;;
            esac
            if [[ "$*" == *HostConfig.LogConfig* ]]; then
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
          echo panic
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
        if [[ "$*" == *'run --rm -T migrate'* && "$failure" == migrate ]]; then return 9; fi ;;
    esac
  }
  sleep() { :; }
  systemctl() {
    printf '%s\n' "$*" >>"$scratch/systemctl-calls"
    if [[ "$1" == is-enabled ]]; then
      if [[ "$failure" == job_disabled ]]; then echo disabled; else echo enabled; fi
    fi
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
grep -q 'HOST_JOB_ENABLED masscom-retention.timer' <<<"$out"
[[ ! -e "$scratch/pg-recreated" ]] || { echo 'postgres was recreated although its log settings were current' >&2; exit 1; }
if grep -q 'wait-timeout 120 postgres' "$scratch/docker-calls"; then echo 'unneeded postgres recreation' >&2; exit 1; fi
if grep -Eq 'systemctl (start|stop|restart|enable|disable|daemon-reload)' "$scratch/systemctl-calls"; then
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

# 다시 만들어도 설정이 맞지 않거나 다시 만들기가 실패하면 마이그레이션 없이 이전 릴리스로 되돌린다(PostgreSQL도 이전 정의로).
for mode in pg_stuck pg_up_fail; do
  reset_live_state
  run_remote_case "$mode"
  [[ "$status" != 0 ]] || { echo "$mode did not fail the deploy" >&2; exit 1; }
  grep -q 'FULL_DEPLOY_REVERTED' <<<"$out" || { echo "$mode did not revert: $out" >&2; exit 1; }
  if grep -q 'run --rm -T migrate' "$scratch/docker-calls"; then echo "$mode still ran the migration" >&2; exit 1; fi
  grep -q "$old_release/infra/lightsail/compose.yml.* up -d --no-deps --wait --wait-timeout 120 postgres" "$scratch/docker-calls" || {
    echo "$mode did not put postgres back to the old release definition" >&2
    exit 1
  }
  grep -qx 'OLD_ENV=1' "$runtime"
  [[ "$(readlink "$scratch/opt/masscom/current")" == "$old_release" ]]
done
[[ "$status" == 7 ]] || { echo "recreation failure status was $status" >&2; exit 1; }

# 정리 작업 설치가 실패하거나 timer가 꺼져 있으면 배포는 실패로 알리지만 이미 올라간 릴리스는 되돌리지 않는다.
for mode in job_install_fail job_disabled; do
  reset_live_state
  run_remote_case "$mode"
  [[ "$status" == 1 ]] || { echo "$mode expected failure 1, got $status: $out" >&2; exit 1; }
  grep -q 'HOST_JOB_INSTALL_FAILED' <<<"$out" || { echo "$mode did not name the retention job failure: $out" >&2; exit 1; }
  if grep -q 'FULL_DEPLOY_REVERTED' <<<"$out"; then echo "$mode rolled back a live release" >&2; exit 1; fi
  grep -qx "$new_commit" "$scratch/opt/masscom/DEPLOYED_COMMIT"
  [[ "$(readlink "$scratch/opt/masscom/current")" == "$new_release" ]]
done
echo 'Lightsail full rollback mock passed'
