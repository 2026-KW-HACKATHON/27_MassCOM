import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

import { detailViewSource, sendMerchantDetailView } from './detail-view-api';

test('허용된 출처만 전달하고 모르는 값은 link로 처리한다', () => {
  assert.equal(detailViewSource('recommendation'), 'recommendation');
  assert.equal(detailViewSource('friend'), 'friend');
  assert.equal(detailViewSource('unknown'), 'link');
  assert.equal(detailViewSource(undefined), 'link');
});

test('new detail screen uses once-per-KST-day v1 event helper after valid ID load', () => {
  const screen = readFileSync(new URL('../screens/merchant-detail/index.tsx', import.meta.url), 'utf8');
  assert.match(screen, /setMerchant\(detail\);setError\(null\);[\s\S]*?sendDiscoveryDetailView\(/);
  assert.doesNotMatch(screen, /sendMerchantDetailView\(/);
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
