import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultStudio, type FurnitureSnapshot } from './studio-api';
import { changeFurniture, clampPosition, placeFurniture, removeFurniture, studioDirty, studioNeedsReload } from './studio-furniture';

const owned: FurnitureSnapshot = { catalog: [{ id: 'chair', name: '의자', kind: 'FURNITURE', assetId: null, priceMileage: null, sellable: false }],
  inventory: [{ id: 'owned-chair', itemId: 'chair' }] };

test('furniture editor places only owned IDs and cancel leaves saved state intact', () => {
  assert.equal(placeFurniture(defaultStudio, 'unowned', owned), defaultStudio);
  const placed = placeFurniture(defaultStudio, 'owned-chair', owned);
  assert.equal(placed.furniture.length, 1);
  assert.equal(placeFurniture(placed, 'owned-chair', owned), placed);
  assert.equal(defaultStudio.furniture.length, 0);
  assert.equal(studioDirty(defaultStudio, placed), true);
  assert.equal(studioDirty(defaultStudio, defaultStudio), false);
  assert.deepEqual(removeFurniture(placed, 'owned-chair').furniture, []);
  assert.equal(changeFurniture(placed, 'owned-chair', (entry) => ({ ...entry, x: clampPosition(1.4), rotation: 90 })).furniture[0]?.x, 1);
});

test('temporary navigation retains studio draft while a changed account client or route request reloads', () => {
  const client = {};
  const loadedFor = { client, requestKey: 'original' };
  assert.equal(studioNeedsReload(loadedFor, client, 'original'), false);
  assert.equal(studioNeedsReload(loadedFor, {}, 'original'), true);
  assert.equal(studioNeedsReload(loadedFor, client, 'new-coin'), true);
  assert.equal(studioNeedsReload(null, client, 'original'), true);
});
