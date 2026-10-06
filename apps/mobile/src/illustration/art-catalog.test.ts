import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXPERIENCE_BADGES, EXPERIENCE_COSMETICS, EXPERIENCE_PACKS } from '../../../api/src/collection-experience';
import { badgeFrame, characterFrame, cosmeticCrop, cosmeticFrames, equippedFrame, packFrame } from './art-catalog';
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
test('affected equipment cells hide adjacent fragments while retaining their own illustration', () => {
  const cases = [
    ['steady-gold-decor', 16, [[0.03, 0.5], [0.54, 0.01]], [0.54, 0.12]],
    ['order-sign', 17, [[0.996, 0.74], [0.5, 0.01]], [0.5, 0.5]],
    ['bronze-decor', 18, [[0.5, 0.01]], [0.5, 0.5]],
    ['silver-decor', 19, [[0.82, 0.01]], [0.5, 0.5]],
    ['gold-decor', 20, [[0.15, 0.01]], [0.5, 0.5]],
  ] as const;
  for (const [id, frame, fragments, center] of cases) {
    assert.equal(cosmeticFrames[id], frame);
    const { left = 0, right = 0, top = 0 } = cosmeticCrop[frame] ?? {};
    const inside = ([x, y]: readonly number[]) => x >= left && x <= 1 - right && y >= top && y <= 1;
    for (const fragment of fragments) assert.equal(inside(fragment), false, `${id} still shows neighboring art`);
    assert.equal(inside(center), true, `${id} lost its primary art`);
  }
});
