#!/usr/bin/env bash
# Issue #273: a build must embed its own API origin and never the other build's. The shared Metro
# cache can inline a stale EXPO_PUBLIC_API_URL, and a hosted-API health check cannot see that.
# Reads the JS bundle from an APK (assets/) or AAB (base/assets/), chosen by file extension, and
# requires <expected-origin> while forbidding <forbidden-origin>. Origins are matched with their
# scheme, so the showcase host https://demo-api.masscom.kr never counts as the operating host
# https://api.masscom.kr. No trailing boundary is applied: Hermes packs strings back to back, so a
# real origin can be followed directly by the next string's first character.
#
# Usage: scripts/check-embedded-api.sh <file.apk|file.aab> <expected-origin> <forbidden-origin>
set -euo pipefail

[[ $# -eq 3 ]] || {
  echo 'usage: check-embedded-api.sh <file.apk|file.aab> <expected-origin> <forbidden-origin>' >&2
  exit 2
}
artifact="$1"
expected="$2"
forbidden="$3"

fail() { echo "embedded API check FAILED: $*" >&2; exit 1; }

origin_pattern='^https://[a-z0-9.-]+$'
[[ "$expected" =~ $origin_pattern && "$forbidden" =~ $origin_pattern ]] ||
  fail 'origins must be https://host without a path or port'
[[ "$expected" != "$forbidden" ]] || fail 'expected and forbidden origins must differ'
[[ -f "$artifact" ]] || fail "no such artifact: $artifact"

case "$artifact" in
  *.aab) entry='base/assets/index.android.bundle' ;;
  *.apk) entry='assets/index.android.bundle' ;;
  *) fail "artifact must be an .apk or .aab: $artifact" ;;
esac
entries="$(unzip -Z1 "$artifact" 2>/dev/null)" || fail "not a readable APK or AAB: $artifact"
grep -qxF "$entry" <<<"$entries" ||
  fail "JS bundle $entry is missing: $(basename "$artifact")"

work="$(mktemp -d -t embedded-api.XXXXXX)"
trap 'rm -rf "$work"' EXIT
unzip -p "$artifact" "$entry" >"$work/bundle" || fail "JS bundle could not be read: $entry"
[[ -s "$work/bundle" ]] || fail "JS bundle is empty: $entry"

grep -aqF -- "$expected" "$work/bundle" ||
  fail "$(basename "$artifact") does not embed $expected"
if grep -aqF -- "$forbidden" "$work/bundle"; then
  fail "$(basename "$artifact") embeds $forbidden"
fi
echo "embedded API verified: $(basename "$artifact"), embeds $expected and not $forbidden"
