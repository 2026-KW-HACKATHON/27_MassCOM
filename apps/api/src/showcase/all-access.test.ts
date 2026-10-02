import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SHOWCASE_BONUS_MILEAGE,
  SHOWCASE_MAX_BACKDATE_DAYS,
  SHOWCASE_REROLL_RATE_LIMIT,
  SHOWCASE_SEED_CAMPAIGN_BACKDATE_DAYS,
  SHOWCASE_TEST_VISIT_LIMIT_PER_HOUR,
  earliestShowcaseVisitDate,
  pickShowcaseVisitDate,
} from './all-access.js';

// 한국 시각을 읽기 쉽게 쓰려는 도우미: '2026-10-03T09:30:00+09:00' 같은 ISO 문자열을 ms로 바꾼다.
const kst = (iso: string): number => Date.parse(iso);
const dayMs = 24 * 60 * 60 * 1000;

function kstDateOf(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test('showcase all-access constants are the owner-visible numbers', () => {
  assert.equal(SHOWCASE_BONUS_MILEAGE, 100_000);
  assert.equal(SHOWCASE_REROLL_RATE_LIMIT, 600);
  assert.equal(SHOWCASE_TEST_VISIT_LIMIT_PER_HOUR, 60);
  assert.equal(SHOWCASE_MAX_BACKDATE_DAYS, 29);
  assert.equal(SHOWCASE_SEED_CAMPAIGN_BACKDATE_DAYS, 30);
});

test('pickShowcaseVisitDate: with nothing used it picks today and occurredAt is exactly now', () => {
  const nowMs = kst('2026-10-03T09:30:15.250+09:00');
  const picked = pickShowcaseVisitDate({
    nowMs, usedKstDates: new Set(), earliestKstDate: '2026-09-03', maxBackDays: 29,
  });
  assert.deepEqual(picked && { kstDate: picked.kstDate, occurredAtMs: picked.occurredAt.getTime() },
    { kstDate: '2026-10-03', occurredAtMs: nowMs });
});

test('pickShowcaseVisitDate: today used -> yesterday at the same KST time of day', () => {
  const nowMs = kst('2026-10-03T09:30:15.250+09:00');
  const picked = pickShowcaseVisitDate({
    nowMs, usedKstDates: new Set(['2026-10-03']), earliestKstDate: '2026-09-03', maxBackDays: 29,
  });
  assert.equal(picked?.kstDate, '2026-10-02');
  assert.equal(picked?.occurredAt.getTime(), kst('2026-10-02T09:30:15.250+09:00'));
});

test('pickShowcaseVisitDate: five consecutive picks walk back one distinct day each', () => {
  const nowMs = kst('2026-10-03T14:00:00+09:00');
  const used = new Set<string>();
  const picked: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const result = pickShowcaseVisitDate({ nowMs, usedKstDates: used, earliestKstDate: '2026-09-03', maxBackDays: 29 });
    assert.ok(result);
    picked.push(result.kstDate);
    used.add(result.kstDate);
  }
  assert.deepEqual(picked, ['2026-10-03', '2026-10-02', '2026-10-01', '2026-09-30', '2026-09-29']);
});

test('pickShowcaseVisitDate: it fills the most recent gap, not the oldest', () => {
  const nowMs = kst('2026-10-03T14:00:00+09:00');
  const picked = pickShowcaseVisitDate({
    nowMs, usedKstDates: new Set(['2026-10-03', '2026-10-01']), earliestKstDate: '2026-09-03', maxBackDays: 29,
  });
  assert.equal(picked?.kstDate, '2026-10-02');
});

test('pickShowcaseVisitDate: dates used by other months or years are ignored', () => {
  const nowMs = kst('2026-10-03T14:00:00+09:00');
  const picked = pickShowcaseVisitDate({
    nowMs, usedKstDates: new Set(['2025-10-03', '2026-09-03']), earliestKstDate: '2026-09-03', maxBackDays: 29,
  });
  assert.equal(picked?.kstDate, '2026-10-03');
});

test('pickShowcaseVisitDate: all 30 days (today plus 29 back) used -> null', () => {
  const nowMs = kst('2026-10-03T14:00:00+09:00');
  const used = new Set<string>();
  for (let back = 0; back <= 29; back += 1) used.add(kstDateOf(nowMs - back * dayMs));
  assert.equal(used.size, 30);
  assert.equal(pickShowcaseVisitDate({ nowMs, usedKstDates: used, earliestKstDate: '2026-01-01', maxBackDays: 29 }), null);
  // 하루만 비워도(가장 오래된 날) 그 날이 나온다.
  used.delete(kstDateOf(nowMs - 29 * dayMs));
  assert.equal(
    pickShowcaseVisitDate({ nowMs, usedKstDates: used, earliestKstDate: '2026-01-01', maxBackDays: 29 })?.kstDate,
    kstDateOf(nowMs - 29 * dayMs),
  );
});

test('pickShowcaseVisitDate: maxBackDays caps how far back it goes even when the campaign started earlier', () => {
  const nowMs = kst('2026-10-03T14:00:00+09:00');
  const used = new Set(['2026-10-03', '2026-10-02']);
  assert.equal(
    pickShowcaseVisitDate({ nowMs, usedKstDates: used, earliestKstDate: '2026-01-01', maxBackDays: 1 }),
    null,
  );
  assert.equal(
    pickShowcaseVisitDate({ nowMs, usedKstDates: used, earliestKstDate: '2026-01-01', maxBackDays: 2 })?.kstDate,
    '2026-10-01',
  );
  assert.equal(
    pickShowcaseVisitDate({ nowMs, usedKstDates: new Set(['2026-10-03']), earliestKstDate: '2026-01-01', maxBackDays: 0 }),
    null,
  );
});

test('pickShowcaseVisitDate: a campaign that started today only allows today', () => {
  const nowMs = kst('2026-10-03T14:00:00+09:00');
  assert.equal(
    pickShowcaseVisitDate({ nowMs, usedKstDates: new Set(), earliestKstDate: '2026-10-03', maxBackDays: 29 })?.kstDate,
    '2026-10-03',
  );
  assert.equal(
    pickShowcaseVisitDate({ nowMs, usedKstDates: new Set(['2026-10-03']), earliestKstDate: '2026-10-03', maxBackDays: 29 }),
    null,
  );
});

test('pickShowcaseVisitDate: never goes before earliestKstDate, and a future earliest date yields null', () => {
  const nowMs = kst('2026-10-03T14:00:00+09:00');
  assert.equal(
    pickShowcaseVisitDate({
      nowMs, usedKstDates: new Set(['2026-10-03']), earliestKstDate: '2026-10-02', maxBackDays: 29,
    })?.kstDate,
    '2026-10-02',
  );
  assert.equal(
    pickShowcaseVisitDate({
      nowMs, usedKstDates: new Set(['2026-10-03', '2026-10-02']), earliestKstDate: '2026-10-02', maxBackDays: 29,
    }),
    null,
  );
  assert.equal(
    pickShowcaseVisitDate({ nowMs, usedKstDates: new Set(), earliestKstDate: '2026-10-04', maxBackDays: 29 }),
    null,
  );
});

test('pickShowcaseVisitDate: month and year boundaries step back through real calendar dates', () => {
  const october = kst('2026-10-01T10:00:00+09:00');
  assert.equal(
    pickShowcaseVisitDate({
      nowMs: october, usedKstDates: new Set(['2026-10-01']), earliestKstDate: '2026-09-01', maxBackDays: 29,
    })?.kstDate,
    '2026-09-30',
  );
  assert.equal(
    pickShowcaseVisitDate({
      nowMs: october, usedKstDates: new Set(['2026-10-01', '2026-09-30']), earliestKstDate: '2026-09-01', maxBackDays: 29,
    })?.kstDate,
    '2026-09-29',
  );
  const newYear = kst('2027-01-01T00:30:00+09:00');
  assert.equal(
    pickShowcaseVisitDate({
      nowMs: newYear, usedKstDates: new Set(['2027-01-01']), earliestKstDate: '2026-12-01', maxBackDays: 29,
    })?.kstDate,
    '2026-12-31',
  );
  // 윤일: 2028-03-01 하루 전은 2028-02-29다.
  const leap = kst('2028-03-01T12:00:00+09:00');
  assert.equal(
    pickShowcaseVisitDate({
      nowMs: leap, usedKstDates: new Set(['2028-03-01']), earliestKstDate: '2028-02-01', maxBackDays: 29,
    })?.kstDate,
    '2028-02-29',
  );
});

test('pickShowcaseVisitDate: KST midnight is the day boundary (not UTC midnight)', () => {
  // 2026-10-01 00:00:00.000 KST == 2026-09-30T15:00:00.000Z
  const atMidnight = Date.parse('2026-09-30T15:00:00.000Z');
  const today = pickShowcaseVisitDate({
    nowMs: atMidnight, usedKstDates: new Set(), earliestKstDate: '2026-09-01', maxBackDays: 29,
  });
  assert.equal(today?.kstDate, '2026-10-01');
  assert.equal(today?.occurredAt.getTime(), atMidnight);
  const yesterday = pickShowcaseVisitDate({
    nowMs: atMidnight, usedKstDates: new Set(['2026-10-01']), earliestKstDate: '2026-09-01', maxBackDays: 29,
  });
  assert.equal(yesterday?.kstDate, '2026-09-30');
  assert.equal(yesterday?.occurredAt.getTime(), Date.parse('2026-09-29T15:00:00.000Z'));

  // 1ms 전은 아직 9월 30일이다. 하루 전 같은 시각(9월 29일 23:59:59.999 KST)은 9월 29일이어야 한다.
  const justBefore = Date.parse('2026-09-30T14:59:59.999Z');
  assert.equal(
    pickShowcaseVisitDate({
      nowMs: justBefore, usedKstDates: new Set(), earliestKstDate: '2026-09-01', maxBackDays: 29,
    })?.kstDate,
    '2026-09-30',
  );
  const before = pickShowcaseVisitDate({
    nowMs: justBefore, usedKstDates: new Set(['2026-09-30']), earliestKstDate: '2026-09-01', maxBackDays: 29,
  });
  assert.equal(before?.kstDate, '2026-09-29');
  assert.equal(before?.occurredAt.getTime(), Date.parse('2026-09-29T14:59:59.999Z'));
});

test('pickShowcaseVisitDate: occurredAt never exceeds now and always lands on the date it reports', () => {
  for (const nowMs of [
    kst('2026-10-03T00:00:00.000+09:00'),
    kst('2026-10-03T08:59:59.999+09:00'),
    kst('2026-10-03T23:59:59.999+09:00'),
    Date.parse('2026-10-03T15:00:00.000Z'),
    Date.parse('2026-12-31T14:59:59.999Z'),
  ]) {
    const used = new Set<string>();
    for (let i = 0; i < 30; i += 1) {
      const picked = pickShowcaseVisitDate({ nowMs, usedKstDates: used, earliestKstDate: '2026-01-01', maxBackDays: 29 });
      assert.ok(picked, `pick ${i} for ${nowMs}`);
      assert.ok(picked.occurredAt.getTime() <= nowMs);
      assert.equal(kstDateOf(picked.occurredAt.getTime()), picked.kstDate);
      assert.ok(!used.has(picked.kstDate));
      used.add(picked.kstDate);
    }
  }
});

test('pickShowcaseVisitDate: rejects a malformed earliest date or day count instead of guessing', () => {
  const nowMs = kst('2026-10-03T14:00:00+09:00');
  assert.throws(
    () => pickShowcaseVisitDate({ nowMs, usedKstDates: new Set(), earliestKstDate: '2026-9-3', maxBackDays: 29 }),
    RangeError,
  );
  assert.throws(
    () => pickShowcaseVisitDate({ nowMs, usedKstDates: new Set(), earliestKstDate: '2026-09-03', maxBackDays: -1 }),
    RangeError,
  );
  assert.throws(
    () => pickShowcaseVisitDate({ nowMs, usedKstDates: new Set(), earliestKstDate: '2026-09-03', maxBackDays: 1.5 }),
    RangeError,
  );
  assert.throws(
    () => pickShowcaseVisitDate({ nowMs: Number.NaN, usedKstDates: new Set(), earliestKstDate: '2026-09-03', maxBackDays: 29 }),
    RangeError,
  );
});

test('earliestShowcaseVisitDate: a campaign that started long ago starts on its own KST date', () => {
  const nowMs = kst('2026-10-03T09:00:00+09:00');
  assert.equal(earliestShowcaseVisitDate(kst('2026-09-03T09:00:00+09:00'), nowMs), '2026-09-03');
});

test('earliestShowcaseVisitDate: a backdated visit may not precede the start time on the first day', () => {
  const nowMs = kst('2026-10-03T09:00:00+09:00');
  // 어제 14:00에 시작했는데 지금이 09:00이면 "어제 09:00"은 시작 전이라 오늘부터다.
  assert.equal(earliestShowcaseVisitDate(kst('2026-10-02T14:00:00+09:00'), nowMs), '2026-10-03');
  // 어제 08:00에 시작했으면 "어제 09:00"은 시작 뒤라 어제부터다.
  assert.equal(earliestShowcaseVisitDate(kst('2026-10-02T08:00:00+09:00'), nowMs), '2026-10-02');
  // 정확히 같은 시각이면 시작 전이 아니다.
  assert.equal(earliestShowcaseVisitDate(kst('2026-10-02T09:00:00+09:00'), nowMs), '2026-10-02');
  // 1ms 늦게 시작하면 시작 전이다.
  assert.equal(earliestShowcaseVisitDate(kst('2026-10-02T09:00:00.001+09:00'), nowMs), '2026-10-03');
});

test('earliestShowcaseVisitDate: a campaign that started earlier today only allows today (and rolls over a month end)', () => {
  assert.equal(
    earliestShowcaseVisitDate(kst('2026-10-03T08:00:00+09:00'), kst('2026-10-03T09:00:00+09:00')),
    '2026-10-03',
  );
  assert.equal(
    earliestShowcaseVisitDate(kst('2026-09-30T14:00:00+09:00'), kst('2026-10-01T09:00:00+09:00')),
    '2026-10-01',
  );
  assert.equal(
    earliestShowcaseVisitDate(kst('2026-12-31T14:00:00+09:00'), kst('2027-01-01T09:00:00+09:00')),
    '2027-01-01',
  );
});

test('earliestShowcaseVisitDate: the seeded 30-day-old campaign leaves the whole 29-day window open', () => {
  const nowMs = kst('2026-10-03T09:00:00+09:00');
  const startsAt = nowMs - SHOWCASE_SEED_CAMPAIGN_BACKDATE_DAYS * dayMs;
  const earliest = earliestShowcaseVisitDate(startsAt, nowMs);
  assert.equal(earliest, '2026-09-03');
  const used = new Set<string>();
  for (let i = 0; i < 30; i += 1) {
    const picked = pickShowcaseVisitDate({
      nowMs, usedKstDates: used, earliestKstDate: earliest, maxBackDays: SHOWCASE_MAX_BACKDATE_DAYS,
    });
    assert.ok(picked, `pick ${i}`);
    assert.ok(picked.occurredAt.getTime() >= startsAt);
    used.add(picked.kstDate);
  }
  assert.equal(
    pickShowcaseVisitDate({
      nowMs, usedKstDates: used, earliestKstDate: earliest, maxBackDays: SHOWCASE_MAX_BACKDATE_DAYS,
    }),
    null,
  );
});
