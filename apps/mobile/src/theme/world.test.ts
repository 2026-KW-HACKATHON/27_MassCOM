import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contrast } from './contrast';
import { darkWorld, lightWorld, worldForScheme } from './world';

test('world text stays readable on its own surfaces in light and dark', () => {
  for (const world of [lightWorld, darkWorld]) {
    for (const sky of world.sky) {
      assert.ok(contrast(world.skyInk, sky) >= 4.5, `skyInk on ${sky}`);
      assert.ok(contrast(world.skyMuted, sky) >= 4.5, `skyMuted on ${sky}`);
    }
    assert.ok(contrast(world.cardInk, world.card) >= 4.5);
    assert.ok(contrast(world.cardMuted, world.card) >= 4.5);
    assert.ok(contrast(world.paperInk, world.paper) >= 4.5);
    assert.ok(contrast(world.stampInk, world.paper) >= 4.5);
    assert.ok(contrast(world.stampOrange, world.card) >= 3, 'stamp orange is a graphic accent');
    assert.ok(contrast(world.tabActive, world.tabBar) >= 4.5);
    assert.ok(contrast(world.tabInactive, world.tabBar) >= 4.5);
  }
});

test('scheme selection falls back to light', () => {
  assert.equal(worldForScheme('dark'), darkWorld);
  assert.equal(worldForScheme(null), lightWorld);
  assert.equal(worldForScheme('unspecified'), lightWorld);
});

test('contrast matches the WCAG formula at the extremes', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
});
