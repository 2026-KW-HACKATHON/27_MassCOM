import assert from 'node:assert/strict';
import { test } from 'node:test';

import { acknowledgeCollectibleReceipt, markCollectiblePresented, presentedCollectibleIds } from './presented-collectibles';

test('로드 실패와 건너뛰기는 기록하지 않고, 표시한 카드만 배치에서 완료된다', () => {
  const api = 'https://demo.example';
  const account = 'partial-batch';
  const batch = ['first', 'failed'];
  assert.equal(batch.every((id) => presentedCollectibleIds(api, account).has(id)), false);
  markCollectiblePresented(api, account, 'first');
  assert.equal(batch.every((id) => presentedCollectibleIds(api, account).has(id)), false);
  markCollectiblePresented(api, account, 'failed');
  assert.equal(batch.every((id) => presentedCollectibleIds(api, account).has(id)), true);
});

test('표시 기록은 API와 계정별로 격리된다', () => {
  markCollectiblePresented('https://demo.example', 'alice', 'card');
  assert.equal(presentedCollectibleIds('https://demo.example', 'bob').has('card'), false);
  assert.equal(presentedCollectibleIds('https://prod.example', 'alice').has('card'), false);
});


test('actual reveal receipt deduplicates repeated events, retries failure and isolates accounts', async () => {
  let calls = 0;
  const fail = async () => { calls++; throw new Error('response lost'); };
  await assert.rejects(acknowledgeCollectibleReceipt('https://qa-receipt', 'first', 'owned', fail));
  const open = async (id: string) => { assert.equal(id, 'owned'); calls++; };
  await Promise.all([acknowledgeCollectibleReceipt('https://qa-receipt', 'first', 'owned', open),
    acknowledgeCollectibleReceipt('https://qa-receipt', 'first', 'owned', open)]);
  assert.equal(calls, 2, 'failed first request plus one retry');
  await acknowledgeCollectibleReceipt('https://qa-receipt', 'second', 'owned', open);
  assert.equal(calls, 3, 'another account must acknowledge its own receipt');
});
