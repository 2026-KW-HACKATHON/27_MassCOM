#!/usr/bin/env bash

web_collection_probe_accepts() {
  case "$1" in
    401|404|503) ;;
    *) return 1 ;;
  esac
  [[ "$2" == application/json* && "$3" == *no-store* && "$3" != *public* ]]
}

web_collection_probe_response() {
  local response status content_type cache_control
  response="$(curl -sS -o /dev/null \
    -w '%{http_code}|%{content_type}|%header{cache-control}' \
    --max-time 8 "$1")" || return 1
  IFS='|' read -r status content_type cache_control <<< "$response"
  web_collection_probe_accepts "$status" "$content_type" "$cache_control"
}
