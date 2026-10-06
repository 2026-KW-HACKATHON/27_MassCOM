import assert from 'node:assert/strict';
import { test } from 'node:test';
import { businessStateAt, validateSchedule } from './real-world-hours.js';
import { validateOwnedLocation, validateRealWorldProfile } from './real-world-rules.js';

const location = { building: { latitude: 37.5, longitude: 127 }, entrance: null, floor: null, unit: null,
  entranceNote: null, source: 'OWNER_DECLARED', verificationNote: '점주가 확인한 건물 입구',
  verifiedAt: '2026-10-05T00:00:00Z' } as const;
const weekly = Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, periods: i === 6 ?
  [{ startMinute: 1320, endMinute: 1560, lastOrderMinute: 1500 }] :
  [{ startMinute: 600, endMinute: 1260, lastOrderMinute: 1200 }] }));
const schedule = { timezone: 'Asia/Seoul', weekly, exceptions: [], verifiedAt: '2026-10-05T00:00:00Z' };

test('owned position rejects reversed, partial and laundered provider positions', () => {
  assert.deepEqual(validateOwnedLocation(location).building, location.building);
  assert.throws(() => validateOwnedLocation({ ...location, building: { latitude: 127, longitude: 37 } }));
  assert.throws(() => validateOwnedLocation({ ...location, building: { latitude: 37.5 } }));
  assert.throws(() => validateOwnedLocation({ ...location, source: 'TMAP' }));
  assert.throws(() => validateOwnedLocation({ ...location, verificationNote: '' }));
});

test('schedule observes breaks, previous-day spill, exception closure and override expiry', () => {
  const normalized = validateSchedule(schedule);
  assert.equal(businessStateAt(normalized, new Date('2026-10-04T15:30:00Z')).state, 'OPEN');
  const closedMonday = validateSchedule({ ...schedule, exceptions: [{ date: '2026-10-05', periods: [], note: '휴무' }] });
  assert.equal(businessStateAt(closedMonday, new Date('2026-10-04T15:30:00Z')).state, 'CLOSED');
  const split = validateSchedule({ ...schedule, weekly: weekly.map((day, i) => i === 0 ?
    { weekday: 1, periods: [{ startMinute: 600, endMinute: 720, lastOrderMinute: null },
      { startMinute: 780, endMinute: 1260, lastOrderMinute: 1200 }] } : day) });
  assert.equal(businessStateAt(split, new Date('2026-10-05T03:30:00Z')).state, 'BREAK');
  const override = { state: 'CLOSED' as const, startsAt: '2026-10-05T01:00:00Z',
    expiresAt: '2026-10-05T02:00:00Z', note: '임시 휴무' };
  assert.equal(businessStateAt(split, new Date('2026-10-05T01:30:00Z'), override).basis, 'OWNER_OVERRIDE');
  assert.equal(businessStateAt(split, new Date('2026-10-05T02:01:00Z'), override).basis, 'SCHEDULE');
  assert.throws(() => validateSchedule({ ...schedule, exceptions: [{ date: '2026-02-30', periods: [], note: null }] }));
  assert.throws(() => validateSchedule({ ...schedule, weekly: weekly.map((day, i) => i === 0 ?
    { weekday: 1, periods: [{ startMinute: 0, endMinute: 120, lastOrderMinute: null }] } : day) }));
});

test('next change includes overnight last order, close, closure cancellation, and future override', () => {
  const normalized = validateSchedule(schedule);
  assert.equal(businessStateAt(normalized, new Date('2026-10-04T15:30:00Z')).nextChangeAt,
    '2026-10-04T16:00:00.000Z'); // Monday 00:30 KST -> last order 01:00
  assert.equal(businessStateAt(normalized, new Date('2026-10-04T16:30:00Z')).nextChangeAt,
    '2026-10-04T17:00:00.000Z'); // Monday 01:30 KST -> close 02:00
  const closure = validateSchedule({ ...schedule, exceptions: [{ date: '2026-10-05', periods: [], note: '휴무' }] });
  assert.equal(businessStateAt(closure, new Date('2026-10-04T14:30:00Z')).nextChangeAt,
    '2026-10-04T15:00:00.000Z'); // Monday exception cancels Sunday spill at midnight
  const future = { state: 'CLOSED' as const, startsAt: '2026-10-05T02:00:00Z',
    expiresAt: '2026-10-05T03:00:00Z', note: '임시 휴무' };
  assert.equal(businessStateAt(normalized, new Date('2026-10-05T01:30:00Z'), future).nextChangeAt,
    '2026-10-05T02:00:00.000Z');
  assert.equal(businessStateAt(normalized, new Date('2026-10-05T02:30:00Z'), future).nextChangeAt,
    '2026-10-05T03:00:00.000Z');
  assert.equal(businessStateAt(null, new Date('2026-10-05T01:30:00Z'), future).nextChangeAt,
    '2026-10-05T02:00:00.000Z');
});

test('profile requires independent source and stable menu IDs', () => {
  const profile = { location, schedule, todayOverride: null, menuItems: [{ id: 'menu-1', name: '국수',
    priceWon: 9000, priceNote: null, photoId: null }], visitInstructions: '', contact: { phone: null, website: null } };
  assert.equal(validateRealWorldProfile(profile).menuItems[0]?.name, '국수');
  assert.throws(() => validateRealWorldProfile({ ...profile, menuItems: [...profile.menuItems, ...profile.menuItems] }));
  assert.throws(() => validateRealWorldProfile({ ...profile, location: { ...location, source: 'TMAP' } }));
});
