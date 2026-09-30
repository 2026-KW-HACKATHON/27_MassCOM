#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
verifier="$repo_root/scripts/verify-project-site.sh"

if [[ ! -x "$verifier" ]]; then
  echo "expected executable site verifier at $verifier" >&2
  exit 1
fi

"$verifier" "$repo_root"

for page in privacy.html terms.html account-deletion.html open.html; do
  [[ -s "$repo_root/docs/$page" ]] || {
    echo "project portal is missing $page" >&2
    exit 1
  }
  grep -q '월계 마스코트' "$repo_root/docs/$page"
done
grep -q 'href="privacy.html"' "$repo_root/docs/index.html"
grep -q 'href="account-deletion.html"' "$repo_root/docs/index.html"
grep -q 'href="terms.html"' "$repo_root/docs/index.html"
for entry in \
  'index.html|https://www.masscom.kr/' \
  'open.html|https://masscom.kr/open' \
  'privacy.html|https://www.masscom.kr/privacy' \
  'terms.html|https://www.masscom.kr/terms' \
  'account-deletion.html|https://www.masscom.kr/account-deletion'; do
  page="${entry%%|*}"
  canonical="${entry#*|}"
  grep -qF "rel=\"canonical\" href=\"$canonical\"" "$repo_root/docs/$page" || {
    echo "project portal canonical URL is missing: $page" >&2
    exit 1
  }
done
[[ -s "$repo_root/docs/assets/wallet-mark.svg" ]] || {
  echo 'project portal is missing the public wallet mark' >&2
  exit 1
}
grep -q 'href="https://masscom.kr/open"' "$repo_root/docs/index.html" || {
  echo 'project portal is missing the Android App Link entry' >&2
  exit 1
}
for file in README.md apps/showcase-web/README.md docs/ANDROID_DOWNLOADS.md; do
  grep -qF 'https://www.masscom.kr/preview/' "$repo_root/$file" || {
    echo "www preview link is missing: $file" >&2
    exit 1
  }
done
for file in README.md apps/production-web/README.md; do
  grep -qF 'https://www.masscom.kr/app/' "$repo_root/$file" || {
    echo "www operating web link is missing: $file" >&2
    exit 1
  }
done
for entry in 'app/|운영 웹 보기' 'preview/|시연 웹 보기'; do
  path="${entry%%|*}"
  label="${entry#*|}"
  grep -qF "href=\"https://www.masscom.kr/$path\">$label" "$repo_root/docs/index.html" || {
    echo "project portal is missing $label" >&2
    exit 1
  }
done
grep -q '"cleanUrls": true' "$repo_root/docs/vercel.json"
node - "$repo_root/docs/.well-known/assetlinks.json" <<'NODE'
const record = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
if (!Array.isArray(record) || record.length !== 1) throw new Error('expected one asset link');
const link = record[0];
if (link.relation?.[0] !== 'delegate_permission/common.handle_all_urls') {
  throw new Error('wrong App Link relation');
}
if (link.target?.namespace !== 'android_app' || link.target?.package_name !== 'kr.masscom.wolgye') {
  throw new Error('wrong App Link Android target');
}
const fingerprints = link.target?.sha256_cert_fingerprints;
if (JSON.stringify(fingerprints) !== JSON.stringify([
  '5E:5E:D3:C3:19:71:E5:A8:8E:A7:52:B3:A2:AE:50:77:2F:EA:1C:95:6B:9D:97:A8:2D:D5:CA:71:30:CF:A3:95',
])) throw new Error('wrong App Link certificate fingerprint');
NODE
grep -qF 'android-v0.1.0-test.5' "$repo_root/docs/open.html"
grep -qF 'showcase-android-v0.1.0-preview.3' "$repo_root/docs/open.html"
grep -qF 'showcase-android-v0.1.0-preview.14' "$repo_root/docs/open.html"
grep -qF '새 시연 API에서는 이 버전의 직원 발급 요청이 호환되지 않으므로' "$repo_root/docs/open.html"
# `! grep` does not trip `set -e`, so the forbidden-text guards fail explicitly.
if grep -Eq 'private GitHub|아직 GitHub에 APK가 없습니다|최신[^<]{0,30}Preview ([4-9]|1[0-3])([^0-9]|$)|운영 test\.[0-4]([^0-9]|$)' "$repo_root/docs/open.html"; then
  echo 'open.html still has stale latest-preview or private-release wording' >&2
  exit 1
fi
if grep -Eq 'showcase-android-v0.1.0-preview\.([4-9]|1[0-3])([^0-9]|$)' "$repo_root/docs/open.html"; then
  echo 'open.html still links a previous showcase Preview 4 to 13' >&2
  exit 1
fi
if grep -Eq 'android-v0.1.0-test\.[0-4]([^0-9]|$)' "$repo_root/docs/open.html"; then
  echo 'open.html still links a previous operating test.0 to test.4' >&2
  exit 1
fi

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
sed 's#<link rel="canonical" href="https://www.masscom.kr/">#<link rel="stylesheet" href="https://example.com/evil.css">#' \
  "$repo_root/docs/index.html" > "$fixture_root/docs/index.html"
status=0
out="$("$verifier" "$fixture_root" 2>&1)" || status=$?
if [[ "$status" == 0 ]]; then
  echo "site verifier accepted an external stylesheet" >&2
  exit 1
fi
grep -qF 'project portal verification failed: page loads an external script, image, or stylesheet' <<<"$out" || {
  echo "external stylesheet fixture failed for an unrelated reason: $out" >&2
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
