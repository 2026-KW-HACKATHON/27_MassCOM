import assert from 'node:assert/strict';
import { test } from 'node:test';

import { acceptInspection, redeemTarget, selectedMerchantMismatch } from './claim-inspect';
import type { ClaimPreview } from './commerce-api';
import { createIdentityRequestGate } from './customer-identity';

const available: ClaimPreview = {
  claimSlotId: 'claim-1',
  merchantId: 'merchant-1',
  merchantName: '월계 밥상',
  campaignId: 'campaign-1',
  campaignTitle: '월계 한 바퀴',
  expiresAt: '2026-09-30T03:00:00.000Z',
  status: 'AVAILABLE',
};

test('현재 요청의 확인 결과는 미리보기와 확정 대상으로 반영한다', () => {
  const gate = createIdentityRequestGate();
  const request = gate.start();
  const accepted = acceptInspection(gate.isCurrent(request), 'code-a', available);
  assert.equal(accepted?.preview, available);
  assert.equal(accepted?.pendingRedeemToken, 'code-a');
  assert.match(accepted?.message ?? '', /사용 가능한 1회 코드/);
  assert.equal(acceptInspection(true, 'code-a', { ...available, status: 'EXPIRED' })?.message, '만료된 코드입니다.');
});

test('입력이 B로 바뀐 뒤 A의 늦은 확인 응답은 버리고, 확정은 B만 대상으로 한다', () => {
  const gate = createIdentityRequestGate();
  const requestA = gate.start();
  gate.cancel(); // 입력이 B로 바뀜
  assert.equal(acceptInspection(gate.isCurrent(requestA), 'code-a', available), undefined);
  // A 응답이 버려졌으므로 B로는 아직 확인하지 않았다: 확정 대상이 없다.
  assert.equal(redeemTarget('code-b', undefined, undefined), undefined);

  const requestB = gate.start();
  const acceptedB = acceptInspection(gate.isCurrent(requestB), 'code-b', available);
  assert.equal(acceptedB?.pendingRedeemToken, 'code-b');
  assert.equal(redeemTarget('code-b', acceptedB?.pendingRedeemToken, acceptedB?.preview), 'code-b');
});

test('확정은 현재 입력과 다른 코드로 확인한 미리보기를 절대 사용하지 않는다', () => {
  assert.equal(redeemTarget('code-b', 'code-a', available), undefined);
  assert.equal(redeemTarget(' code-a\n', 'code-a', available), 'code-a');
});

test('확정은 수령 가능한 미리보기와 확인한 코드가 모두 있을 때만 대상이 있다', () => {
  assert.equal(redeemTarget('code-a', 'code-a', undefined), undefined);
  assert.equal(redeemTarget('code-a', 'code-a', { ...available, status: 'EXPIRED' }), undefined);
  assert.equal(redeemTarget('code-a', undefined, available), undefined);
});

test('선택한 가게와 직원 코드의 실제 가게가 다르면 확정하지 않는다', () => {
  assert.equal(selectedMerchantMismatch('merchant-2', available), true);
  assert.equal(selectedMerchantMismatch('merchant-1', available), false);
  assert.equal(selectedMerchantMismatch(undefined, available), false);
});
