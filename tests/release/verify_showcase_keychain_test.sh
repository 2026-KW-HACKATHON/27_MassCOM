#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
helper="$repo_root/scripts/showcase-keychain-password.sh"
scratch="$(mktemp -d -t masscom-showcase-keychain.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT
mkdir "$scratch/bin"

printf '%s\n' \
  '#!/bin/sh' \
  '[ "$*" = "find-generic-password -s masscom-showcase-upload-keystore -a masscom-showcase-upload -w" ] || exit 11' \
  'case "$MOCK_KEYCHAIN_RESULT" in' \
  '  present) printf "fixture-secret\\n" ;;' \
  '  empty) : ;;' \
  '  fail) exit 1 ;;' \
  'esac' > "$scratch/bin/security"
chmod 700 "$scratch/bin/security"

result="$(PATH="$scratch/bin:$PATH" MOCK_KEYCHAIN_RESULT=present bash -e -c '
  source "$1"
  load_showcase_keychain_password
  [[ "$store_password" == fixture-secret && "$key_password" == fixture-secret ]]
' bash "$helper" 2>&1)" || {
  echo 'dedicated Keychain password could not be loaded' >&2
  exit 1
}
[[ -z "$result" ]] || { echo 'Keychain password appeared in output' >&2; exit 1; }

for mode in empty fail; do
  if PATH="$scratch/bin:$PATH" MOCK_KEYCHAIN_RESULT="$mode" bash -e -c '
    source "$1"
    load_showcase_keychain_password
  ' bash "$helper" >/dev/null 2>&1; then
    echo "Keychain $mode result was accepted" >&2
    exit 1
  fi
done

trace_status=0
trace_output="$(PATH="$scratch/bin:$PATH" MOCK_KEYCHAIN_RESULT=present bash -ex -c '
  source "$1"
  load_showcase_keychain_password
' bash "$helper" 2>&1)" || trace_status=$?
[[ "$trace_status" != 0 && "$trace_output" != *fixture-secret* ]] || {
  echo 'shell tracing could expose the showcase Keychain password' >&2
  exit 1
}

echo 'showcase Keychain password boundary verified'
