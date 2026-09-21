#!/usr/bin/env bash
# Builds the store variant (package kr.masscom.wolgye) as a release AAB.
# Signing: the owner keeps the upload keystore outside the repository and sets
#   android.injected.signing.store.file / store.password / key.alias / key.password
# in ~/.gradle/gradle.properties. Without them the AAB is signed with the local debug key and
# this script says so; a debug-signed AAB must not be uploaded.
# Usage: scripts/build-release-aab.sh [--restore-dev]   (--restore-dev regenerates the dev project afterwards)
# The AAB and its provenance are copied to apps/mobile/release-artifacts/ (gitignored) before anything is restored.
# Exit code 0 means the automated gates passed; release/device/Play readiness remains NOT_RUN.
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

test_only_environment=(
  MASSCOM_TEST_MODE
  AAB_SIGNATURE_CHECK_COMMAND
  AAB_WALLET_SURFACE_CHECK_COMMAND
  AAB_W08_CHECK_COMMAND
  EXPECTED_PACKAGE
)
for variable in "${test_only_environment[@]}"; do
  if [[ "${!variable+x}" == x ]]; then
    echo "release build rejects test-only environment variable: $variable" >&2
    exit 1
  fi
done

commit="$(git -C "$repo_root" rev-parse HEAD)"
initial_mobile_status="$(git -C "$repo_root" status --porcelain --untracked-files=normal -- apps/mobile)"
if [[ -n "$initial_mobile_status" ]]; then
  echo 'release build requires a clean mobile tree' >&2
  exit 1
fi
artifacts_input="${RELEASE_ARTIFACT_DIR:-$mobile_dir/release-artifacts}"
if [[ "$artifacts_input" == /* ]]; then
  artifacts="$artifacts_input"
else
  artifacts="$mobile_dir/$artifacts_input"
fi
mkdir -p "$artifacts"
artifacts="$(cd "$artifacts" && pwd -P)"
artifact_base="$artifacts/app-release-${commit:0:7}"
aab="$artifact_base.aab"
provenance="$artifact_base.provenance.json"

for target in "$aab" "$provenance"; do
  if [[ -e "$target" || -L "$target" ]]; then
    echo "release artifact target already exists: $target" >&2
    exit 1
  fi
done
rejected_target="$(find "$artifacts" -maxdepth 1 \( \
  -name "$(basename "$artifact_base").NOT-RELEASE-READY-exit*.aab" -o \
  -name "$(basename "$artifact_base").NOT-RELEASE-READY-exit*.provenance.json" \
\) -print -quit)"
if [[ -n "$rejected_target" ]]; then
  echo "release artifact target already exists: $rejected_target" >&2
  exit 1
fi

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

publish_pair() { # <source-aab> <source-provenance> <target-aab> <target-provenance>
  local source_aab="$1" source_provenance="$2" target_aab="$3" target_provenance="$4"
  if [[ -e "$target_aab" || -L "$target_aab" || -e "$target_provenance" || -L "$target_provenance" ]]; then
    echo "release artifact target appeared during build" >&2
    return 1
  fi
  if ! ln "$source_aab" "$target_aab"; then
    echo "could not publish AAB without overwriting: $target_aab" >&2
    return 1
  fi
  if ! ln "$source_provenance" "$target_provenance"; then
    if [[ -e "$target_aab" && "$target_aab" -ef "$source_aab" ]]; then
      rm -f "$target_aab"
    fi
    echo "could not publish provenance without overwriting: $target_provenance" >&2
    return 1
  fi
  rm "$source_aab" "$source_provenance"
}

cd "$mobile_dir"
CI=1 APP_VARIANT=production npx --no-install expo prebuild --platform android --clean --no-install
(cd android && APP_VARIANT=production ./gradlew bundleRelease --console=plain -q)
if [[ "$(git -C "$repo_root" rev-parse HEAD)" != "$commit" ]]; then
  echo 'source commit changed during release build' >&2
  exit 1
fi
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal -- apps/mobile)" ]]; then
  echo 'mobile source changed during release build' >&2
  exit 1
fi

built="$mobile_dir/android/app/build/outputs/bundle/release/app-release.aab"
gradle_file="$mobile_dir/android/app/build.gradle"
# android/ is wiped by the restore above, so everything reported below is about the copy.
staging_dir="$(mktemp -d "$artifacts/.app-release-${commit:0:7}.staging.XXXXXX")"
staged_aab="$staging_dir/$(basename "$aab")"
staged_provenance="$staging_dir/$(basename "$provenance")"
cp "$built" "$staged_aab"
echo "AAB: $aab"
echo "sha256: $(shasum -a 256 "$staged_aab" | cut -d' ' -f1)"
echo "source commit: $commit$(git -C "$repo_root" diff --quiet -- apps/mobile || echo ' (apps/mobile has uncommitted changes)')"
# Informational: a format change here must not abort before the signing verdict below.
grep -E "^[[:space:]]*(applicationId|versionCode|versionName)[[:space:](]" "$gradle_file" | sed 's/^ *//' \
  || echo "version metadata not found in $gradle_file" >&2

# The assessor records both automated verdicts and leaves manual/device/Play readiness explicit.
assessment=0
MASSCOM_BUILD_SOURCE_COMMIT="$commit" "$repo_root/scripts/assess-release-aab.sh" \
  "$staged_aab" "$mobile_dir/src" "$staged_provenance" || assessment=$?
if [[ "$(git -C "$repo_root" rev-parse HEAD)" != "$commit" ]]; then
  echo 'source commit changed before release evidence publication' >&2
  exit 1
fi
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal -- apps/mobile)" ]]; then
  echo 'mobile source changed before release evidence publication' >&2
  exit 1
fi
if [[ "$assessment" != "0" ]]; then
  if [[ ! -f "$staged_provenance" || -L "$staged_provenance" ]]; then
    echo "assessment exited $assessment without fresh provenance" >&2
    echo "AAB retained after incomplete assessment: $staged_aab" >&2
    exit "$assessment"
  fi
  rejected_base="${aab%.aab}.NOT-RELEASE-READY-exit$assessment"
  finalized_provenance="$staging_dir/$(basename "$rejected_base").provenance.json"
  if ! node "$repo_root/scripts/write-aab-provenance.mjs" \
    --input "$staged_provenance" \
    --output "$finalized_provenance" \
    --finalize-artifact-basename "$(basename "$rejected_base").aab"; then
    echo "could not finalize rejected provenance; staged evidence retained: $staged_aab, $staged_provenance" >&2
    exit "$assessment"
  fi
  if ! publish_pair "$staged_aab" "$finalized_provenance" \
    "$rejected_base.aab" "$rejected_base.provenance.json"; then
    echo "could not publish rejected pair; staged evidence retained: $staged_aab, $staged_provenance" >&2
    exit "$assessment"
  fi
  rm "$staged_provenance"
  rmdir "$staging_dir"
  echo "AAB retained for diagnosis: $rejected_base.aab" >&2
  echo "Provenance: $rejected_base.provenance.json" >&2
  exit "$assessment"
fi
if [[ ! -f "$staged_provenance" || -L "$staged_provenance" ]]; then
  echo 'assessment passed without fresh provenance' >&2
  echo "AAB retained after incomplete assessment: $staged_aab" >&2
  exit 1
fi
if ! publish_pair "$staged_aab" "$staged_provenance" "$aab" "$provenance"; then
  echo "could not publish accepted pair; staged evidence retained: $staged_aab, $staged_provenance" >&2
  exit 1
fi
rmdir "$staging_dir"
echo "Provenance: $provenance"
echo 'Automated gates: PASS'
echo 'Release readiness: NOT_RUN'
