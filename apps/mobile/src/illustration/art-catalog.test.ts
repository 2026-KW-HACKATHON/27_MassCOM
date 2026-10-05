import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXPERIENCE_BADGES, EXPERIENCE_COSMETICS, EXPERIENCE_PACKS } from '../../../api/src/collection-experience';
import { badgeFrame, characterFrame, cosmeticFrames, equippedFrame, packFrame } from './art-catalog';
test('every real catalog reward has a consumed illustration cell or actual character pose', () => {
  for (const item of EXPERIENCE_COSMETICS) assert.ok(item.id === 'stack-cheer' || cosmeticFrames[item.id] !== undefined, item.id);
  for (const badge of EXPERIENCE_BADGES) assert.ok(badgeFrame(badge.id) !== undefined, badge.id);
  for (const pack of EXPERIENCE_PACKS) assert.ok(packFrame(pack.grade) !== undefined, pack.id);
  assert.ok(Object.values(cosmeticFrames).every(index => index >= 0 && index < 21));
});
test('real greeting or mistake overrides an equipped cheer pose', () => {
  assert.equal(equippedFrame('stack-cheer', 'idle'), 2);
  assert.equal(equippedFrame('stack-cheer', 'wave'), 1);
  assert.equal(equippedFrame('stack-cheer', 'concerned'), 3);
  assert.equal(characterFrame('calm'), 0);
  assert.equal(badgeFrame('unknown'), undefined);
  assert.equal(packFrame('unknown'), undefined);
});
