import assert from 'node:assert/strict';
import test from 'node:test';

import { friendStampMerchantId } from './friend-stamp-destination';

test('친구 도장은 공개 가게 이름이 하나로 정해질 때만 연결한다', () => {
  const merchants = [
    { id: 'a', name: '첫 가게' },
    { id: 'b', name: '같은 이름' },
    { id: 'c', name: '같은 이름' },
  ];
  assert.equal(friendStampMerchantId('첫 가게', merchants), 'a');
  assert.equal(friendStampMerchantId('같은 이름', merchants), undefined);
  assert.equal(friendStampMerchantId('목록에 없는 가게', merchants), undefined);
});
