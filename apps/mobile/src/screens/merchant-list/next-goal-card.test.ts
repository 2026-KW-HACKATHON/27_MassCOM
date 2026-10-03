import assert from 'node:assert/strict';
import test from 'node:test';

import type { Recommendation } from '../../recommendation/recommendation-api';
import { homeNextGoalTitle } from './next-goal-card';

const recommendation: Recommendation = {
  merchantId: 'm1', merchantName: '동네 식당', roadAddress: '서울 노원구', campaignId: 'c1', campaignTitle: '방문 수집',
  enrollmentStatus: 'OPEN', progressVisitCount: 2, demo: false, reasonCode: 'NEXT_REWARD', reasonText: '다음 보상까지 한 번 남았어요',
  nextGoal: { targetVisitCount: 3, displayName: '실버', remainingVisits: 1 },
};

test('재방문 목표는 서버의 보상 이름과 남은 횟수를 보여 준다', () => {
  assert.equal(homeNextGoalTitle(recommendation), '동네 식당 · 실버까지 1번');
  assert.equal(homeNextGoalTitle({ ...recommendation, nextGoal: { targetVisitCount: 5, displayName: '별빛 수집품', remainingVisits: 3 } }), '동네 식당 · 별빛 수집품까지 3번');
});

test('미방문은 첫 도장과 캠페인 보상 이름을 안내한다', () => {
  assert.equal(homeNextGoalTitle({ ...recommendation, progressVisitCount: 0, reasonCode: 'NEW_PLACE', nextGoal: { targetVisitCount: 1, displayName: '브론즈 수집품', remainingVisits: 1 } }), '동네 식당 · 첫 도장 · 브론즈 수집품');
});

test('목표가 없는 완료 추천은 남은 횟수를 만들지 않는다', () => {
  assert.equal(homeNextGoalTitle({ ...recommendation, reasonCode: 'COLLECTION_COMPLETE', nextGoal: undefined }), '동네 식당 · 도감 완성');
});
