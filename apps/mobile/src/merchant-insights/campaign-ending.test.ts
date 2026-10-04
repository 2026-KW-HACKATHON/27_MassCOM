import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MerchantOverview } from './api';
import { campaignEndingNotice } from './campaign-ending';

const campaign = {
  title: '수집 캠페인', status: 'ACTIVE', isPublic: true,
  startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-18T15:00:00.000Z', phase: 'LIVE',
} as const satisfies NonNullable<MerchantOverview['campaign']>;

test('현황 생성 시점을 사용하고 한국 날짜 기준 14일째도 안내한다', () => {
  const overview = { generatedAt: '2026-10-04T15:00:00.000Z', campaign };
  assert.equal(campaignEndingNotice(overview, Date.parse('2026-10-01T00:00:00.000Z')),
    '수집 캠페인이 14일 뒤(10월 19일)에 끝나요. 끝나면 손님 앱의 가게 목록에서 내려가요. 계속하려면 운영자에게 연장을 요청해 주세요.');
  assert.equal(campaignEndingNotice({ ...overview, generatedAt: undefined }, Date.parse('2026-10-04T15:00:00.000Z')),
    campaignEndingNotice(overview, 0));
});

test('한국 자정이 지나면 남은 일수가 바뀐다', () => {
  assert.match(campaignEndingNotice({ generatedAt: '2026-10-05T14:59:59.000Z', campaign }, 0)!, /14일 뒤/);
  assert.match(campaignEndingNotice({ generatedAt: '2026-10-05T15:00:00.000Z', campaign }, 0)!, /13일 뒤/);
});

test('종료 시각이 지났거나 종료 단계이면 지난 시제로 안내한다', () => {
  assert.equal(campaignEndingNotice({ generatedAt: campaign.endsAt, campaign }, 0),
    '수집 캠페인이 10월 19일에 끝났어요. 손님 앱의 가게 목록에서 내려갔어요. 계속하려면 운영자에게 연장을 요청해 주세요.');
  assert.match(campaignEndingNotice({ generatedAt: '2026-10-05T00:00:00.000Z', campaign: { ...campaign, phase: 'ENDED' } }, 0)!, /끝났어요/);
  assert.match(campaignEndingNotice({ generatedAt: '2026-10-05T00:00:00.000Z', campaign: { ...campaign, phase: 'EXPIRED' } }, 0)!, /끝났어요/);
});

test('캠페인이 없거나 14일보다 더 남으면 안내하지 않는다', () => {
  const now = Date.parse('2026-10-01T00:00:00.000Z');
  assert.equal(campaignEndingNotice({ campaign: null }, now), null);
  assert.equal(campaignEndingNotice({ campaign: { ...campaign, phase: 'DRAFT' } }, now), null);
  assert.equal(campaignEndingNotice({ campaign }, now), null);
});

test('가까운 종료일은 준비 단계도 안내하고 같은 날이면 0일 뒤로 표시한다', () => {
  const now = Date.parse('2026-10-18T15:00:00.000Z');
  const today = { ...campaign, endsAt: '2026-10-18T15:30:00.000Z' };
  assert.match(campaignEndingNotice({ campaign: { ...today, phase: 'DRAFT' } }, now)!, /0일 뒤\(10월 19일\)/);
  assert.match(campaignEndingNotice({ campaign: { ...today, phase: 'NOT_PUBLIC' } }, now)!, /0일 뒤\(10월 19일\)/);
});
