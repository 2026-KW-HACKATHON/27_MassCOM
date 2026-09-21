#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="$repo_root/scripts/check-accessibility-semantics.mjs"
[[ -f "$checker" ]] || { echo "missing accessibility semantics checker" >&2; exit 1; }

node "$checker" "$repo_root/apps/mobile/src"

fixture="$(mktemp -d -t accessibility-semantics.XXXXXX)"
trap 'rm -rf "$fixture"' EXIT
cp -R "$repo_root/apps/mobile/src/screens" "$fixture/screens"
sed -i.bak 's/accessibilityLiveRegion="polite"//' "$fixture/screens/auth-required/index.tsx"
if node "$checker" "$fixture" >/dev/null 2>&1; then
  echo 'accessibility checker accepted a missing live region' >&2
  exit 1
fi

echo 'mobile accessibility semantics tests passed'
