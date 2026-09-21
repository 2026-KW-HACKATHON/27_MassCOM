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
artifact="$(cd "$(dirname "$artifact_input")" && pwd -P)/$(basename "$artifact_input")"
mobile_src_input="${2:-$repo_root/apps/mobile/src}"
[[ -d "$mobile_src_input" ]] || { echo "no such mobile source directory: $mobile_src_input" >&2; exit 1; }
mobile_src="$(cd "$mobile_src_input" && pwd -P)"
canonical_mobile_src="$(cd "$repo_root/apps/mobile/src" && pwd -P)"
if [[ "$mobile_src" != "$canonical_mobile_src" && "${MASSCOM_TEST_MODE:-}" != 'true' ]]; then
  echo 'mobile source override requires MASSCOM_TEST_MODE=true' >&2
  exit 1
fi

provenance_input="${3:-${artifact%.aab}.provenance.json}"
provenance_parent="$(dirname "$provenance_input")"
[[ -d "$provenance_parent" ]] || { echo "no such provenance directory: $provenance_parent" >&2; exit 1; }
provenance="$(cd "$provenance_parent" && pwd -P)/$(basename "$provenance_input")"
if [[ "$artifact" == "$provenance" ]] || [[ -e "$provenance" && "$artifact" -ef "$provenance" ]]; then
  echo 'provenance output must not refer to the artifact' >&2
  exit 1
fi

if [[ "${EXPECTED_PACKAGE+x}" == x && "${MASSCOM_TEST_MODE:-}" != 'true' ]]; then
  echo 'EXPECTED_PACKAGE requires MASSCOM_TEST_MODE=true' >&2
  exit 1
fi
if [[ -n "${AAB_SIGNATURE_CHECK_COMMAND:-}" || -n "${AAB_WALLET_SURFACE_CHECK_COMMAND:-}" ]]; then
  [[ "${MASSCOM_TEST_MODE:-}" == 'true' ]] || {
    echo 'AAB gate command overrides require MASSCOM_TEST_MODE=true' >&2
    exit 1
  }
fi
expected_source_commit="${MASSCOM_BUILD_SOURCE_COMMIT:-}"
if [[ "${MASSCOM_TEST_MODE:-}" != 'true' && -z "$expected_source_commit" ]]; then
  echo 'production assessment requires MASSCOM_BUILD_SOURCE_COMMIT' >&2
  exit 1
fi

signature_check="${AAB_SIGNATURE_CHECK_COMMAND:-$repo_root/scripts/verify-aab-signature.sh}"
wallet_check="${AAB_WALLET_SURFACE_CHECK_COMMAND:-$repo_root/scripts/check-release-wallet-surface.sh}"
[[ -x "$signature_check" ]] || { echo "signature check is not executable: $signature_check" >&2; exit 1; }
[[ -x "$wallet_check" ]] || { echo "wallet surface check is not executable: $wallet_check" >&2; exit 1; }

artifact_sha256="$(shasum -a 256 "$artifact" | cut -d' ' -f1)"
artifact_bytes="$(wc -c <"$artifact" | tr -d ' ')"
assert_artifact_unchanged() {
  if [[ "$(shasum -a 256 "$artifact" | cut -d' ' -f1)" != "$artifact_sha256" \
    || "$(wc -c <"$artifact" | tr -d ' ')" != "$artifact_bytes" ]]; then
    echo 'artifact changed during release assessment' >&2
    return 1
  fi
}
source_commit="$(git -C "$repo_root" rev-parse HEAD)"
if [[ -n "$expected_source_commit" ]]; then
  [[ "$expected_source_commit" =~ ^[0-9a-fA-F]{40}$ ]] || {
    echo 'MASSCOM_BUILD_SOURCE_COMMIT must be a 40-character Git object id' >&2
    exit 1
  }
  [[ "$source_commit" == "$expected_source_commit" ]] || {
    echo 'source commit changed during release assessment' >&2
    exit 1
  }
fi
worktree_status="$(git -C "$repo_root" status --porcelain --untracked-files=normal)"
if [[ -n "$expected_source_commit" && -n "$worktree_status" ]]; then
  echo 'Git worktree changed during release assessment' >&2
  exit 1
fi
mobile_status="$(git -C "$repo_root" status --porcelain --untracked-files=normal -- apps/mobile)"
if [[ -n "$mobile_status" ]]; then
  mobile_dirty=true
else
  mobile_dirty=false
fi

manifest_dump=''
if [[ "${MASSCOM_TEST_MODE:-}" == 'true' ]]; then
  manifest_dump="$(unzip -p "$artifact" 'base/manifest/AndroidManifest.xml')" || {
    echo 'artifact AndroidManifest could not be read' >&2
    exit 1
  }
else
  aapt2=''
  if command -v aapt2 >/dev/null 2>&1; then
    aapt2="$(command -v aapt2)"
  else
    android_sdk="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    for candidate in "$android_sdk"/build-tools/*/aapt2; do
      [[ -x "$candidate" ]] && aapt2="$candidate"
    done
  fi
  [[ -n "$aapt2" ]] || { echo 'artifact manifest parser aapt2 is unavailable' >&2; exit 1; }
  manifest_dump="$($aapt2 dump xmltree --file base/manifest/AndroidManifest.xml "$artifact" 2>&1)" || {
    echo 'artifact AndroidManifest could not be parsed' >&2
    exit 1
  }
fi
manifest_nodes="$(awk '
  function emit_node() {
    if (in_metadata) print metadata_name "\t" metadata_value
    in_metadata = 0
    metadata_name = ""
    metadata_value = ""
  }
  {
    indent = match($0, /[^[:space:]]/) - 1
    if ($0 ~ /^[[:space:]]*E:/) {
      if (in_metadata && indent <= metadata_indent) emit_node()
      if ($0 ~ /^[[:space:]]*E: meta-data([[:space:]]|$)/) {
        in_metadata = 1
        metadata_indent = indent
      }
      next
    }
    if (!in_metadata) next
    if ($0 ~ /A: android:name([^=]*)=/) {
      metadata_name = $0
      sub(/^[^"]*"/, "", metadata_name)
      sub(/".*$/, "", metadata_name)
    } else if ($0 ~ /A: android:value([^=]*)=/) {
      metadata_value = $0
      sub(/^[^"]*"/, "", metadata_value)
      sub(/".*$/, "", metadata_value)
    }
  }
  END { emit_node() }
' <<<"$manifest_dump")"
read -r marker_name_count marker_match_count artifact_source_commit <<<"$(awk -F '\t' \
  -v key='kr.masscom.BUILD_SOURCE_COMMIT' -v expected="$source_commit" '
    $1 == key { name_count += 1; marker = tolower($2) }
    $1 == key && tolower($2) == tolower(expected) { match_count += 1 }
    END { printf "%d %d %s\n", name_count, match_count, marker }
  ' <<<"$manifest_nodes")"
if [[ "$marker_name_count" != 1 ]]; then
  echo 'artifact must contain exactly one BUILD_SOURCE_COMMIT manifest marker' >&2
  exit 1
fi
if [[ "$marker_match_count" != 1 || "$artifact_source_commit" != "$source_commit" ]]; then
  echo 'artifact BUILD_SOURCE_COMMIT does not match the assessed source commit' >&2
  exit 1
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
w08_verified_artifact_package="$(sed -nE \
  's/^release wallet surface verified: .*, package ([A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+)[[:space:]]*$/\1/p' \
  <<<"$wallet_output")"

if [[ -n "$expected_source_commit" ]]; then
  [[ "$(git -C "$repo_root" rev-parse HEAD)" == "$expected_source_commit" ]] || {
    echo 'source commit changed during release assessment' >&2
    exit 1
  }
  [[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]] || {
    echo 'Git worktree changed during release assessment' >&2
    exit 1
  }
fi
assert_artifact_unchanged || exit 1

node "$repo_root/scripts/write-aab-provenance.mjs" \
  --output "$provenance" \
  --artifact "$artifact" \
  --artifact-sha256 "$artifact_sha256" \
  --artifact-bytes "$artifact_bytes" \
  --artifact-source-commit "$artifact_source_commit" \
  --source-commit "$source_commit" \
  --mobile-dirty "$mobile_dirty" \
  --source-expected-android-package kr.masscom.wolgye \
  --source-expected-android-version-name "$android_version_name" \
  --source-expected-android-version-code "$android_version_code" \
  --w08-verified-artifact-package "$w08_verified_artifact_package" \
  --signature-status "$signature_status" \
  --signature-exit-code "$signature_exit" \
  --signature-certificate-sha256 "$certificate_sha256" \
  --wallet-surface-status "$wallet_status" \
  --wallet-surface-exit-code "$wallet_exit" \
  --release-readiness-status NOT_RUN \
  --release-readiness-pending A02_DEVICE_INSTALL,APP_LINKS,PLAY_UPLOAD_AND_REVIEW

if ! assert_artifact_unchanged; then
  rm -f "$provenance"
  exit 1
fi

echo "$provenance"
if [[ "$signature_exit" != 0 ]]; then exit "$signature_exit"; fi
if [[ "$wallet_exit" != 0 ]]; then exit "$wallet_exit"; fi
