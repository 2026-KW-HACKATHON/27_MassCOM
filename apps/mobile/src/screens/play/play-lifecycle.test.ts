import assert from 'node:assert/strict';
import test from 'node:test';
import { initialRunElapsed, shouldRenderGameFrame } from './play-lifecycle';

test('background rendering stops while issued run time keeps expiring', () => {
  assert.equal(shouldRenderGameFrame('playing', true, true), true);
  assert.equal(shouldRenderGameFrame('playing', false, true), false);
  assert.equal(shouldRenderGameFrame('playing', true, false), false);
  assert.equal(shouldRenderGameFrame('result', true, true), false);
  assert.equal(initialRunElapsed(30_000, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:30.000Z', Date.parse('2026-10-06T00:00:40.000Z')), 30_000);
  assert.equal(initialRunElapsed(30_000, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:30.000Z', Date.parse('2026-10-06T00:00:12.000Z')), 12_000);
});
