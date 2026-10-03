import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { detailViewSource, sendMerchantDetailView } from './detail-view-api';

test('허용된 출처만 전달하고 모르는 값은 link로 처리한다', () => {
  assert.equal(detailViewSource('recommendation'), 'recommendation');
  assert.equal(detailViewSource('friend'), 'friend');
  assert.equal(detailViewSource('unknown'), 'link');
  assert.equal(detailViewSource(undefined), 'link');
});

test('유지된 상세 화면에 다음 KST 날짜에 복귀하면 다시 집계하고 같은 날에는 중복하지 않는다', async () => {
  const screen = readFileSync(new URL('../screens/merchant-detail/index.tsx', import.meta.url), 'utf8');
  const call = screen.indexOf('void sendMerchantDetailView(');
  const start = screen.lastIndexOf('useFocusEffect(', call);
  const end = screen.indexOf('[apiUrl, merchantId, hasVisibleMerchant, from]', call);
  const effect = screen.slice(start, screen.indexOf(';', end) + 1);
  assert.match(effect, /useFocusEffect\(useCallback\(/);
  let focus!: () => void;
  let now = new Date('2026-10-03T14:59:00Z');
  let requests = 0;
  const fake: typeof fetch = async () => { requests++; return new Response(null, { status: 204 }); };
  runInNewContext(ts.transpileModule(effect, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    apiUrl: 'https://api.example', merchantId: 'focus-merchant', hasVisibleMerchant: true, from: 'friend', detailViewSource,
    useCallback: (callback: typeof focus) => callback,
    useFocusEffect: (callback: typeof focus) => { focus = callback; },
    sendMerchantDetailView: (apiUrl: string, merchantId: string, source: Parameters<typeof sendMerchantDetailView>[2]) =>
      sendMerchantDetailView(apiUrl, merchantId, source, fake, now),
  });
  focus(); focus(); await Promise.resolve();
  assert.equal(requests, 1);
  now = new Date('2026-10-03T15:01:00Z');
  focus(); focus(); await Promise.resolve();
  assert.equal(requests, 2);
});

test('같은 가게는 한국 날짜별 한 번만 보내며 출처 외 식별자를 담지 않는다', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fake: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  };
  const beforeMidnight = new Date('2026-10-03T14:59:00Z');
  const afterMidnight = new Date('2026-10-03T15:01:00Z');
  await sendMerchantDetailView('https://api.example', 'test-merchant', 'list', fake, beforeMidnight);
  await sendMerchantDetailView('https://api.example', 'test-merchant', 'friend', fake, beforeMidnight);
  await sendMerchantDetailView('https://api.example', 'test-merchant', 'map', fake, afterMidnight);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url, 'https://api.example/merchants/test-merchant/views');
  assert.equal(requests[0]?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), { source: 'list' });
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), { source: 'map' });
});
