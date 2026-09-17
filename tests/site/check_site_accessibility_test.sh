#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="$repo_root/scripts/check-site-accessibility.mjs"

if [[ ! -f "$checker" ]]; then
  echo "expected accessibility checker at $checker" >&2
  exit 1
fi

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

printf '%s\n' \
  '<!DOCTYPE html>' \
  '<html lang="ko"><head><meta charset="utf-8"></head>' \
  '<body><main><div role="group" aria-label="상태">확인</div></main></body></html>' \
  > "$fixture_root/index.html"

printf '%s\n' \
  ':root {' \
  '  --night: #12303d;' \
  '  --text-on-night: #d9ecff;' \
  '  --paper: #f4f9fa;' \
  '  --ink: #102833;' \
  '}' \
  > "$fixture_root/site.css"

node "$checker" "$fixture_root/index.html" "$fixture_root/site.css"

sed 's/#d9ecff/#526a73/' "$fixture_root/site.css" > "$fixture_root/low-contrast.css"

if node "$checker" "$fixture_root/index.html" "$fixture_root/low-contrast.css" >/dev/null 2>&1; then
  echo "accessibility checker accepted low-contrast text" >&2
  exit 1
fi

sed 's/ role="group"//' "$fixture_root/index.html" > "$fixture_root/unnamed-generic.html"

if node "$checker" "$fixture_root/unnamed-generic.html" "$fixture_root/site.css" >/dev/null 2>&1; then
  echo "accessibility checker accepted aria-label on a generic div" >&2
  exit 1
fi

echo "site accessibility regression tests passed"
