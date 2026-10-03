import assert from 'node:assert/strict';
import { test } from 'node:test';

import { markCollectiblePresented, presentedCollectibleIds } from './presented-collectibles';

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
