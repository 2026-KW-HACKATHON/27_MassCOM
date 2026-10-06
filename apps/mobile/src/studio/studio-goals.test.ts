import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStudioGoal, studioGoalOptions } from './studio-goals';

const now = Date.parse('2026-10-04T12:00:00Z');
const merchant = {
  id: 'merchant-1', name: '동네 가게',
  campaign: {
    id: 'campaign-current', enrollmentStatus: 'OPEN',
    startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-10T00:00:00Z',
    rewardGoals: [{ targetVisitCount: 1 }, { targetVisitCount: 3 }, { targetVisitCount: 5 }],
  },
} as const;
const collection = {
  visits: [
    { merchantId: 'merchant-1', campaignId: 'campaign-old', progressCounted: true },
    { merchantId: 'merchant-1', campaignId: 'campaign-current', progressCounted: true },
  ],
  collectibles: [
    { merchantId: 'merchant-1', campaignId: 'campaign-current', targetVisitCount: 1 },
    { merchantId: 'merchant-1', campaignId: 'campaign-current', targetVisitCount: 1 },
    { merchantId: 'merchant-1', campaignId: 'campaign-old', targetVisitCount: 3 },
  ],
} as const;

test('visit and series goals count the current campaign and distinct milestones', () => {
  const options = studioGoalOptions([merchant], collection, [], now);
  assert.equal(options.find((item) => item.goal.kind === 'regular')?.progress, '방문 1/3');
  assert.equal(options.find((item) => item.goal.kind === 'series')?.progress, '수집 1/3');
  assert.equal(options.some((item) => item.goal.kind === 'discover'), false);
});

test('closed campaigns offer no merchant goal while play remains selectable', () => {
  const options = studioGoalOptions([merchant], collection, [], Date.parse('2026-10-10T00:00:00Z'));
  assert.equal(options.filter((item) => item.merchantId).length, 0);
  assert.equal(options.filter((item) => item.goal.kind === 'play').length, 4);
});


test('새 규칙 최고는 이전 최고와 비교하지 않고 따로 표시한다', () => {
  const progress = studioGoalOptions([], collection, [{ kind: 'stack', bestScore: 999, plays: 12, version2BestScore: 20, version2Plays: 1 }], now)
    .find((option) => option.goal.gameKind === 'stack')?.progress;
  assert.equal(progress, '새 규칙 최고 20점 · 1회 · 이전 규칙 999점 · 11회');
  assert.match(studioGoalOptions([], collection, [{ kind: 'stack', bestScore: 999, plays: 12 }], now)[0]!.progress, /새 규칙 첫 플레이/);
});


test('누적 횟수에서 새 규칙 횟수를 빼며 새 플레이어에게 이전 기록을 만들지 않는다', () => {
  const progress = (plays: number, version2Plays: number) => studioGoalOptions([], collection,
    [{ kind: 'stack', bestScore: 0, plays, version2BestScore: 20, version2Plays }], now)[0]!.progress;
  assert.equal(progress(1, 1), '새 규칙 최고 20점 · 1회');
  assert.equal(progress(3, 2), '새 규칙 최고 20점 · 2회 · 이전 규칙 0점 · 1회');
  assert.equal(progress(0, 1), '새 규칙 최고 20점 · 1회');
});


test('saved first-visit goal resolves completed after a counted visit and offers the next eligible milestone', () => {
  const saved = { kind: 'discover' as const, merchantId: merchant.id };
  const result = resolveStudioGoal(saved, [merchant], collection, now)!;
  assert.equal(result.status, 'completed');
  assert.equal(result.next?.goal.kind, 'regular');
  assert.equal(result.next?.progress, '방문 1/3');
  assert.equal(saved.kind, 'discover');
});

test('old-campaign or excluded visits do not complete the current first-visit goal', () => {
  const result = resolveStudioGoal({ kind: 'discover', merchantId: merchant.id }, [merchant], {
    visits: [{ merchantId: merchant.id, campaignId: 'campaign-old', progressCounted: true },
      { merchantId: merchant.id, campaignId: merchant.campaign.id, progressCounted: false }], collectibles: [],
  }, now)!;
  assert.equal(result.status, 'active');
  assert.match(result.label, /이번 캠페인 첫 방문/);
});

test('expired or removed merchants remain unavailable and never advertise an active saved visit goal', () => {
  const saved = { kind: 'discover' as const, merchantId: merchant.id };
  assert.equal(resolveStudioGoal(saved, [merchant], collection, Date.parse(merchant.campaign.endsAt))?.status, 'unavailable');
  assert.equal(resolveStudioGoal(saved, [], collection, now)?.status, 'unavailable');
  assert.equal(resolveStudioGoal(null, [merchant], collection, now), undefined);
});

test('regular and collection goals complete only at their existing thresholds', () => {
  assert.equal(resolveStudioGoal({ kind: 'regular', merchantId: merchant.id }, [merchant], collection, now)?.status, 'active');
  const complete = {
    visits: Array.from({ length: 3 }, () => ({ merchantId: merchant.id, campaignId: merchant.campaign.id, progressCounted: true })),
    collectibles: [1, 3, 5].map((targetVisitCount) => ({ merchantId: merchant.id, campaignId: merchant.campaign.id, targetVisitCount: targetVisitCount as 1 | 3 | 5 })),
  };
  assert.equal(resolveStudioGoal({ kind: 'regular', merchantId: merchant.id }, [merchant], complete, now)?.status, 'completed');
  assert.equal(resolveStudioGoal({ kind: 'series', merchantId: merchant.id }, [merchant], complete, now)?.status, 'completed');
  assert.equal(resolveStudioGoal({ kind: 'regular', merchantId: merchant.id }, [merchant], { visits: [], collectibles: [] }, now)?.status, 'unavailable');
});

test('a wanted collectible tracks the exact publication and milestone, never another campaign or edition', () => {
  const goal = { kind: 'collectible', merchantId: merchant.id, campaignId: merchant.campaign.id,
    publicationId: 'publication-a', targetVisitCount: 3 } as const;
  const preview = { campaignId: merchant.campaign.id, publicationId: 'publication-a', goals: [{ visitCount: 3 }] };
  const before = resolveStudioGoal(goal, [merchant], collection, now, preview);
  assert.equal(before?.status, 'active');
  assert.equal(resolveStudioGoal(goal, [{ ...merchant, campaign: { ...merchant.campaign, enrollmentStatus: 'FULL' } }], collection, now, preview)?.status, 'active');
  assert.match(before?.label ?? '', /3회/);
  const exact = { ...collection, collectibles: [...collection.collectibles,
    { merchantId: merchant.id, campaignId: merchant.campaign.id, targetVisitCount: 3 as const, artwork: { publicationId: 'publication-a' } }] };
  assert.equal(resolveStudioGoal(goal, [merchant], exact, now, preview)?.status, 'completed');
  const withdrawnMedia = { ...collection, collectibles: [{ merchantId: merchant.id, campaignId: merchant.campaign.id,
    targetVisitCount: 3 as const, publicationId: 'publication-a' }] };
  assert.equal(resolveStudioGoal(goal, [merchant], withdrawnMedia, Date.parse(merchant.campaign.endsAt))?.status, 'completed');
  assert.equal(resolveStudioGoal(goal, [merchant], collection, now, { ...preview, publicationId: 'publication-b' })?.status, 'unavailable');
  assert.equal(resolveStudioGoal(goal, [merchant], collection, Date.parse(merchant.campaign.endsAt), preview)?.status, 'unavailable');
  assert.equal(resolveStudioGoal(goal, [merchant], collection, now)?.status, 'unavailable');
});
