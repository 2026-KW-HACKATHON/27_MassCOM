import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RecommendationService,
  type RecommendationCandidate,
  type RecommendationSource,
} from './recommendation-service.js';

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
