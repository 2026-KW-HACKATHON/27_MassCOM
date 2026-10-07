import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogRewards, chooseGradeReward } from './grade-draw-rules.js';

test('every existing character and theme item in the selected grade has one equal entry', () => {
  for (const grade of ['BRONZE', 'SILVER', 'GOLD'] as const) {
    const rewards = catalogRewards(grade);
    assert.equal(rewards.length, 6);
    assert.equal(rewards.filter((reward) => reward.kind === 'CHARACTER').length, 3);
    assert.equal(rewards.filter((reward) => reward.kind === 'THEME').length, 3);
    for (let index = 0; index < rewards.length; index++) {
      assert.equal(chooseGradeReward(rewards, () => index), rewards[index]);
    }
    assert.throws(() => chooseGradeReward(rewards, () => rewards.length), RangeError);
  }
});
