#!/usr/bin/env bash

web_collection_probe_accepts() {
  case "$1" in
    401|404|503) ;;
    *) return 1 ;;
  esac
  [[ "$2" == application/json* && "$3" == *no-store* && "$3" != *public* ]]
}
