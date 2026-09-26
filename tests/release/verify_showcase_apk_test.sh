#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
builder="$repo_root/scripts/build-showcase-apk.sh"
scratch="$(mktemp -d -t masscom-showcase-apk-test.XXXXXX)"
trap 'rm -rf "$scratch"' EXIT

key="$scratch/showcase.jks"
printf 'test fixture, not a signing key\n' > "$key"
chmod 600 "$key"
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

[[ -f "$builder" ]] || { echo 'showcase APK builder is missing' >&2; exit 1; }

result="$(env -u EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -u EXPO_PUBLIC_REOWN_PROJECT_ID \
  "${common[@]}" bash "$builder" --check)"
[[ "$result" == *'local showcase APK preflight PASS'* &&
   "$result" == *'hosted API, signature and APK NOT_RUN'* ]] || {
  echo "showcase check overstated readiness: $result" >&2
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

echo 'showcase APK preflight boundaries verified; no APK built'
