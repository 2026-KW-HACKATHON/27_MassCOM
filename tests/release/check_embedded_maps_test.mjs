import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../../scripts/check-embedded-maps.mjs', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'masscom-embedded-maps-'));
const tmap = 'public-tmap-test-id';
const naver = 'public-naver-test-id';
const baseEnv = { ...process.env, EXPO_PUBLIC_TMAP_MAP_APP_KEY: tmap, EXPO_PUBLIC_NAVER_MAP_CLIENT_ID: naver };
for (const name of ['NAVER_MAP_CLIENT_SECRET', 'NAVER_SEARCH_CLIENT_SECRET']) delete baseEnv[name];

function archive(name, config = { sdkAppKey: tmap, naverClientId: naver }, bundle = Buffer.from(`\0${tmap}\0${naver}\0`)) {
  const stage = join(work, `${name}-stage`);
  const prefix = name.endsWith('.aab') ? 'base/assets' : 'assets';
  mkdirSync(join(stage, prefix), { recursive: true });
  writeFileSync(join(stage, prefix, 'app.config'), JSON.stringify({ extra: { masscomMaps: config } }));
  writeFileSync(join(stage, prefix, 'index.android.bundle'), bundle);
  const target = join(work, name);
  execFileSync('zip', ['-q', '-r', target, '.'], { cwd: stage });
  return target;
}

function check(path, env = baseEnv) {
  return spawnSync(process.execPath, [script, path], { env, encoding: 'utf8' });
}

test('public IDs must appear in both Expo config and binary JS bundle for APK and AAB', () => {
  for (const name of ['showcase.apk', 'showcase.aab']) {
    const result = check(archive(name));
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /public-tmap-test-id|public-naver-test-id/);
  }
});

test('missing or stale IDs fail without printing the ID', () => {
  const missingBundle = check(archive('missing-bundle.apk', undefined, Buffer.from(`\0${tmap}\0`)));
  assert.equal(missingBundle.status, 1);
  assert.match(missingBundle.stderr, /NAVER public ID is missing or mismatched/);
  const staleConfig = check(archive('stale-config.aab', { sdkAppKey: 'stale', naverClientId: naver }));
  assert.equal(staleConfig.status, 1);
  assert.match(staleConfig.stderr, /TMAP public ID is missing or mismatched/);
  assert.doesNotMatch(missingBundle.stderr + staleConfig.stderr, /public-tmap-test-id|public-naver-test-id/);
});

test('one configured public provider is sufficient, none is rejected', () => {
  const onlyTmap = { ...baseEnv };
  delete onlyTmap.EXPO_PUBLIC_NAVER_MAP_CLIENT_ID;
  assert.equal(check(archive('single-provider.apk'), onlyTmap).status, 0);
  delete onlyTmap.EXPO_PUBLIC_TMAP_MAP_APP_KEY;
  assert.match(check(archive('no-provider.apk'), onlyTmap).stderr, /no public map ID configured/);
});

test('shared public IDs and a server secret in the checking environment are safe when absent from artifact', () => {
  const env = { ...baseEnv, TMAP_REST_APP_KEY: tmap, NAVER_MAP_CLIENT_ID: naver,
    NAVER_MAP_CLIENT_SECRET: 'private-test-secret' };
  assert.equal(check(archive('safe.apk'), env).status, 0);
});

test('embedded server secret is rejected without printing its value', () => {
  const result = check(archive('secret.apk', undefined, Buffer.from(`\0${tmap}\0${naver}\0private-test-secret\0`)),
    { ...baseEnv, NAVER_MAP_CLIENT_SECRET: 'private-test-secret' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NAVER_MAP_CLIENT_SECRET/);
  assert.doesNotMatch(result.stderr, /private-test-secret/);
  const configResult = check(archive('secret-config.aab', {
    sdkAppKey: tmap, naverClientId: naver, accidentalSecret: 'private-test-secret',
  }), { ...baseEnv, NAVER_MAP_CLIENT_SECRET: 'private-test-secret' });
  assert.equal(configResult.status, 1);
  assert.match(configResult.stderr, /NAVER_MAP_CLIENT_SECRET/);
  assert.doesNotMatch(configResult.stderr, /private-test-secret/);
});

test('unreadable archive fails closed', () => {
  const bad = join(work, 'bad.apk');
  writeFileSync(bad, 'bad zip');
  assert.equal(check(bad).status, 1);
});

test.after(() => rmSync(work, { recursive: true, force: true }));
