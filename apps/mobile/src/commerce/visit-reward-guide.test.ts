import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  defaultVisitGoals,
  mileageBalanceLine,
  newStoreMileage,
  seriesCompleteMileage,
  visitMileage,
  visitRewardGuide,
} from './visit-reward-guide';

const goals = [1, 3, 5] as const;

test('a counted visit earns the 50 mileage line', () => {
  assert.equal(visitRewardGuide({ progressCounted: true, progressCount: 2, goals }).mileageLine, '+50 마일리지 적립');
  assert.equal(visitRewardGuide({ progressCounted: true, progressCount: 4, goals }).mileageLine, '+50 마일리지 적립');
});

test('the first counted visit at a store adds the first-visit bonus', () => {
  assert.equal(
    visitRewardGuide({ progressCounted: true, progressCount: 1, goals }).mileageLine,
    '+50 마일리지 적립 · 첫 방문 +100',
  );
});

test('the fifth counted visit completes the series and adds its bonus', () => {
  assert.equal(
    visitRewardGuide({ progressCounted: true, progressCount: 5, goals }).mileageLine,
    '+50 마일리지 적립 · 시리즈 완성 +200',
  );
});

test('a visit beyond the series earns the plain line only', () => {
  assert.equal(visitRewardGuide({ progressCounted: true, progressCount: 6, goals }).mileageLine, '+50 마일리지 적립');
});

test('a visit that was not counted has no mileage line, whatever the count says', () => {
  for (const progressCount of [0, 1, 3, 5]) {
    assert.equal(visitRewardGuide({ progressCounted: false, progressCount, goals }).mileageLine, null);
  }
});

test('the next-grade line counts down to the first goal above the current count', () => {
  assert.equal(
    visitRewardGuide({ progressCounted: true, progressCount: 0, goals }).nextGradeLine,
    '브론즈 수집품까지 1번 남았어요 (같은 가게는 하루 1번)',
  );
  assert.equal(
    visitRewardGuide({ progressCounted: true, progressCount: 1, goals }).nextGradeLine,
    '실버 수집품까지 2번 남았어요 (같은 가게는 하루 1번)',
  );
  assert.equal(
    visitRewardGuide({ progressCounted: true, progressCount: 2, goals }).nextGradeLine,
    '실버 수집품까지 1번 남았어요 (같은 가게는 하루 1번)',
  );
  assert.equal(
    visitRewardGuide({ progressCounted: true, progressCount: 3, goals }).nextGradeLine,
    '골드 수집품까지 2번 남았어요 (같은 가게는 하루 1번)',
  );
  assert.equal(
    visitRewardGuide({ progressCounted: true, progressCount: 4, goals }).nextGradeLine,
    '골드 수집품까지 1번 남았어요 (같은 가게는 하루 1번)',
  );
});

test('with every goal reached the line says gold is collected', () => {
  assert.equal(visitRewardGuide({ progressCounted: true, progressCount: 5, goals }).nextGradeLine, '골드까지 모았어요');
  assert.equal(visitRewardGuide({ progressCounted: true, progressCount: 9, goals }).nextGradeLine, '골드까지 모았어요');
});

test('a visit that was not counted still shows how far the next grade is', () => {
  const guide = visitRewardGuide({ progressCounted: false, progressCount: 2, goals });
  assert.equal(guide.mileageLine, null);
  assert.equal(guide.nextGradeLine, '실버 수집품까지 1번 남았어요 (같은 가게는 하루 1번)');
});

test('goals are read in ascending order whatever order the store lists them in', () => {
  assert.equal(
    visitRewardGuide({ progressCounted: true, progressCount: 1, goals: [5, 1, 3] }).nextGradeLine,
    '실버 수집품까지 2번 남았어요 (같은 가게는 하루 1번)',
  );
});

test('a store with only some of the goals counts down to the goals it has', () => {
  assert.equal(
    visitRewardGuide({ progressCounted: true, progressCount: 1, goals: [1, 5] }).nextGradeLine,
    '골드 수집품까지 4번 남았어요 (같은 가게는 하루 1번)',
  );
});

test('a store without any goal gives no next-grade line instead of claiming gold', () => {
  const guide = visitRewardGuide({ progressCounted: true, progressCount: 1, goals: [] });
  assert.equal(guide.nextGradeLine, null);
  assert.equal(guide.mileageLine, '+50 마일리지 적립 · 첫 방문 +100');
});

test('the default goals are the fixed 1, 3 and 5 counted visits', () => {
  assert.deepEqual([...defaultVisitGoals], [1, 3, 5]);
});

test('the balance line shows the mileage the account holds', () => {
  assert.equal(mileageBalanceLine(0), '보유 0마일리지');
  assert.equal(mileageBalanceLine(350), '보유 350마일리지');
  assert.equal(mileageBalanceLine(1250), '보유 1,250마일리지');
});

// 서버(apps/api/src/mileage-rules.ts)가 적립 규칙의 정본이다. 앱 문구가 서버 값과 어긋나면 이 시험이 먼저 깨진다.
test('the bonus numbers in the copy match the server earn rules', () => {
  const rules = readFileSync(fileURLToPath(new URL('../../../api/src/mileage-rules.ts', import.meta.url)), 'utf8');
  const earn = rules.match(/MILEAGE_EARN_RULES = \{ visit: (\d+), newStore: (\d+), series: (\d+) \}/);
  assert.ok(earn, 'MILEAGE_EARN_RULES is still declared on one line');
  assert.deepEqual([visitMileage, newStoreMileage, seriesCompleteMileage], [Number(earn[1]), Number(earn[2]), Number(earn[3])]);
});
