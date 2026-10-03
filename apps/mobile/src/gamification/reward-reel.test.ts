import assert from 'node:assert/strict';
import test from 'node:test';

import { rewardReel } from './reward-reel';

const reward = (entitlementId: string, targetVisitCount: 1 | 3 | 5, artwork: boolean) =>
  ({ entitlementId, targetVisitCount, artwork, status: 'GRANTED' as const, claimExpiresAt: '' });
const medal = { kind: 'regular' as const, fromTier: 0 as const, toTier: 1 as const,
  medal: { kind: 'regular' as const, value: 1, tier: 1 as const, thresholds: [1, 3, 5] as const } };
const box = { milestone: 1 as const, requiredTiers: 1, state: 'READY' as const, offer: null, coupon: null };

test('empty or unknown rewards produce an empty reel', () => {
  assert.deepEqual(rewardReel({ grantedRewards: [], raisedMedals: [], openableBox: [] }), []);
  assert.deepEqual(rewardReel({ grantedRewards: [reward('plain', 1, false)], raisedMedals: [], openableBox: [], mileageDelta: 0 }), []);
});

test('collectibles come first in visit order and artwork-free rewards are omitted', () => {
  const items = rewardReel({ grantedRewards: [reward('five', 5, true), reward('plain', 3, false), reward('one', 1, true)], raisedMedals: [], openableBox: [] });
  assert.deepEqual(items.map((item) => item.type === 'collectible' ? item.reward.entitlementId : ''), ['one', 'five']);
});

test('every raised medal and openable box follows collectibles, then known earned mileage', () => {
  const items = rewardReel({ grantedRewards: [reward('one', 1, true)], raisedMedals: [medal, { ...medal, kind: 'explorer', medal: { ...medal.medal, kind: 'explorer' } }], openableBox: [box, { ...box, milestone: 2 }], mileageDelta: 125 });
  assert.deepEqual(items.map((item) => item.type), ['collectible', 'medal', 'medal', 'box', 'box', 'mileage']);
  assert.deepEqual(items.at(-1), { type: 'mileage', amount: 125 });
});

test('medal, box and mileage work independently', () => {
  const base = { grantedRewards: [], raisedMedals: [], openableBox: [] };
  assert.deepEqual(rewardReel({ ...base, raisedMedals: [medal] }).map((item) => item.type), ['medal']);
  assert.deepEqual(rewardReel({ ...base, openableBox: [box] }).map((item) => item.type), ['box']);
  assert.deepEqual(rewardReel({ ...base, mileageDelta: 10 }).map((item) => item.type), ['mileage']);
  assert.deepEqual(rewardReel({ ...base, mileageDelta: Number.NaN }), []);
});

test('all sixteen presence combinations keep collectible, medal, box, mileage order', () => {
  for (let mask = 0; mask < 16; mask += 1) {
    const items = rewardReel({
      grantedRewards: mask & 1 ? [reward('one', 1, true)] : [],
      raisedMedals: mask & 2 ? [medal] : [],
      openableBox: mask & 4 ? [box] : [],
      mileageDelta: mask & 8 ? 7 : undefined,
    });
    const expected = (['collectible', 'medal', 'box', 'mileage'] as const).filter((_, bit) => Boolean(mask & (1 << bit)));
    assert.deepEqual(items.map((item) => item.type), expected, `mask ${mask}`);
  }
});
