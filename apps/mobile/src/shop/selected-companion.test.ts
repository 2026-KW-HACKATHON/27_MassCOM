import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectedCompanion } from './selected-companion';

test('selected owned friend appears; default, missing, stale and unowned selections remain the penguin', () => {
  const items = [{ id: 'cook-cat', owned: true }, { id: 'cafe-bear', owned: false }];
  assert.equal(selectedCompanion({ avatar: 'cook-cat', items }), 'cook-cat');
  assert.equal(selectedCompanion({ avatar: null, items }), null);
  assert.equal(selectedCompanion({ avatar: 'cafe-bear', items }), null);
  assert.equal(selectedCompanion({ avatar: 'unknown', items }), null);
  assert.equal(selectedCompanion(undefined), null);
});

test('selection is resolved from each account snapshot without retaining the previous account', () => {
  const accountA = { avatar: 'cook-cat', items: [{ id: 'cook-cat', owned: true }] };
  const accountB = { avatar: null, items: [] };
  assert.equal(selectedCompanion(accountA), 'cook-cat');
  assert.equal(selectedCompanion(undefined), null);
  assert.equal(selectedCompanion(accountB), null);
});
