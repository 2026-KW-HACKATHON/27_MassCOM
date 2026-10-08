import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isDisclosureForced, setDisclosureOverride, subscribeDisclosureOverride } from './disclosure-override';

// CI leaves EXPO_PUBLIC_DISCLOSURE unset; the build-time switch is tested through forcedByEnv in discovery-stage.test.ts.
test('the showcase hook forces everything visible and lifts again', () => {
  assert.equal(isDisclosureForced(), false);
  setDisclosureOverride('regular');
  assert.equal(isDisclosureForced(), true);
  setDisclosureOverride(undefined);
  assert.equal(isDisclosureForced(), false);
});

test('listeners hear a change once, and not a repeat of the same value or after unsubscribing', () => {
  let heard = 0;
  const unsubscribe = subscribeDisclosureOverride(() => { heard += 1; });
  setDisclosureOverride('regular');
  setDisclosureOverride('regular');
  assert.equal(heard, 1);
  setDisclosureOverride(undefined);
  assert.equal(heard, 2);
  unsubscribe();
  setDisclosureOverride('regular');
  assert.equal(heard, 2);
  setDisclosureOverride(undefined);
});
