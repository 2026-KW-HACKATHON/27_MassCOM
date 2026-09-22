#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/scripts/verify-project-site.sh"

if [[ ! -x "$verifier" ]]; then
  echo "expected executable site verifier at $verifier" >&2
  exit 1
fi

"$verifier" "$repo_root"

for page in privacy.html account-deletion.html; do
  [[ -s "$repo_root/docs/$page" ]] || {
    echo "project portal is missing $page" >&2
    exit 1
  }
  grep -q '월계 마스코트' "$repo_root/docs/$page"
done
grep -q 'href="privacy.html"' "$repo_root/docs/index.html"
grep -q 'href="account-deletion.html"' "$repo_root/docs/index.html"
grep -q '"cleanUrls": true' "$repo_root/docs/vercel.json"

fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

cp -R "$repo_root/docs" "$fixture_root/docs"
mkdir -p "$fixture_root/scripts" "$fixture_root/tests/catalog"
cp "$repo_root/README.md" "$fixture_root/README.md"
cp "$repo_root/scripts/verify-evidence-consistency.mjs" "$fixture_root/scripts/verify-evidence-consistency.mjs"
cp "$repo_root/scripts/check-site-accessibility.mjs" "$fixture_root/scripts/check-site-accessibility.mjs"
cp "$repo_root/tests/catalog/required-tests.tsv" "$fixture_root/tests/catalog/required-tests.tsv"

sed -e 's/<main /<div /' -e 's#</main>#</div>#' \
  "$repo_root/docs/index.html" > "$fixture_root/docs/index.html"

status=0
out="$("$verifier" "$fixture_root" 2>&1)" || status=$?
if [[ "$status" == 0 ]]; then
  echo "site verifier accepted a page without its main content" >&2
  exit 1
fi
grep -qF 'project portal verification failed: main content landmark is missing' <<<"$out" || {
  echo "missing-main fixture failed for an unrelated reason: $out" >&2
  exit 1
}

cp "$repo_root/docs/index.html" "$fixture_root/docs/index.html"
sed '/docs\/index.html/d' "$repo_root/README.md" > "$fixture_root/README.md"

status=0
out="$("$verifier" "$fixture_root" 2>&1)" || status=$?
if [[ "$status" == 0 ]]; then
  echo "site verifier accepted a README without the portal entry point" >&2
  exit 1
fi
grep -qF 'project portal verification failed: README does not link to the project portal' <<<"$out" || {
  echo "missing-README-link fixture failed for an unrelated reason: $out" >&2
  exit 1
}

echo "project portal regression tests passed"
