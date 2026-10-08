import assert from 'node:assert/strict';
import { test } from 'node:test';

import { displayStudioItems } from '@/studio/studio-api';
import { visibleHomeMerchantItems } from './showcase-visibility';

const retired = ['showcase-local-merchant', 'showcase-local-merchant-b', 'showcase-local-merchant-c'];
const real = 'showcase-wolgye-MA010120220813334279';

test('showcase home hides only retired store tickets, while production keeps the server list', () => {
  const tickets = [...retired, real, 'showcase-local-merchant-d'].map((merchantId) => ({ merchantId, id: `ticket-${merchantId}` }));
  assert.deepEqual(visibleHomeMerchantItems(tickets, 'kr.masscom.wolgye.demo').map((item) => item.merchantId), [real, 'showcase-local-merchant-d']);
  assert.equal(visibleHomeMerchantItems(tickets, 'kr.masscom.wolgye'), tickets);
  assert.equal(visibleHomeMerchantItems(tickets, 'kr.masscom.wolgye.dev'), tickets);
});

test('showcase home hides retired room coins without changing saved studio history', () => {
  const snapshot = {
    items: [{ merchantId: retired[0]!, merchantName: '가상 점포 A', campaignTitle: '방문', displayName: '기존 수집품' }],
    coinItems: [
      { merchantId: retired[1]!, merchantName: '가상 점포 B', publicationId: 'old', gradeId: 'bronze', name: '기존 코인' },
      { merchantId: real, merchantName: '더까까주까월계역점', publicationId: 'real', gradeId: 'prism', name: '월계 코인' },
    ],
  };
  const savedItems = displayStudioItems(snapshot);
  assert.deepEqual(savedItems.map((item) => item.merchantId), [retired[0], retired[1], real]);
  assert.deepEqual(visibleHomeMerchantItems(savedItems, 'kr.masscom.wolgye.demo').map((item) => item.merchantId), [real]);
  assert.deepEqual(displayStudioItems(snapshot), savedItems, 'collection and studio callers still read the saved items');
});
