#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scanner="$repo_root/scripts/check-privacy.sh"

if [[ ! -x "$scanner" ]]; then
  echo "expected executable privacy scanner at $scanner" >&2
  exit 1
fi

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT
mkdir -p "$fixture_root/apps/api/src" "$fixture_root/apps/mobile"

printf '%s\n' \
  "console.log('worker started')" \
  "console.error('wallet signature verification failed')" \
  "console.error('request failed, signature unavailable')" \
  'console.error(`request failed, signature unavailable`)' \
  "throw new Error('ACCOUNT_REQUIRED')" \
  "console.error(safeErrorMetadata('wallet.verify.failed', error))" \
  "console.error(safeErrorMetadata('wallet.verify.failed', error, new Set(['SIGNER_MISMATCH'])))" \
  "console.error({ event: 'wallet.verify.failed', errorName: 'Error', errorCode: 'SIGNER_MISMATCH' })" \
  "// console.error('request failed', error)" \
  "/*" \
  "console.error('request failed', { detail: error.message })" \
  'console.error(`request failed: ${body.signature}`)' \
  "*/" \
  > "$fixture_root/apps/api/src/safe.ts"
printf '%s\n' '{"dependencies":{}}' > "$fixture_root/apps/mobile/package.json"
"$scanner" "$fixture_root"

unsafe_logs=(
  "console.error('request failed', error)"
  "console.error('request failed', { message: error.message })"
  "console.error('request failed', { stack: error.stack })"
  "console.error('request failed', { cause: error.cause })"
  "console.error('request failed', { signature: body.signature })"
  $'console.error(\n  \'request failed\',\n  error,\n)'
  "console.error('request failed', { message })"
  "console.error('request failed', { detail: error.message })"
  'console.error(`request failed: ${body.signature}`)'
  "console.error('request failed: ' + body.signature)"
  "console.error(signature)"
  "console.error(body.signature)"
  "console.error('request failed', signature)"
  "console.error('request failed', body.signature)"
  "console.error({ detail: error })"
  "console.error({ detail: caught })"
  "console.error({ detail: signature })"
)

for unsafe_log in "${unsafe_logs[@]}"; do
  printf '%s\n' "$unsafe_log" > "$fixture_root/apps/api/src/leaking-log.ts"
  if "$scanner" "$fixture_root" >/dev/null 2>&1; then
    echo "privacy scanner accepted unsafe error projection: $unsafe_log" >&2
    exit 1
  fi
done

rm "$fixture_root/apps/api/src/leaking-log.ts"
global_unsafe_logs=(
  "console.error({ detail: secret })"
  "console.error({ detail: body.password })"
)

for unsafe_log in "${global_unsafe_logs[@]}"; do
  printf '%s\n' "$unsafe_log" > "$fixture_root/apps/mobile/leaking-log.ts"
  if "$scanner" "$fixture_root" >/dev/null 2>&1; then
    echo "privacy scanner accepted a credential log outside the API: $unsafe_log" >&2
    exit 1
  fi
done

rm "$fixture_root/apps/mobile/leaking-log.ts"
printf '%s\n' '{"dependencies":{"@react-native-firebase/analytics":"1.0.0"}}' \
  > "$fixture_root/apps/mobile/package.json"
if "$scanner" "$fixture_root" >/dev/null 2>&1; then
  echo "privacy scanner accepted an unreviewed analytics SDK" >&2
  exit 1
fi

echo "privacy scanning regression tests passed"
