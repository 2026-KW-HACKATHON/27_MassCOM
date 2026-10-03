import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultVisitGoals, mileageBalanceLine, mileageDeltaLine, settleWithin, visitRewardGuide } from './visit-reward-guide';

const goals = defaultVisitGoals;

test('the next-grade line counts down to the first goal above the current count', () => {
  assert.equal(
    visitRewardGuide({ progressCount: 0, goals }).nextGradeLine,
    '브론즈 수집품까지 1번 남았어요 (같은 가게는 하루 1번)',
  );
  assert.equal(
    visitRewardGuide({ progressCount: 1, goals }).nextGradeLine,
    '실버 수집품까지 2번 남았어요 (같은 가게는 하루 1번)',
  );
  assert.equal(
    visitRewardGuide({ progressCount: 2, goals }).nextGradeLine,
    '실버 수집품까지 1번 남았어요 (같은 가게는 하루 1번)',
  );
  assert.equal(
    visitRewardGuide({ progressCount: 3, goals }).nextGradeLine,
    '골드 수집품까지 2번 남았어요 (같은 가게는 하루 1번)',
  );
  assert.equal(
    visitRewardGuide({ progressCount: 4, goals }).nextGradeLine,
    '골드 수집품까지 1번 남았어요 (같은 가게는 하루 1번)',
  );
});

test('with every goal reached the line says gold is collected', () => {
  assert.equal(visitRewardGuide({ progressCount: 5, goals }).nextGradeLine, '골드까지 모았어요');
  assert.equal(visitRewardGuide({ progressCount: 9, goals }).nextGradeLine, '골드까지 모았어요');
});

test('goals are read in ascending order whatever order the store lists them in', () => {
  assert.equal(
    visitRewardGuide({ progressCount: 1, goals: [goals[2], goals[0], goals[1]] }).nextGradeLine,
    '실버 수집품까지 2번 남았어요 (같은 가게는 하루 1번)',
  );
});

test('a store with only some of the goals counts down to the goals it has', () => {
  assert.equal(
    visitRewardGuide({ progressCount: 1, goals: [goals[0], goals[2]] }).nextGradeLine,
    '골드 수집품까지 4번 남았어요 (같은 가게는 하루 1번)',
  );
});

test('a store without any goal gives no next-grade line instead of claiming gold', () => {
  assert.equal(visitRewardGuide({ progressCount: 1, goals: [] }).nextGradeLine, null);
});

test('the campaign display names and actual visit thresholds determine the guide', () => {
  const campaignGoals = [{ targetVisitCount: 2, displayName: '새싹' }, { targetVisitCount: 4, displayName: '단골' }];
  assert.equal(visitRewardGuide({ progressCount: 1, goals: campaignGoals }).nextGradeLine, '새싹 수집품까지 1번 남았어요 (같은 가게는 하루 1번)');
  assert.equal(visitRewardGuide({ progressCount: 3, goals: campaignGoals }).nextGradeLine, '단골 수집품까지 1번 남았어요 (같은 가게는 하루 1번)');
  assert.equal(visitRewardGuide({ progressCount: 4, goals: campaignGoals }).nextGradeLine, '단골까지 모았어요');
});

test('the guide no longer guesses mileage: it only carries the next-grade line', () => {
  assert.deepEqual(Object.keys(visitRewardGuide({ progressCount: 1, goals })), ['nextGradeLine']);
});

test('unknown goals alone use the legacy visit thresholds', () => {
  assert.deepEqual(defaultVisitGoals.map((goal) => goal.targetVisitCount), [1, 3, 5]);
  assert.equal(visitRewardGuide({ progressCount: 2 }).nextGradeLine, '실버 수집품까지 1번 남았어요 (같은 가게는 하루 1번)');
});

test('the balance line shows the mileage the account holds', () => {
  assert.equal(mileageBalanceLine(0), '보유 0마일리지');
  assert.equal(mileageBalanceLine(350), '보유 350마일리지');
  assert.equal(mileageBalanceLine(1250), '보유 1,250마일리지');
});

test('the mileage line is the real change in the earned total, whatever the server counted', () => {
  assert.equal(mileageDeltaLine({ replayed: false, before: 0, after: 150 }), '+150 마일리지 적립');
  assert.equal(mileageDeltaLine({ replayed: false, before: 150, after: 200 }), '+50 마일리지 적립');
  assert.equal(mileageDeltaLine({ replayed: false, before: 400, after: 650 }), '+250 마일리지 적립');
  assert.equal(mileageDeltaLine({ replayed: false, before: 100, after: 1350 }), '+1,250 마일리지 적립');
});

test('no change in the earned total means no mileage line (a repeat visit the same day, a second campaign cycle)', () => {
  assert.equal(mileageDeltaLine({ replayed: false, before: 300, after: 300 }), null);
  assert.equal(mileageDeltaLine({ replayed: false, before: 0, after: 0 }), null);
});

test('a missing or unusable snapshot never produces a guessed number', () => {
  assert.equal(mileageDeltaLine({ replayed: false, before: undefined, after: 150 }), null);
  assert.equal(mileageDeltaLine({ replayed: false, before: 0, after: undefined }), null);
  assert.equal(mileageDeltaLine({ replayed: false, before: undefined, after: undefined }), null);
  assert.equal(mileageDeltaLine({ replayed: false, before: Number.NaN, after: 150 }), null);
  assert.equal(mileageDeltaLine({ replayed: false, before: 0, after: Number.POSITIVE_INFINITY }), null);
});

test('a total that went down (a cancelled visit between the snapshots) is not shown as earned', () => {
  assert.equal(mileageDeltaLine({ replayed: false, before: 300, after: 250 }), null);
});

test('a recovered (replayed) claim never shows an earned line, even if the totals differ', () => {
  assert.equal(mileageDeltaLine({ replayed: true, before: 0, after: 150 }), null);
});

test('a snapshot that settles in time is returned as is', async () => {
  assert.equal(await settleWithin(Promise.resolve(120), 50), 120);
});

test('a missing snapshot, a failed one and one that never settles all give undefined', async () => {
  assert.equal(await settleWithin(undefined, 50), undefined);
  assert.equal(await settleWithin(Promise.reject(new Error('offline')), 50), undefined);
  const started = Date.now();
  assert.equal(await settleWithin(new Promise<number>(() => {}), 20), undefined);
  assert.ok(Date.now() - started < 500);
});
