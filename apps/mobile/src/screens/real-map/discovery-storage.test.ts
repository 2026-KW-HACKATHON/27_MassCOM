import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { discoveryStorageKeys, loadDiscoveryStorage } from './discovery-storage';

test('discovery storage separates account and environment and discards legacy shared values', async () => {
  const a = discoveryStorageKeys({ accountId: 'A', apiUrl: 'https://api.example/a', packageId: 'app.demo' });
  const b = discoveryStorageKeys({ accountId: 'B', apiUrl: 'https://api.example/a', packageId: 'app.demo' });
  const other = discoveryStorageKeys({ accountId: 'A', apiUrl: 'https://other.example/a', packageId: 'app.demo' });
  assert.notEqual(a.navigation, b.navigation);
  assert.notEqual(a.course, other.course);
  const values = new Map([
    ['@masscom:discovery:navigation', 'private-A'],
    ['@masscom:discovery:course', 'private-course-A'],
    [a.navigation, 'saved-A'],
    [a.course, 'saved-course-A'],
  ]);
  const storage = {
    async getItem(key: string) { return values.get(key) ?? null; },
    async removeItem(key: string) { values.delete(key); },
  };
  assert.deepEqual(await loadDiscoveryStorage(storage, b), [null, null]);
  assert.equal(values.has('@masscom:discovery:navigation'), false);
  assert.equal(values.has('@masscom:discovery:course'), false);
  assert.deepEqual(await loadDiscoveryStorage(storage, a), ['saved-A', 'saved-course-A']);
  values.set('@masscom:discovery:navigation', 'private-A');
  assert.deepEqual(await loadDiscoveryStorage(storage, null), [null, null]);
  assert.equal(values.has('@masscom:discovery:navigation'), false);
});

test('map hydration and writes are guarded by the current account scope', () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(source, /if\(!alive\)return; discoveryState\.restore\(nav\)/);
  assert.match(source, /return\(\)=>\{alive=false;\}/);
  assert.match(source, /hydratedScope\.current===storageScope/g);
  assert.match(source, /loadDiscoveryStorage\(AsyncStorage,storageKeys\)/);
  assert.match(source, /setManualText\(''\);setPlaces\(\[\]\)/);
});

test('계정 전환 뒤 이전 출발 주소 조회가 새 계정 화면에 돌아오지 않는다', async () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function findManualOrigin()'), source.indexOf('const chooseManual='));
  let resolve!: (value: unknown) => void;
  const response = new Promise((done) => { resolve = done; });
  const generation = { current: 1 };
  let places: unknown[] = [];
  let message = '';
  const find = new Function('api', 'locationGeneration', 'manualText', 'setOriginMessage', 'setPlaces', 'DiscoveryApiError',
    `${body}; return findManualOrigin;`)({ places: () => response }, generation, 'A의 주소',
    (value: string) => { message = value; }, (value: unknown[]) => { places = value; }, Error);
  const pending = find();
  generation.current++;
  message = '';
  resolve({ places: [{ id: 'A', expiresAt: new Date(Date.now() + 60_000).toISOString() }] });
  await pending;
  assert.deepEqual(places, []);
  assert.equal(message, '');
});
