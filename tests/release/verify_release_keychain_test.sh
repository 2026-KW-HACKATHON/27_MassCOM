#!/usr/bin/env bash
# Release Keychain signing boundary (Issue #262). Runs build-release-aab.sh in a throwaway Git
# repository with fake security/keytool/npx/gradlew: no real Keychain, keystore or AAB is touched.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
work="$(mktemp -d -t masscom-release-keychain.XXXXXX)"
trap 'rm -rf "$work"' EXIT
secret=fixture-release-keychain-value
pin=5e5ed3c31971e5a88ea752b3a2ae50772fea1c956b9d97a82dd5ca7130cfa395
pin_as_keytool_prints_it="$(sed 's/../&:/g; s/:$//' <<<"$pin" | tr '[:lower:]' '[:upper:]')"
log="$work/log"
sandbox="$work/repo"
mkdir -p "$sandbox/scripts" "$sandbox/apps/mobile/src" "$work/bin" "$work/home/.android" "$work/keys"

cp "$repo_root/scripts/build-release-aab.sh" "$repo_root/scripts/keychain-password.sh" "$sandbox/scripts/"
printf 'fixture\n' >"$sandbox/apps/mobile/src/fixture.ts"
printf 'apps/mobile/android/\n' >"$sandbox/.gitignore"
(cd "$sandbox" && git init -q && git add . && \
  git -c user.email=t@example.invalid -c user.name=t commit -q -m sample)
printf 'fixture keystore\n' >"$work/home/.android/masscom-upload.jks"
printf 'fixture keystore\n' >"$work/keys/other.jks"

cat >"$work/bin/security" <<'STUB'
#!/bin/sh
echo called >>"$MOCK_LOG_DIR/security.log"
[ "$*" = "find-generic-password -s masscom-upload-keystore -a masscom-upload -w" ] || exit 11
case "$MOCK_KEYCHAIN_RESULT" in
  present) printf '%s\n' "$MOCK_VALUE" ;;
  empty) : ;;
  fail) exit 1 ;;
esac
STUB
cat >"$work/bin/keytool" <<'STUB'
#!/bin/bash
echo called >>"$MOCK_LOG_DIR/keytool.log"
[[ "$*" != *"$MOCK_VALUE"* ]] || exit 3
[[ "${MASSCOM_RELEASE_STORE_PASSWORD-}" == "$MOCK_VALUE" ]] || exit 4
[[ " $* " == *" -storepass:env MASSCOM_RELEASE_STORE_PASSWORD "* ]] || exit 5
[[ " $* " == *" -keystore $MOCK_KEYSTORE -alias $MOCK_ALIAS "* ]] || exit 6
[[ -z "${MOCK_KEYTOOL_FAIL-}" ]] || { echo 'keytool error: fixture failure' >&2; exit 1; }
printf 'Certificate fingerprints:\n\t SHA1: AA:BB\n\t SHA256: %s\n' "$MOCK_KEYTOOL_SHA256"
STUB
cat >"$work/bin/npx" <<'STUB'
#!/bin/bash
echo "variant=${APP_VARIANT:-unset} secret_env_entries=$(env | grep -F "$MOCK_VALUE" | grep -vc '^MOCK_VALUE=' || true)" \
  >>"$MOCK_LOG_DIR/npx.log"
rm -rf android
mkdir -p android/app/build/outputs/bundle/release
cp "$MOCK_GRADLEW_STUB" android/gradlew
chmod +x android/gradlew
STUB
# Records only booleans and counts, never the value. Exit 42 stops the build right after Gradle.
cat >"$work/gradlew-stub" <<'STUB'
#!/bin/bash
property=ORG_GRADLE_PROJECT_android.injected.signing
has() { [[ "$(env | grep -cFx "$1" || true)" == 1 ]] && echo yes || echo no; }
{
  echo "args=$*"
  echo "secret_env_entries=$(env | grep -F "$MOCK_VALUE" | grep -vc '^MOCK_VALUE=' || true)"
  echo "password_variables_left=$(env | grep -cE '^MASSCOM_RELEASE_(STORE|KEY)_PASSWORD' || true)"
  echo "store_file=$(has "$property.store.file=$MOCK_KEYSTORE")"
  echo "store_password=$(has "$property.store.password=$MOCK_VALUE")"
  echo "key_alias=$(has "$property.key.alias=$MOCK_ALIAS")"
  echo "key_password=$(has "$property.key.password=$MOCK_VALUE")"
  echo "upload_pin=${UPLOAD_CERT_SHA256-unset}"
} >"$MOCK_LOG_DIR/gradle.log"
exit 42
STUB
chmod 755 "$work/bin/security" "$work/bin/keytool" "$work/bin/npx" "$work/gradlew-stub"

fail() { echo "$*" >&2; exit 1; }
bash_flags=''
build() { # <NAME=value>... ; script arguments come from $build_args
  (cd "$sandbox" && env \
    -u MASSCOM_RELEASE_USE_KEYCHAIN -u MASSCOM_RELEASE_KEYSTORE_FILE -u MASSCOM_RELEASE_KEY_ALIAS \
    -u MASSCOM_RELEASE_CERT_SHA256 -u UPLOAD_CERT_SHA256 -u MASSCOM_TEST_MODE \
    -u AAB_SIGNATURE_CHECK_COMMAND -u AAB_WALLET_SURFACE_CHECK_COMMAND -u AAB_W08_CHECK_COMMAND \
    -u EXPECTED_PACKAGE \
    HOME="$work/home" PATH="$work/bin:$PATH" RELEASE_ARTIFACT_DIR="$work/artifacts" \
    MOCK_LOG_DIR="$log" MOCK_VALUE="$secret" MOCK_GRADLEW_STUB="$work/gradlew-stub" \
    MOCK_KEYCHAIN_RESULT=present MOCK_KEYTOOL_SHA256="$pin_as_keytool_prints_it" \
    MOCK_KEYSTORE="$work/home/.android/masscom-upload.jks" MOCK_ALIAS=masscom-upload \
    "$@" bash $bash_flags scripts/build-release-aab.sh ${build_args-} 2>&1)
}
run() { # <label> <NAME=value>... ; sets out and status, and checks that no output carries the value
  local label="$1"; shift
  rm -rf "$log"; mkdir -p "$log"
  status=0
  out="$(build "$@")" || status=$?
  [[ "$out" != *"$secret"* ]] || fail "$label: the Keychain value appeared in build output"
  if grep -rqF "$secret" "$log" "$work/artifacts" 2>/dev/null; then
    fail "$label: the Keychain value was written to a file"
  fi
  return 0
}
expect_rejected() { # <label> <message> <called-tools-that-must-not-exist> <NAME=value>...
  local label="$1" message="$2" untouched="$3"; shift 3
  run "$label" "$@"
  [[ "$status" == 1 ]] || fail "$label: expected exit 1, got $status: $out"
  grep -qF "$message" <<<"$out" || fail "$label: missing '$message' in: $out"
  [[ ! -e "$log/npx.log" && ! -e "$log/gradle.log" ]] || fail "$label: reached prebuild or Gradle"
  for tool in $untouched; do
    [[ ! -e "$log/$tool.log" ]] || fail "$label: $tool ran before the failure"
  done
}

# Anything but 1 fails before the Keychain, keytool, prebuild or Gradle are touched.
for mode in 0 true yes 2; do
  expect_rejected "mode $mode" 'release Keychain mode must be 1' 'security keytool' \
    MASSCOM_RELEASE_USE_KEYCHAIN="$mode"
done

# Precondition failures also happen before the Keychain is read.
expect_rejected 'missing keystore' 'release upload keystore file is not available' 'security keytool' \
  MASSCOM_RELEASE_USE_KEYCHAIN=1 MASSCOM_RELEASE_KEYSTORE_FILE="$work/keys/absent.jks"
mkdir -p "$sandbox/apps/mobile/android"
printf 'fixture keystore\n' >"$sandbox/apps/mobile/android/inside.jks"
expect_rejected 'keystore in the repository' 'release upload keystore must stay outside the repository' \
  'security keytool' MASSCOM_RELEASE_USE_KEYCHAIN=1 \
  MASSCOM_RELEASE_KEYSTORE_FILE="$sandbox/apps/mobile/android/inside.jks"
rm -rf "$sandbox/apps/mobile/android"
expect_rejected 'bad alias' 'release key alias is invalid' 'security keytool' \
  MASSCOM_RELEASE_USE_KEYCHAIN=1 'MASSCOM_RELEASE_KEY_ALIAS=bad alias'
expect_rejected 'bad pin' 'release certificate SHA-256 pin is invalid' 'security keytool' \
  MASSCOM_RELEASE_USE_KEYCHAIN=1 MASSCOM_RELEASE_CERT_SHA256=abc

# Shell tracing would print the value, so it is refused before the Keychain is read.
bash_flags=-x expect_rejected 'shell tracing' 'release Keychain refuses shell tracing' 'security keytool' \
  MASSCOM_RELEASE_USE_KEYCHAIN=1

# A missing or empty Keychain item stops the build without ever reaching keytool.
expect_rejected 'missing Keychain item' 'release Keychain item is not available' 'keytool' \
  MASSCOM_RELEASE_USE_KEYCHAIN=1 MOCK_KEYCHAIN_RESULT=fail
expect_rejected 'empty Keychain item' 'release Keychain item is empty' 'keytool' \
  MASSCOM_RELEASE_USE_KEYCHAIN=1 MOCK_KEYCHAIN_RESULT=empty
grep -qF 'release Keychain password could not be loaded' <<<"$out" ||
  fail 'a failed Keychain read was not reported by the builder'

# A certificate other than the approved upload pin stops the build before prebuild and Gradle.
other_pin="$(sed 's/../&:/g; s/:$//' <<<"$(printf '%064d' 0)" | tr '[:lower:]' '[:upper:]')"
expect_rejected 'certificate mismatch' \
  'release keystore certificate does not match the approved upload SHA-256 pin' '' \
  MASSCOM_RELEASE_USE_KEYCHAIN=1 MOCK_KEYTOOL_SHA256="$other_pin"
[[ -e "$log/keytool.log" ]] || fail 'certificate mismatch: keytool did not run'
expect_rejected 'keytool failure' \
  'release keystore certificate does not match the approved upload SHA-256 pin' '' \
  MASSCOM_RELEASE_USE_KEYCHAIN=1 MOCK_KEYTOOL_FAIL=1
expect_rejected 'pin override' \
  'release keystore certificate does not match the approved upload SHA-256 pin' '' \
  MASSCOM_RELEASE_USE_KEYCHAIN=1 MASSCOM_RELEASE_CERT_SHA256="$(printf '%064d' 1)"

# Success up to Gradle: the value reaches only the gradlew child, in ORG_GRADLE_PROJECT_ variables.
assert_gradle_signing() { # <label> [expected UPLOAD_CERT_SHA256 seen by Gradle]
  local label="$1" expected_pin="${2:-$pin}"
  [[ "$status" == 42 ]] || fail "$label: expected the Gradle stub's exit 42, got $status: $out"
  for expected in 'args=bundleRelease --console=plain -q' secret_env_entries=2 \
    password_variables_left=0 store_file=yes store_password=yes key_alias=yes key_password=yes \
    "upload_pin=$expected_pin"; do
    grep -qxF "$expected" "$log/gradle.log" || fail "$label: Gradle saw '$expected'? $(cat "$log/gradle.log")"
  done
  [[ "$(wc -l <"$log/security.log")" -eq 1 ]] || fail "$label: the Keychain was read more than once"
  grep -qxF 'variant=production secret_env_entries=0' "$log/npx.log" ||
    fail "$label: prebuild inherited the value"
}
run 'default paths' MASSCOM_RELEASE_USE_KEYCHAIN=1
assert_gradle_signing 'default paths'
run 'overridden keystore and alias' MASSCOM_RELEASE_USE_KEYCHAIN=1 \
  MASSCOM_RELEASE_KEYSTORE_FILE="$work/keys/other.jks" MASSCOM_RELEASE_KEY_ALIAS=custom.alias \
  MOCK_KEYSTORE="$work/keys/other.jks" MOCK_ALIAS=custom.alias
assert_gradle_signing 'overridden keystore and alias'
run 'caller pin' MASSCOM_RELEASE_USE_KEYCHAIN=1 UPLOAD_CERT_SHA256="$pin_as_keytool_prints_it"
assert_gradle_signing 'caller pin' "$pin_as_keytool_prints_it"

# --restore-dev regenerates the dev project after the failure; that child must not see the value either.
build_args=--restore-dev run 'restore-dev' MASSCOM_RELEASE_USE_KEYCHAIN=1
[[ "$status" == 42 ]] || fail "restore-dev: expected exit 42, got $status: $out"
grep -qxF 'variant=development secret_env_entries=0' "$log/npx.log" ||
  fail 'restore-dev: the dev regeneration inherited the value'

# Without the opt-in the Keychain stays untouched and Gradle gets no signing properties from this script.
for unset_mode in '' 'MASSCOM_RELEASE_USE_KEYCHAIN='; do
  run "no opt-in ($unset_mode)" ${unset_mode:+"$unset_mode"}
  [[ "$status" == 42 ]] || fail "no opt-in: expected the Gradle stub's exit 42, got $status: $out"
  [[ ! -e "$log/security.log" && ! -e "$log/keytool.log" ]] || fail 'no opt-in: the Keychain was used'
  for expected in secret_env_entries=0 store_file=no store_password=no key_alias=no key_password=no \
    upload_pin=unset; do
    grep -qxF "$expected" "$log/gradle.log" || fail "no opt-in: Gradle saw '$expected'? $(cat "$log/gradle.log")"
  done
done

echo 'release Keychain signing boundary verified'
