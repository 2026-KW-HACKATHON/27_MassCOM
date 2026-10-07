import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roomVisitMileageRule } from './room-community.js';

test('room visit mileage requires a real visitor and caps at five different rooms', () => {
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: true, creditedRoomsToday: 0 }), 2);
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: true, creditedRoomsToday: 4 }), 2);
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: true, creditedRoomsToday: 5 }), 0);
  assert.equal(roomVisitMileageRule({ firstVisitToday: false, eligible: true, creditedRoomsToday: 0 }), 0);
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: false, creditedRoomsToday: 0 }), 0);
});
