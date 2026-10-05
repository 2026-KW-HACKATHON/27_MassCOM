import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExperienceSnapshot } from './experience-api';
import { themeOutfit } from './theme-outfit';

function snapshot(): ExperienceSnapshot {
  return {
    catalog: { badges: [], packs: [{ id: 'cafe', name: 'Cafe', theme: 'Cafe', grade: 'BRONZE', price: 100,
      bonusItemIds: ['cap', 'cup', 'plant'] }], cosmetics: [
      { id: 'cap', name: 'Cap', slot: 'hat', source: { kind: 'pack', packId: 'cafe' } },
      { id: 'cup', name: 'Cup', slot: 'prop', source: { kind: 'pack', packId: 'cafe' } },
      { id: 'plant', name: 'Plant', slot: 'decor', source: { kind: 'pack', packId: 'cafe' } },
    ] },
    profile: { badgeId: 'kept-badge', coinEntitlementId: 'kept-coin', wishlist: 'kept-wish',
      cosmetics: { hat: null, prop: null, decor: null, bag: 'kept-bag', pose: 'kept-pose' } },
    progress: { badges: [], packs: [], cosmetics: ['cap', 'cup', 'plant'].map((id) => ({ id, owned: true, equippable: true })) },
  };
}

test('complete owned theme creates one three-slot patch and preserves unrelated equipment without mutating the snapshot', () => {
  const input = snapshot();
  const before = structuredClone(input);
  const outfit = themeOutfit(input, 'cafe')!;
  assert.equal(outfit.canEquip, true);
  assert.deepEqual(outfit.cosmetics, { hat: 'cap', prop: 'cup', decor: 'plant' });
  assert.deepEqual(outfit.profile, { ...input.profile, cosmetics: { hat: 'cap', prop: 'cup', decor: 'plant', bag: 'kept-bag', pose: 'kept-pose' } });
  assert.deepEqual(input, before);
});

test('each missing or unowned theme piece allows reference preview but blocks whole-theme equip', () => {
  for (const id of ['cap', 'cup', 'plant']) {
    const input = snapshot();
    input.progress.cosmetics = input.progress.cosmetics.filter((entry) => entry.id !== id);
    assert.equal(themeOutfit(input, 'cafe')?.canEquip, false, `missing ${id}`);
    input.progress.cosmetics.push({ id, owned: false, equippable: true });
    assert.equal(themeOutfit(input, 'cafe')?.canEquip, false, `unowned ${id}`);
    assert.equal(themeOutfit(input, 'cafe')?.profile.cosmetics.decor, 'plant');
  }
});

test('owned but unavailable item cannot be included in an equip operation', () => {
  const input = snapshot();
  input.progress.cosmetics[2]!.equippable = false;
  assert.equal(themeOutfit(input, 'cafe')?.canEquip, false);
});

test('unknown, incomplete and mismatched catalogue sets do not produce a patch', () => {
  const input = snapshot();
  assert.equal(themeOutfit(input, 'unknown'), undefined);
  input.catalog.packs[0]!.bonusItemIds[2] = 'missing';
  assert.equal(themeOutfit(input, 'cafe'), undefined);
  input.catalog.packs[0]!.bonusItemIds[2] = 'cup';
  assert.equal(themeOutfit(input, 'cafe'), undefined);
  input.catalog.packs[0]!.bonusItemIds[2] = 'plant';
  input.catalog.cosmetics[2]!.source = { kind: 'pack', packId: 'another' };
  assert.equal(themeOutfit(input, 'cafe'), undefined);
});
