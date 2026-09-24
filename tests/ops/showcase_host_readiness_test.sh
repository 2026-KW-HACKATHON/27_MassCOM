#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
source "$repo_root/tests/ops/run_showcase_host_postgres.sh"

calls=0
docker() {
  case "$*" in
    'exec fixture pg_isready -h 127.0.0.1 -U masscom_showcase -d masscom_showcase')
      calls=$((calls + 1))
      [[ "$calls" -ge 3 ]]
      ;;
    'exec fixture pg_isready -U masscom_showcase -d masscom_showcase')
      calls=$((calls + 1))
      return 0
      ;;
    *) echo "unexpected docker call: $*" >&2; return 1 ;;
  esac
}
sleep() { :; }

wait_for_postgres_ready fixture
[[ "$calls" -eq 3 ]] || {
  echo "temporary Unix-socket server was mistaken for final TCP readiness: $calls check(s)" >&2
  exit 1
}

echo 'showcase PostgreSQL waits for final TCP server'
