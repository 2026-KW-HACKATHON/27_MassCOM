import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextCosmeticBonus, EXPERIENCE_BADGES, EXPERIENCE_COSMETICS, EXPERIENCE_PACKS, badgeTarget } from './collection-experience.js';

test('each pack has three usable bonuses with unique catalog ids and existing shop price', () => {
  assert.equal(new Set(EXPERIENCE_COSMETICS.map((item) => item.id)).size, EXPERIENCE_COSMETICS.length);
  for (const pack of EXPERIENCE_PACKS) {
    assert.equal(pack.bonusItemIds.length, 3);
    for (const id of pack.bonusItemIds) {
      assert.equal(EXPERIENCE_COSMETICS.find((item) => item.id === id)?.source.kind, 'pack');
    }
  }
  for (const badge of EXPERIENCE_BADGES) {
    for (const id of badge.unlockItemIds) {
      assert.equal(EXPERIENCE_COSMETICS.find((item) => item.id === id)?.source.kind, 'badge');
    }
  }
  assert.equal(badgeTarget('regular-gold'), 5);
  assert.equal(EXPERIENCE_COSMETICS.find((item) => item.id === 'memory-card')?.name, '기억의 달인 카드 소품');
});

test('three draws guarantee all three previously unowned cosmetics in every pack', () => {
  for (const pack of EXPERIENCE_PACKS) {
    const owned = new Set<string>();
    for (const expected of pack.bonusItemIds) {
      const selected = nextCosmeticBonus(pack.grade, owned);
      assert.equal(selected, expected);
      assert.ok(!owned.has(selected));
      owned.add(selected);
    }
    assert.equal(owned.size, 3);
    assert.throws(() => nextCosmeticBonus(pack.grade, owned), /already complete/);
    assert.equal(nextCosmeticBonus(pack.grade, new Set([pack.bonusItemIds[1]!])), pack.bonusItemIds[0]);
  }
});
