import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { campaignPurposeBlock, dayList, timeWindowLabel } from './campaign-purpose';

test('dayList shortens weekdays, weekends and every day, and otherwise lists the Korean day names in order', () => {
  assert.equal(dayList([5, 4, 3, 2, 1]), '평일');
  assert.equal(dayList([7, 6]), '주말');
  assert.equal(dayList([1, 2, 3, 4, 5, 6, 7]), '매일');
  assert.equal(dayList([5, 1, 3]), '월·수·금');
  assert.equal(dayList([7]), '일');
  assert.equal(dayList([1, 1, 2]), '월·화');
});

test('timeWindowLabel formats one window and rejects a malformed one', () => {
  assert.equal(timeWindowLabel({ days: [1, 2, 3, 4, 5], start: '14:00', end: '17:00' }), '평일 14:00–17:00');
  assert.equal(timeWindowLabel({ days: [6, 7], start: '21:00', end: '24:00' }), '주말 21:00–24:00');
  for (const bad of [null, 'x', [], {}, { days: [], start: '14:00', end: '17:00' }, { days: [0], start: '14:00', end: '17:00' },
    { days: [1], start: '9:00', end: '17:00' }, { days: [1], start: '14:00' }, { days: ['1'], start: '14:00', end: '17:00' }]) {
    assert.equal(timeWindowLabel(bad), undefined, JSON.stringify(bad));
  }
});

test('an off-peak campaign shows its windows and says a visit outside them still counts, without naming a benefit', () => {
  const block = campaignPurposeBlock({
    kind: 'OFF_PEAK', featuredMenuName: '라떼',
    timeWindows: [{ days: [1, 2, 3, 4, 5], start: '14:00', end: '17:00' }, { days: [6], start: '10:00', end: '12:00' }],
  });
  assert.equal(block?.headline, '이번 캠페인: 한산한 시간대 방문 · 평일 14:00–17:00, 토 10:00–12:00');
  assert.deepEqual(block?.lines, ['점주가 정한 시간대 캠페인이에요. 시간은 한국 시간 기준이고, 시간대 밖에 방문해도 방문은 인정돼요.', '대표 메뉴 · 라떼']);
  assert.doesNotMatch(JSON.stringify(block), /혜택/);
});

test('a revisit campaign describes the day range and the owner next-step text, without naming a benefit', () => {
  const block = campaignPurposeBlock({ kind: 'REVISIT', revisitMinDays: 3, revisitWindowDays: 14, nextStepText: '다음에 오시면 코인이 완성돼요' });
  assert.deepEqual(block, {
    headline: '이번 캠페인: 다시 방문하기',
    lines: ['점주가 정한 재방문 기간은 처음 방문한 날로부터 3일 뒤부터 14일 안이에요.', '다음에 오시면 코인이 완성돼요'],
  });
  assert.doesNotMatch(JSON.stringify(block), /혜택/);
  // 일수가 이상하면 그 줄만 빠진다.
  assert.deepEqual(campaignPurposeBlock({ kind: 'REVISIT', revisitMinDays: 14, revisitWindowDays: 3 }), { headline: '이번 캠페인: 다시 방문하기', lines: [] });
});

test('a first-visit campaign shows the featured menu and never promises a benefit or calls anyone a new customer', () => {
  const block = campaignPurposeBlock({ kind: 'NEW_CUSTOMERS', featuredMenuName: '김밥' });
  assert.deepEqual(block, { headline: '이번 캠페인: 처음 방문하는 분께 가게 소개', lines: ['대표 메뉴 · 김밥'] });
  assert.deepEqual(campaignPurposeBlock({ kind: 'NEW_CUSTOMERS' }), { headline: '이번 캠페인: 처음 방문하는 분께 가게 소개', lines: [] });
  assert.doesNotMatch(JSON.stringify(block), /신규 고객|첫 손님/);
});

test('missing, unknown or malformed purposes show nothing', () => {
  for (const value of [undefined, null, 'OFF_PEAK', [], {}, { kind: 'SOMETHING_NEW' }, { kind: 'OFF_PEAK' },
    { kind: 'OFF_PEAK', timeWindows: [] }, { kind: 'OFF_PEAK', timeWindows: [{ days: [1], start: '14:00', end: 'late' }] },
    { kind: 'OFF_PEAK', timeWindows: [{ days: [1], start: '14:00', end: '17:00' }, 'x'] }]) {
    assert.equal(campaignPurposeBlock(value), undefined, JSON.stringify(value));
  }
});

test('the merchant detail screen renders the purpose block from the discovery campaign', () => {
  const source = readFileSync(new URL('../screens/merchant-detail/index.tsx', import.meta.url), 'utf8');
  assert.match(source, /from '@\/merchant\/campaign-purpose'/);
  assert.match(source, /campaignPurposeBlock\(campaign\.purpose\)/);
});
