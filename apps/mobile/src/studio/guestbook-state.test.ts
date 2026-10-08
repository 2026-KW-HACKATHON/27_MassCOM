import assert from 'node:assert/strict';
import test from 'node:test';
import { appendGuestbookPage, notifyGuestbookChanged, subscribeGuestbookChanged, visibleUnreadGuestbookIds } from './guestbook-state';
import type { GuestbookEntry, GuestbookPage } from './room-api';

const entry = (id: string, unread = true, mine = false): GuestbookEntry => ({ id, roomId: 'room', message: '반가워요',
  createdAt: '2026-10-09T00:00:00.000Z', mine, authorNickname: '친구', authorAvatar: null, authorAvatarClothingId: null, unread });
const page = (entries: GuestbookEntry[], nextCursor: string | null = null): GuestbookPage => ({ roomId: 'room', entries, nextCursor, unreadCount: 6 });

test('read acknowledgement excludes offscreen, absent, already-read and self-authored entries', () => {
  const loaded = [entry('visible'), entry('offscreen'), entry('read', false), entry('mine', true, true)];
  assert.deepEqual(visibleUnreadGuestbookIds(loaded, ['visible', 'read', 'mine', 'new-arrival']), ['visible']);
  assert.deepEqual(visibleUnreadGuestbookIds(loaded, []), []);
});

test('pagination keeps loaded entries once, applies updated reads, and retains authoritative unread count', () => {
  const first = page([entry('newer'), entry('overlap')], 'older');
  const next = { ...page([entry('overlap', false), entry('older')]), unreadCount: 4 };
  const merged = appendGuestbookPage(first, next);
  assert.deepEqual(merged.entries.map(({ id, unread }) => ({ id, unread })), [
    { id: 'newer', unread: true }, { id: 'overlap', unread: false }, { id: 'older', unread: true },
  ]);
  assert.equal(merged.unreadCount, 4);
  assert.equal(merged.nextCursor, null);
  assert.equal(appendGuestbookPage(first, { ...next, roomId: 'another-room' }).entries.length, 2);
});

test('guestbook changes refresh active observers and unsubscribed screens remain untouched', () => {
  let changes = 0;
  const unsubscribe = subscribeGuestbookChanged(() => { changes += 1; });
  notifyGuestbookChanged();
  unsubscribe();
  notifyGuestbookChanged();
  assert.equal(changes, 1);
});
