#!/usr/bin/env bash

web_collection_probe_accepts() {
  case "$1" in
    401|404|503) ;;
    *) return 1 ;;
  esac
  [[ "$2" == application/json* && "$3" == *no-store* && "$3" != *public* ]]
}

web_collection_probe_response() {
  local probe_host="${2:?web collection probe host is required}"
  local response status content_type cache_control
  response="$(curl -sS -o /dev/null -H "Host: $probe_host" \
    -w '%{http_code}|%{content_type}|%header{cache-control}' \
    --max-time 8 "$1")" || return 1
  IFS='|' read -r status content_type cache_control <<< "$response"
  web_collection_probe_accepts "$status" "$content_type" "$cache_control"
}

# 로그인하지 않은 `/api/web/consent`는 후보 Caddy를 거쳐 운영 API에서 401이어야 한다(Issue #253). 404는 API에 경로가 없거나
# Caddy가 경로를 넘기지 않는다는 뜻이고(옛 API, 빠진 라우트), 503은 웹 로그인이 꺼진 API라 동의 화면이 동작하지 않으므로 둘 다 거절한다.
web_consent_probe_accepts() {
  [[ "$1" == 401 && "$2" == application/json* && "$3" == *no-store* && "$3" != *public* ]]
}

web_consent_probe_response() {
  local probe_host="${2:?web consent probe host is required}"
  local response status content_type cache_control
  response="$(curl -sS -o /dev/null -H "Host: $probe_host" \
    -w '%{http_code}|%{content_type}|%header{cache-control}' \
    --max-time 8 "$1")" || return 1
  IFS='|' read -r status content_type cache_control <<< "$response"
  web_consent_probe_accepts "$status" "$content_type" "$cache_control"
}

# grep -q stops reading at its first match; under pipefail a curl that is still writing then
# fails with exit 23 and the deploy rolls back for no reason. Read the whole page first.
web_page_contains() {
  local body
  body="$(curl -fsS --max-time 8 "$1")" || return 1
  grep -qF -- "$2" <<< "$body"
}
