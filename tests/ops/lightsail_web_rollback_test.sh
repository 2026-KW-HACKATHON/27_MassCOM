#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
library="$repo_root/scripts/lightsail-web-rollback.sh"
[[ -f "$library" ]] || { echo 'rollback library is missing' >&2; exit 1; }
scratch="$(mktemp -d -t masscom-web-rollback-test.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT

run_case() {
  local prior_web="$1" web_started="$2" caddy_started="$3" fail_restore="$4" active_probe="${5:-}"
  local log="$scratch/actions" output="$scratch/output" status=0
  : > "$log"
  (
    source "$library"
    previous_web_id="$prior_web"
    web_change_started="$web_started"
    changing_caddy="$caddy_started"
    probe_id="$active_probe"
    api_before='api-stable'
    db_before='db-stable'
    compose_old() {
      printf 'old:%s\n' "$*" >> "$log"
      [[ "$fail_restore" != 'true' ]]
    }
    compose_new() { printf 'new:%s\n' "$*" >> "$log"; }
    service_snapshot() {
      if [[ "$1" == 'api' ]]; then echo 'api-stable'; else echo 'db-stable'; fi
    }
    service_id() { echo 'caddy-stable'; }
    curl() { return 0; }
    sudo() {
      printf 'sudo:%s\n' "$*" >> "$log"
      if [[ "$*" == 'docker inspect --format {{.State.Running}} caddy-stable' ]]; then echo 'true'; fi
    }
    web_rollback 73
  ) > "$output" 2>&1 || status=$?
  printf '%s\n' "$status"
}

[[ "$(run_case prior-web false false false)" == '73' ]]
[[ ! -s "$scratch/actions" ]]

[[ "$(run_case prior-web true false false)" == '73' ]]
[[ "$(sed -n '1p' "$scratch/actions")" == 'old:up -d --no-deps --force-recreate production-web' ]]
[[ "$(wc -l < "$scratch/actions" | tr -d ' ')" == '2' ]]
grep -q '^old:exec -T production-web' "$scratch/actions"

[[ "$(run_case prior-web true false false probe-id)" == '73' ]]
[[ "$(sed -n '1p' "$scratch/actions")" == 'sudo:docker stop probe-id' ]]
[[ "$(sed -n '2p' "$scratch/actions")" == 'old:up -d --no-deps --force-recreate production-web' ]]

[[ "$(run_case prior-web true true false)" == '73' ]]
[[ "$(sed -n '1p' "$scratch/actions")" == 'old:up -d --no-deps --force-recreate production-web' ]]
[[ "$(sed -n '2p' "$scratch/actions")" == 'old:up -d --no-deps --force-recreate caddy' ]]
grep -q '^old:exec -T production-web' "$scratch/actions"
grep -q 'WEB_DEPLOY_REVERTED' "$scratch/output"

[[ "$(run_case '' true true false)" == '73' ]]
[[ "$(sed -n '1p' "$scratch/actions")" == 'new:stop production-web' ]]
[[ "$(sed -n '2p' "$scratch/actions")" == 'old:up -d --no-deps --force-recreate caddy' ]]

[[ "$(run_case prior-web true true true)" == '1' ]]
grep -q 'WEB_ROLLBACK_FAILED' "$scratch/output"

echo 'Lightsail web rollback control flow verified'
