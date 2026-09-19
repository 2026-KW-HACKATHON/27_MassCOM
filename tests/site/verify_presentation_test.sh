#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/scripts/verify-presentation.sh"

if [[ ! -x "$verifier" ]]; then
  echo "expected executable presentation verifier at $verifier" >&2
  exit 1
fi

"$verifier" "$repo_root"
node "$repo_root/scripts/check-site-accessibility.mjs" \
  "$repo_root/docs/presentation.html" \
  "$repo_root/docs/assets/presentation.css"

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT
mkdir -p "$fixture_root/docs/assets" "$fixture_root/docs/evidence"
cp "$repo_root/docs/presentation.html" "$fixture_root/docs/presentation.html"
cp "$repo_root/docs/index.html" "$fixture_root/docs/index.html"
cp "$repo_root/docs/assets/presentation.css" "$fixture_root/docs/assets/presentation.css"
cp "$repo_root/docs/SUBMISSION_EVIDENCE.json" "$fixture_root/docs/SUBMISSION_EVIDENCE.json"
cp "$repo_root/docs/TEST_STATUS.md" "$fixture_root/docs/TEST_STATUS.md"

sed '/data-evidence-state="NOT_RUN"/d' "$repo_root/docs/presentation.html" \
  > "$fixture_root/docs/presentation.html"
if "$verifier" "$fixture_root" >/dev/null 2>&1; then
  echo "presentation verifier accepted a page that hid NOT_RUN evidence" >&2
  exit 1
fi

echo "presentation regression tests passed"
