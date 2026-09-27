import assert from 'node:assert/strict';
import test from 'node:test';

import { showcaseCollectibleArtKey } from './showcase-collectible-art';

test('only fixed virtual merchant IDs receive showcase collectible artwork', () => {
  assert.equal(showcaseCollectibleArtKey('showcase-local-merchant'), 'a');
  assert.equal(showcaseCollectibleArtKey('showcase-local-merchant-b'), 'b');
  assert.equal(showcaseCollectibleArtKey('showcase-local-merchant-c'), 'c');
  assert.equal(showcaseCollectibleArtKey('merchant-1'), undefined);
  assert.equal(showcaseCollectibleArtKey('showcase-local-merchant-d'), undefined);
  assert.equal(showcaseCollectibleArtKey(''), undefined);
});
