import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { createPlayRequests } from './play-requests';

test('초기 조회와 시작 요청은 서로의 취소 controller를 덮어쓰지 않는다', async () => {
  const requests = createPlayRequests();
  const load = requests.beginLoad();
  const start = requests.beginStart();
  assert.equal(load.aborted, false);
  assert.equal(start.aborted, false);
  requests.dispose();
  let updates = 0;
  await Promise.all([load, start].map(async (signal) => {
    await Promise.resolve();
    if (!signal.aborted) updates++;
  }));
  assert.equal(load.aborted, true);
  assert.equal(start.aborted, true);
  assert.equal(updates, 0);
});

test('다시 조회할 때 이전 조회만 취소하고 시작 요청은 유지한다', () => {
  const requests = createPlayRequests();
  const older = requests.beginLoad();
  const start = requests.beginStart();
  const latest = requests.beginLoad();
  assert.equal(older.aborted, true);
  assert.equal(latest.aborted, false);
  assert.equal(start.aborted, false);
  requests.dispose();
});

test('다시 시작할 때 이전 시작만 취소하고 새 mount에서 요청할 수 있다', () => {
  const requests = createPlayRequests();
  const load = requests.beginLoad();
  const older = requests.beginStart();
  const latest = requests.beginStart();
  assert.equal(older.aborted, true);
  assert.equal(latest.aborted, false);
  assert.equal(load.aborted, false);
  requests.dispose();
  assert.equal(requests.beginLoad().aborted, false);
  requests.dispose();
});

test('놀이 화면은 조회·시작 signal을 따로 받아 cleanup에서 모두 취소한다', () => {
  const source = readFileSync(new URL('../screens/play/index.tsx', import.meta.url), 'utf8');
  assert.match(source, /requests\.current\.beginLoad\(\)/);
  assert.match(source, /requests\.current\.beginStart\(\)/);
  assert.match(source, /const pending = requests\.current;/);
  assert.match(source, /return \(\) => \{ active = false; pending\.dispose\(\); \}/);
  assert.match(source, /if \(signal\.aborted\) return;/);
});
