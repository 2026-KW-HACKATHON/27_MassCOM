import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RecommendationService,
  type RecommendationCandidate,
  type RecommendationSource,
} from './recommendation-service.js';
import type { CourseHint } from './course-rules.js';

const candidate = (
  id: string,
  progressVisitCount: number,
  enrollmentStatus: 'OPEN' | 'FULL' = 'OPEN',
): RecommendationCandidate => ({
  merchantId: id,
  merchantName: `데모 식당 ${id}`,
  roadAddress: `서울 노원구 데모로 ${id}`,
  campaignId: `campaign-${id}`,
  campaignTitle: `동네 도감 ${id}`,
  enrollmentStatus,
  progressVisitCount,
  rewardGoals: [
    { targetVisitCount: 1, displayName: '첫 방문 잎새' },
    { targetVisitCount: 3, displayName: '단골 새싹' },
    { targetVisitCount: 5, displayName: '월계수 관' },
  ],
  demo: true,
});

function source(items: readonly RecommendationCandidate[]): RecommendationSource {
  return { listCandidates: async () => items };
}

const hint = (done: number, total: number): CourseHint => ({
  courseId: 'course-1', title: '식사와 커피', situation: 'AFTER_MEAL', done, total,
});

test('course next step precedes existing tiers and keeps installed reason codes', async () => {
  const result = await new RecommendationService(source([
    candidate('new', 0), candidate('complete', 5), candidate('near-reward', 2),
    { ...candidate('course', 1), courseHint: hint(2, 3) },
  ])).listRecommendations('customer');
  assert.deepEqual(result.map(item => item.merchantId), ['course', 'new', 'near-reward', 'complete']);
  assert.equal(result[0]?.reasonCode, 'NEXT_REWARD');
  assert.equal(result[0]?.reasonText, "'식사 후 들르기 좋은 곳' 코스 2/3 · 다음은 이 가게예요.");
  assert.deepEqual(result[0]?.course, hint(2, 3));
  assert.equal('courseHint' in result[0]!, false);
  assert.equal('rank' in result[0]!, false);
});

test('numeric course ranks prefer fewer remaining steps then earlier start', async () => {
  const result = await new RecommendationService(source([
    { ...candidate('later', 0), courseHint: hint(2, 3), courseStartsAt: '2026-10-02T00:00:00Z' },
    { ...candidate('more-left', 0), courseHint: hint(1, 3), courseStartsAt: '2026-09-01T00:00:00Z' },
    { ...candidate('earlier', 0), courseHint: hint(2, 3), courseStartsAt: '2026-10-01T00:00:00Z' },
  ])).listRecommendations('customer');
  assert.deepEqual(result.map(item => item.merchantId), ['earlier', 'later', 'more-left']);
});

test('equal course ranks rotate daily and full next stores stay excluded', async () => {
  const candidates = ['a', 'b', 'c'].map(id => ({ ...candidate(id, 0), courseHint: hint(1, 2) }));
  candidates.push({ ...candidate('full', 0, 'FULL'), courseHint: hint(1, 2) });
  const first = new RecommendationService(source(candidates), () => new Date('2026-10-08T01:00:00Z'));
  const next = new RecommendationService(source(candidates), () => new Date('2026-10-09T01:00:00Z'));
  const result = await first.listRecommendations('customer');
  assert.deepEqual(await first.listRecommendations('customer'), result);
  assert.notEqual((await next.listRecommendations('customer'))[0]?.merchantId, result[0]?.merchantId);
  assert.equal(result.some(item => item.merchantId === 'full'), false);
});

test('not-started and complete courses do not replace existing explanations', async () => {
  const result = await new RecommendationService(source([
    { ...candidate('a', 0), courseHint: hint(0, 2) },
    { ...candidate('b', 5), courseHint: hint(2, 2) },
  ])).listRecommendations('customer');
  assert.equal(result[0]?.course, undefined);
  assert.equal(result[1]?.course, undefined);
  assert.equal(result[1]?.reasonCode, 'COLLECTION_COMPLETE');
});

test('prioritizes unvisited open merchants and excludes full campaigns', async () => {
  const service = new RecommendationService(source([
    candidate('visited', 2),
    candidate('new-place', 0),
    candidate('full-place', 0, 'FULL'),
  ]), () => new Date('2026-09-19T03:00:00.000Z'));

  const result = await service.listRecommendations('customer-1');

  assert.deepEqual(result.map((item) => item.merchantId), ['new-place', 'visited']);
  assert.equal(result[0]?.reasonCode, 'NEW_PLACE');
  assert.match(result[0]?.reasonText ?? '', /아직 방문하지 않은/);
});

test('explains the nearest fixed goal for a previously visited merchant', async () => {
  const service = new RecommendationService(
    source([candidate('visited', 2)]),
    () => new Date('2026-09-19T03:00:00.000Z'),
  );

  const [result] = await service.listRecommendations('customer-1');

  assert.equal(result?.reasonCode, 'NEXT_REWARD');
  assert.deepEqual(result?.nextGoal, {
    targetVisitCount: 3,
    displayName: '단골 새싹',
    remainingVisits: 1,
  });
  assert.equal(result?.reasonText, '1번 더 방문하면 단골 새싹을 받을 수 있어요.');
});

test('rotates equal-priority merchants by Korean date but stays deterministic within the day', async () => {
  const items = [candidate('a', 0), candidate('b', 0), candidate('c', 0)];
  const firstDay = new RecommendationService(
    source(items),
    () => new Date('2026-09-19T03:00:00.000Z'),
  );
  const nextDay = new RecommendationService(
    source(items),
    () => new Date('2026-09-20T03:00:00.000Z'),
  );

  const first = await firstDay.listRecommendations('customer-1');
  const repeated = await firstDay.listRecommendations('customer-1');
  const rotated = await nextDay.listRecommendations('customer-1');

  assert.deepEqual(repeated, first);
  assert.notEqual(rotated[0]?.merchantId, first[0]?.merchantId);
  assert.deepEqual(
    new Set(rotated.map((item) => item.merchantId)),
    new Set(first.map((item) => item.merchantId)),
  );
});
