#!/usr/bin/env bash
# Builds the store variant (package kr.masscom.wolgye) as a release AAB.
# Signing: the owner keeps the upload keystore outside the repository and sets
#   android.injected.signing.store.file / store.password / key.alias / key.password
# in ~/.gradle/gradle.properties. Without them the AAB is signed with the local debug key and
# this script says so; a debug-signed AAB must not be uploaded.
# Usage: scripts/build-release-aab.sh [--restore-dev]   (--restore-dev regenerates the dev project afterwards)
# The AAB is copied to apps/mobile/release-artifacts/ (gitignored) before anything is restored.
# Exit codes: 0 uploadable; 3-7 built but not uploadable (see scripts/verify-aab-signature.sh); other = build failure.
# The upload key is the owner's; Play re-signs installs with its own app signing key, so the
# certificate printed here is the upload certificate, not the one devices will see.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile_dir="$repo_root/apps/mobile"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

[[ $# -le 1 ]] || { echo "unknown option: ${*:2}" >&2; exit 1; }
case "${1:-}" in
  ''|--restore-dev) ;;
  *) echo "unknown option: $1" >&2; exit 1 ;;
esac
restore_dev="${1:-}"
# Runs on every exit, so a failed build or signer check never leaves the production project behind.
# The variant is set explicitly: a caller that exported APP_VARIANT=production must not get a
# production project back.
restore() {
  if [[ "$restore_dev" == "--restore-dev" ]]; then
    (cd "$mobile_dir" && CI=1 APP_VARIANT=development npx --no-install expo prebuild --platform android --clean --no-install) \
      || echo "warning: --restore-dev could not regenerate the development project" >&2
  fi
}
trap restore EXIT

cd "$mobile_dir"
CI=1 APP_VARIANT=production npx --no-install expo prebuild --platform android --clean --no-install
(cd android && APP_VARIANT=production ./gradlew bundleRelease --console=plain -q)

built="$mobile_dir/android/app/build/outputs/bundle/release/app-release.aab"
gradle_file="$mobile_dir/android/app/build.gradle"
commit="$(git -C "$repo_root" rev-parse HEAD)"
# android/ is wiped by the restore above, so everything reported below is about the copy.
artifacts="${RELEASE_ARTIFACT_DIR:-$mobile_dir/release-artifacts}"
mkdir -p "$artifacts"
aab="$artifacts/app-release-${commit:0:7}.aab"
cp "$built" "$aab"
echo "AAB: $aab"
echo "sha256: $(shasum -a 256 "$aab" | cut -d' ' -f1)"
echo "source commit: $commit$(git -C "$repo_root" diff --quiet -- apps/mobile || echo ' (apps/mobile has uncommitted changes)')"
# Informational: a format change here must not abort before the signing verdict below.
grep -E "^[[:space:]]*(applicationId|versionCode|versionName)[[:space:](]" "$gradle_file" | sed 's/^ *//' \
  || echo "version metadata not found in $gradle_file" >&2

# The build succeeded either way; a non-zero verdict tells callers the artifact must not go to Play.
"$repo_root/scripts/verify-aab-signature.sh" "$aab"
