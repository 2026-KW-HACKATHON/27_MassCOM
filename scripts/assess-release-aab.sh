#!/usr/bin/env bash
# Records automated signature and W08 verdicts without claiming that manual release gates ran.
# Usage: scripts/assess-release-aab.sh <file.aab> [mobile-src-dir] [provenance.json]
set -euo pipefail

[[ $# -ge 1 && $# -le 3 ]] || {
  echo 'usage: assess-release-aab.sh <file.aab> [mobile-src-dir] [provenance.json]' >&2
  exit 1
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_input="$1"
[[ -f "$artifact_input" ]] || { echo "no such artifact: $artifact_input" >&2; exit 1; }
artifact="$(cd "$(dirname "$artifact_input")" && pwd)/$(basename "$artifact_input")"
mobile_src_input="${2:-$repo_root/apps/mobile/src}"
[[ -d "$mobile_src_input" ]] || { echo "no such mobile source directory: $mobile_src_input" >&2; exit 1; }
mobile_src="$(cd "$mobile_src_input" && pwd)"

provenance_input="${3:-${artifact%.aab}.provenance.json}"
provenance_parent="$(dirname "$provenance_input")"
[[ -d "$provenance_parent" ]] || { echo "no such provenance directory: $provenance_parent" >&2; exit 1; }
provenance="$(cd "$provenance_parent" && pwd)/$(basename "$provenance_input")"

if [[ -n "${AAB_SIGNATURE_CHECK_COMMAND:-}" || -n "${AAB_WALLET_SURFACE_CHECK_COMMAND:-}" ]]; then
  [[ "${MASSCOM_TEST_MODE:-}" == 'true' ]] || {
    echo 'AAB gate command overrides require MASSCOM_TEST_MODE=true' >&2
    exit 1
  }
fi

signature_check="${AAB_SIGNATURE_CHECK_COMMAND:-$repo_root/scripts/verify-aab-signature.sh}"
wallet_check="${AAB_WALLET_SURFACE_CHECK_COMMAND:-$repo_root/scripts/check-release-wallet-surface.sh}"
[[ -x "$signature_check" ]] || { echo "signature check is not executable: $signature_check" >&2; exit 1; }
[[ -x "$wallet_check" ]] || { echo "wallet surface check is not executable: $wallet_check" >&2; exit 1; }

artifact_sha256="$(shasum -a 256 "$artifact" | cut -d' ' -f1)"
artifact_bytes="$(wc -c <"$artifact" | tr -d ' ')"
source_commit="$(git -C "$repo_root" rev-parse HEAD)"
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal -- apps/mobile)" ]]; then
  mobile_dirty=true
else
  mobile_dirty=false
fi

app_json="$repo_root/apps/mobile/app.json"
android_version_name="$(node -e "const c=require(process.argv[1]).expo; process.stdout.write(c.version)" "$app_json")"
android_version_code="$(node -e "const c=require(process.argv[1]).expo; process.stdout.write(String(c.android?.versionCode ?? 1))" "$app_json")"

signature_output=''
signature_exit=0
signature_output="$("$signature_check" "$artifact" 2>&1)" || signature_exit=$?
[[ -z "$signature_output" ]] || printf '%s\n' "$signature_output" >&2
if [[ "$signature_exit" == 0 ]]; then signature_status=PASS; else signature_status=FAIL; fi

certificate_sha256="$(sed -nE 's/^certificate sha256:[[:space:]]*([0-9A-Fa-f]{64})[[:space:]]*$/\1/p' <<<"$signature_output" | tr 'a-f' 'A-F')"

wallet_output=''
wallet_exit=0
wallet_output="$("$wallet_check" "$artifact" "$mobile_src" 2>&1)" || wallet_exit=$?
[[ -z "$wallet_output" ]] || printf '%s\n' "$wallet_output" >&2
if [[ "$wallet_exit" == 0 ]]; then wallet_status=PASS; else wallet_status=FAIL; fi

node "$repo_root/scripts/write-aab-provenance.mjs" \
  --output "$provenance" \
  --artifact "$artifact" \
  --artifact-sha256 "$artifact_sha256" \
  --artifact-bytes "$artifact_bytes" \
  --source-commit "$source_commit" \
  --mobile-dirty "$mobile_dirty" \
  --android-package kr.masscom.wolgye \
  --android-version-name "$android_version_name" \
  --android-version-code "$android_version_code" \
  --signature-status "$signature_status" \
  --signature-exit-code "$signature_exit" \
  --signature-certificate-sha256 "$certificate_sha256" \
  --wallet-surface-status "$wallet_status" \
  --wallet-surface-exit-code "$wallet_exit" \
  --release-readiness-status NOT_RUN \
  --release-readiness-pending A02_DEVICE_INSTALL,APP_LINKS,PLAY_UPLOAD_AND_REVIEW

echo "$provenance"
if [[ "$signature_exit" != 0 ]]; then exit "$signature_exit"; fi
if [[ "$wallet_exit" != 0 ]]; then exit "$wallet_exit"; fi
