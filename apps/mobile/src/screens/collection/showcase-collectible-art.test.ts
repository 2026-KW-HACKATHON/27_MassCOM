import assert from 'node:assert/strict';
import test from 'node:test';

import { collectibleArtSize, showcaseCollectibleArtKey } from './showcase-collectible-art';

test('only fixed virtual merchant IDs receive showcase collectible artwork', () => {
  const showcasePackage = 'kr.masscom.wolgye.demo';
  assert.equal(showcaseCollectibleArtKey(showcasePackage, 'showcase-local-merchant'), 'a');
  assert.equal(showcaseCollectibleArtKey(showcasePackage, 'showcase-local-merchant-b'), 'b');
  assert.equal(showcaseCollectibleArtKey(showcasePackage, 'showcase-local-merchant-c'), 'c');
  assert.equal(showcaseCollectibleArtKey(showcasePackage, 'merchant-1'), undefined);
  assert.equal(showcaseCollectibleArtKey(showcasePackage, 'showcase-local-merchant-d'), undefined);
  assert.equal(showcaseCollectibleArtKey(showcasePackage, ''), undefined);
  for (const packageId of ['kr.masscom.wolgye', 'kr.masscom.wolgye.dev', null, undefined]) {
    assert.equal(showcaseCollectibleArtKey(packageId, 'showcase-local-merchant'), undefined);
  }
});

test('artwork fits inside the screen and both card insets', () => {
  assert.equal(collectibleArtSize(360, 20, 18), 284);
  assert.equal(collectibleArtSize(200, 20, 18), 124);
  assert.equal(collectibleArtSize(50, 20, 18), 1);
});
