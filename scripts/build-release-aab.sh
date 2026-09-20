#!/usr/bin/env bash
# Builds the store variant (package kr.masscom.wolgye) as a release AAB.
# Signing: the owner keeps the upload keystore outside the repository and sets
#   android.injected.signing.store.file / store.password / key.alias / key.password
# in ~/.gradle/gradle.properties. Without them the AAB is signed with the local debug key and
# this script says so; a debug-signed AAB must not be uploaded.
# Usage: scripts/build-release-aab.sh [--restore-dev]   (--restore-dev regenerates the dev project afterwards)

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile_dir="$repo_root/apps/mobile"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

cd "$mobile_dir"
CI=1 APP_VARIANT=production npx --no-install expo prebuild --platform android --clean --no-install
(cd android && APP_VARIANT=production ./gradlew bundleRelease --console=plain -q)

aab="$mobile_dir/android/app/build/outputs/bundle/release/app-release.aab"
echo "AAB: $aab"
# keytool labels are localized, so match the certificate subject instead of the "Owner:" label.
signer="$(keytool -J-Duser.language=en -printcert -jarfile "$aab")"
# Informational only: a missing label must not abort before the debug-key check below.
grep -E 'Owner:|SHA256:' <<<"$signer" | head -2 || true
if grep -q 'CN=Android Debug' <<<"$signer"; then
  echo "WARNING: signed with the local debug key; configure the upload key before uploading" >&2
fi

if [[ "${1:-}" == "--restore-dev" ]]; then
  CI=1 npx --no-install expo prebuild --platform android --clean --no-install
fi
