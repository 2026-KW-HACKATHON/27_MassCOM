import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRoomMessage, roomVisitMileageRule } from './room-community.js';

test('room visit mileage requires a real visitor and caps at five different rooms', () => {
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: true, creditedRoomsToday: 0 }), 2);
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: true, creditedRoomsToday: 4 }), 2);
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: true, creditedRoomsToday: 5 }), 0);
  assert.equal(roomVisitMileageRule({ firstVisitToday: false, eligible: true, creditedRoomsToday: 0 }), 0);
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: false, creditedRoomsToday: 0 }), 0);
});

test('guestbook message trims text and limits Unicode code points without invisible controls', () => {
  assert.equal(parseRoomMessage('  좋은 방이에요!  '), '좋은 방이에요!');
  assert.equal(parseRoomMessage('😀'.repeat(120)), '😀'.repeat(120));
  for (const message of ['', '  ', '😀'.repeat(121), '좋아요\n다시 올게요', '안녕\u200b하세요', 3])
    assert.equal(parseRoomMessage(message), null);
});
