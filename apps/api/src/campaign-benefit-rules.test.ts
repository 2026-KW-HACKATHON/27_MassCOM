import assert from 'node:assert/strict';
import { test } from 'node:test';

import { benefitCosts, benefitEligibility, composeBenefitConsentNote } from './campaign-benefit-rules.js';

const campaignId = 'campaign-a';
const visit = (id: string, date: string, campaign = campaignId, slot = '2026-10-05T06:00:00Z') =>
  ({ id, campaignId: campaign, businessDate: date, slotCreatedAt: new Date(slot) });

test('campaign benefit purpose eligibility keeps store-first, revisit, and off-peak distinct', () => {
  const first = { purpose: 'NEW_CUSTOMERS' as const, revisitMinDays: 1, revisitWindowDays: 14, timeWindows: null };
  assert.deepEqual(benefitEligibility(campaignId, first, [visit('v1', '2026-10-05')]),
    { sourceVisitId: 'v1', usableFrom: null });
  assert.equal(benefitEligibility(campaignId, first,
    [visit('old', '2026-10-01', 'older'), visit('v1', '2026-10-05')]), null);
  assert.equal(benefitEligibility(campaignId, first,
    [{ ...visit('v1', '2026-10-05'), occurredAt: new Date('2026-10-01T00:00:00Z') }],
    { startsAt: new Date('2026-10-04T00:00:00Z'), endsAt: new Date('2026-10-06T00:00:00Z') }), null);

  const revisit = { ...first, purpose: 'REVISIT' as const, revisitMinDays: 2, revisitWindowDays: 7 };
  assert.equal(benefitEligibility(campaignId, revisit,
    [visit('v1', '2026-10-05'), visit('same', '2026-10-06')]), null);
  assert.deepEqual(benefitEligibility(campaignId, revisit,
    [visit('v1', '2026-10-05'), visit('v2', '2026-10-07')]),
    { sourceVisitId: 'v2', usableFrom: new Date('2026-10-08T15:00:00Z') });

  const offPeak = { ...first, purpose: 'OFF_PEAK' as const,
    timeWindows: [{ days: [1], start: '14:00', end: '17:00' }] };
  assert.deepEqual(benefitEligibility(campaignId, offPeak,
    [visit('outside', '2026-10-05', campaignId, '2026-10-05T05:00:00Z'),
      visit('inside', '2026-10-05', campaignId, '2026-10-05T06:00:00Z')]),
    { sourceVisitId: 'inside', usableFrom: null });
});

test('four-number cost math and consent note keep won values exact', () => {
  const costs = benefitCosts({ redeemed: 9_000_000_000, usable: 9_000_000_000,
    maxUses: 9_000_000_000, unitExtraCostWon: 1_000_000 });
  assert.deepEqual(costs, {
    costBorne: '9000000000000000', maxExposure: '9000000000000000',
    promisedMaxCost: '18000000000000000',
  });
  const note = composeBenefitConsentNote('ref-123', 10_000, 2);
  assert.match(note, /건당 추가 원가 10,000원/);
  assert.match(note, /최대 추가 원가 20,000원/);
});
