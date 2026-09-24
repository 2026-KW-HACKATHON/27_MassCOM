#!/usr/bin/env bash

# Sourced by the web-only remote deploy after compose_old/new and service_snapshot exist.
web_rollback() {
  local code="${1:-1}" rollback_failed='false'
  trap - ERR
  if [[ -n "${probe_id:-}" ]]; then
    sudo docker stop "$probe_id" >/dev/null || rollback_failed='true'
  fi
  if [[ "${web_change_started:-false}" == 'true' ]]; then
    if [[ -n "${previous_web_id:-}" ]]; then
      compose_old up -d --no-deps --force-recreate production-web || rollback_failed='true'
    else
      compose_new stop production-web || rollback_failed='true'
    fi
  fi
  if [[ "${changing_caddy:-false}" == 'true' ]]; then
    compose_old up -d --no-deps --force-recreate caddy || rollback_failed='true'
  fi
  if [[ "${web_change_started:-false}" == 'true' && -n "${previous_web_id:-}" ]]; then
    compose_old exec -T production-web node -e \
      "fetch('http://127.0.0.1:4173/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" \
      || rollback_failed='true'
  fi
  if [[ "${changing_caddy:-false}" == 'true' ]]; then
    local caddy_id
    caddy_id="$(service_id caddy)"
    [[ -n "$caddy_id" && "$(sudo docker inspect --format '{{.State.Running}}' "$caddy_id")" == 'true' ]] \
      || rollback_failed='true'
  fi
  [[ "$(service_snapshot api)" == "$api_before" ]] || rollback_failed='true'
  [[ "$(service_snapshot postgres)" == "$db_before" ]] || rollback_failed='true'
  curl -fsS --max-time 8 https://api.masscom.kr/health >/dev/null || rollback_failed='true'
  if [[ "$rollback_failed" == 'true' ]]; then
    echo 'WEB_ROLLBACK_FAILED: inspect web, Caddy, API and DB before retrying' >&2
    exit 1
  fi
  echo 'WEB_DEPLOY_REVERTED: previous web/Caddy restored; API and DB unchanged' >&2
  exit "$code"
}
