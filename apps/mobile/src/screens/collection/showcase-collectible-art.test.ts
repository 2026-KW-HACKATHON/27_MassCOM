import assert from 'node:assert/strict';
import test from 'node:test';

import { collectibleArtSize, showcaseCollectibleArtKey } from './showcase-collectible-art';

test('only fixed virtual merchant IDs receive showcase collectible artwork', () => {
  assert.equal(showcaseCollectibleArtKey('showcase-local-merchant'), 'a');
  assert.equal(showcaseCollectibleArtKey('showcase-local-merchant-b'), 'b');
  assert.equal(showcaseCollectibleArtKey('showcase-local-merchant-c'), 'c');
  assert.equal(showcaseCollectibleArtKey('merchant-1'), undefined);
  assert.equal(showcaseCollectibleArtKey('showcase-local-merchant-d'), undefined);
  assert.equal(showcaseCollectibleArtKey(''), undefined);
});

test('artwork fits inside the screen and both card insets', () => {
  assert.equal(collectibleArtSize(360, 20, 18), 284);
  assert.equal(collectibleArtSize(200, 20, 18), 124);
  assert.equal(collectibleArtSize(50, 20, 18), 1);
});
