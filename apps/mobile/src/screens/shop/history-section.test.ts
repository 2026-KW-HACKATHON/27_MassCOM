import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('./history-section.tsx', import.meta.url)), 'utf8');

test('PR #312 리뷰 1번: "더 보기"는 불러오는 중이면 비활성화되고, load() 자체도 ref로 두 번째 시작을 막는다', () => {
  assert.match(source, /const statusRef = useRef\(state\.status\);/);
  const loadFn = source.slice(source.indexOf('async function load('), source.indexOf('useEffect(() => {\n    if (refreshToken'));
  assert.match(loadFn, /if \(!canStartHistoryLoad\(statusRef\.current\)\) return;/);
  assert.match(loadFn, /statusRef\.current = 'loading';/);
  const loadMoreButton = source.slice(source.indexOf('{state.nextCursor ?'), source.indexOf('</View>\n      )}'));
  assert.match(loadMoreButton, /disabled=\{state\.status === 'loading'\}/);
  assert.match(loadMoreButton, /accessibilityState=\{\{ disabled: state\.status === 'loading' \}\}/);
});

test('PR #312 리뷰 6번: refreshToken이 바뀌면 첫 페이지부터 다시 불러오거나(펼쳐져 있으면), 다음에 펼칠 때 다시 불러오도록 idle로 되돌린다', () => {
  const effect = source.slice(source.indexOf('useEffect(() => {\n    if (refreshToken'), source.indexOf('function toggle()'));
  assert.match(effect, /if \(refreshToken === seenRefreshToken\.current\) return;/);
  assert.match(effect, /setState\(initialHistoryLoad\);/);
  assert.match(effect, /if \(expandedRef\.current\) void load\(\);/);
  assert.match(source, /export function HistorySection\(\{ api, refreshToken \}: \{ api: Pick<ShopApiClient, 'getHistory'>; refreshToken: number \}\)/);
});
