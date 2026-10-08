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
  EXPO_PUBLIC_TMAP_MAP_APP_KEY=public-tmap-test-id
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

# 실제 네트워크·서명 없이 빌드의 API 준비 검사를 실행한다.
node --input-type=module - "$builder" "$repo_root/apps/api/src/showcase/wolgye-stores.json" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(process.argv[2], 'utf8');
const data = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const block = source.split('node - "$repo_root/apps/api/src/showcase/wolgye-stores.json" <<\'NODE\'\n')[1]?.split('\nNODE')[0];
assert.ok(block, 'API preflight block exists');
const real = data.stores.map(({ id }) => ({ id, demo: true }));
for (const [merchants, expected] of [
  [real, undefined],
  [real.slice(0, 29), 1],
  [[...real, real[0]], 1],
  [[{ ...real[0], id: 'showcase-local-merchant' }, ...real.slice(1)], 1],
  [[{ ...real[0], demo: false }, ...real.slice(1)], 1],
  [[real[1], ...real.slice(1)], 1],
]) {
  const fakeProcess = { argv: ['node', '-', 'stores.json'] };
  await runInNewContext(block, {
    require: () => data, process: fakeProcess, Set, AbortSignal,
    console: { error() {} },
    fetch: async (url) => ({ ok: true, json: async () => url.endsWith('/health') ? { status: 'ok' } : { merchants } }),
  });
  assert.equal(fakeProcess.exitCode, expected);
}
NODE

result="$(env -u EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -u EXPO_PUBLIC_REOWN_PROJECT_ID \
  "${common[@]}" bash "$builder" --check)"
[[ "$result" == *'local showcase APK preflight PASS'* &&
   "$result" == *'hosted API, signature and APK NOT_RUN'* ]] || {
  echo "showcase check overstated readiness: $result" >&2
  exit 1
}
result="$(env -u EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -u EXPO_PUBLIC_REOWN_PROJECT_ID \
  "${common[@]}" MASSCOM_SHOWCASE_REOWN_PROJECT_ID=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bash "$builder" --check)"
[[ "$result" == *'local showcase APK preflight PASS'* ]] || {
  echo 'dedicated showcase wallet project was rejected' >&2
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
expect_rejected 'malformed showcase wallet project' 'MASSCOM_SHOWCASE_REOWN_PROJECT_ID must be 32 hexadecimal characters' \
  MASSCOM_SHOWCASE_REOWN_PROJECT_ID=invalid
expect_rejected 'missing showcase TMAP map ID' 'showcase EXPO_PUBLIC_TMAP_MAP_APP_KEY is required' \
  EXPO_PUBLIC_TMAP_MAP_APP_KEY=
expect_rejected 'blank showcase TMAP map ID' 'showcase EXPO_PUBLIC_TMAP_MAP_APP_KEY is required' \
  EXPO_PUBLIC_TMAP_MAP_APP_KEY='   '
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

trace_status=0
trace_output="$(env -u EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID -u EXPO_PUBLIC_REOWN_PROJECT_ID \
  "${common[@]}" bash -x "$builder" --check 2>&1)" || trace_status=$?
[[ "$trace_status" != 0 && "$trace_output" == *'showcase signing refuses shell tracing'* ]] || {
  echo 'showcase builder did not refuse shell tracing' >&2
  exit 1
}

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
node - "$builder" "$scratch" <<'NODE'
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const source = readFileSync(process.argv[2], 'utf8');
for (const value of [
  'EXPO_PUBLIC_TMAP_MAP_APP_KEY="$tmap_map_key" EXPO_PUBLIC_NAVER_MAP_CLIENT_ID="$naver_map_client"',
  'node "$repo_root/scripts/check-embedded-maps.mjs" "$embedded_artifact"',
  "config.extra?.masscomShowcase?.reownProjectId !== process.env.MASSCOM_SHOWCASE_REOWN_PROJECT_ID",
  "embeddedMaps: 'PASS'",
]) assert.ok(source.includes(value), `showcase build gate missing: ${value}`);
assert.equal(source.split('EXPO_PUBLIC_TMAP_MAP_APP_KEY="$tmap_map_key" EXPO_PUBLIC_NAVER_MAP_CLIENT_ID="$naver_map_client"').length - 1, 2);
assert.ok(source.indexOf('cp "$built_apk" "$apk"') < source.indexOf('node "$repo_root/scripts/check-embedded-maps.mjs" "$embedded_artifact"'));
assert.ok(source.indexOf('node "$repo_root/scripts/check-embedded-maps.mjs" "$embedded_artifact"') < source.indexOf("embeddedMaps: 'PASS'"));
const reownCheck = source.split('    node - "$embedded_artifact" <<\'NODE\'\n')[1]?.split('\nNODE')[0];
assert.ok(reownCheck, 'archive Reown check must exist');
const expectedId = 'a'.repeat(32);
for (const extension of ['apk', 'aab']) {
  const entry = extension === 'aab' ? 'base/assets' : 'assets';
  const folder = join(process.argv[3], `${extension}-config`);
  mkdirSync(join(folder, entry), { recursive: true });
  const configPath = join(folder, entry, 'app.config');
  const artifact = join(process.argv[3], `wallet-check.${extension}`);
  for (const [embeddedId, accepted] of [[expectedId, true], ['b'.repeat(32), false]]) {
    writeFileSync(configPath, JSON.stringify({ extra: { masscomShowcase: { reownProjectId: embeddedId } } }));
    rmSync(artifact, { force: true });
    execFileSync('zip', ['-q', '-r', artifact, '.'], { cwd: folder });
    const result = spawnSync(process.execPath, ['-', artifact], {
      input: reownCheck,
      encoding: 'utf8',
      env: { ...process.env, MASSCOM_SHOWCASE_REOWN_PROJECT_ID: expectedId },
    });
    assert.equal(result.status, accepted ? 0 : 1, `${extension}: ${result.stderr}`);
    assert.ok(!result.stderr.includes(expectedId), 'Reown ID must not appear in error output');
  }
}
NODE
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
if [[ ! -e "$existing_apk" ]]; then
  printf 'existing artifact must not be overwritten\n' > "$existing_apk"
  created_existing=true
fi
before_digest="$(shasum -a 256 "$existing_apk" | awk '{print $1}')"
expect_build_rejected 'existing artifact' 'showcase artifact already exists; refusing overwrite'
after_digest="$(shasum -a 256 "$existing_apk" | awk '{print $1}')"
[[ "$before_digest" == "$after_digest" ]] || {
  echo 'existing showcase artifact was changed' >&2
  exit 1
}
if [[ "$created_existing" == true ]]; then
  rm "$existing_apk"
  created_existing=false
fi

echo 'showcase APK preflight boundaries verified; no APK built'
