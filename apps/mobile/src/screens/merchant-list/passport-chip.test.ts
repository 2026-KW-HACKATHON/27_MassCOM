import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BadgeBook, Medal } from '../../gamification/badge-api';
import { contrast } from '../../theme/contrast';
import { darkMedalColors, lightMedalColors, tierColors } from '../../theme/medal-colors';
import { darkWorld, lightWorld } from '../../theme/world';
import { passportChipData } from './passport-chip';

const medal = (kind: Medal['kind'], tier: Medal['tier']): Medal => ({ kind, value: tier * 3, tier, thresholds: [3, 6, 9] });
const book = (tiers: [Medal['tier'], Medal['tier'], Medal['tier']]): Pick<BadgeBook, 'earnedTiers' | 'medals'> => ({
  medals: [medal('explorer', tiers[0]), medal('regular', tiers[1]), medal('steady', tiers[2])],
  earnedTiers: tiers[0] + tiers[1] + tiers[2],
});

test('no badge data means no chip summary, so the chip keeps its plain copy and shows no dot', () => {
  assert.equal(passportChipData(undefined), undefined);
});

test('the chip shows earned badges out of nine and the best tier for its dot', () => {
  assert.deepEqual(passportChipData(book([2, 1, 0])), {
    text: '배지 3/9', tier: 2, label: '내 탐험 여권 보기, 배지 9개 중 3개, 가장 높은 등급 실버',
  });
  const full = passportChipData(book([3, 3, 3]));
  assert.equal(full?.text, '배지 9/9');
  assert.equal(full?.tier, 3);
});

test('a book with no badges yet shows 0/9 and no tier, so no dot is drawn', () => {
  const empty = passportChipData(book([0, 0, 0]));
  assert.equal(empty?.text, '배지 0/9');
  assert.equal(empty?.tier, 0);
  assert.equal(empty?.label, '내 탐험 여권 보기, 배지 9개 중 0개');
});

test('an earned count past nine is capped, a negative one floored', () => {
  assert.equal(passportChipData({ ...book([3, 3, 3]), earnedTiers: 12 })?.text, '배지 9/9');
  assert.equal(passportChipData({ ...book([0, 0, 0]), earnedTiers: -1 })?.text, '배지 0/9');
});

test('the medal-coloured dot outline holds 3:1 against the chip card in light and dark', () => {
  for (const [colors, world] of [[lightMedalColors, lightWorld], [darkMedalColors, darkWorld]] as const) {
    for (const tier of [1, 2, 3] as const) {
      const { edge } = tierColors(colors, tier);
      assert.ok(contrast(edge, world.card) >= 3, `tier ${tier} edge on the card ${contrast(edge, world.card)}`);
    }
  }
});
