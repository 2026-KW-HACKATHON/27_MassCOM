#!/usr/bin/env bash
# Builds the store variant (package kr.masscom.wolgye) as a release AAB.
# Signing: the owner keeps the upload keystore outside the repository and sets
#   android.injected.signing.store.file / store.password / key.alias / key.password
# in ~/.gradle/gradle.properties. Without them the AAB is signed with the local debug key and
# this script says so; a debug-signed AAB must not be uploaded.
# Usage: scripts/build-release-aab.sh [--restore-dev]   (--restore-dev regenerates the dev project afterwards)
# Exit codes: 0 signed with a non-debug key, 3 built but debug-signed (not uploadable), other = build failure.
# The upload key is the owner's; Play re-signs installs with its own app signing key, so the
# certificate printed here is the upload certificate, not the one devices will see.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile_dir="$repo_root/apps/mobile"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

cd "$mobile_dir"
CI=1 APP_VARIANT=production npx --no-install expo prebuild --platform android --clean --no-install
(cd android && APP_VARIANT=production ./gradlew bundleRelease --console=plain -q)

aab="$mobile_dir/android/app/build/outputs/bundle/release/app-release.aab"
gradle_file="$mobile_dir/android/app/build.gradle"
echo "AAB: $aab"
echo "sha256: $(shasum -a 256 "$aab" | cut -d' ' -f1)"
echo "source commit: $(git -C "$repo_root" rev-parse HEAD)$(git -C "$repo_root" diff --quiet -- apps/mobile || echo ' (apps/mobile has uncommitted changes)')"
grep -E "^\s*(applicationId|versionCode|versionName) " "$gradle_file" | sed 's/^ *//'
# keytool labels are localized, so match the certificate subject instead of the "Owner:" label.
signer="$(keytool -J-Duser.language=en -printcert -jarfile "$aab")"
# Informational only: a missing label must not abort before the debug-key check below.
grep -E 'Owner:|SHA256:' <<<"$signer" | head -2 || true
uploadable=1
if grep -q 'CN=Android Debug' <<<"$signer"; then
  uploadable=0
  echo "NOT UPLOADABLE: signed with the local debug key; configure the upload key (see the header)" >&2
fi

if [[ "${1:-}" == "--restore-dev" ]]; then
  CI=1 npx --no-install expo prebuild --platform android --clean --no-install
fi

# The build succeeded either way; exit 3 tells callers the artifact must not go to Play.
[[ "$uploadable" == "1" ]] || exit 3
