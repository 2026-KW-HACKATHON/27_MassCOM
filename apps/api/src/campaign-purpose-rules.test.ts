import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  benefitJudgedAt,
  benefitStateFor,
  isWithinWindows,
  kstClock,
  normalizeCampaignPurpose,
  normalizeTimeWindows,
  parseClockMinutes,
  windowStatusAt,
  type TimeWindow,
} from './campaign-purpose-rules.js';

// 한국 시간으로 적은 순간. 2026-10-05는 월요일이다.
const kst = (value: string) => new Date(`${value}+09:00`);
const weekdayAfternoon: TimeWindow[] = [{ days: [1, 2, 3, 4, 5], start: '14:00', end: '17:00' }];

test('parseClockMinutes accepts HH:MM only, and 24:00 only as an end time', () => {
  assert.equal(parseClockMinutes('00:00'), 0);
  assert.equal(parseClockMinutes('09:05'), 545);
  assert.equal(parseClockMinutes('23:59'), 1439);
  assert.equal(parseClockMinutes('24:00'), undefined);
  assert.equal(parseClockMinutes('24:00', true), 1440);
  for (const bad of ['9:00', '09:0', '24:01', '12:60', '1200', '12:00:00', ' 12:00', '', 'ab:cd', '-1:00', '12.30']) {
    assert.equal(parseClockMinutes(bad, true), undefined, bad);
  }
  for (const notText of [900, null, undefined, {}, ['09:00']]) assert.equal(parseClockMinutes(notText, true), undefined);
});

test('kstClock reads the Korean weekday and time of day, including the date rollover from UTC', () => {
  assert.deepEqual(kstClock(kst('2026-10-05T00:00:00.000')), { isoWeekday: 1, msOfDay: 0 });
  assert.deepEqual(kstClock(kst('2026-10-04T23:59:59.999')), { isoWeekday: 7, msOfDay: 86_399_999 });
  // UTC로는 아직 월요일(15:30)이지만 한국에서는 화요일 00:30이다.
  assert.deepEqual(kstClock(new Date('2026-10-05T15:30:00.000Z')), { isoWeekday: 2, msOfDay: 30 * 60_000 });
  // UTC 14:59:59.999 = 한국 월요일 23:59:59.999, 15:00:00.000 = 화요일 00:00.
  assert.deepEqual(kstClock(new Date('2026-10-05T14:59:59.999Z')), { isoWeekday: 1, msOfDay: 86_399_999 });
  assert.deepEqual(kstClock(new Date('2026-10-05T15:00:00.000Z')), { isoWeekday: 2, msOfDay: 0 });
  // 1970 이전(음수 시각)과 에포크 경계. 1970-01-01은 목요일이다.
  assert.deepEqual(kstClock(new Date(-1)), { isoWeekday: 4, msOfDay: 9 * 3_600_000 - 1 });
  assert.deepEqual(kstClock(new Date('1969-12-31T14:59:59.999Z')), { isoWeekday: 3, msOfDay: 86_399_999 });
  assert.equal(kstClock(new Date(Number.NaN)), undefined);
  // 7일 순환: 2026-10-05(월)부터 일주일.
  assert.deepEqual([5, 6, 7, 8, 9, 10, 11].map(day => kstClock(kst(`2026-10-${String(day).padStart(2, '0')}T12:00:00`))!.isoWeekday),
    [1, 2, 3, 4, 5, 6, 7]);
  // 연말·연초 경계도 같은 계산이다(2026-12-31은 목요일, 2027-01-01은 금요일).
  assert.equal(kstClock(kst('2026-12-31T23:59:59.999'))!.isoWeekday, 4);
  assert.equal(kstClock(kst('2027-01-01T00:00:00.000'))!.isoWeekday, 5);
});

test('isWithinWindows includes the start instant and excludes the end instant', () => {
  assert.equal(isWithinWindows(kst('2026-10-05T13:59:59.999'), weekdayAfternoon), false);
  assert.equal(isWithinWindows(kst('2026-10-05T14:00:00.000'), weekdayAfternoon), true);
  assert.equal(isWithinWindows(kst('2026-10-05T14:00:00.001'), weekdayAfternoon), true);
  assert.equal(isWithinWindows(kst('2026-10-05T16:59:59.999'), weekdayAfternoon), true);
  assert.equal(isWithinWindows(kst('2026-10-05T17:00:00.000'), weekdayAfternoon), false);
  assert.equal(isWithinWindows(kst('2026-10-05T17:00:00.001'), weekdayAfternoon), false);
});

test('isWithinWindows follows the Korean weekday, not the UTC weekday', () => {
  // 금요일 14:00~17:00 KST는 UTC로도 금요일이다. 토요일은 요일이 달라 밖이다.
  assert.equal(isWithinWindows(kst('2026-10-09T15:00:00'), weekdayAfternoon), true);
  assert.equal(isWithinWindows(kst('2026-10-10T15:00:00'), weekdayAfternoon), false);
  assert.equal(isWithinWindows(kst('2026-10-11T15:00:00'), weekdayAfternoon), false);
  // 한국 화요일 00:30(UTC 월요일 15:30)은 월요일 창이 아니라 화요일 창에 속한다.
  const justAfterMidnight: TimeWindow[] = [{ days: [2], start: '00:00', end: '01:00' }];
  assert.equal(isWithinWindows(new Date('2026-10-05T15:30:00.000Z'), justAfterMidnight), true);
  assert.equal(isWithinWindows(new Date('2026-10-05T15:30:00.000Z'), [{ days: [1], start: '00:00', end: '01:00' }]), false);
  // 일요일(7)은 일요일 창에서만 안이다.
  const sunday: TimeWindow[] = [{ days: [7], start: '10:00', end: '12:00' }];
  assert.equal(isWithinWindows(kst('2026-10-04T11:00:00'), sunday), true);
  assert.equal(isWithinWindows(kst('2026-10-05T11:00:00'), sunday), false);
});

test('a window that runs to 24:00 covers the whole last minute and stops at the Korean midnight', () => {
  const evening: TimeWindow[] = [{ days: [1], start: '21:00', end: '24:00' }];
  assert.equal(isWithinWindows(kst('2026-10-05T20:59:59.999'), evening), false);
  assert.equal(isWithinWindows(kst('2026-10-05T21:00:00.000'), evening), true);
  assert.equal(isWithinWindows(kst('2026-10-05T23:59:59.999'), evening), true);
  // 자정이 지나면 화요일이라 월요일 창 밖이다(자정을 넘기는 시간대는 없다).
  assert.equal(isWithinWindows(kst('2026-10-06T00:00:00.000'), evening), false);
});

test('several windows are a union and an empty list never matches', () => {
  const windows: TimeWindow[] = [
    { days: [1, 3], start: '09:00', end: '10:00' },
    { days: [3], start: '15:00', end: '16:30' },
    { days: [6, 7], start: '11:00', end: '11:01' },
  ];
  assert.equal(isWithinWindows(kst('2026-10-05T09:30:00'), windows), true); // 월
  assert.equal(isWithinWindows(kst('2026-10-07T09:30:00'), windows), true); // 수 오전
  assert.equal(isWithinWindows(kst('2026-10-07T16:29:59'), windows), true); // 수 오후
  assert.equal(isWithinWindows(kst('2026-10-07T16:30:00'), windows), false);
  assert.equal(isWithinWindows(kst('2026-10-06T09:30:00'), windows), false); // 화
  assert.equal(isWithinWindows(kst('2026-10-10T11:00:59.999'), windows), true); // 토 한 분짜리
  assert.equal(isWithinWindows(kst('2026-10-10T11:01:00.000'), windows), false);
  assert.equal(isWithinWindows(kst('2026-10-05T09:30:00'), []), false);
  assert.equal(isWithinWindows(new Date(Number.NaN), windows), false);
});

test('windowStatusAt is NONE without a time condition and benefitStateFor maps it for the visit payload', () => {
  const inside = kst('2026-10-05T15:00:00');
  const outside = kst('2026-10-05T18:00:00');
  assert.equal(windowStatusAt(inside, undefined), 'NONE');
  assert.equal(windowStatusAt(inside, null), 'NONE');
  assert.equal(windowStatusAt(inside, []), 'NONE');
  assert.equal(windowStatusAt(inside, weekdayAfternoon), 'IN_WINDOW');
  assert.equal(windowStatusAt(outside, weekdayAfternoon), 'OUTSIDE_WINDOW');
  assert.equal(benefitStateFor('IN_WINDOW'), 'ELIGIBLE');
  assert.equal(benefitStateFor('OUTSIDE_WINDOW'), 'OUTSIDE_WINDOW');
  assert.equal(benefitStateFor('NONE'), 'NONE');
});

test('benefitJudgedAt uses the creation time only while the claim is inside the code validity, and the claim time after', () => {
  const ttlMs = 15 * 60 * 1000;
  const createdAt = kst('2026-10-05T16:50:00');
  assert.equal(benefitJudgedAt(createdAt, kst('2026-10-05T16:50:00'), ttlMs), createdAt);
  assert.equal(benefitJudgedAt(createdAt, kst('2026-10-05T17:04:59.999'), ttlMs), createdAt);
  // 만든 시각 + ttl 정각부터는 확정 시각이 기준이다(끝 제외).
  const exactly = kst('2026-10-05T17:05:00');
  assert.equal(benefitJudgedAt(createdAt, exactly, ttlMs), exactly);
  const days = kst('2026-10-10T15:00:00');
  assert.equal(benefitJudgedAt(createdAt, days, ttlMs), days);
  // 시계가 조금 어긋나 확정 시각이 만든 시각보다 앞서도 만든 시각을 쓴다.
  assert.equal(benefitJudgedAt(createdAt, kst('2026-10-05T16:49:59'), ttlMs), createdAt);
  assert.equal(windowStatusAt(benefitJudgedAt(createdAt, days, ttlMs), weekdayAfternoon), 'OUTSIDE_WINDOW');
  assert.equal(windowStatusAt(benefitJudgedAt(createdAt, kst('2026-10-05T17:04:59.999'), ttlMs), weekdayAfternoon), 'IN_WINDOW');
});

test('normalizeTimeWindows accepts one to three windows and sorts the days', () => {
  assert.deepEqual(normalizeTimeWindows([{ days: [5, 1, 3], start: '14:00', end: '17:00' }]),
    [{ days: [1, 3, 5], start: '14:00', end: '17:00' }]);
  const three = [
    { days: [1], start: '00:00', end: '01:00' }, { days: [2], start: '10:00', end: '11:00' },
    { days: [3], start: '22:00', end: '24:00' },
  ];
  assert.deepEqual(normalizeTimeWindows(three), three);
  assert.deepEqual(normalizeTimeWindows([{ days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '24:00' }]),
    [{ days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '24:00' }]);
});

test('normalizeTimeWindows rejects every malformed shape instead of keeping part of it', () => {
  const ok = { days: [1], start: '14:00', end: '17:00' };
  const bad: unknown[] = [
    undefined, null, 'text', 7, {}, [], [ok, ok, ok, ok], [null], ['x'], [[]], [{}],
    [{ days: [1], start: '14:00' }], [{ days: [1], end: '17:00' }], [{ start: '14:00', end: '17:00' }],
    [{ ...ok, extra: true }], [{ ...ok, days: [] }], [{ ...ok, days: [1, 2, 3, 4, 5, 6, 7, 1] }],
    [{ ...ok, days: [0] }], [{ ...ok, days: [8] }], [{ ...ok, days: [1.5] }], [{ ...ok, days: ['1'] }],
    [{ ...ok, days: [1, 1] }], [{ ...ok, days: 1 }], [{ ...ok, days: null }],
    [{ ...ok, start: '9:00' }], [{ ...ok, start: '24:00', end: '24:00' }], [{ ...ok, start: '12:60' }],
    [{ ...ok, start: 1400 }], [{ ...ok, end: '24:01' }], [{ ...ok, end: '17:0' }], [{ ...ok, end: null }],
    // 끝이 시작보다 이르거나 같으면 자정을 넘기는 시간대이거나 빈 시간대다.
    [{ days: [1], start: '22:00', end: '02:00' }], [{ days: [1], start: '14:00', end: '14:00' }],
    [{ days: [1], start: '17:00', end: '14:00' }],
    [ok, { ...ok, days: [9] }],
  ];
  for (const raw of bad) assert.equal(normalizeTimeWindows(raw), undefined, JSON.stringify(raw));
});

test('normalizeCampaignPurpose accepts each purpose with only its own fields and fills the revisit defaults', () => {
  assert.deepEqual(normalizeCampaignPurpose({ purpose: 'NEW_CUSTOMERS' }), { ok: true, value: {
    purpose: 'NEW_CUSTOMERS', featuredMenuName: null, revisitMinDays: 1, revisitWindowDays: 14, nextStepText: null, timeWindows: null,
  } });
  assert.deepEqual(normalizeCampaignPurpose({ purpose: 'NEW_CUSTOMERS', featuredMenuName: ' 김밥 ' }), { ok: true, value: {
    purpose: 'NEW_CUSTOMERS', featuredMenuName: '김밥', revisitMinDays: 1, revisitWindowDays: 14, nextStepText: null, timeWindows: null,
  } });
  assert.deepEqual(normalizeCampaignPurpose({ purpose: 'REVISIT' }), { ok: true, value: {
    purpose: 'REVISIT', featuredMenuName: null, revisitMinDays: 1, revisitWindowDays: 14, nextStepText: null, timeWindows: null,
  } });
  assert.deepEqual(normalizeCampaignPurpose({ purpose: 'REVISIT', revisitMinDays: 3, revisitWindowDays: 21,
    nextStepText: '다음에 오시면 코인이 완성돼요' }), { ok: true, value: {
    purpose: 'REVISIT', featuredMenuName: null, revisitMinDays: 3, revisitWindowDays: 21,
    nextStepText: '다음에 오시면 코인이 완성돼요', timeWindows: null,
  } });
  assert.deepEqual(normalizeCampaignPurpose({ purpose: 'OFF_PEAK', featuredMenuName: '라떼',
    timeWindows: [{ days: [5, 1], start: '14:00', end: '17:00' }] }), { ok: true, value: {
    purpose: 'OFF_PEAK', featuredMenuName: '라떼', revisitMinDays: 1, revisitWindowDays: 14, nextStepText: null,
    timeWindows: [{ days: [1, 5], start: '14:00', end: '17:00' }],
  } });
});

test('normalizeCampaignPurpose refuses unknown purposes and fields that belong to another purpose', () => {
  const problem = (raw: unknown, menu?: string[]) => {
    const result = normalizeCampaignPurpose(raw, menu);
    return result.ok ? 'ok' : result.problem;
  };
  for (const raw of [undefined, null, 'OFF_PEAK', [], 5, {}, { purpose: 'off_peak' }, { purpose: 'ALL' }, { purpose: null }]) {
    assert.equal(problem(raw), 'PURPOSE_UNKNOWN', JSON.stringify(raw));
  }
  const windows = [{ days: [1], start: '14:00', end: '17:00' }];
  assert.equal(problem({ purpose: 'NEW_CUSTOMERS', timeWindows: windows }), 'FIELD_NOT_ALLOWED');
  assert.equal(problem({ purpose: 'NEW_CUSTOMERS', revisitMinDays: 2 }), 'FIELD_NOT_ALLOWED');
  assert.equal(problem({ purpose: 'NEW_CUSTOMERS', nextStepText: '다음에' }), 'FIELD_NOT_ALLOWED');
  assert.equal(problem({ purpose: 'REVISIT', timeWindows: windows }), 'FIELD_NOT_ALLOWED');
  assert.equal(problem({ purpose: 'OFF_PEAK', timeWindows: windows, revisitWindowDays: 14 }), 'FIELD_NOT_ALLOWED');
  assert.equal(problem({ purpose: 'OFF_PEAK', timeWindows: windows, nextStepText: '다음에' }), 'FIELD_NOT_ALLOWED');
  assert.equal(problem({ purpose: 'OFF_PEAK', timeWindows: windows, introText: '직접 쓴 소개' }), 'FIELD_NOT_ALLOWED');
  assert.equal(problem(JSON.parse('{"purpose":"NEW_CUSTOMERS","__proto__":{"x":1}}')), 'FIELD_NOT_ALLOWED');
  // 양식이 쓰지 않는 칸을 null로 보내 오는 것은 받는다.
  assert.equal(problem({ purpose: 'NEW_CUSTOMERS', featuredMenuName: null, timeWindows: null, revisitMinDays: null,
    revisitWindowDays: undefined, nextStepText: null }), 'ok');
});

test('normalizeCampaignPurpose requires and validates the time windows for OFF_PEAK only', () => {
  const problem = (raw: unknown) => {
    const result = normalizeCampaignPurpose(raw);
    return result.ok ? 'ok' : result.problem;
  };
  assert.equal(problem({ purpose: 'OFF_PEAK' }), 'WINDOWS_REQUIRED');
  assert.equal(problem({ purpose: 'OFF_PEAK', timeWindows: null }), 'WINDOWS_REQUIRED');
  assert.equal(problem({ purpose: 'OFF_PEAK', timeWindows: [] }), 'WINDOWS_INVALID');
  assert.equal(problem({ purpose: 'OFF_PEAK', timeWindows: 'weekday 14:00-17:00' }), 'WINDOWS_INVALID');
  assert.equal(problem({ purpose: 'OFF_PEAK', timeWindows: [{ days: [1], start: '17:00', end: '14:00' }] }), 'WINDOWS_INVALID');
  assert.equal(problem({ purpose: 'OFF_PEAK', timeWindows: [{ days: [1], start: '14:00', end: '17:00' }] }), 'ok');
});

test('normalizeCampaignPurpose bounds the revisit days and keeps the minimum below the window', () => {
  const problem = (extra: Record<string, unknown>) => {
    const result = normalizeCampaignPurpose({ purpose: 'REVISIT', ...extra });
    return result.ok ? 'ok' : result.problem;
  };
  assert.equal(problem({ revisitMinDays: 1, revisitWindowDays: 2 }), 'ok');
  assert.equal(problem({ revisitMinDays: 30, revisitWindowDays: 60 }), 'ok');
  assert.equal(problem({ revisitMinDays: 0 }), 'REVISIT_DAYS_INVALID');
  assert.equal(problem({ revisitMinDays: 31, revisitWindowDays: 60 }), 'REVISIT_DAYS_INVALID');
  assert.equal(problem({ revisitWindowDays: 1 }), 'REVISIT_DAYS_INVALID');
  assert.equal(problem({ revisitWindowDays: 61 }), 'REVISIT_DAYS_INVALID');
  assert.equal(problem({ revisitMinDays: 2.5 }), 'REVISIT_DAYS_INVALID');
  assert.equal(problem({ revisitMinDays: '3' }), 'REVISIT_DAYS_INVALID');
  // 최소 일수는 기간보다 작아야 한다. 기본 기간(14일)과도 비교한다.
  assert.equal(problem({ revisitMinDays: 14 }), 'REVISIT_DAYS_INVALID');
  assert.equal(problem({ revisitMinDays: 5, revisitWindowDays: 5 }), 'REVISIT_DAYS_INVALID');
  assert.equal(problem({ revisitMinDays: 13 }), 'ok');
});

test('normalizeCampaignPurpose checks the customer-visible text and the featured menu against the menu list', () => {
  const featured = (featuredMenuName: unknown, menu?: string[]) => {
    const result = normalizeCampaignPurpose({ purpose: 'NEW_CUSTOMERS', featuredMenuName }, menu);
    return result.ok ? result.value.featuredMenuName : result.problem;
  };
  assert.equal(featured('가'.repeat(40)), '가'.repeat(40));
  assert.equal(featured('가'.repeat(41)), 'TEXT_INVALID');
  assert.equal(featured('   '), 'TEXT_INVALID');
  assert.equal(featured(''), 'TEXT_INVALID');
  assert.equal(featured(7), 'TEXT_INVALID');
  assert.equal(featured('김밥\n추가'), 'TEXT_INVALID');
  assert.equal(featured('김밥​'), 'TEXT_INVALID');
  assert.equal(featured('김밥‮'), 'TEXT_INVALID');
  assert.equal(featured('문의 010-1234-5678'), 'TEXT_INVALID');
  assert.equal(featured('shop@example.com'), 'TEXT_INVALID');
  assert.equal(featured('https://example.com'), 'TEXT_INVALID');
  // 메뉴 정보가 있으면 그 이름 중 하나여야 하고, 없으면 이름만 검사한다.
  assert.equal(featured('김밥', ['김밥', '라면']), '김밥');
  assert.equal(featured(' 라면 ', ['김밥', ' 라면']), '라면');
  assert.equal(featured('우동', ['김밥', '라면']), 'MENU_UNKNOWN');
  assert.equal(featured('우동', []), '우동');
  const nextStep = (nextStepText: unknown) => {
    const result = normalizeCampaignPurpose({ purpose: 'REVISIT', nextStepText });
    return result.ok ? result.value.nextStepText : result.problem;
  };
  assert.equal(nextStep('가'.repeat(80)), '가'.repeat(80));
  assert.equal(nextStep('가'.repeat(81)), 'TEXT_INVALID');
  assert.equal(nextStep('연락은 010 1234 5678'), 'TEXT_INVALID');
  assert.equal(nextStep(' '), 'TEXT_INVALID');
});
