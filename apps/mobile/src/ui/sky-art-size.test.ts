import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMPACT_ART_FRACTION, compactArtHeight, skyArtHeight } from './sky-art-size';

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
