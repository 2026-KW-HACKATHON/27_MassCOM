import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createReduceMotionStore } from './reduce-motion';

function fakeSource() {
  let emit: (reduced: boolean) => void = () => undefined;
  let release: (reduced: boolean) => void = () => undefined;
  return {
    source: {
      read: () => new Promise<boolean>((resolve) => { release = resolve; }),
      listen: (onChange: (reduced: boolean) => void) => { emit = onChange; },
    },
    emit: (reduced: boolean) => emit(reduced),
    resolveRead: (reduced: boolean) => release(reduced),
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('the store starts with motion allowed and adopts the OS value once it is read', async () => {
  const fake = fakeSource();
  const store = createReduceMotionStore(fake.source);
  assert.equal(store.get(), false);
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  fake.resolveRead(true);
  await tick();
  assert.equal(store.get(), true);
  assert.equal(calls, 1);
});

test('toggling the OS setting at runtime notifies every subscriber', () => {
  const fake = fakeSource();
  const store = createReduceMotionStore(fake.source);
  const seen: boolean[] = [];
  store.subscribe(() => seen.push(store.get()));
  store.subscribe(() => seen.push(store.get()));
  fake.emit(true);
  fake.emit(false);
  assert.deepEqual(seen, [true, true, false, false]);
});

test('an unchanged value does not wake subscribers, and unsubscribing stops updates', () => {
  const fake = fakeSource();
  const store = createReduceMotionStore(fake.source);
  let calls = 0;
  const stop = store.subscribe(() => { calls += 1; });
  fake.emit(false);
  assert.equal(calls, 0);
  stop();
  fake.emit(true);
  assert.equal(calls, 0);
  assert.equal(store.get(), true, 'the value still tracks the OS');
});

test('a change heard before the first read resolves is not overwritten by the stale read', async () => {
  const fake = fakeSource();
  const store = createReduceMotionStore(fake.source);
  store.subscribe(() => undefined);
  fake.emit(true);
  fake.resolveRead(false);
  await tick();
  assert.equal(store.get(), true);
});

test('a failed read leaves motion allowed', async () => {
  const store = createReduceMotionStore({
    read: () => Promise.reject(new Error('no accessibility service')),
    listen: () => undefined,
  });
  store.subscribe(() => undefined);
  await tick();
  assert.equal(store.get(), false);
});

test('the source is started once, on the first subscription', () => {
  let listens = 0;
  const store = createReduceMotionStore({ read: () => Promise.resolve(false), listen: () => { listens += 1; } });
  assert.equal(listens, 0);
  store.subscribe(() => undefined);
  store.subscribe(() => undefined);
  assert.equal(listens, 1);
});
