#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
container_id=''

cleanup() {
  if [[ -n "$container_id" ]]; then
    docker stop "$container_id" >/dev/null || true
  fi
}
trap cleanup EXIT

showcase_container_name() {
  printf 'masscom-showcase-host-test-%s-%s\n' "$$" "${1%.postgres.integration.ts}"
}

wait_for_postgres_ready() {
  local container="$1" ready='false'
  for _attempt in $(seq 1 30); do
    # The image first starts a Unix-socket-only server for init scripts, then restarts it.
    if docker exec "$container" pg_isready -h 127.0.0.1 \
      -U masscom_showcase -d masscom_showcase >/dev/null 2>&1; then
      ready='true'
      break
    fi
    sleep 1
  done
  [[ "$ready" == 'true' ]] || { echo 'disposable showcase PostgreSQL did not become ready' >&2; return 1; }
}

run_case() {
  local test_file="$1" case_container_name
  case_container_name="$(showcase_container_name "$test_file")"
  container_id="$(docker run --rm -d \
    --name "$case_container_name" \
    -e POSTGRES_DB=masscom_showcase \
    -e POSTGRES_USER=masscom_showcase \
    -e POSTGRES_HOST_AUTH_METHOD=trust \
    -p 127.0.0.1:55435:5432 \
    postgres:16.10-alpine)"

  wait_for_postgres_ready "$container_id"

  (
    cd "$repo_root/apps/api"
    TEST_SHOWCASE_HOST_DATABASE_URL='postgresql://masscom_showcase@127.0.0.1:55435/masscom_showcase' \
      ./node_modules/.bin/tsx --test "src/showcase/$test_file"
  )
  docker stop "$container_id" >/dev/null
  container_id=''
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  run_case host-seed-existing.postgres.integration.ts
  run_case host-seed.postgres.integration.ts
fi
