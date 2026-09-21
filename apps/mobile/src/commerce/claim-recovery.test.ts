import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CommerceApiError, type ClaimPreview, type RedeemedClaim } from './commerce-api';
import { claimFailureAction, claimPreviewTitle, claimSuccessCopy } from './claim-recovery';

const preview: ClaimPreview = {
  claimSlotId: 'claim-1',
  merchantId: 'merchant-internal-id',
  merchantName: '월계 밥상',
  campaignId: 'campaign-internal-id',
  campaignTitle: '월계 한 바퀴',
  expiresAt: '2026-09-22T03:00:00.000Z',
  status: 'AVAILABLE',
};
const redeemed: RedeemedClaim = {
  claimSlotId: 'claim-1',
  merchantId: 'merchant-internal-id',
  merchantName: '월계 밥상',
  campaignTitle: '월계 한 바퀴',
  status: 'CLAIMED',
  replayed: false,
  visit: {
    visitEventId: 'visit-1',
    campaignId: 'campaign-internal-id',
    businessDate: '2026-09-22',
    verificationLevel: 'MERCHANT_CONFIRMED',
    progressCounted: true,
    progressVisitCount: 1,
  },
  grantedRewards: [],
};

test('preview title uses merchant and campaign names instead of internal IDs', () => {
  assert.equal(claimPreviewTitle(preview), '월계 밥상 · 월계 한 바퀴');
  assert.doesNotMatch(claimPreviewTitle(preview), /merchant-internal-id|점포 ID/);
});

test('replayed success explains that an already completed visit was recovered', () => {
  assert.match(claimSuccessCopy({ ...redeemed, replayed: true }).body, /이미 완료된 방문 결과를 복구/);
});

test('unknown redeem failure keeps the preview and retries the same result', () => {
  assert.deepEqual(claimFailureAction(new Error('network'), preview), {
    kind: 'retry',
    label: '수령 결과 다시 확인',
    message: '응답을 확인하지 못했습니다. 같은 코드를 다시 보내 기존 결과를 확인합니다.',
    keepPreview: true,
  });
});

test('unavailable token after an ambiguous attempt points to collection recovery', () => {
  assert.deepEqual(
    claimFailureAction(new CommerceApiError(409, 'CLAIM_TOKEN_UNAVAILABLE'), preview),
    {
      kind: 'collection-check',
      label: '내 도감에서 결과 확인',
      message: '코드가 이미 처리됐을 수 있습니다. 도감을 새로 열어 방문 결과를 확인해 주세요.',
      keepPreview: true,
    },
  );
});

test('success copy includes both user-facing names and next destinations', () => {
  const copy = claimSuccessCopy(redeemed);
  assert.match(copy.title, /월계 밥상/);
  assert.match(copy.body, /월계 한 바퀴/);
  assert.deepEqual(copy.destinations, [
    { href: '/collection', label: '내 도감 확인' },
    { href: '/recommendations', label: '다음 가게 추천' },
  ]);
});
