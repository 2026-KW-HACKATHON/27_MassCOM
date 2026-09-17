#!/usr/bin/env bash

set -euo pipefail

repo_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
html="$repo_root/docs/index.html"
css="$repo_root/docs/assets/project.css"
readme="$repo_root/README.md"
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
accessibility_checker="$script_root/check-site-accessibility.mjs"

fail() {
  echo "project portal verification failed: $1" >&2
  exit 1
}

[[ -s "$html" ]] || fail "missing docs/index.html"
[[ -s "$css" ]] || fail "missing docs/assets/project.css"
[[ -s "$readme" ]] || fail "missing README.md"
[[ -s "$accessibility_checker" ]] || fail "missing accessibility checker"

grep -q '<html lang="ko"' "$html" || fail "page language is not Korean"
grep -q 'name="viewport"' "$html" || fail "viewport metadata is missing"
grep -q 'name="description"' "$html" || fail "description metadata is missing"
grep -q 'rel="icon"' "$html" || fail "favicon is missing"
grep -q '<main ' "$html" || fail "main content landmark is missing"
grep -q 'aria-label="주요 메뉴"' "$html" || fail "primary navigation label is missing"

for section_id in overview flow architecture evidence evaluation decisions documents; do
  grep -q "id=\"$section_id\"" "$html" || fail "missing section $section_id"
done

for status in PLANNED IN_PROGRESS IMPLEMENTED VERIFIED BLOCKED NOT_RUN; do
  grep -q "$status" "$html" || fail "missing honest status label $status"
done

grep -q 'assets/project.css' "$html" || fail "local stylesheet is not linked"
grep -q 'docs/index.html' "$readme" || fail "README does not link to the project portal"
grep -q 'python3 -m http.server' "$readme" || fail "README does not explain how to preview the portal"

if grep -Eqi '<(script|img|link)[^>]+(src|href)="https?://' "$html"; then
  fail "page loads an external script, image, or stylesheet"
fi

if grep -Eqi '(TODO|TBD|Lorem ipsum)' "$html" "$css"; then
  fail "page contains placeholder content"
fi

node "$accessibility_checker" "$html" "$css"

echo "project portal verified: structure, status labels, metadata, and local assets are valid"
