import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PublicMerchant } from './merchant-api';
import { filterMerchants } from './filter-merchants';

const merchants: readonly PublicMerchant[] = [
  {
    id: 'one', name: '월계식당', story: '따뜻한 한 끼', roadAddress: '서울 노원구 월계로 1', minimumSpendWon: 10_000, menuItems: [], businessHours: '', demo: false, artUrl: null,
    campaign: { id: 'c1', title: '첫 방문', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z', enrollmentStatus: 'OPEN', rewardGoals: [] },
  },
  {
    id: 'two', name: '골목 카페', story: 'Coffee와 휴식', roadAddress: '서울 노원구 광운로 2', minimumSpendWon: 5_000, menuItems: [], businessHours: '', demo: true, artUrl: null,
    campaign: { id: 'c2', title: '동네 산책', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z', enrollmentStatus: 'FULL', rewardGoals: [] },
  },
  {
    id: 'three', name: '한그릇', story: '푸짐한 식사', roadAddress: '서울 노원구 월계로 3', minimumSpendWon: 8_000, menuItems: [], businessHours: '', demo: false, artUrl: null,
    campaign: { id: 'c3', title: '맛집 탐험', startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-10-01T00:00:00Z', enrollmentStatus: 'OPEN', rewardGoals: [] },
  },
];

test('searches only real catalog fields with trimmed, case-insensitive text', () => {
  assert.deepEqual(filterMerchants(merchants, '  카페  ', 'all').map(({ id }) => id), ['two']);
  assert.deepEqual(filterMerchants(merchants, '월계로', 'all').map(({ id }) => id), ['one', 'three']);
  assert.deepEqual(filterMerchants(merchants, 'COFFEE', 'all').map(({ id }) => id), ['two']);
  assert.deepEqual(filterMerchants(merchants, '맛집 탐험', 'all').map(({ id }) => id), ['three']);
});

test('filters open campaigns without changing source order or source data', () => {
  const visible = filterMerchants(merchants, '', 'open');
  assert.deepEqual(visible.map(({ id }) => id), ['one', 'three']);
  assert.equal(visible[0], merchants[0]);
  assert.equal(merchants.length, 3);
  assert.deepEqual(filterMerchants(merchants, '골목', 'open'), []);
});
