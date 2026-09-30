#!/usr/bin/env bash
set -euo pipefail

require_private_file() {
  local path="$1"
  local label="$2"
  local mode_value
  if mode_value="$(stat -f '%Lp' "$path" 2>/dev/null)"; then
    :
  else
    mode_value="$(stat -c '%a' "$path")"
  fi
  [[ "$mode_value" == "400" || "$mode_value" == "600" ]] || {
    echo "$label must have mode 400 or 600" >&2
    exit 1
  }
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:---deploy}"
[[ "$mode" == "--deploy" || "$mode" == "--dry-run" ]] || {
  echo "usage: $0 [--deploy|--dry-run]" >&2
  exit 2
}

host="${MASSCOM_LIGHTSAIL_HOST:?MASSCOM_LIGHTSAIL_HOST is required}"
identity_file="${MASSCOM_LIGHTSAIL_KEY_FILE:?MASSCOM_LIGHTSAIL_KEY_FILE is required}"
runtime_env="${MASSCOM_RUNTIME_ENV_FILE:?MASSCOM_RUNTIME_ENV_FILE is required}"
compatibility_evidence="${MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE:?MASSCOM_MIGRATION_COMPATIBILITY_EVIDENCE_FILE is required}"

[[ -f "$identity_file" ]] || { echo "SSH identity file not found" >&2; exit 1; }
[[ -f "$runtime_env" ]] || { echo "runtime environment file not found" >&2; exit 1; }
[[ -f "$compatibility_evidence" ]] || { echo "migration compatibility evidence file not found" >&2; exit 1; }
require_private_file "$identity_file" "SSH identity file"
require_private_file "$runtime_env" "runtime environment file"
require_private_file "$compatibility_evidence" "migration compatibility evidence file"

for name in \
  MASSCOM_API_DOMAIN \
  POSTGRES_PASSWORD \
  GOOGLE_OAUTH_CLIENT_IDS \
  ACCOUNT_DELETION_HMAC_SECRET \
  MERCHANT_REFERENCE_HMAC_SECRET; do
  grep -Eq "^${name}=.+$" "$runtime_env" || {
    echo "runtime environment is missing $name" >&2
    exit 1
  }
done

deployment_paths=(
  apps/api/package.json
  apps/api/package-lock.json
  apps/api/tsconfig.json
  apps/api/src
  apps/api/migrations
  apps/production-web
  infra/lightsail
)
public_source_paths=(
  scripts/build-public-site.mjs
  scripts/deploy-lightsail.sh
  docs/index.html docs/open.html docs/privacy.html docs/terms.html docs/account-deletion.html
  docs/.well-known/assetlinks.json docs/assets docs/nft-metadata
  docs/evidence/android-collection.png docs/evidence/android-merchant-list.png
  docs/evidence/screenshots/android-account-settings.png
  docs/evidence/screenshots/android-nft-finalized.png
)
deployment_status="$(git -C "$repo_root" status --porcelain --untracked-files=all -- "${deployment_paths[@]}" "${public_source_paths[@]}")"
if [[ -n "$deployment_status" ]]; then
  echo 'deployment source paths must be clean so deployed bytes match the recorded commit' >&2
  printf '%s\n' "$deployment_status" >&2
  exit 1
fi

commit="$(git -C "$repo_root" rev-parse --verify HEAD)"
compatibility_from="$(sed -n 's/^from=//p' "$compatibility_evidence")"
[[ "$compatibility_from" =~ ^[0-9a-f]{40}$ ]] &&
  grep -qx "to=$commit" "$compatibility_evidence" &&
  grep -qx 'backward_compatible=yes' "$compatibility_evidence" || {
    echo 'MIGRATION_COMPATIBILITY_EVIDENCE_INVALID: require from=<live commit>, to=<HEAD>, backward_compatible=yes' >&2
    exit 1
  }
release_id="${commit:0:12}"
target="ubuntu@$host"
remote_release="/opt/masscom/releases/$release_id"
remote_env="/opt/masscom/runtime.env"
remote_tmp_env="/tmp/masscom-runtime-$release_id.env"
ssh_options=(
  -i "$identity_file"
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=accept-new
  -o UserKnownHostsFile="${MASSCOM_KNOWN_HOSTS_FILE:-/tmp/masscom-lightsail-known-hosts}"
  -o ConnectTimeout=15
)

echo "target: $target"
echo "release: $commit"
echo "mode: ${mode#--}"

if [[ "$mode" == "--dry-run" ]]; then
  exit 0
fi

ssh "${ssh_options[@]}" "$target" bash -s -- "$remote_release" "$release_id" <<'REMOTE_RELEASE_PREFLIGHT'
set -euo pipefail
release="$1"
tag="$2"
[[ ! -e "$release" && ! -L "$release" ]] || {
  echo 'RELEASE_ALREADY_EXISTS: refusing to overwrite release bytes' >&2
  exit 1
}
images="$(sudo docker image ls --format '{{.Repository}}:{{.Tag}}')"
for image in "masscom-api:$tag" "masscom-production-web:$tag"; do
  if grep -Fxq "$image" <<<"$images"; then
    echo "IMAGE_TAG_ALREADY_EXISTS: $image" >&2
    exit 1
  fi
done
REMOTE_RELEASE_PREFLIGHT

public_site_scratch="$(mktemp -d -t masscom-public-deploy.XXXXXX)"
trap 'rm -rf "$public_site_scratch"' EXIT
mkdir -p "$public_site_scratch/site"
node "$repo_root/scripts/build-public-site.mjs" "$public_site_scratch/site/public" >/dev/null

ssh "${ssh_options[@]}" "$target" \
  "sudo mkdir '$remote_release' && sudo chown ubuntu:ubuntu '$remote_release'"

COPYFILE_DISABLE=1 tar -C "$repo_root" -czf - "${deployment_paths[@]}" \
  -C "$public_site_scratch" site \
  | ssh "${ssh_options[@]}" "$target" "tar -xzf - -C '$remote_release'"

scp "${ssh_options[@]}" -q "$runtime_env" "$target:$remote_tmp_env"

ssh "${ssh_options[@]}" "$target" bash -s -- \
  "$remote_release" "$remote_env" "$remote_tmp_env" "$release_id" "$commit" "$compatibility_from" <<'REMOTE'
set -Eeuo pipefail

release="$1"
runtime_env="$2"
temporary_env="$3"
release_id="$4"
commit="$5"
compatibility_from="$6"
compose_file="$release/infra/lightsail/compose.yml"
trap 'sudo rm -f "$temporary_env"' EXIT

command -v docker >/dev/null
sudo docker compose version >/dev/null
images="$(sudo docker image ls --format '{{.Repository}}:{{.Tag}}')"
for image in "masscom-api:$release_id" "masscom-production-web:$release_id"; do
  if grep -Fxq "$image" <<<"$images"; then
    echo "IMAGE_TAG_ALREADY_EXISTS: $image" >&2
    exit 1
  fi
done
old_api_release="$(readlink -f /opt/masscom/current)"
old_web_release="$(readlink -f /opt/masscom/web/current)"
test -f "$old_api_release/infra/lightsail/compose.yml"
test -f "$old_web_release/infra/lightsail/compose.yml"
old_api_commit="$(sudo cat /opt/masscom/DEPLOYED_COMMIT)"
old_web_commit="$(sudo cat /opt/masscom/web/DEPLOYED_COMMIT)"
[[ "$old_api_commit" =~ ^[0-9a-f]{40}$ && "$old_web_commit" =~ ^[0-9a-f]{40}$ ]]
[[ "$old_api_commit" == "$compatibility_from" ]]
[[ "$(basename "$old_api_release")" == "${old_api_commit:0:12}" ]]
[[ "$(basename "$old_web_release")" == "${old_web_commit:0:12}" ]]

service_id() {
  sudo docker ps -q --filter label=com.docker.compose.project=masscom \
    --filter "label=com.docker.compose.service=$1"
}
api_id="$(service_id api)"
web_id="$(service_id production-web)"
caddy_id="$(service_id caddy)"
postgres_id="$(service_id postgres)"
for id in "$api_id" "$web_id" "$caddy_id" "$postgres_id"; do
  [[ -n "$id" && "$id" != *$'\n'* ]]
done
[[ "$(sudo docker inspect --format '{{.Config.Image}}' "$api_id")" == "masscom-api:${old_api_commit:0:12}" ]]
[[ "$(sudo docker inspect --format '{{.Config.Image}}' "$web_id")" == "masscom-production-web:${old_web_commit:0:12}" ]]
old_caddy_image="$(sudo docker inspect --format '{{.Config.Image}}' "$caddy_id")"
[[ "$old_caddy_image" == 'caddy:2.10.2-alpine' ]]
old_site_source="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/srv/masscom"}}{{.Source}}{{end}}{{end}}' "$caddy_id")"
old_caddyfile_source="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$caddy_id")"
[[ "$old_site_source" == "$old_web_release/site/public" ]]
[[ "$old_caddyfile_source" =~ ^/[A-Za-z0-9_./-]+$ ]]
sudo test -f "$old_caddyfile_source"
[[ "$(sudo docker inspect --format '{{if index .NetworkSettings.Networks "masscom_showcase_edge"}}true{{end}}' "$caddy_id")" == true ]]

sudo install -d -m 0700 /opt/masscom/backups
env_backup="$(sudo mktemp /opt/masscom/backups/runtime-before-$release_id.env.XXXXXX)"
sudo install -o root -g root -m 600 "$runtime_env" "$env_backup"
caddyfile_backup="$(sudo mktemp /opt/masscom/backups/caddyfile-before-$release_id.XXXXXX)"
sudo install -o root -g root -m 644 "$old_caddyfile_source" "$caddyfile_backup"
rollback_caddy_override="$(sudo mktemp /opt/masscom/backups/caddy-rollback-$release_id.yml.XXXXXX)"
sudo tee "$rollback_caddy_override" >/dev/null <<YAML
services:
  caddy:
    volumes:
      - type: bind
        source: $caddyfile_backup
        target: /etc/caddy/Caddyfile
        read_only: true
      - type: bind
        source: $old_site_source
        target: /srv/masscom
        read_only: true
YAML
db_backup="$(sudo mktemp /opt/masscom/backups/database-before-$release_id.dump.XXXXXX)"
sudo docker exec "$postgres_id" pg_dump --format=custom --no-owner -U masscom -d masscom \
  | sudo tee "$db_backup" >/dev/null
sudo test -s "$db_backup"
sudo cat "$db_backup" | sudo docker exec -i "$postgres_id" pg_restore --list >/dev/null

compose_new() {
  sudo env MASSCOM_IMAGE_TAG="$release_id" MASSCOM_WEB_IMAGE_TAG="$release_id" \
    docker compose -p masscom --env-file "$runtime_env" -f "$compose_file" "$@" </dev/null
}
compose_old() {
  sudo env MASSCOM_IMAGE_TAG="${old_api_commit:0:12}" MASSCOM_WEB_IMAGE_TAG="${old_web_commit:0:12}" \
    docker compose -p masscom --env-file "$runtime_env" \
    -f "$old_web_release/infra/lightsail/compose.yml" "$@" </dev/null
}
compose_old_caddy() {
  sudo env MASSCOM_IMAGE_TAG="${old_api_commit:0:12}" MASSCOM_WEB_IMAGE_TAG="${old_web_commit:0:12}" \
    docker compose -p masscom --env-file "$runtime_env" \
    -f "$compose_file" -f "$rollback_caddy_override" "$@" </dev/null
}
compose_no_stdin() {
  compose_new "$@" </dev/null
}
compose_old_caddy config --quiet
retry_health() {
  local attempt
  for attempt in {1..12}; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    if [[ "$attempt" != 12 ]]; then sleep 5; fi
  done
  return 1
}

# `set -E`에서는 명령 치환·함수가 ERR 트랩을 물려받는다. 값을 읽는 도우미가 `$(도우미)`로 불릴 때 실패하면 하위 셸 안에서 되돌림이 한 번 돌고
# (함수가 `return 1`로 돌려주는 것도 하위 셸에서는 실패한 명령이다) 부모가 다시 한 번 돌려 FULL_DEPLOY_REVERTED·Caddy 재생성이 두 번 나온다.
# 그래서 값을 읽는 곳은 `$(trap - ERR; 도우미 …)`로 하위 셸의 트랩을 먼저 끄고, 실패는 부모의 `… || { postgres_check_failed 이름; false; }`에서
# 한 번만 ERR를 건다. (트랩을 끄는 `trap - ERR`는 그 하위 셸에만 적용된다. 도우미를 `$(…)` 밖에서 직접 부르지 않는다.)
# PostgreSQL 컨테이너가 이 릴리스의 로그 설정(용량 순환 10m×3, 오류 로그에 행 값·SQL 문을 남기지 않는 서버 옵션)으로 떠 있는지 읽기만 해서 본다.
# 실행 중인 컨테이너는 compose 파일이 바뀌어도 다시 만들어지지 않으므로 배포가 직접 확인한다(Issue #253, D-059).
postgres_log_settings_ok() {
  (
    trap - ERR
    local id log_config command_line
    id="$(service_id postgres)" && [[ -n "$id" && "$id" != *$'\n'* ]] || exit 1
    log_config="$(sudo docker inspect --format '{{json .HostConfig.LogConfig.Config}}' "$id")" || exit 1
    command_line="$(sudo docker inspect --format '{{json .Config.Cmd}}' "$id")" || exit 1
    [[ "$log_config" == *'"max-size":"10m"'* && "$log_config" == *'"max-file":"3"'* &&
       "$command_line" == *'log_error_verbosity=terse'* && "$command_line" == *'log_min_error_statement=panic'* ]]
  ) || return 1
}
# 다시 만든 PostgreSQL이 **같은 데이터 볼륨**을 물고 **같은 데이터**를 갖는지 보는 값. 볼륨 이름과, 적용된 마이그레이션의 개수·마지막 파일 이름이다.
postgres_data_volume() {
  local id
  id="$(service_id postgres)" && [[ -n "$id" && "$id" != *$'\n'* ]] || return 1
  sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$id" || return 1
}
postgres_data_fingerprint() {
  compose_no_stdin exec -T postgres psql -U masscom -d masscom -Atc \
    "SELECT count(*) || '|' || coalesce(max(filename), '') FROM schema_migrations" || return 1
}
postgres_setting() {
  compose_no_stdin exec -T postgres psql -U masscom -d masscom -Atc "SHOW $1" || return 1
}
# 어느 확인이 어긋났는지 남기고(되돌림 로그에 이름이 보이게) 호출한 쪽이 `false`로 ERR 트랩을 한 번 건다.
postgres_check_failed() {
  echo "POSTGRES_DATA_CHECK_FAILED: $1" >&2
}
postgres_recreated=false

rollback_started=false
migration_started=false
rollback() {
  local code="${1:-1}" failed=false
  trap - ERR
  if [[ "$rollback_started" == true ]]; then
    sudo install -o root -g root -m 600 "$env_backup" "$runtime_env" || failed=true
    if [[ "$postgres_recreated" == true ]]; then
      # 이전 릴리스의 compose 정의로 PostgreSQL을 되돌린다(이 배포가 다시 만들었으므로 한 번 더 짧게 다시 뜬다).
      compose_old up -d --no-deps --wait --wait-timeout 120 postgres || failed=true
    fi
    compose_old up -d --no-deps --force-recreate --wait --wait-timeout 120 api production-web || failed=true
    compose_old_caddy up -d --no-deps --force-recreate caddy || failed=true
    sudo ln -sfn "$old_api_release" /opt/masscom/current || failed=true
    sudo ln -sfn "$old_web_release" /opt/masscom/web/current || failed=true
    printf '%s\n' "$old_api_commit" | sudo tee /opt/masscom/DEPLOYED_COMMIT >/dev/null || failed=true
    printf '%s\n' "$old_web_commit" | sudo tee /opt/masscom/web/DEPLOYED_COMMIT >/dev/null || failed=true
    compose_old exec -T api node -e \
      "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
      || failed=true
    compose_old exec -T production-web node -e \
      "fetch('http://127.0.0.1:4173/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
      || failed=true
    api_id="$(service_id api)" || failed=true
    web_id="$(service_id production-web)" || failed=true
    caddy_id="$(service_id caddy)" || failed=true
    [[ -n "$api_id" && "$(sudo docker inspect --format '{{.Config.Image}}' "$api_id")" == "masscom-api:${old_api_commit:0:12}" ]] || failed=true
    [[ -n "$web_id" && "$(sudo docker inspect --format '{{.Config.Image}}' "$web_id")" == "masscom-production-web:${old_web_commit:0:12}" ]] || failed=true
    [[ -n "$caddy_id" && "$(sudo docker inspect --format '{{.Config.Image}}' "$caddy_id")" == "$old_caddy_image" ]] || failed=true
    [[ -n "$caddy_id" && "$(sudo docker inspect --format '{{.State.Running}}' "$caddy_id")" == true ]] || failed=true
    [[ "$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/srv/masscom"}}{{.Source}}{{end}}{{end}}' "$caddy_id")" == "$old_site_source" ]] || failed=true
    [[ "$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$caddy_id")" == "$caddyfile_backup" ]] || failed=true
    [[ "$(sudo docker inspect --format '{{if index .NetworkSettings.Networks "masscom_showcase_edge"}}true{{end}}' "$caddy_id")" == true ]] || failed=true
    retry_health curl -fsS --max-time 8 https://api.masscom.kr/health || failed=true
    retry_health curl -fsS --max-time 8 https://www.masscom.kr/app/ || failed=true
    # 시연 API는 운영 릴리스의 되돌림 성공 조건이 아니다(Issue #263): 시연 장애가 겹쳐도 운영이 이전 릴리스로 돌아왔으면 되돌림은 성공이다.
    retry_health curl -fsS --max-time 8 https://demo-api.masscom.kr/health ||
      echo 'SHOWCASE_HEALTH_WARNING: the production rollback is complete but the showcase API (demo-api.masscom.kr) is not answering; check it separately' >&2
  fi
  if [[ "$migration_started" == true ]]; then
    echo "DB_MIGRATION_MANUAL_RECOVERY_REQUIRED: backup=$db_backup; inspect applied migrations before restoring data" >&2
  fi
  if [[ "$failed" == true ]]; then
    echo 'FULL_DEPLOY_ROLLBACK_FAILED: inspect env, services, pointers and markers before retrying' >&2
    exit 1
  fi
  echo 'FULL_DEPLOY_REVERTED: previous env, API, web, Caddy and markers restored' >&2
  exit "$code"
}

sudo docker run --rm \
  -v "$release/infra/lightsail/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null
rollback_started=true
trap 'rollback "$?"' ERR
sudo install -o root -g root -m 600 "$temporary_env" "$runtime_env"
rm -f "$temporary_env"
compose_new build api production-web
# 사전 백업이 검증된 뒤에만 PostgreSQL을 다시 만든다. 로그 설정이 이미 맞으면 건드리지 않는다.
# 아래 확인은 `… || { postgres_check_failed 이름; false; }`로 쓴다: 옛 bash(3.2)는 홑 `[[ ]]`의 실패로 ERR 트랩을 걸지 않고, 명령 치환 안의 실패가
# 트랩을 두 번(하위 셸과 부모) 돌리지 않게 하기 위해서다. `false`는 부모에서 한 번만 ERR를 건다.
if ! postgres_log_settings_ok; then
  # 다시 만들기 전에 볼륨 이름과 데이터 지문을 적어 둔다. 운영 DB는 마이그레이션이 하나 이상 적용돼 있어야 한다.
  data_volume_before="$(trap - ERR; postgres_data_volume)" || { postgres_check_failed baseline; false; }
  data_fingerprint_before="$(trap - ERR; postgres_data_fingerprint)" || { postgres_check_failed baseline; false; }
  [[ -n "$data_volume_before" && "$data_fingerprint_before" =~ ^[1-9][0-9]*\|[0-9]{4}_[a-z0-9_]+\.sql$ ]] || { postgres_check_failed baseline; false; }
  postgres_recreated=true
  compose_new up -d --no-deps --wait --wait-timeout 120 postgres
  postgres_log_settings_ok || { postgres_check_failed log_settings; false; }
  # 같은 볼륨이 붙어 있고 같은 데이터가 그대로 있어야 한다. 아니면 마이그레이션 없이 되돌린다(볼륨은 지우지 않는다).
  data_volume_after="$(trap - ERR; postgres_data_volume)" || { postgres_check_failed volume; false; }
  [[ "$data_volume_after" == "$data_volume_before" ]] || { postgres_check_failed volume; false; }
  data_fingerprint_after="$(trap - ERR; postgres_data_fingerprint)" || { postgres_check_failed fingerprint; false; }
  [[ "$data_fingerprint_after" == "$data_fingerprint_before" ]] || { postgres_check_failed fingerprint; false; }
  min_error_statement="$(trap - ERR; postgres_setting log_min_error_statement)" || { postgres_check_failed min_error_statement; false; }
  [[ "$min_error_statement" == panic ]] || { postgres_check_failed min_error_statement; false; }
  error_verbosity="$(trap - ERR; postgres_setting log_error_verbosity)" || { postgres_check_failed verbosity; false; }
  [[ "$error_verbosity" == terse ]] || { postgres_check_failed verbosity; false; }
  echo 'POSTGRES_RECREATED_FOR_LOG_SETTINGS'
fi
migration_started=true
compose_no_stdin run --rm -T migrate
compose_new up -d --no-deps --wait --wait-timeout 120 api production-web
compose_new up -d --no-deps caddy
compose_no_stdin exec -T api node -e \
  "fetch('http://127.0.0.1:3000/health').then(async r=>{if(!r.ok)throw new Error('HTTP '+r.status);const b=await r.json();if(b.status!=='ok')throw new Error('unexpected health payload')}).catch(e=>{console.error(e.message);process.exit(1)})"
compose_no_stdin exec -T production-web node -e \
  "fetch('http://127.0.0.1:4173/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
retry_health curl -fsS --max-time 8 https://api.masscom.kr/health
retry_health curl -fsS --max-time 8 https://www.masscom.kr/app/
retry_health curl -fsS --max-time 8 https://www.masscom.kr/merchant/

sudo ln -sfn "$release" /opt/masscom/current
printf '%s\n' "$commit" | sudo tee /opt/masscom/DEPLOYED_COMMIT >/dev/null
sudo install -d -m 0755 /opt/masscom/web
sudo ln -sfn "$release" /opt/masscom/web/current
printf '%s\n' "$commit" | sudo tee /opt/masscom/web/DEPLOYED_COMMIT >/dev/null
compose_new ps
trap - ERR

# 시연 API(demo-api) health는 운영 릴리스가 이미 올라간 뒤에 따로 본다(Issue #263, 점검 보고서 C02). 시연 장애는 운영 API를 이전 버전으로
# 되돌릴 이유가 아니다: 여기서 실패해도 운영은 새 릴리스로 두고(DEPLOYED_COMMIT도 새 커밋) 배포만 실패로 알린다. 아래 정리 작업 단계가
# 시연 장애 때문에 건너뛰어지지 않게, 실패는 기록만 하고 종료는 그 단계 뒤에 한다.
showcase_probe_failed=false
if ! retry_health curl -fsS --max-time 8 https://demo-api.masscom.kr/health; then
  showcase_probe_failed=true
  echo 'SHOWCASE_HEALTH_FAILED: production is live on the new release and was not rolled back; the same commit cannot be deployed again (RELEASE_ALREADY_EXISTS), so fix the showcase API (demo-api.masscom.kr) or Caddy by hand on the server, or ship a new commit' >&2
fi

# 보관 기간 정리 작업(하루 한 번, systemd timer)을 이 릴리스의 것으로 설치·갱신하고(멱등) timer가 켜져 있는지 읽기 전용으로 확인한다.
# 처리방침의 "서버의 정리 작업" 문장은 이 timer가 켜져 있어야 사실이다. 여기서 실패하면 릴리스는 이미 올라간 상태로 두고(되돌리지 않는다)
# 배포를 실패로 알린다: 서버에서 `sudo bash "$release/infra/lightsail/host-jobs/install.sh" --verify`로 원인을 보고 다시 실행한다.
# 설치한 작업을 바로 한 번 실행해(매일 작업과 같은 일) 마지막 결과가 success인지 확인한다: 켜져만 있고 실제로는 실패하는 작업을 배포가 통과시키지 않는다.
if ! sudo bash "$release/infra/lightsail/host-jobs/install.sh" ||
   [[ "$(sudo systemctl is-enabled masscom-retention.timer)" != enabled ]] ||
   ! sudo systemctl start masscom-retention.service ||
   [[ "$(sudo systemctl show -p Result --value masscom-retention.service)" != success ]]; then
  echo 'HOST_JOB_INSTALL_FAILED: release is live but the retention job is not enabled or its first run failed; check journalctl -u masscom-retention.service and run host-jobs/install.sh --verify on the server' >&2
  exit 1
fi
echo 'HOST_JOB_ENABLED masscom-retention.timer (first run: success)'
[[ "$showcase_probe_failed" == false ]] || exit 1
REMOTE

echo "Lightsail deployment completed: $commit"
