import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PublicMerchant } from '@/merchant/merchant-api';
import { buildStampSlots, stampColumnCount } from './collection-stamps';

const merchants: readonly Pick<PublicMerchant, 'id' | 'name'>[] = [
  { id: 'one', name: '가상 점포 A' },
  { id: 'two', name: '가상 점포 B' },
  { id: 'three', name: '가상 점포 C' },
];

test('a merchant with one or more matching visits is marked visited with a visit count', () => {
  const slots = buildStampSlots(merchants, [
    { merchantId: 'one' },
    { merchantId: 'one' },
    { merchantId: 'two' },
  ]);
  assert.deepEqual(slots, [
    { merchantId: 'one', merchantName: '가상 점포 A', visited: true, visitCount: 2 },
    { merchantId: 'two', merchantName: '가상 점포 B', visited: true, visitCount: 1 },
    { merchantId: 'three', merchantName: '가상 점포 C', visited: false, visitCount: 0 },
  ]);
});

test('a merchant with no visits at all is marked not visited with a zero count', () => {
  const slots = buildStampSlots(merchants, []);
  assert.ok(slots.every((slot) => !slot.visited && slot.visitCount === 0));
});

test('an empty merchant catalog yields no stamp slots, even with visits present', () => {
  assert.deepEqual(buildStampSlots([], [{ merchantId: 'one' }]), []);
});

test('a visit for a merchant id outside the current public catalog is ignored, not shown as a phantom slot', () => {
  const slots = buildStampSlots(merchants, [{ merchantId: 'unlisted-merchant' }]);
  assert.equal(slots.length, 3);
  assert.ok(slots.every((slot) => !slot.visited));
});

test('matching is by merchant id, not by display name', () => {
  const renamed: readonly Pick<PublicMerchant, 'id' | 'name'>[] = [
    { id: 'one', name: '다른 이름으로 바뀐 가게' },
  ];
  const slots = buildStampSlots(renamed, [{ merchantId: 'one' }]);
  assert.deepEqual(slots, [
    { merchantId: 'one', merchantName: '다른 이름으로 바뀐 가게', visited: true, visitCount: 1 },
  ]);
});

test('stamp grid drops to two columns only below the narrow-width threshold', () => {
  assert.equal(stampColumnCount(360), 3);
  assert.equal(stampColumnCount(340), 3);
  assert.equal(stampColumnCount(339), 2);
});
