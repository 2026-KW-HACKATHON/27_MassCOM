import assert from 'node:assert/strict';
import { test } from 'node:test';

import { uiMetrics } from '../../theme/ui-metrics';
import { CARD_PADDING, TILE_GAP, draftTileSize, finalArtSize } from './layout';

const widths = [320, 360, 393, 411, 600, 768];

test('two drafts and their gap fill the card exactly, so the 2x2 grid never wraps to one column', () => {
  for (const width of widths) {
    const inner = width - uiMetrics.pageInset * 2 - CARD_PADDING * 2;
    const tile = draftTileSize(width);
    assert.ok(tile * 2 + TILE_GAP <= inner, `${width}: ${tile * 2 + TILE_GAP} <= ${inner}`);
    assert.ok(tile * 2 + TILE_GAP >= inner - 1, `${width}: no more than a dp of slack`);
  }
});

test('a draft is a real picture at phone width, not a sliver', () => {
  assert.ok(draftTileSize(320) >= 100);
  assert.equal(draftTileSize(360), 136);
});

test('the final picture is the card width; a degenerate viewport never gives zero or negative sizes', () => {
  assert.equal(finalArtSize(360), 360 - 40 - 36);
  for (const width of [0, 10, -5]) {
    assert.ok(draftTileSize(width) >= 1);
    assert.ok(finalArtSize(width) >= 1);
  }
});
