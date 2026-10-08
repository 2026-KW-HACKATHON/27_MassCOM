import assert from 'node:assert/strict';
import test from 'node:test';

import { collectibleArtSize, showcaseCollectibleArtKey } from './showcase-collectible-art';

test('only selected real-data merchant IDs receive showcase collectible artwork', () => {
  const showcasePackage = 'kr.masscom.wolgye.demo';
  assert.equal(showcaseCollectibleArtKey(showcasePackage, 'showcase-wolgye-MA010120220813334279'), 'b');
  assert.equal(showcaseCollectibleArtKey(showcasePackage, 'showcase-wolgye-MA010120220809686086'), 'b');
  assert.equal(showcaseCollectibleArtKey(showcasePackage, 'showcase-wolgye-MA010120220812445724'), 'c');
  assert.equal(showcaseCollectibleArtKey(showcasePackage, 'merchant-1'), undefined);
  assert.equal(showcaseCollectibleArtKey(showcasePackage, 'showcase-wolgye-MA010120220813334279-d'), undefined);
  assert.equal(showcaseCollectibleArtKey(showcasePackage, ''), undefined);
  for (const retiredId of ['showcase-local-merchant', 'showcase-local-merchant-b', 'showcase-local-merchant-c']) {
    assert.equal(showcaseCollectibleArtKey(showcasePackage, retiredId), undefined);
  }
  for (const packageId of ['kr.masscom.wolgye', 'kr.masscom.wolgye.dev', null, undefined]) {
    assert.equal(showcaseCollectibleArtKey(packageId, 'showcase-wolgye-MA010120220813334279'), undefined);
  }
});

test('artwork fits inside the screen and both card insets', () => {
  assert.equal(collectibleArtSize(360, 20, 18), 284);
  assert.equal(collectibleArtSize(200, 20, 18), 124);
  assert.equal(collectibleArtSize(50, 20, 18), 1);
});
