import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyGradeDrawCoinAcquisition,
  classifyRerollCoinAcquisition,
  classifyTicketCoinAcquisition,
  snapshotCoinQuantities,
} from './coin-acquisition';

const before = snapshotCoinQuantities([
  { publicationId: 'pub-a', gradeId: 'bronze', quantity: 1 },
  { publicationId: 'pub-b', gradeId: 'silver', quantity: 0 },
]);

test('rerolling into the same consumed coin is never treated as new', () => {
  assert.equal(classifyRerollCoinAcquisition({
    before,
    consumed: { publicationId: 'pub-a', gradeId: 'bronze' },
    coin: { publicationId: 'pub-a', gradeId: 'bronze', quantity: 1 },
    replayed: false,
  }), 'owned');
});

test('rerolling into a previously empty slot is a genuine new registration', () => {
  assert.equal(classifyRerollCoinAcquisition({
    before,
    consumed: { publicationId: 'pub-a', gradeId: 'bronze' },
    coin: { publicationId: 'pub-b', gradeId: 'silver', quantity: 1 },
    replayed: false,
  }), 'new');
});

test('reroll replay and unknown pre-request state stay conservative', () => {
  assert.equal(classifyRerollCoinAcquisition({
    consumed: { publicationId: 'pub-a', gradeId: 'bronze' },
    coin: { publicationId: 'pub-c', gradeId: 'gold', quantity: 1 },
    replayed: false,
  }), 'owned');
  assert.equal(classifyRerollCoinAcquisition({
    before,
    consumed: { publicationId: 'pub-a', gradeId: 'bronze' },
    coin: { publicationId: 'pub-b', gradeId: 'silver', quantity: 1 },
    replayed: true,
  }), 'owned');
});

test('ticket use prefers the pre-use snapshot and falls back to fresh quantity only for non-replay results', () => {
  assert.equal(classifyTicketCoinAcquisition({
    before,
    coin: { publicationId: 'pub-b', gradeId: 'silver', quantity: 2 },
    replayed: false,
  }), 'new');
  assert.equal(classifyTicketCoinAcquisition({
    coin: { publicationId: 'pub-c', gradeId: 'gold', quantity: 1 },
    replayed: false,
  }), 'new');
  assert.equal(classifyTicketCoinAcquisition({
    coin: { publicationId: 'pub-c', gradeId: 'gold', quantity: 1 },
    replayed: true,
  }), 'owned');
});

test('grade draw coin status follows server duplicate and replay identity', () => {
  assert.equal(classifyGradeDrawCoinAcquisition({ duplicate: false, replayed: false }), 'new');
  assert.equal(classifyGradeDrawCoinAcquisition({ duplicate: true, replayed: false }), 'duplicate');
  assert.equal(classifyGradeDrawCoinAcquisition({ duplicate: false, replayed: true }), 'owned');
});
