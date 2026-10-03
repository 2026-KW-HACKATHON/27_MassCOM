import assert from 'node:assert/strict';
import { test } from 'node:test';

import { merchantCardHint, merchantCardLabel } from './merchant-card-label';

const merchant = {
  name: '가상 점포 A', story: '월계동 골목의 오래된 국숫집이에요.', roadAddress: '서울 노원구 월계로 1',
  demo: true,
  campaign: { title: '가을 도장 캠페인', enrollmentStatus: 'OPEN' as const },
};

test('the label keeps the story and campaign the card shows, and the tap goes in the hint', () => {
  assert.equal(
    merchantCardLabel(merchant),
    '가상 점포 A, 참여 가능, 데모 데이터, 서울 노원구 월계로 1, 월계동 골목의 오래된 국숫집이에요., 가을 도장 캠페인',
  );
  assert.equal(merchantCardHint(), '자세히 보기');
});

test('a full campaign is not called closed (visits still earn, D-023), a real merchant is not called demo, and an empty story is skipped', () => {
  const label = merchantCardLabel({ ...merchant, demo: false, story: '', campaign: { ...merchant.campaign, enrollmentStatus: 'FULL' } });
  assert.equal(label, '가상 점포 A, 참여 가능, 서울 노원구 월계로 1, 가을 도장 캠페인');
  assert.doesNotMatch(label, /마감/);
});


test('공개 대표 태그 집계도 카드의 접근성 이름에 포함한다', () => {
  assert.match(merchantCardLabel({ ...merchant, visitorTags: [{ code: 'SOLO', count: 18 }] }), /혼밥하기 좋아요 · 18명/);
});
