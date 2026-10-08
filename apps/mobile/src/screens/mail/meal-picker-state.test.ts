import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isMealDate, mealDateLabel, mealDateOptions, mealResponseTimeError, mealScheduleError, mealTimeOptions, mealToday } from './meal-picker-state';

test('date wheel retains the internal year across KST midnight and New Year without showing year numbers', () => {
  assert.equal(mealToday(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
  const dates = mealDateOptions('2026-12-31', 3);
  assert.deepEqual(dates.map(item => item.value), ['2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(dates[1]!.label, '내년 1월 1일 (금)');
  assert.equal(mealDateLabel('2028-01-01', '2026-12-31'), '2년 후 1월 1일 (토)');
  assert.ok(dates.every(item => !/202[67]/.test(item.label)));
});

test('date wheel has only valid calendar days, handles leap years, and can extend without a new API cap', () => {
  assert.deepEqual(mealDateOptions('2027-02-28', 2).map(item => item.value), ['2027-02-28', '2027-03-01']);
  assert.deepEqual(mealDateOptions('2028-02-28', 3).map(item => item.value), ['2028-02-28', '2028-02-29', '2028-03-01']);
  for (const date of ['2027-02-29', '2100-02-29', '2026-04-31', '', '2026-13-01']) assert.equal(isMealDate(date), false);
  assert.equal(mealDateOptions('2026-01-01', 733).at(-1)!.value, '2028-01-03');
  assert.equal(mealDateOptions('2026-04-31').length, 0);
});

test('time wheel keeps every minute and bounds receiver choices inclusively', () => {
  assert.equal(mealTimeOptions().length, 1440);
  assert.deepEqual(mealTimeOptions('12:59', '13:01'), ['12:59', '13:00', '13:01']);
  assert.deepEqual(mealTimeOptions('23:59', '23:59'), ['23:59']);
  assert.deepEqual(mealTimeOptions('13:00', '12:00'), []);
  assert.deepEqual(mealTimeOptions('24:00', '24:01'), []);
});

test('draft validation rejects empty, impossible, past, equal and reversed selections', () => {
  const now = new Date('2026-10-09T03:00:01Z');
  const check = (date: string, time: string) => mealScheduleError(date, { kind: 'CONFIRMED', time }, now);
  for (const [date, time] of [['', ''], ['2026-10-08', '23:59'], ['2026-10-09', '12:00'], ['2026-10-09', '24:00'], ['2027-02-29', '13:00']]) {
    assert.ok(check(date!, time!));
  }
  assert.equal(check('2026-10-09', '12:01'), undefined);
  assert.equal(check('2028-02-29', '12:00'), undefined);
  for (const endTime of ['12:00', '11:59', '']) {
    assert.ok(mealScheduleError('2026-10-10', { kind: 'RANGE', startTime: '12:00', endTime }, now));
  }
  assert.equal(mealScheduleError('2026-10-10', { kind: 'RANGE', startTime: '12:00', endTime: '12:01' }, now), undefined);
});

test('accepting a range requires an explicit, future time inside its boundaries', () => {
  const now = new Date('2026-10-09T03:00:00Z');
  const check = (time: string) => mealResponseTimeError('2026-10-09', time, '11:00', '13:00', now);
  for (const time of ['', '10:59', '11:30', '13:01']) assert.ok(check(time));
  assert.equal(check('13:00'), undefined);
});

test('both meal flows expose the shared wheel picker instead of format or recommendation inputs', () => {
  for (const file of ['compose.tsx', 'detail.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /<MealTimePicker/);
    assert.doesNotMatch(source, /placeholder="(?:YYYY-MM-DD|.*HH:mm|예: 12:40)"/);
  }
  const picker = readFileSync(new URL('meal-date-time-picker.tsx', import.meta.url), 'utf8');
  assert.match(picker, /snapToInterval=\{rowHeight\}/);
  assert.match(picker, /accessibilityRole="adjustable"/);
  assert.match(picker, /accessibilityValue=/);
  assert.match(picker, /onAccessibilityAction=/);
  assert.match(picker, /label="선택 완료"/);
  assert.doesNotMatch(picker, /TextInput|점심|저녁|추천/);
});
