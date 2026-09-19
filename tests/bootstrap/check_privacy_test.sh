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
  "throw new Error('ACCOUNT_REQUIRED')" \
  > "$fixture_root/apps/api/src/safe.ts"
printf '%s\n' '{"dependencies":{}}' > "$fixture_root/apps/mobile/package.json"
"$scanner" "$fixture_root"

printf '%s\n' 'console.error("request failed", { accountId, token, signature });' \
  > "$fixture_root/apps/api/src/leaking-log.ts"
if "$scanner" "$fixture_root" >/dev/null 2>&1; then
  echo "privacy scanner accepted sensitive log arguments" >&2
  exit 1
fi

rm "$fixture_root/apps/api/src/leaking-log.ts"
printf '%s\n' '{"dependencies":{"@react-native-firebase/analytics":"1.0.0"}}' \
  > "$fixture_root/apps/mobile/package.json"
if "$scanner" "$fixture_root" >/dev/null 2>&1; then
  echo "privacy scanner accepted an unreviewed analytics SDK" >&2
  exit 1
fi

echo "privacy scanning regression tests passed"
