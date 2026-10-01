import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canStartHistoryLoad, historyFailed, historyLoaded, historyLoading, initialHistoryLoad,
} from './history-loader';

function entry(id: string) {
  return { id, amount: 100, grade: 'BRONZE' as const, itemId: 'cook-cat', itemName: '요리사 냥이', createdAt: '2026-10-01T00:00:00.000Z' };
}

test('canStartHistoryLoad refuses a second load while one is already in flight', () => {
  assert.equal(canStartHistoryLoad('loading'), false);
  assert.equal(canStartHistoryLoad('idle'), true);
  assert.equal(canStartHistoryLoad('ready'), true);
  assert.equal(canStartHistoryLoad('error'), true);
});

test('historyLoading flips the status without touching what is already shown', () => {
  const state = { status: 'ready' as const, entries: [entry('s1')], nextCursor: null };
  assert.deepEqual(historyLoading(state), { ...state, status: 'loading' });
});

test('historyLoaded replaces the page when there is no cursor (first page)', () => {
  const state = { status: 'loading' as const, entries: [entry('stale')], nextCursor: 'stale-cursor' };
  const next = historyLoaded(state, { mileage: { earned: 0, spent: 0, balance: 0 }, spends: [entry('s1')], nextCursor: null }, undefined);
  assert.deepEqual(next, { status: 'ready', entries: [entry('s1')], nextCursor: null });
});

test('historyLoaded appends when there is a cursor ("더 보기")', () => {
  const state = { status: 'loading' as const, entries: [entry('s1')], nextCursor: 'c1' };
  const next = historyLoaded(state, { mileage: { earned: 0, spent: 0, balance: 0 }, spends: [entry('s2')], nextCursor: null }, 'c1');
  assert.deepEqual(next.entries, [entry('s1'), entry('s2')]);
  assert.equal(next.nextCursor, null);
});

test('historyFailed keeps the entries already on screen and records the error', () => {
  const state = { status: 'loading' as const, entries: [entry('s1')], nextCursor: null };
  const error = new Error('boom');
  assert.deepEqual(historyFailed(state, error), { status: 'error', entries: [entry('s1')], nextCursor: null, error });
});

test('initialHistoryLoad starts idle with nothing loaded', () => {
  assert.deepEqual(initialHistoryLoad, { status: 'idle', entries: [], nextCursor: null });
});
