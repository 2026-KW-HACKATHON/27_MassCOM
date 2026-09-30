#!/usr/bin/env bash
# Issue #273: the JS bundle inside an APK/AAB must carry only its own API origin. Uses small fake
# zips with crafted bundles; no Android build, network or signing key is involved.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
check="$repo_root/scripts/check-embedded-api.sh"
work="$(mktemp -d -t masscom-embedded-api-test.XXXXXX)"
trap 'rm -rf "$work"' EXIT

prod=https://api.masscom.kr
demo=https://demo-api.masscom.kr
fail() { echo "$*" >&2; exit 1; }

make_artifact() { # <file name> <zip entry> <bundle file>
  local stage="$work/stage-$1"
  rm -rf "$stage"
  mkdir -p "$stage/$(dirname "$2")"
  cp "$3" "$stage/$2"
  printf 'other entry\n' >"$stage/payload.txt"
  (cd "$stage" && zip -q -r "$work/$1" .)
}
make_bundle() { # <name> <printf format with optional binary escapes>
  printf "$2" >"$work/$1.bundle"
}

# Hermes bytecode is binary: origins sit between NUL and high bytes, with strings packed back to back.
make_bundle prod-only "\x00\x01\xc3HBC\x00$prod\x00\xffmerchants\x00"
make_bundle demo-only "\x00\x01\xc3HBC\x00$demo\x00\xffmerchants\x00"
make_bundle both "\x00$prod\x00\xff$demo\x00"
make_bundle neither "\x00\x01\xc3HBC\x00https://example.test\x00"
make_bundle packed "\x00\xc3${prod}merchants\x00"
make_bundle insecure-prod "\x00http://api.masscom.kr\x00"
make_bundle longer-host "\x00$demo\x00https://api.masscom.kr.example.test\x00"

make_artifact showcase.apk assets/index.android.bundle "$work/demo-only.bundle"
make_artifact showcase.aab base/assets/index.android.bundle "$work/demo-only.bundle"
make_artifact operating.aab base/assets/index.android.bundle "$work/prod-only.bundle"
make_artifact swapped-showcase.apk assets/index.android.bundle "$work/prod-only.bundle"
make_artifact swapped-showcase.aab base/assets/index.android.bundle "$work/prod-only.bundle"
make_artifact swapped-operating.aab base/assets/index.android.bundle "$work/demo-only.bundle"
make_artifact both-showcase.apk assets/index.android.bundle "$work/both.bundle"
make_artifact both-operating.aab base/assets/index.android.bundle "$work/both.bundle"
make_artifact neither.apk assets/index.android.bundle "$work/neither.bundle"
make_artifact neither.aab base/assets/index.android.bundle "$work/neither.bundle"
make_artifact packed-operating.aab base/assets/index.android.bundle "$work/packed.bundle"
make_artifact insecure-operating.aab base/assets/index.android.bundle "$work/insecure-prod.bundle"
make_artifact longer-host-showcase.apk assets/index.android.bundle "$work/longer-host.bundle"
make_artifact no-bundle.apk assets/other.bin "$work/demo-only.bundle"
make_artifact misplaced.aab assets/index.android.bundle "$work/prod-only.bundle"
: >"$work/empty.bundle"
make_artifact empty-bundle.apk assets/index.android.bundle "$work/empty.bundle"
printf 'not a zip\n' >"$work/not-a-zip.apk"

expect_pass() { # <label> <artifact> <expected> <forbidden>
  local out status=0
  out="$(bash "$check" "$work/$2" "$3" "$4" 2>&1)" || status=$?
  [[ "$status" == 0 ]] || fail "$1: expected PASS, got exit $status: $out"
  [[ "$out" == *'embedded API verified'* ]] || fail "$1: missing PASS line: $out"
}
expect_reject() { # <label> <expected text> <artifact> <expected origin> <forbidden origin>
  local out status=0
  out="$(bash "$check" "$work/$3" "$4" "$5" 2>&1)" || status=$?
  [[ "$status" == 1 ]] || fail "$1: expected exit 1, got $status: $out"
  [[ "$out" == *"$2"* ]] || fail "$1: missing '$2' in: $out"
}

# Correct builds pass, for APK and AAB, in both directions.
expect_pass 'showcase APK' showcase.apk "$demo" "$prod"
expect_pass 'showcase AAB' showcase.aab "$demo" "$prod"
expect_pass 'operating AAB' operating.aab "$prod" "$demo"
expect_pass 'origin packed against the next string' packed-operating.aab "$prod" "$demo"

# A stale cache that swapped the origin fails, and so does a bundle that carries both.
expect_reject 'showcase APK with production origin' "does not embed $demo" swapped-showcase.apk "$demo" "$prod"
expect_reject 'showcase AAB with production origin' "does not embed $demo" swapped-showcase.aab "$demo" "$prod"
expect_reject 'operating AAB with showcase origin' "does not embed $prod" swapped-operating.aab "$prod" "$demo"
expect_reject 'showcase APK with both origins' "embeds $prod" both-showcase.apk "$demo" "$prod"
expect_reject 'operating AAB with both origins' "embeds $demo" both-operating.aab "$prod" "$demo"

# The demo host contains "api.masscom.kr" but is not the production origin.
expect_reject 'demo origin alone is not production' "does not embed $prod" showcase.aab "$prod" "$demo"
expect_reject 'demo origin alone is not production (APK)' "does not embed $prod" showcase.apk "$prod" "$demo"
expect_reject 'http scheme is not the production origin' "does not embed $prod" insecure-operating.aab "$prod" "$demo"
expect_reject 'a longer host starting with the production origin is forbidden' "embeds $prod" longer-host-showcase.apk "$demo" "$prod"

# Neither origin, or no readable bundle, never passes.
expect_reject 'APK without either origin' "does not embed $demo" neither.apk "$demo" "$prod"
expect_reject 'AAB without either origin' "does not embed $prod" neither.aab "$prod" "$demo"
expect_reject 'APK without a bundle' 'JS bundle assets/index.android.bundle is missing' no-bundle.apk "$demo" "$prod"
expect_reject 'AAB with the bundle outside base/' 'JS bundle base/assets/index.android.bundle is missing' misplaced.aab "$prod" "$demo"
expect_reject 'empty bundle' 'JS bundle is empty' empty-bundle.apk "$demo" "$prod"
expect_reject 'unknown extension' 'must be an .apk or .aab' empty.bundle "$demo" "$prod"
expect_reject 'not a zip' 'not a readable APK or AAB' not-a-zip.apk "$demo" "$prod"
expect_reject 'missing artifact' 'no such artifact' missing.apk "$demo" "$prod"

# Bad arguments are refused before anything is read.
expect_reject 'origin with a path' 'origins must be https://host' showcase.apk "$demo/path" "$prod"
expect_reject 'http origin' 'origins must be https://host' showcase.apk "http://demo-api.masscom.kr" "$prod"
expect_reject 'same origin twice' 'must differ' showcase.apk "$demo" "$demo"
status=0
bash "$check" "$work/showcase.apk" "$demo" >/dev/null 2>&1 || status=$?
[[ "$status" == 2 ]] || fail "missing forbidden origin: expected exit 2, got $status"

# The builders must run the check and Gradle must not run with CI=1 (Expo then ignores --reset-cache).
showcase_builder="$repo_root/scripts/build-showcase-apk.sh"
release_builder="$repo_root/scripts/build-release-aab.sh"
grep -qF 'CI=0 NODE_ENV=production' "$showcase_builder" ||
  fail 'showcase Gradle step must run with CI=0'
! grep -qE 'CI=1[[:space:]]+NODE_ENV=production' "$showcase_builder" ||
  fail 'showcase Gradle step must not run with CI=1'
grep -qF 'CI=0 NODE_ENV=production' "$release_builder" ||
  fail 'release Gradle step must run with CI=0'
grep -qF -- 'check-embedded-api.sh" "$embedded_artifact"' "$showcase_builder" ||
  fail 'showcase builder does not check the embedded API origin'
grep -qF 'https://demo-api.masscom.kr https://api.masscom.kr' "$showcase_builder" ||
  fail 'showcase builder must expect the demo origin and forbid the production origin'
grep -qF 'for embedded_artifact in "$apk" "$aab"' "$showcase_builder" ||
  fail 'showcase builder must check both the APK and the companion AAB'
grep -qF "embeddedApi: 'PASS'" "$showcase_builder" ||
  fail 'showcase provenance must record embeddedApi'
grep -qF 'check-embedded-api.sh" "$built" https://api.masscom.kr https://demo-api.masscom.kr' "$release_builder" ||
  fail 'release builder must expect the production origin and forbid the demo origin'
bash "$repo_root/scripts/check-secrets.sh" "$check" >/dev/null ||
  fail 'embedded API check is rejected by repository secret scanning'

echo 'embedded API origin checks verified'
