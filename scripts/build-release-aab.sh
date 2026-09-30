#!/usr/bin/env bash
# Builds the store variant (package kr.masscom.wolgye) as a release AAB.
# Signing: the owner keeps the upload keystore outside the repository and sets
#   android.injected.signing.store.file / store.password / key.alias / key.password
# in ~/.gradle/gradle.properties. Without them the AAB is signed with the local debug key and
# this script says so; a debug-signed AAB must not be uploaded.
# Keychain mode (MASSCOM_RELEASE_USE_KEYCHAIN=1) keeps the password out of that file: it is read from
# the macOS Keychain (service masscom-upload-keystore, account masscom-upload), the certificate is
# checked against the approved upload pin before any build, and only the gradlew child receives it,
# through ORG_GRADLE_PROJECT_ environment variables. Overrides: MASSCOM_RELEASE_KEYSTORE_FILE
# (default ~/.android/masscom-upload.jks), MASSCOM_RELEASE_KEY_ALIAS (default masscom-upload),
# MASSCOM_RELEASE_CERT_SHA256.
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

use_keychain="${MASSCOM_RELEASE_USE_KEYCHAIN:-}"
if [[ -n "$use_keychain" && "$use_keychain" != 1 ]]; then
  echo 'release Keychain mode must be 1' >&2
  exit 1
fi

commit="$(git -C "$repo_root" rev-parse HEAD)"
initial_worktree_status="$(git -C "$repo_root" status --porcelain --untracked-files=normal)"
if [[ -n "$initial_worktree_status" ]]; then
  echo 'release build requires a clean Git worktree' >&2
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

# Keychain mode: everything is checked before prebuild, so a wrong key never reaches Gradle.
if [[ "$use_keychain" == 1 ]]; then
  keychain_fail() { echo "$*" >&2; exit 1; }
  keystore="${MASSCOM_RELEASE_KEYSTORE_FILE:-$HOME/.android/masscom-upload.jks}"
  [[ "$keystore" == /* && -f "$keystore" ]] || keychain_fail 'release upload keystore file is not available'
  [[ "$(cd -P "$(dirname "$keystore")" && pwd -P)/$(basename "$keystore")" != "$(cd -P "$repo_root" && pwd -P)"/* ]] ||
    keychain_fail 'release upload keystore must stay outside the repository'
  key_alias="${MASSCOM_RELEASE_KEY_ALIAS:-masscom-upload}"
  [[ "$key_alias" =~ ^[A-Za-z0-9._-]+$ ]] || keychain_fail 'release key alias is invalid'
  upload_pin="$(printf '%s' "${MASSCOM_RELEASE_CERT_SHA256:-5e5ed3c31971e5a88ea752b3a2ae50772fea1c956b9d97a82dd5ca7130cfa395}" \
    | tr -d ':' | tr '[:upper:]' '[:lower:]')"
  [[ "$upload_pin" =~ ^[0-9a-f]{64}$ ]] || keychain_fail 'release certificate SHA-256 pin is invalid'
  source "$repo_root/scripts/keychain-password.sh"
  load_keychain_password release masscom-upload-keystore masscom-upload ||
    keychain_fail 'release Keychain password could not be loaded'
  # The command substitution is a subshell, so the exported value reaches keytool only.
  keystore_fingerprint="$(printf -v MASSCOM_RELEASE_STORE_PASSWORD '%s' "$store_password"
    export MASSCOM_RELEASE_STORE_PASSWORD
    keytool -J-Duser.language=en -list -v -keystore "$keystore" -alias "$key_alias" \
      -storepass:env MASSCOM_RELEASE_STORE_PASSWORD 2>/dev/null \
      | sed -n 's/.*SHA256: *//p' | head -1 | tr -d ':' | tr '[:upper:]' '[:lower:]')" || true
  [[ "$keystore_fingerprint" == "$upload_pin" ]] ||
    keychain_fail 'release keystore certificate does not match the approved upload SHA-256 pin'
  # The signature verdict after the build checks the AAB against the same pin unless the caller set one.
  export UPLOAD_CERT_SHA256="${UPLOAD_CERT_SHA256:-$upload_pin}"
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
  if ! node - "$source_aab" "$source_provenance" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, statSync } = require('node:fs');
const [artifactPath, provenancePath] = process.argv.slice(2);
const artifact = readFileSync(artifactPath);
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
const digest = createHash('sha256').update(artifact).digest('hex');
if (provenance?.artifact?.sha256 !== digest || provenance?.artifact?.bytes !== statSync(artifactPath).size) {
  throw new Error('staged AAB no longer matches its provenance');
}
NODE
  then
    echo 'staged AAB changed before release evidence publication' >&2
    return 1
  fi
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

# Keychain mode: the signing secrets live only in the gradlew child's environment. Bash cannot export
# the dotted property names, and passing them through env(1) would put the password on a command line.
# Called from a subshell, so the exports below never reach the parent script.
run_gradle_bundle() {
  if [[ "$use_keychain" != 1 ]]; then
    ./gradlew bundleRelease --console=plain -q
    return
  fi
  printf -v MASSCOM_RELEASE_STORE_PASSWORD '%s' "$store_password"
  printf -v MASSCOM_RELEASE_KEY_PASSWORD '%s' "$key_password"
  export MASSCOM_RELEASE_STORE_PASSWORD MASSCOM_RELEASE_KEY_PASSWORD
  MASSCOM_RELEASE_KEYSTORE_FILE="$keystore" MASSCOM_RELEASE_KEY_ALIAS="$key_alias" node - <<'NODE'
const { spawnSync } = require('node:child_process');
const env = { ...process.env,
  'ORG_GRADLE_PROJECT_android.injected.signing.store.file': process.env.MASSCOM_RELEASE_KEYSTORE_FILE,
  'ORG_GRADLE_PROJECT_android.injected.signing.store.password': process.env.MASSCOM_RELEASE_STORE_PASSWORD,
  'ORG_GRADLE_PROJECT_android.injected.signing.key.alias': process.env.MASSCOM_RELEASE_KEY_ALIAS,
  'ORG_GRADLE_PROJECT_android.injected.signing.key.password': process.env.MASSCOM_RELEASE_KEY_PASSWORD,
};
delete env.MASSCOM_RELEASE_STORE_PASSWORD;
delete env.MASSCOM_RELEASE_KEY_PASSWORD;
const result = spawnSync('./gradlew', ['bundleRelease', '--console=plain', '-q'], { env, stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
NODE
}

cd "$mobile_dir"
CI=1 APP_VARIANT=production MASSCOM_BUILD_SOURCE_COMMIT="$commit" \
  EXPO_PUBLIC_DEMO_ACCOUNT_ID= \
  EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID= \
  EXPO_PUBLIC_DEMO_MERCHANT_ID= \
  EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION= \
  npx --no-install expo prebuild --platform android --clean --no-install
(cd android && \
  # Expo ignores Gradle's --reset-cache when CI=1, which can embed stale public config.
  CI=0 NODE_ENV=production APP_VARIANT=production MASSCOM_BUILD_SOURCE_COMMIT="$commit" \
  EXPO_PUBLIC_DEMO_ACCOUNT_ID= \
  EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID= \
  EXPO_PUBLIC_DEMO_MERCHANT_ID= \
  EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION= \
  run_gradle_bundle)
unset store_password key_password
if [[ "$(git -C "$repo_root" rev-parse HEAD)" != "$commit" ]]; then
  echo 'source commit changed during release build' >&2
  exit 1
fi
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]]; then
  echo 'Git worktree changed during release build' >&2
  exit 1
fi

built="$mobile_dir/android/app/build/outputs/bundle/release/app-release.aab"
gradle_file="$mobile_dir/android/app/build.gradle"
# A stale Metro cache can inline the showcase API origin; the bundle must carry only the operating one.
"$repo_root/scripts/check-embedded-api.sh" "$built" https://api.masscom.kr https://demo-api.masscom.kr || {
  echo 'release AAB embeds the wrong API origin' >&2
  exit 1
}
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
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]]; then
  echo 'Git worktree changed before release evidence publication' >&2
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
