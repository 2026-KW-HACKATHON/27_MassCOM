import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePeriods, parseExceptions, profileFromForm, errorMessage, renderRealWorldPreview } from '../../apps/production-web/assets/real-world-merchant.mjs';

const value = input => ({ value: input, checked: false });
function form(overrides = {}) {
  const elements = Object.fromEntries([
    'latitude', 'longitude', 'entranceLatitude', 'entranceLongitude', 'floor', 'unit', 'entranceNote',
    'verificationNote', 'exceptions', 'overrideState', 'overrideStartsAt', 'overrideExpiresAt',
    'overrideNote', 'visitInstructions', 'phone', 'website',
    ...Array.from({ length: 7 }, (_, i) => `weekday${i + 1}`),
  ].map(name => [name, value('')]));
  elements.locationConfirmed = { checked: false };
  elements.scheduleConfirmed = { checked: false };
  for (const [name, input] of Object.entries(overrides)) elements[name] = typeof input === 'boolean' ? { checked: input } : value(input);
  return { elements, querySelectorAll: () => [] };
}
const empty = { location: null, schedule: null, todayOverride: null, menuItems: [], visitInstructions: '', contact: { phone: null, website: null } };

test('weekly periods preserve breaks, overnight hours and last order; reject overlap and out-of-range order', () => {
  assert.deepEqual(parsePeriods('09:00-14:00/13:30,17:00-02:00+1/01:30+1'), [
    { startMinute: 540, endMinute: 840, lastOrderMinute: 810 },
    { startMinute: 1020, endMinute: 1560, lastOrderMinute: 1530 },
  ]);
  assert.throws(() => parsePeriods('09:00-14:00,13:00-18:00'), /겹치거나/);
  assert.throws(() => parsePeriods('09:00-18:00/19:00'), /마지막 주문/);
  assert.throws(() => parsePeriods('23:00-01:00'), /마지막 주문/);
});

test('specific day replaces all periods and rejects duplicate or invalid calendar dates', () => {
  assert.deepEqual(parseExceptions('2026-10-09 | | 휴무'), [{ date: '2026-10-09', periods: [], note: '휴무' }]);
  assert.throws(() => parseExceptions('2026-02-30 | | 휴무'), /날짜/);
  assert.throws(() => parseExceptions('2026-10-09 | | 휴무\n2026-10-09 | 09:00-10:00 | 재영업'), /한 번/);
});

test('manual owner location requires independent evidence and keeps existing verification unchanged', () => {
  const now = new Date('2026-10-06T03:00:00.000Z');
  const inputs = { latitude: '37.65', longitude: '127.06', verificationNote: '점주가 현장 확인' };
  assert.throws(() => profileFromForm(form(inputs), empty, now), /독립적으로/);
  const confirmed = profileFromForm(form({ ...inputs, locationConfirmed: true }), empty, now);
  assert.deepEqual(confirmed.location.building, { latitude: 37.65, longitude: 127.06 });
  assert.equal(confirmed.location.source, 'OWNER_DECLARED');
  assert.equal(confirmed.location.verifiedAt, now.toISOString());
  const documented = profileFromForm(form({ ...inputs, locationConfirmed: true }), empty, now, 'ADMIN_DOCUMENTED');
  assert.equal(documented.location.source, 'ADMIN_DOCUMENTED');
  const unchanged = profileFromForm(form(inputs), { ...empty, location: confirmed.location }, new Date('2026-10-07T00:00:00Z'));
  assert.equal(unchanged.location.verifiedAt, now.toISOString());
  assert.equal(unchanged.location.source, 'OWNER_DECLARED');
});

test('schedule confirmation, temporary closure and 409/403 feedback are explicit', () => {
  assert.throws(() => profileFromForm(form({ weekday1: '09:00-18:00' }), empty), /영업시간을 확인/);
  const profile = profileFromForm(form({ weekday1: '09:00-18:00', scheduleConfirmed: true,
    overrideState: 'CLOSED', overrideStartsAt: '2026-10-06T12:00', overrideExpiresAt: '2026-10-06T14:00', overrideNote: '임시 휴무' }), empty);
  assert.equal(profile.schedule.timezone, 'Asia/Seoul');
  assert.equal(profile.schedule.weekly.length, 7);
  assert.equal(profile.todayOverride.state, 'CLOSED');
  assert.equal(profile.todayOverride.startsAt, '2026-10-06T03:00:00.000Z');
  assert.match(errorMessage({ status: 409 }), /저장하지 않은 내용/);
  assert.match(errorMessage({ status: 403 }), /역할/);
  assert.match(errorMessage({ code: 'MAP_NOT_CONFIGURED' }), /지도 검색 키/);
});

test('JSONB key and weekday order do not require hours confirmation for an unrelated edit', () => {
  const inputs = { weekday1: '09:00-18:00/17:30', exceptions: '2026-10-09 | | 휴무' };
  const verifiedAt = '2026-10-06T03:00:00.000Z';
  const original = profileFromForm(form({ ...inputs, scheduleConfirmed: true }), empty, new Date(verifiedAt));
  const stored = { ...original, schedule: { ...original.schedule,
    weekly: original.schedule.weekly.map(({ weekday, periods }) => ({ periods: periods.map(p => ({
      endMinute: p.endMinute, lastOrderMinute: p.lastOrderMinute, startMinute: p.startMinute,
    })), weekday })).reverse(),
  } };
  const updated = profileFromForm(form({ ...inputs, visitInstructions: '안내만 변경' }), stored, new Date('2026-10-07T03:00:00Z'));
  assert.equal(updated.schedule.verifiedAt, verifiedAt);
  assert.equal(updated.visitInstructions, '안내만 변경');
  assert.throws(() => profileFromForm(form({ ...inputs, weekday1: '09:00-19:00' }), stored), /영업시간을 확인/);
});

test('unpublished owner preview renders private draft fields and photo without public lookup or publishing', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.text = ''; }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.text = ''; this.children = children; }
  }
  const doc = { createElement: tag => new Node(tag), createTextNode: text => ({ textContent: text }) };
  const target = new Node('div');
  const draft = {
    name: '검증용 가상 같은상호', roadAddress: '서울 검증용 가상건물 1',
    location: { floor: '2층', unit: '201호', entranceNote: '후문 계단', source: 'OWNER_MEASURED',
      verificationNote: '비공개 위치 검증 기록' },
    business: { state: 'BREAK', acceptingOrders: false, lastOrderAt: null },
    todayOverride: { state: 'CLOSED', note: '오늘 임시 휴무' },
    schedule: { weekly: [{ weekday: 1, periods: [
      { startMinute: 540, endMinute: 840, lastOrderMinute: 810 },
      { startMinute: 1020, endMinute: 1560, lastOrderMinute: 1530 },
    ] }], exceptions: [{ date: '2026-10-09', periods: [], note: '한글날 휴무' }] },
    campaign: { title: '검증용 가상 캠페인', state: 'PAUSED' },
    menuItems: [{ name: '검증용 가상 메뉴', priceWon: 5000, priceNote: null }],
    visitInstructions: '후문으로 들어오세요.',
    photos: [{ id: 'photo-1', caption: '<script>사진</script>' }],
  };
  renderRealWorldPreview(doc, target, draft, 'merchant', 'unpublished-owner');
  const text = target.textContent;
  for (const expected of ['검증용 가상 같은상호', '서울 검증용 가상건물 1', '2층', '후문 계단',
    '쉬는 시간', '오늘 임시 휴무', '09:00~14:00 (마지막 주문 13:30)', '17:00~02:00+1 (마지막 주문 01:30+1)',
    '한글날 휴무', '일시 중지', '5,000원', '후문으로 들어오세요.']) assert.ok(text.includes(expected), expected);
  assert.equal(text.includes('비공개 위치 검증 기록'), false);
  const figure = target.children.find(child => child.tag === 'figure');
  const image = figure.children.find(child => child.tag === 'img');
  assert.equal(image.src, '/api/web/v1/merchant/merchants/unpublished-owner/photos/photo-1/image');
  assert.equal(image.alt, '<script>사진</script>');
  assert.equal(figure.children.find(child => child.tag === 'figcaption').textContent, '<script>사진</script>');
});
