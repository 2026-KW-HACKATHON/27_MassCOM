import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createMemoryHistory } = require('expo-router/build/fork/createMemoryHistory');

/**
 * 하위 화면에서 하단 탭(dismissTo)으로 가면 Stack이 줄어든다. expo-router 웹 history는 줄어든 만큼 `history.go(-n)` 한 뒤 앞 항목을 새 경로로
 * 덮어써서(replace), 앱의 이전 화면이 기록에서 사라지고 뒤로 가기가 앱 밖으로 나갔다. 패치는 "이전 항목 중 같은 경로가 없으면" push로 바꾼다.
 */
test('a popped-to path that no earlier entry holds is told apart from a real step back', () => {
  const previous = { window: Reflect.get(globalThis, 'window'), location: Reflect.get(globalThis, 'location') };
  const browser = { state: null as unknown, pushState(state: unknown) { this.state = state; }, replaceState(state: unknown) { this.state = state; } };
  Reflect.set(globalThis, 'window', { history: browser, addEventListener() {}, removeEventListener() {}, document: { title: '' } });
  Reflect.set(globalThis, 'location', { hash: '' });
  try {
    const history = createMemoryHistory();
    history.replace({ path: '/play/', state: 'home' });
    history.push({ path: '/play/room-explore', state: 'room-explore' });
    // 탐색 탭: 이전 항목(/play/)과 경로가 다르다 → 새 목적지(push).
    assert.equal(history.backIndex({ path: '/play/search' }), -1);
    // 홈 탭: 이전 항목과 같은 경로 → 뒤로 가기(go)로 처리한다.
    assert.equal(history.backIndex({ path: '/play/' }), 0);
  } finally {
    Reflect.set(globalThis, 'window', previous.window);
    Reflect.set(globalThis, 'location', previous.location);
  }
});

test('the installed expo-router web history pushes instead of overwriting the previous screen, and the patch is pinned to that version', () => {
  const installed = readFileSync(require.resolve('expo-router/build/fork/useLinking.js'), 'utf8');
  assert.match(installed, /if \(nextIndex === -1\) \{\s*history\.push\(\{ path, state \}\);\s*return;\s*\}/);
  // The push comes before the go-back branch, so a back step to a known path is unchanged.
  assert.ok(installed.indexOf('if (nextIndex === -1)') < installed.indexOf('await history.go(historyDelta)'));
  const version = JSON.parse(readFileSync(require.resolve('expo-router/package.json'), 'utf8')).version;
  const patch = readFileSync(fileURLToPath(new URL(`../../patches/expo-router+${version}.patch`, import.meta.url)), 'utf8');
  assert.match(patch, /node_modules\/expo-router\/build\/fork\/useLinking\.js/);
  assert.match(patch, /\+\s+if \(nextIndex === -1\) \{/);
});
