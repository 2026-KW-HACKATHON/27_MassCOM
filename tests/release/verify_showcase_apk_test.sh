#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
builder="$repo_root/scripts/build-showcase-apk.sh"
scratch="$(mktemp -d -t masscom-showcase-apk-test.XXXXXX)"
created_android=false
created_lock=false
created_existing=false
existing_apk=''
cleanup() {
  if [[ "$created_android" == true ]]; then rmdir "$repo_root/apps/mobile/android" 2>/dev/null || true; fi
  if [[ "$created_lock" == true ]]; then
    rmdir "$repo_root/apps/mobile/release-artifacts/.showcase-build.lock" 2>/dev/null || true
  fi
  if [[ "$created_existing" == true ]]; then rm "$existing_apk" 2>/dev/null || true; fi
  rm -rf "$scratch"
}
trap cleanup EXIT

key="$scratch/showcase.jks"
printf 'test fixture, not a signing key\n' > "$key"
chmod 600 "$key"
for banned_name in masscom-upload.jks debug.keystore; do
  printf 'test fixture, not a signing key\n' > "$scratch/$banned_name"
  chmod 600 "$scratch/$banned_name"
done
common=(
  MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID=123-showcase.apps.googleusercontent.com
  MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID=456-operating.apps.googleusercontent.com
  MASSCOM_SHOWCASE_KEYSTORE_FILE="$key"
  MASSCOM_SHOWCASE_KEY_ALIAS=masscom-showcase
  MASSCOM_SHOWCASE_CERT_SHA256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
)

expect_rejected() {
  local label="$1" expected="$2"
  shift 2
  local output status=0
  output="$(env -u EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -u EXPO_PUBLIC_REOWN_PROJECT_ID \
    "${common[@]}" "$@" bash "$builder" --check 2>&1)" || status=$?
  if [[ "$status" == 0 || "$output" != *"$expected"* ]]; then
    echo "$label did not fail closed: $output" >&2
    exit 1
  fi
}

expect_build_rejected() {
  local label="$1" expected="$2" output status=0
  output="$(env -u EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -u EXPO_PUBLIC_REOWN_PROJECT_ID \
    "${common[@]}" bash "$builder" --build 2>&1)" || status=$?
  if [[ "$status" == 0 || "$output" != *"$expected"* ]]; then
    echo "$label did not fail closed: $output" >&2
    exit 1
  fi
}

[[ -f "$builder" ]] || { echo 'showcase APK builder is missing' >&2; exit 1; }

result="$(env -u EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -u EXPO_PUBLIC_REOWN_PROJECT_ID \
  "${common[@]}" bash "$builder" --check)"
[[ "$result" == *'local showcase APK preflight PASS'* &&
   "$result" == *'hosted API, signature and APK NOT_RUN'* ]] || {
  echo "showcase check overstated readiness: $result" >&2
  exit 1
}

mkdir "$scratch/bin"
printf '%s\n' \
  '#!/bin/sh' \
  'if [ "$1" = "-c" ]; then echo 600; exit 0; fi' \
  'if [ "$1" = "-f" ]; then echo "GNU filesystem data"; exit 0; fi' \
  'exit 1' > "$scratch/bin/stat"
chmod +x "$scratch/bin/stat"
result="$(env -u EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -u EXPO_PUBLIC_REOWN_PROJECT_ID \
  PATH="$scratch/bin:$PATH" "${common[@]}" bash "$builder" --check)"
[[ "$result" == *'local showcase APK preflight PASS'* ]] || {
  echo 'GNU stat filesystem output was mistaken for a permission mode' >&2
  exit 1
}

expect_rejected 'operating Google audience' 'dedicated Google Web client' \
  MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID=456-operating.apps.googleusercontent.com
expect_rejected 'inherited operating audience' 'showcase build rejects EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID' \
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=456-operating.apps.googleusercontent.com
expect_rejected 'inherited wallet project' 'showcase build rejects EXPO_PUBLIC_REOWN_PROJECT_ID' \
  EXPO_PUBLIC_REOWN_PROJECT_ID=production-wallet-project
expect_rejected 'inherited operating API' 'showcase build rejects EXPO_PUBLIC_API_URL' \
  EXPO_PUBLIC_API_URL=https://api.masscom.kr
expect_rejected 'insecure demo account' 'showcase build rejects EXPO_PUBLIC_DEMO_ACCOUNT_ID' \
  EXPO_PUBLIC_DEMO_ACCOUNT_ID=development-only
expect_rejected 'operating keystore' 'showcase-only keystore is required' \
  MASSCOM_SHOWCASE_KEYSTORE_FILE="$scratch/masscom-upload.jks"
expect_rejected 'debug keystore' 'showcase-only keystore is required' \
  MASSCOM_SHOWCASE_KEYSTORE_FILE="$scratch/debug.keystore"
expect_rejected 'operating certificate' 'showcase certificate must differ from operating upload certificate' \
  MASSCOM_SHOWCASE_CERT_SHA256=5e5ed3c31971e5a88ea752b3a2ae50772fea1c956b9d97a82dd5ca7130cfa395
expect_rejected 'missing keystore' 'showcase-only keystore is required' \
  MASSCOM_SHOWCASE_KEYSTORE_FILE="$scratch/missing.jks"
expect_rejected 'unsupported Keychain mode' 'showcase Keychain mode must be 1' \
  MASSCOM_SHOWCASE_USE_KEYCHAIN=unexpected

chmod 644 "$key"
expect_rejected 'readable keystore' 'showcase keystore must have mode 400 or 600'
chmod 600 "$key"
ln -s "$key" "$scratch/link.jks"
expect_rejected 'symlink keystore' 'showcase-only keystore is required' \
  MASSCOM_SHOWCASE_KEYSTORE_FILE="$scratch/link.jks"

[[ ! -e "$repo_root/apps/mobile/android" ]] || {
  echo 'showcase --check unexpectedly created a native Android project' >&2
  exit 1
}
bash "$repo_root/scripts/check-secrets.sh" "$builder" >/dev/null || {
  echo 'showcase builder is rejected by repository secret scanning' >&2
  exit 1
}
mkdir "$repo_root/apps/mobile/android"
created_android=true
expect_build_rejected 'existing native project' 'existing native Android project must not be overwritten'
rmdir "$repo_root/apps/mobile/android"
created_android=false

mkdir -p "$repo_root/apps/mobile/release-artifacts"
mkdir "$repo_root/apps/mobile/release-artifacts/.showcase-build.lock"
created_lock=true
expect_build_rejected 'concurrent builder' 'another showcase APK build is already running'
rmdir "$repo_root/apps/mobile/release-artifacts/.showcase-build.lock"
created_lock=false

short_commit="$(git -C "$repo_root" rev-parse --short=7 HEAD)"
existing_apk="$repo_root/apps/mobile/release-artifacts/MassCOM-showcase-android-$short_commit.apk"
printf 'existing artifact must not be overwritten\n' > "$existing_apk"
created_existing=true
expect_build_rejected 'existing artifact' 'showcase artifact already exists; refusing overwrite'
[[ "$(<"$existing_apk")" == 'existing artifact must not be overwritten' ]] || {
  echo 'existing showcase artifact was changed' >&2
  exit 1
}
rm "$existing_apk"
created_existing=false

echo 'showcase APK preflight boundaries verified; no APK built'
