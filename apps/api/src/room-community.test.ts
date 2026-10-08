import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRoomMessage, parseGuestbookMessage, guestbookMileageRule, roomVisitMileageRule } from './room-community.js';

test('room visit mileage requires a real visitor and caps at five different rooms', () => {
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: true, creditedRoomsToday: 0 }), 2);
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: true, creditedRoomsToday: 4 }), 2);
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: true, creditedRoomsToday: 5 }), 0);
  assert.equal(roomVisitMileageRule({ firstVisitToday: false, eligible: true, creditedRoomsToday: 0 }), 0);
  assert.equal(roomVisitMileageRule({ firstVisitToday: true, eligible: false, creditedRoomsToday: 0 }), 0);
});

test('text guestbook allows normalized multiline Unicode up to 300 code points and rejects hidden controls', () => {
  assert.equal(parseGuestbookMessage('  좋은 방\r\n다시 올게요\t!  '), '좋은 방\n다시 올게요\t!');
  assert.equal(parseGuestbookMessage('😀'.repeat(300)), '😀'.repeat(300));
  for (const message of ['', '  ', '😀'.repeat(301), '안녕\u200b하세요', '안녕\r하세요', 'x\r', 'x\u0000', '\ud800', 3])
    assert.equal(parseGuestbookMessage(message), null);
});

test('guestbook rewards only the first same-room daily post and have their own 25 point limit', () => {
  assert.equal(guestbookMileageRule(true,0),5);
  assert.equal(guestbookMileageRule(true,20),5);
  assert.equal(guestbookMileageRule(true,25),0);
  assert.equal(guestbookMileageRule(false,0),0);
});

test('guestbook message trims text and limits Unicode code points without invisible controls', () => {
  assert.equal(parseRoomMessage('  좋은 방이에요!  '), '좋은 방이에요!');
  assert.equal(parseRoomMessage('😀'.repeat(120)), '😀'.repeat(120));
  for (const message of ['', '  ', '😀'.repeat(121), '좋아요\n다시 올게요', '안녕\u200b하세요', 3])
    assert.equal(parseRoomMessage(message), null);
});
