import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMPACT_ART_FRACTION, compactArtHeight, skyArtHeight, storeArtHeight } from './sky-art-size';

test('the art keeps the picture aspect at every width', () => {
  assert.equal(skyArtHeight(360), 240);
  assert.equal(skyArtHeight(1080), 720);
  assert.equal(skyArtHeight(411), 274);
});

test('the compact art for back headers crops the sky, never the rooftops, and is always shorter', () => {
  assert.ok(COMPACT_ART_FRACTION > 0.5 && COMPACT_ART_FRACTION < 1);
  for (const width of [320, 360, 411, 768]) {
    assert.ok(compactArtHeight(width) < skyArtHeight(width));
    assert.ok(compactArtHeight(width) >= 150, `${width}dp still holds the back button and title panel`);
  }
});

test('a store picture header is one banner: taller than the compact sky, short enough to keep the content in view', () => {
  assert.equal(storeArtHeight(360), 202);
  for (const width of [320, 360, 411, 768]) {
    assert.ok(storeArtHeight(width) > compactArtHeight(width) * 0.9, `${width}dp holds the back button, title panel and part of the picture`);
    assert.ok(storeArtHeight(width) < skyArtHeight(width), `${width}dp is shorter than the full sky art`);
    // The old layout stacked a 180dp sky banner and a 240dp picture: the one banner must beat that.
    assert.ok(storeArtHeight(width) < compactArtHeight(width) + 240, `${width}dp no longer stacks two banners`);
  }
});
