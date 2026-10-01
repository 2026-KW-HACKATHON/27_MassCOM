#!/usr/bin/env bash
# #295 로컬 QA 한 번에 띄우기: 임시 PostgreSQL + 시연 seed(가상 점포·사진 수집품) + API(DEMO 헤더 허용) + Metro(dev-client)를
# 한 명령으로 띄우고, 다시 한 명령으로 정리한다. 운영 DB·운영 서버에는 절대 연결하지 않는다(모두 127.0.0.1 전용).
#
# Usage: scripts/qa-local.sh [up|down]   (기본은 up)
#   up   임시 postgres:16.10-alpine 컨테이너를 띄우고 masscom_showcase_test를 만들어 migration·시연 seed·QA용
#        사진 수집품을 넣은 뒤, 그 DB로 API를 127.0.0.1:3000에 ALLOW_INSECURE_DEMO_ACCOUNT=true로 띄우고
#        /health가 답할 때까지 기다린다. 이어서 apps/mobile/.env.local을 백업하고 Android 에뮬레이터(10.0.2.2)를
#        가리키는 값으로 바꿔 Metro(dev-client)를 띄운다.
#   down API·Metro를 끝내고 컨테이너를 지운 뒤 apps/mobile/.env.local을 백업에서 되돌린다(백업이 없었으면 지운다).
#
# 비밀(HMAC 시크릿)은 매번 openssl rand -hex 32로 새로 만들어 API 프로세스 환경에만 넘기고 어디에도 적거나
# 화면에 찍지 않는다. .env.local 백업은 .tmp/qa-local/(저장소 전용, git 추적 밖)에 둔다.
#
# ponytail: 한 번에 한 세션만 가정한다(컨테이너 이름·포트·PID 파일이 고정), 동시에 두 세션을 띄우려면
# 컨테이너 이름·포트·state 디렉터리를 세션별로 받게 넓혀야 한다.

set -euo pipefail

cmd="${1:-up}"
if [[ "$cmd" != "up" && "$cmd" != "down" ]]; then
  echo "usage: $0 [up|down]" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="$repo_root/.tmp/qa-local"
mkdir -p "$state_dir"

pg_container=masscom-qa-pg
pg_port=55432
db_name=masscom_showcase_test
db_url="postgresql://postgres@127.0.0.1:${pg_port}/${db_name}"
api_pid_file="$state_dir/api.pid"
metro_pid_file="$state_dir/metro.pid"
env_backup="$state_dir/mobile.env.local.bak"
mobile_env="$repo_root/apps/mobile/.env.local"
api_log="$state_dir/api.log"
metro_log="$state_dir/metro.log"
tmpdir_short="$state_dir/tmp"

stop_pid_file() {
  # $1: pid file. Stale PIDs (process already gone) and missing files are not errors.
  if [[ -f "$1" ]]; then
    local pid
    pid="$(cat "$1")"
    if [[ -n "$pid" ]]; then kill "$pid" >/dev/null 2>&1 || true; fi
    rm -f "$1"
  fi
}

restore_mobile_env() {
  # 백업이 있으면 복사 뒤 cmp로 바이트까지 같은지 확인하고서만 백업을 지운다(다르면 백업을 남겨 둔다).
  # 백업이 없다면 up이 새로 만든 파일이라는 뜻이라 지운다. 둘 다 없으면 할 일이 없다.
  if [[ -f "$env_backup" ]]; then
    cp -p "$env_backup" "$mobile_env"
    if cmp -s "$env_backup" "$mobile_env"; then
      rm -f "$env_backup"
    else
      echo "qa-local: restored .env.local did not match the backup; backup kept at $env_backup" >&2
      return 1
    fi
  elif [[ -f "$mobile_env" ]]; then
    rm -f "$mobile_env"
  fi
  return 0
}

down() {
  local status=0
  stop_pid_file "$metro_pid_file"
  stop_pid_file "$api_pid_file"
  docker rm -f "$pg_container" >/dev/null 2>&1 || true
  restore_mobile_env || status=1
  rm -rf "$tmpdir_short"
  echo "qa-local: down"
  return "$status"
}

if [[ "$cmd" == "down" ]]; then
  down
  exit $?
fi

# --- up ---
trap 'echo "qa-local: up failed; cleaning up" >&2; down || true' ERR INT TERM

if docker ps -a --format '{{.Names}}' | grep -qx "$pg_container"; then
  echo "qa-local: $pg_container already exists; run '$0 down' first" >&2
  exit 1
fi
if [[ -f "$env_backup" ]]; then
  echo "qa-local: a stale .env.local backup already exists at $env_backup; run '$0 down' first" >&2
  exit 1
fi

echo "qa-local: starting postgres ($pg_container on 127.0.0.1:$pg_port)"
docker run -d --name "$pg_container" -p "127.0.0.1:${pg_port}:5432" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB="$db_name" \
  postgres:16.10-alpine >/dev/null

ready=0
for _ in $(seq 1 30); do
  if docker exec "$pg_container" pg_isready -U postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo "qa-local: postgres never became ready" >&2
  exit 1
fi
echo "qa-local: postgres ready"

echo "qa-local: migrating and seeding showcase fixtures (demo stores)"
(cd "$repo_root/apps/api" && SHOWCASE_TEST_DATABASE_URL="$db_url" npm run --silent seed:showcase:local)
echo "qa-local: seeding a published photo collectible for QA"
(cd "$repo_root/apps/api" && SHOWCASE_TEST_DATABASE_URL="$db_url" npm run --silent seed:showcase:qa-collectible)

echo "qa-local: starting API on 127.0.0.1:3000"
(
  cd "$repo_root/apps/api"
  DATABASE_URL="$db_url" \
  ALLOW_INSECURE_DEMO_ACCOUNT=true \
  API_BIND_HOST=127.0.0.1 \
  PORT=3000 \
  ACCOUNT_DELETION_HMAC_SECRET="$(openssl rand -hex 32)" \
  MERCHANT_REFERENCE_HMAC_SECRET="$(openssl rand -hex 32)" \
  npx tsx src/server.ts >"$api_log" 2>&1 &
  echo $! > "$api_pid_file"
)

health_ok=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    health_ok=1
    break
  fi
  sleep 1
done
if [[ "$health_ok" != 1 ]]; then
  echo "qa-local: API /health never answered; see $api_log" >&2
  exit 1
fi
echo "qa-local: API healthy (http://127.0.0.1:3000, log: $api_log)"

echo "qa-local: preparing Metro .env.local (Android emulator: 10.0.2.2)"
if [[ -f "$mobile_env" ]]; then
  cp -p "$mobile_env" "$env_backup"
fi
cat >"$mobile_env" <<ENVEOF
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
EXPO_PUBLIC_DEMO_ACCOUNT_ID=showcase-local-customer
EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID=showcase-local-staff
EXPO_PUBLIC_DEMO_MERCHANT_ID=showcase-local-merchant
EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION=true
ENVEOF

mkdir -p "$tmpdir_short"
echo "qa-local: starting Metro (dev-client, APP_VARIANT=development)"
(
  cd "$repo_root/apps/mobile"
  TMPDIR="$tmpdir_short" APP_VARIANT=development npx expo start --dev-client >"$metro_log" 2>&1 &
  echo $! > "$metro_pid_file"
)

trap - ERR INT TERM
echo "qa-local: up. API http://127.0.0.1:3000 (log: $api_log), Metro log: $metro_log"
echo "qa-local: run '$0 down' to stop everything and restore apps/mobile/.env.local"
