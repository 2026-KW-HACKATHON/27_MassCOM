import assert from 'node:assert/strict';
import test from 'node:test';

import { studioGoalOptions } from './studio-goals';

const now = Date.parse('2026-10-04T12:00:00Z');
const merchant = {
  id: 'merchant-1', name: '동네 가게',
  campaign: {
    id: 'campaign-current', enrollmentStatus: 'OPEN',
    startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-10T00:00:00Z',
    rewardGoals: [{ targetVisitCount: 1 }, { targetVisitCount: 3 }, { targetVisitCount: 5 }],
  },
} as const;
const collection = {
  visits: [
    { merchantId: 'merchant-1', campaignId: 'campaign-old', progressCounted: true },
    { merchantId: 'merchant-1', campaignId: 'campaign-current', progressCounted: true },
  ],
  collectibles: [
    { merchantId: 'merchant-1', campaignId: 'campaign-current', targetVisitCount: 1 },
    { merchantId: 'merchant-1', campaignId: 'campaign-current', targetVisitCount: 1 },
    { merchantId: 'merchant-1', campaignId: 'campaign-old', targetVisitCount: 3 },
  ],
} as const;

test('visit and series goals count the current campaign and distinct milestones', () => {
  const options = studioGoalOptions([merchant], collection, [], now);
  assert.equal(options.find((item) => item.goal.kind === 'regular')?.progress, '방문 1/3');
  assert.equal(options.find((item) => item.goal.kind === 'series')?.progress, '수집 1/3');
  assert.equal(options.some((item) => item.goal.kind === 'discover'), false);
});

test('closed campaigns offer no merchant goal while play remains selectable', () => {
  const options = studioGoalOptions([merchant], collection, [], Date.parse('2026-10-10T00:00:00Z'));
  assert.equal(options.filter((item) => item.merchantId).length, 0);
  assert.equal(options.filter((item) => item.goal.kind === 'play').length, 4);
});
