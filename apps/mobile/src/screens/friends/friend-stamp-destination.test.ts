import assert from 'node:assert/strict';
import test from 'node:test';

import { friendStampDestination } from './friend-stamp-destination';

test('친구 도장은 서버가 준 공개 가게 ID로만 상세 화면에 연결한다', () => {
  assert.deepEqual(friendStampDestination({ merchantName: '같은 이름', merchantId: 'public-2' }), {
    pathname: '/merchants/[merchantId]', params: { merchantId: 'public-2', from: 'friend' },
  });
  assert.deepEqual(friendStampDestination({ merchantName: '같은 이름', merchantId: 'public-1' }), {
    pathname: '/merchants/[merchantId]', params: { merchantId: 'public-1', from: 'friend' },
  });
  assert.equal(friendStampDestination({ merchantName: '같은 이름', merchantId: null }), undefined);
});
