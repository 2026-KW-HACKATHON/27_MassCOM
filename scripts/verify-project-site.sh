#!/usr/bin/env bash

set -euo pipefail

repo_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
html="$repo_root/docs/index.html"
css="$repo_root/docs/assets/project.css"
legal_css="$repo_root/docs/assets/legal.css"
privacy_html="$repo_root/docs/privacy.html"
deletion_html="$repo_root/docs/account-deletion.html"
open_html="$repo_root/docs/open.html"
assetlinks_json="$repo_root/docs/.well-known/assetlinks.json"
vercel_config="$repo_root/docs/vercel.json"
readme="$repo_root/README.md"
script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
accessibility_checker="$script_root/check-site-accessibility.mjs"
node "$repo_root/scripts/verify-evidence-consistency.mjs" "$repo_root"

fail() {
  echo "project portal verification failed: $1" >&2
  exit 1
}

[[ -s "$html" ]] || fail "missing docs/index.html"
[[ -s "$css" ]] || fail "missing docs/assets/project.css"
[[ -s "$legal_css" ]] || fail "missing docs/assets/legal.css"
[[ -s "$privacy_html" ]] || fail "missing docs/privacy.html"
[[ -s "$deletion_html" ]] || fail "missing docs/account-deletion.html"
[[ -s "$open_html" ]] || fail "missing docs/open.html"
[[ -s "$assetlinks_json" ]] || fail "missing docs/.well-known/assetlinks.json"
[[ -s "$vercel_config" ]] || fail "missing docs/vercel.json"
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
grep -q 'href="privacy.html"' "$html" || fail "privacy policy is not linked"
grep -q 'href="account-deletion.html"' "$html" || fail "account deletion page is not linked"
grep -q 'android-v0.1.0-test.3' "$open_html" || fail "current operating Android release is not linked"
grep -q 'showcase-android-v0.1.0-preview.3' "$open_html" || fail "current showcase Android release is not linked"
if grep -Eq 'private GitHub|아직 GitHub에 APK가 없습니다' "$open_html"; then
  fail "public Android install page still describes private or unavailable releases"
fi
node -e "const x=JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8')); if(!Array.isArray(x)||x.length!==1||x[0]?.target?.package_name!=='kr.masscom.wolgye') process.exit(1)" "$assetlinks_json" \
  || fail "App Link association is invalid"
grep -q '외부 지갑 비밀번호, 개인키, 복구 문구' "$deletion_html" || fail "wallet secret warning is missing"
grep -q '"cleanUrls": true' "$vercel_config" || fail "Vercel clean URLs are not enabled"
grep -q 'docs/index.html' "$readme" || fail "README does not link to the project portal"
grep -q 'python3 -m http.server' "$readme" || fail "README does not explain how to preview the portal"

if grep -Eqi '<(script|img)[^>]+(src|href)="https?://' "$html" \
  || grep -Ei '<link[^>]+href="https?://' "$html" \
    | grep -Ev '^[[:space:]]*<link rel="canonical" href="https://www.masscom.kr/">[[:space:]]*$'; then
  fail "page loads an external script, image, or stylesheet"
fi

if grep -Eqi '(TODO|TBD|Lorem ipsum)' "$html" "$css"; then
  fail "page contains placeholder content"
fi

node "$accessibility_checker" "$html" "$css"

echo "project portal verified: structure, status labels, metadata, and local assets are valid"
