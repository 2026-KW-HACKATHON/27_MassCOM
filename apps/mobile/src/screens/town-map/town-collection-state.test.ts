import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CollectionSnapshot } from '@/commerce/commerce-api';

import { INITIAL_TOWN_COLLECTION, townCollectionReducer, type TownCollectionState } from './town-collection-state';

const first = { visits: [], collectibles: [] } as unknown as CollectionSnapshot;
const second = { visits: [{ merchantId: 'one' }], collectibles: [] } as unknown as CollectionSnapshot;

const ready = (collection: CollectionSnapshot): TownCollectionState => ({ collection, status: 'ready', stale: false });

test('it starts by checking, with nothing shown and nothing stale', () => {
  assert.deepEqual(INITIAL_TOWN_COLLECTION, { collection: undefined, status: 'loading', stale: false });
});

test('a load that succeeds shows the stamps and clears any doubt', () => {
  assert.deepEqual(townCollectionReducer(INITIAL_TOWN_COLLECTION, { type: 'loaded', collection: first }), ready(first));
  const stale: TownCollectionState = { collection: first, status: 'ready', stale: true };
  assert.deepEqual(townCollectionReducer(stale, { type: 'loaded', collection: second }), ready(second));
});

test('a first load that fails is an error, and there are still no stamps to show', () => {
  assert.deepEqual(townCollectionReducer(INITIAL_TOWN_COLLECTION, { type: 'failed' }), { collection: undefined, status: 'error', stale: false });
});

test('a reload that fails over stamps already shown keeps them, marks them stale, and is not an error', () => {
  const next = townCollectionReducer(ready(first), { type: 'failed' });
  assert.equal(next.collection, first);
  assert.equal(next.status, 'ready');
  assert.equal(next.stale, true);
});

test('a second failure stays stale, and a later success clears it', () => {
  const once = townCollectionReducer(ready(first), { type: 'failed' });
  const twice = townCollectionReducer(once, { type: 'failed' });
  assert.deepEqual(twice, once);
  assert.deepEqual(townCollectionReducer(twice, { type: 'loaded', collection: second }), ready(second));
});

test('a person retrying after an error sees "checking" again, and a failure after that is an error again', () => {
  const errored = townCollectionReducer(INITIAL_TOWN_COLLECTION, { type: 'failed' });
  const retrying = townCollectionReducer(errored, { type: 'retry' });
  assert.equal(retrying.status, 'loading');
  assert.deepEqual(townCollectionReducer(retrying, { type: 'failed' }), errored);
  assert.deepEqual(townCollectionReducer(retrying, { type: 'loaded', collection: first }), ready(first));
});

test('retrying while stamps are shown changes nothing on screen, stale ones stay flagged until a load succeeds', () => {
  const shown = ready(first);
  assert.equal(townCollectionReducer(shown, { type: 'retry' }), shown, 'same state object, so no re-render');
  const stale: TownCollectionState = { collection: first, status: 'ready', stale: true };
  assert.equal(townCollectionReducer(stale, { type: 'retry' }), stale);
  assert.equal(townCollectionReducer(stale, { type: 'failed' }).stale, true);
});

test('the stale flag is only ever set together with stamps to show', () => {
  const states = [INITIAL_TOWN_COLLECTION, ready(first), townCollectionReducer(INITIAL_TOWN_COLLECTION, { type: 'failed' })];
  for (const state of states) {
    for (const event of [{ type: 'failed' }, { type: 'retry' }] as const) {
      const next = townCollectionReducer(state, event);
      assert.ok(!next.stale || next.collection !== undefined);
    }
  }
});
