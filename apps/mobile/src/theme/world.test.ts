import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blend, contrast } from './contrast';
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
    // Stamp text on paper is stampInk (above). The orange is a graphic ring drawn where card and paper meet, so it must hold on both.
    assert.ok(contrast(world.stampOrange, world.card) >= 3.3, `stamp orange on card ${contrast(world.stampOrange, world.card)}`);
    assert.ok(contrast(world.stampOrange, world.paper) >= 3, `stamp orange on paper ${contrast(world.stampOrange, world.paper)}`);
    assert.ok(contrast(world.paperLine, world.paper) >= 3, `paper line on paper ${contrast(world.paperLine, world.paper)}`);
    assert.ok(contrast(world.paperLine, world.card) >= 3, `paper line on card ${contrast(world.paperLine, world.card)}`);
    assert.ok(contrast(world.tabActive, world.tabBar) >= 4.5);
    assert.ok(contrast(world.tabInactive, world.tabBar) >= 4.5);
  }
});

test('the header scrim keeps sky text readable over the worst art pixel, light and dark', () => {
  for (const world of [lightWorld, darkWorld]) {
    assert.equal(world.headerScrim, world.sky[2]);
    assert.ok(world.headerScrimAlpha >= 0.86 && world.headerScrimAlpha < 1, 'frosted, not opaque');
    // The header art is an opaque picture, so text may land on anything from black to white.
    for (const art of ['#000000', '#FFFFFF']) {
      const panel = blend(world.headerScrim, art, world.headerScrimAlpha);
      assert.ok(contrast(world.skyInk, panel) >= 4.5, `skyInk over ${art}: ${contrast(world.skyInk, panel)}`);
      assert.ok(contrast(world.skyMuted, panel) >= 4.5, `skyMuted over ${art}: ${contrast(world.skyMuted, panel)}`);
    }
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

test('blend composites a translucent colour over a backdrop', () => {
  assert.equal(blend('#FFFFFF', '#000000', 0.5), '#808080');
  assert.equal(blend('#123456', '#FFFFFF', 1), '#123456');
  assert.equal(blend('#123456', '#FFFFFF', 0), '#FFFFFF');
});
