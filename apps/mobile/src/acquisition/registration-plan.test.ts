import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRegistrationPlan,
  isNewRegistration,
  registrationConfirmation,
  registrationStatusLabel,
  type RegistrationPlanItem,
} from './registration-plan';

test('new items receive only sequential new registration indexes', () => {
  const items: RegistrationPlanItem[] = [
    { id: 'coin-a', name: '브론즈 라멘', kindLabel: '가게 코인', status: 'new' },
    { id: 'coin-b', name: '실버 라멘', kindLabel: '가게 코인', status: 'duplicate' },
    { id: 'coin-c', name: '프리즘 라멘', kindLabel: '가게 코인', status: 'new' },
    { id: 'theme-a', name: '밤하늘 벽지', kindLabel: '마이룸 꾸미기', status: 'owned' },
  ];

  const plan = buildRegistrationPlan(items);

  assert.equal(plan.newCount, 2);
  assert.equal(plan.duplicateOrOwnedCount, 2);
  assert.deepEqual(plan.slots.map((slot) => slot.sequenceIndex), [0, null, 1, null]);
  assert.deepEqual(plan.slots.map((slot) => slot.isNew), [true, false, true, false]);
  assert.equal(plan.summary, '새 수집품 2개가 도감에 등록됐어요.');
});

test('duplicates and owned items never get NEW wording by default', () => {
  const plan = buildRegistrationPlan([
    { id: 'coin-b', name: '실버 라멘', kindLabel: '가게 코인', status: 'duplicate' },
    { id: 'coin-c', name: '골드 라멘', kindLabel: '가게 코인', status: 'owned' },
  ]);

  assert.equal(plan.newCount, 0);
  assert.equal(plan.summary, '새 수집품은 없지만 보상 2개를 확인했어요.');
  for (const slot of plan.slots) {
    assert.equal(slot.isNew, false);
    assert.equal(slot.sequenceIndex, null);
    assert.doesNotMatch(slot.statusLabel, /NEW/);
    assert.doesNotMatch(slot.confirmation, /이번에 얻은/);
  }
});

test('explicit detail overrides the default truthful confirmation copy', () => {
  const item: RegistrationPlanItem = {
    id: 'coin-b',
    name: '실버 라멘',
    kindLabel: '가게 코인',
    status: 'duplicate',
    detail: '이미 2개 보유 중이에요. 리롤 재료로 쓸 수 있어요.',
  };

  assert.equal(registrationConfirmation(item), item.detail);
});

test('status helpers keep classification separate from display labels', () => {
  assert.equal(isNewRegistration('new'), true);
  assert.equal(isNewRegistration('duplicate'), false);
  assert.equal(isNewRegistration('owned'), false);
  assert.equal(registrationStatusLabel('new'), 'NEW');
  assert.equal(registrationStatusLabel('duplicate'), '이미 보유');
  assert.equal(registrationStatusLabel('owned'), '보유 중');
});
