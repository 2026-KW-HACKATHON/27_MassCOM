import assert from 'node:assert/strict';
import test from 'node:test';
import { studioShareLifetime } from './studio-share-lifetime';

test('blur and refocus never revive an old sharing operation', () => {
  let active = true, generation = 1;
  const old = studioShareLifetime(() => active, () => generation);
  assert.equal(old(), true);
  active = false; generation += 1;
  active = true;
  assert.equal(old(), false, 'generation invalidates even a blur missed by polling');
  assert.equal(studioShareLifetime(() => active, () => generation)(), true);
  generation = 1;
  assert.equal(old(), false, 'cancellation is permanent');
});

test('an observed cancellation stays cancelled without a generation provider', () => {
  let active = true;
  const alive = studioShareLifetime(() => active);
  assert.equal(alive(), true);
  active = false;
  assert.equal(alive(), false);
  active = true;
  assert.equal(alive(), false);
});
