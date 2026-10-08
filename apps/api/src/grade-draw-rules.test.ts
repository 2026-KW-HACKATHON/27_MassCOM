import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogRewards, categoryWeightsByRarity, chooseGradeReward, gradeWeights, rewardEntries } from './grade-draw-rules.js';

test('box rarity odds are independent of eligible catalog size', () => {
  assert.deepEqual(gradeWeights.BRONZE, { BRONZE: 8000, SILVER: 1700, GOLD: 280, PLATINUM: 20 });
  assert.deepEqual(gradeWeights.SILVER, { BRONZE: 0, SILVER: 9400, GOLD: 550, PLATINUM: 50 });
  assert.deepEqual(gradeWeights.GOLD, { BRONZE: 0, SILVER: 0, GOLD: 9900, PLATINUM: 100 });
  assert.deepEqual(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'].map((rarity) =>
    categoryWeightsByRarity[rarity as keyof typeof categoryWeightsByRarity].REROLL_TICKET), [50, 100, 200, 200]);
  const entries = rewardEntries('BRONZE', [{ id: 'chair', name: 'Chair', assetId: 'chair-art' }]);
  assert.throws(() => rewardEntries('BRONZE', []), RangeError);
  assert.equal(entries.some(({ reward }) => reward.kind === 'COIN' || reward.kind === 'CHARACTER'), false);
  assert.ok(entries.some(({ rarity, reward }) => rarity === 'PLATINUM' && reward.kind === 'MILEAGE'));
  assert.ok(Math.abs(entries.reduce((total, entry) => total + entry.probability, 0) - 1) < 1e-12);
  const withAnotherChair = rewardEntries('BRONZE', [
    { id: 'chair', name: 'Chair', assetId: 'chair-art' }, { id: 'table', name: 'Table', assetId: null },
  ]);
  const furnitureReward = entries.find((entry) => entry.reward.kind === 'FURNITURE')?.reward;
  assert.equal(furnitureReward?.kind, 'FURNITURE');
  if (furnitureReward?.kind === 'FURNITURE') assert.equal(furnitureReward.assetId, 'chair-art');
  for (const rarity of ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'] as const) {
    const probability = (pool: typeof entries) => pool.filter((entry) => entry.rarity === rarity)
      .reduce((sum, entry) => sum + entry.probability, 0);
    assert.ok(Math.abs(probability(entries) - gradeWeights.BRONZE[rarity] / 10000) < 1e-12);
    assert.ok(Math.abs(probability(withAnotherChair) - probability(entries)) < 1e-12);
  }
});

test('selection samples rarity, category, then one eligible item', () => {
  const entries = rewardEntries('BRONZE', [{ id: 'chair', name: 'Chair', assetId: 'chair-art' }]);
  const calls: number[] = [];
  const selected = chooseGradeReward(entries, (bound) => {
    calls.push(bound);
    return bound === 10000 ? calls.length === 1 ? 9999 : 0 : 0;
  });
  assert.equal(selected.rarity, 'PLATINUM');
  assert.equal(selected.reward.kind, 'REROLL_TICKET');
  assert.deepEqual(calls, [10000, 10000, 1]);
  assert.equal(catalogRewards('GOLD').some((reward) => reward.kind === 'CHARACTER'), false);
  assert.throws(() => chooseGradeReward(entries, () => 10000), RangeError);
});
