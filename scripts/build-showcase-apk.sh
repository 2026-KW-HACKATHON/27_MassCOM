#!/usr/bin/env bash
# Build only the isolated showcase package. A local check never produces an APK.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
mobile_dir="$repo_root/apps/mobile"
mode="${1:---build}"
[[ $# -le 1 && ( "$mode" == '--check' || "$mode" == '--build' ) ]] || {
  echo 'usage: build-showcase-apk.sh [--check|--build]' >&2
  exit 2
}

fail() { echo "$*" >&2; exit 1; }

showcase_client="${MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID:-}"
operating_client="${MASSCOM_OPERATING_GOOGLE_WEB_CLIENT_ID:-}"
client_pattern='^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$'
[[ "$showcase_client" =~ $client_pattern && "$operating_client" =~ $client_pattern &&
   "$showcase_client" != "$operating_client" ]] || fail 'dedicated Google Web client is required'

for variable in EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID EXPO_PUBLIC_REOWN_PROJECT_ID \
  EXPO_PUBLIC_API_URL EXPO_PUBLIC_DEMO_ACCOUNT_ID \
  EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID EXPO_PUBLIC_DEMO_MERCHANT_ID \
  EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION; do
  [[ -z "${!variable:-}" ]] || fail "showcase build rejects $variable"
done
[[ -z "${APP_VARIANT:-}" || "$APP_VARIANT" == showcase ]] || fail 'showcase build rejects another APP_VARIANT'

keystore="${MASSCOM_SHOWCASE_KEYSTORE_FILE:-}"
[[ "$keystore" == /* && -f "$keystore" && ! -L "$keystore" ]] ||
  fail 'showcase-only keystore is required'
case "$(basename "$keystore")" in
  masscom-upload.jks|debug.keystore) fail 'showcase-only keystore is required' ;;
esac
keystore_dir="$(cd -P "$(dirname "$keystore")" && pwd -P)"
[[ "$keystore_dir/$(basename "$keystore")" != "$repo_root"/* ]] ||
  fail 'showcase-only keystore must stay outside the repository'
keystore_mode="$(stat -c '%a' "$keystore" 2>/dev/null || true)"
if [[ ! "$keystore_mode" =~ ^[0-9]{3,4}$ ]]; then
  keystore_mode="$(stat -f '%Lp' "$keystore" 2>/dev/null)" ||
    fail 'could not inspect showcase keystore permissions'
fi
[[ "$keystore_mode" == 400 || "$keystore_mode" == 600 ]] ||
  fail 'showcase keystore must have mode 400 or 600'
alias_name="${MASSCOM_SHOWCASE_KEY_ALIAS:-}"
[[ "$alias_name" =~ ^[A-Za-z0-9._-]+$ ]] || fail 'showcase key alias is required'
certificate="$(printf '%s' "${MASSCOM_SHOWCASE_CERT_SHA256:-}" | tr -d ':' | tr '[:upper:]' '[:lower:]')"
[[ "$certificate" =~ ^[0-9a-f]{64}$ ]] || fail 'showcase certificate SHA-256 pin is required'
[[ "$certificate" != 5e5ed3c31971e5a88ea752b3a2ae50772fea1c956b9d97a82dd5ca7130cfa395 ]] ||
  fail 'showcase certificate must differ from operating upload certificate'

if [[ "$mode" == --check ]]; then
  echo 'local showcase APK preflight PASS; hosted API, signature and APK NOT_RUN'
  exit 0
fi

[[ ! -e "$mobile_dir/android" ]] || fail 'existing native Android project must not be overwritten'
lock_path="$mobile_dir/release-artifacts/.showcase-build.lock"
[[ ! -e "$lock_path" ]] || fail 'another showcase APK build is already running'
commit="$(git -C "$repo_root" rev-parse --verify HEAD)"
artifacts="$mobile_dir/release-artifacts"
basename="MassCOM-showcase-android-${commit:0:7}"
target="$artifacts/$basename.apk"
provenance="$artifacts/$basename.provenance.json"
[[ ! -e "$target" && ! -e "$provenance" ]] || fail 'showcase artifact already exists; refusing overwrite'
git_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-dir)"
common_dir="$(git -C "$repo_root" rev-parse --path-format=absolute --git-common-dir)"
[[ "$git_dir" != "$common_dir" ]] || fail 'showcase build requires an isolated Git worktree'
[[ -z "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]] ||
  fail 'showcase build requires a clean Git worktree'
mkdir -p "$artifacts"
mkdir "$lock_path" 2>/dev/null || fail 'another showcase APK build is already running'
staging=''
cleanup_build() {
  unset store_password key_password MASSCOM_SHOWCASE_STORE_PASSWORD MASSCOM_SHOWCASE_KEY_PASSWORD
  if [[ -n "$staging" && -d "$staging" ]]; then
    echo "staged APK evidence remains at $staging" >&2
  fi
  rmdir "$lock_path" 2>/dev/null || echo 'showcase build lock needs inspection' >&2
}
trap cleanup_build EXIT
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
tools_dir="$ANDROID_HOME/build-tools/36.0.0"
for tool in aapt apksigner; do
  [[ -x "$tools_dir/$tool" ]] || fail "Android build tool 36.0.0 is missing: $tool"
done

EXPO_NO_DOTENV=1 APP_VARIANT=showcase MASSCOM_BUILD_SOURCE_COMMIT="$commit" \
  EXPO_PUBLIC_API_URL=https://demo-api.masscom.kr \
  node - "$mobile_dir/src/config/build-environment.cjs" <<'NODE'
const { validateBuildEnvironment } = require(process.argv[2]);
validateBuildEnvironment('showcase', {
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  MASSCOM_BUILD_SOURCE_COMMIT: process.env.MASSCOM_BUILD_SOURCE_COMMIT,
  MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID: process.env.MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID,
});
NODE

node <<'NODE'
const api = 'https://demo-api.masscom.kr';
(async () => {
  const health = await fetch(`${api}/health`, { signal: AbortSignal.timeout(8000) });
  if (!health.ok || (await health.json()).status !== 'ok') throw new Error('showcase API health is not ready');
  const catalog = await fetch(`${api}/merchants`, { signal: AbortSignal.timeout(8000) });
  const body = await catalog.json();
  if (!catalog.ok || !Array.isArray(body.merchants) || body.merchants.length < 3 ||
      !body.merchants.every((merchant) => merchant.demo === true)) {
    throw new Error('showcase API does not serve only three or more virtual merchants');
  }
})().catch(() => { console.error('SHOWCASE_API_NOT_READY'); process.exitCode = 1; });
NODE

[[ -t 0 ]] || fail 'interactive terminal is required for the owner-managed showcase keystore password'
read -r -s -p '시연 키 저장소 비밀번호 입력: ' store_password
printf '\n'
read -r -s -p '시연 키 비밀번호 입력 (같으면 Enter): ' key_password
printf '\n'
[[ -n "$store_password" ]] || fail 'showcase keystore password is required'
key_password="${key_password:-$store_password}"

set_signing_environment() {
  printf -v MASSCOM_SHOWCASE_STORE_PASSWORD '%s' "$store_password"
  printf -v MASSCOM_SHOWCASE_KEY_PASSWORD '%s' "$key_password"
  export MASSCOM_SHOWCASE_STORE_PASSWORD MASSCOM_SHOWCASE_KEY_PASSWORD
}

set_signing_environment
fingerprint="$(keytool -J-Duser.language=en -list -v -keystore "$keystore" -alias "$alias_name" \
  -storepass:env MASSCOM_SHOWCASE_STORE_PASSWORD 2>/dev/null \
  | sed -n 's/.*SHA256: *//p' | head -1 | tr -d ':' | tr '[:upper:]' '[:lower:]')"
[[ "$fingerprint" == "$certificate" ]] || fail 'showcase keystore certificate does not match the approved SHA-256 pin'
unset MASSCOM_SHOWCASE_STORE_PASSWORD MASSCOM_SHOWCASE_KEY_PASSWORD

cd "$mobile_dir"
CI=1 EXPO_NO_DOTENV=1 APP_VARIANT=showcase MASSCOM_BUILD_SOURCE_COMMIT="$commit" \
  MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID="$showcase_client" \
  EXPO_PUBLIC_API_URL=https://demo-api.masscom.kr \
  npx --no-install expo prebuild --platform android --clean --no-install
set_signing_environment
MASSCOM_SHOWCASE_KEYSTORE_FILE="$keystore" MASSCOM_SHOWCASE_KEY_ALIAS="$alias_name" \
  CI=1 NODE_ENV=production EXPO_NO_DOTENV=1 APP_VARIANT=showcase \
  MASSCOM_BUILD_SOURCE_COMMIT="$commit" MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID="$showcase_client" \
  EXPO_PUBLIC_API_URL=https://demo-api.masscom.kr \
  node - "$mobile_dir/android" <<'NODE'
const { spawnSync } = require('node:child_process');
const env = { ...process.env,
  'ORG_GRADLE_PROJECT_android.injected.signing.store.file': process.env.MASSCOM_SHOWCASE_KEYSTORE_FILE,
  'ORG_GRADLE_PROJECT_android.injected.signing.store.password': process.env.MASSCOM_SHOWCASE_STORE_PASSWORD,
  'ORG_GRADLE_PROJECT_android.injected.signing.key.alias': process.env.MASSCOM_SHOWCASE_KEY_ALIAS,
  'ORG_GRADLE_PROJECT_android.injected.signing.key.password': process.env.MASSCOM_SHOWCASE_KEY_PASSWORD,
};
delete env.MASSCOM_SHOWCASE_STORE_PASSWORD;
delete env.MASSCOM_SHOWCASE_KEY_PASSWORD;
const result = spawnSync('./gradlew', ['assembleRelease', 'bundleRelease', '--console=plain'], {
  cwd: process.argv[2], env, stdio: 'inherit',
});
process.exit(result.status ?? 1);
NODE
unset store_password key_password MASSCOM_SHOWCASE_STORE_PASSWORD MASSCOM_SHOWCASE_KEY_PASSWORD

[[ "$(git -C "$repo_root" rev-parse HEAD)" == "$commit" &&
   -z "$(git -C "$repo_root" status --porcelain --untracked-files=normal)" ]] ||
  fail 'source changed during showcase build'
built_apk="$mobile_dir/android/app/build/outputs/apk/release/app-release.apk"
built_aab="$mobile_dir/android/app/build/outputs/bundle/release/app-release.aab"
[[ -s "$built_apk" && -s "$built_aab" ]] || fail 'showcase APK or companion AAB is missing'
staging="$(mktemp -d "$artifacts/.showcase-apk.XXXXXX")"
apk="$staging/$basename.apk"
aab="$staging/$basename.aab"
cp "$built_apk" "$apk"
cp "$built_aab" "$aab"
badging="$("$tools_dir/aapt" dump badging "$apk")" || fail 'APK manifest is unreadable'
[[ "$badging" == *"package: name='kr.masscom.wolgye.demo' "* ]] ||
  fail 'APK package is not the showcase package'
manifest="$("$tools_dir/aapt" dump xmltree "$apk" AndroidManifest.xml)" ||
  fail 'APK manifest is unreadable'
source_entry="$(grep -A1 -F 'kr.masscom.BUILD_SOURCE_COMMIT' <<< "$manifest")" ||
  fail 'APK source commit marker is missing'
[[ "$source_entry" == *"\"$commit\""* ]] || fail 'APK source commit marker is missing'
signature_report="$("$tools_dir/apksigner" verify --verbose --print-certs "$apk")" ||
  fail 'APK signature verification failed'
signed_certificate="$(sed -n 's/^Signer #1 certificate SHA-256 digest: *//p' <<< "$signature_report" | head -1)"
[[ "$signed_certificate" == "$certificate" ]] || fail 'APK signature does not match the approved showcase certificate'
EXPECTED_PACKAGE=kr.masscom.wolgye.demo \
  "$repo_root/scripts/check-release-wallet-surface.sh" "$aab" "$mobile_dir/src"

node - "$apk" "$staging/$basename.provenance.json" "$commit" "$certificate" <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, statSync, writeFileSync } = require('node:fs');
const [apkPath, resultPath, sourceCommit, certificateSha256] = process.argv.slice(2);
const artifact = readFileSync(apkPath);
writeFileSync(resultPath, JSON.stringify({
  sourceCommit,
  package: 'kr.masscom.wolgye.demo',
  apiOrigin: 'https://demo-api.masscom.kr',
  artifact: { basename: apkPath.split('/').pop(), sha256: createHash('sha256').update(artifact).digest('hex'), bytes: statSync(apkPath).size },
  signingCertificateSha256: certificateSha256,
  checks: { api: 'PASS', package: 'PASS', sourceMarker: 'PASS', signature: 'PASS', walletSurface: 'PASS' },
  deviceInstall: 'NOT_RUN',
  githubRelease: 'NOT_RUN',
}, null, 2) + '\n', { mode: 0o600 });
NODE
ln "$apk" "$target"
if ! ln "$staging/$basename.provenance.json" "$provenance"; then
  rm "$target"
  fail 'could not publish showcase provenance without overwriting'
fi
rm "$apk" "$aab" "$staging/$basename.provenance.json"
rmdir "$staging"
staging=''
echo "Showcase APK built: $target"
echo "SHA-256: $(shasum -a 256 "$target" | awk '{print $1}')"
echo "Provenance: $provenance"
echo 'Device install and GitHub release: NOT_RUN'
