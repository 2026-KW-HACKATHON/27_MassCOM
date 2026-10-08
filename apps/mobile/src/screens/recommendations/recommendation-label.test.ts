import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reasonLabel, recommendationHint, recommendationLabel } from './recommendation-label';

const item = {
  merchantId: 'showcase-b', merchantName: '가상 점포 B', roadAddress: '서울 노원구 월계로 2', demo: true, progressVisitCount: 2,
  reasonCode: 'NEXT_REWARD' as const, reasonText: '3회 도장까지 한 번 남았어요.',
  nextGoal: { targetVisitCount: 3 as const, displayName: '세 번째 방문 보상', remainingVisits: 1 },
};

test('the label carries the reason and progress the card shows, and the tap goes in the hint', () => {
  assert.equal(
    recommendationLabel(item),
    '가상 점포 B, 다음 보상 가까움, 데모 데이터, 3회 도장까지 한 번 남았어요., 서울 노원구 월계로 2, 현재 2회, 다음 3회 세 번째 방문 보상',
  );
  assert.equal(recommendationHint(), '가게 상세 보기');
});

test('a finished goal set is read as done, and reason labels cover every code', () => {
  const label = recommendationLabel({ ...item, demo: false, nextGoal: undefined, reasonCode: 'COLLECTION_COMPLETE' });
  assert.ok(label.endsWith('현재 2회, 고정 보상 완료'));
  assert.equal(reasonLabel('NEW_PLACE'), '새로운 가게');
  assert.equal(reasonLabel('COLLECTION_COMPLETE'), '도감 완성');
});
