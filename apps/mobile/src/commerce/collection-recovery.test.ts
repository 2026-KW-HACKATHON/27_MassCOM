import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ActiveWalletBindingResponse } from '@/wallet/wallet-api';

import type { CollectionSnapshot } from './commerce-api';
import {
  clearFinalizedNotice,
  initialPollingState,
  MAX_CONSECUTIVE_POLL_FAILURES,
  nextPollingState,
  resolveCollectionLoad,
} from './collection-recovery';

const pendingSnapshot = snapshot('CONFIRMING');
const finalizedSnapshot = snapshot('FINALIZED');
const binding: NonNullable<ActiveWalletBindingResponse['binding']> = {
  bindingId: 'binding-1',
  bindingVersion: 1,
  address: '0x0000000000000000000000000000000000000001',
  chainId: 84532,
  verifiedAt: '2026-09-21T00:00:00.000Z',
};

test('keeps collection visible when wallet binding lookup fails', () => {
  assert.deepEqual(
    resolveCollectionLoad(
      { status: 'fulfilled', value: pendingSnapshot },
      { status: 'rejected', reason: new Error('wallet unavailable') },
    ),
    {
      ok: true,
      collection: pendingSnapshot,
      binding: undefined,
      bindingError: 'WALLET_BINDING_UNAVAILABLE',
    },
  );
});

test('treats collection failure as fatal even when binding succeeds', () => {
  assert.deepEqual(
    resolveCollectionLoad(
      { status: 'rejected', reason: new Error('collection unavailable') },
      { status: 'fulfilled', value: { binding } },
    ),
    { ok: false, error: 'COLLECTION_UNAVAILABLE' },
  );
});

test('stops automatic polling after three failures without deleting the snapshot', () => {
  let state = initialPollingState(pendingSnapshot);
  for (let failure = 1; failure <= MAX_CONSECUTIVE_POLL_FAILURES; failure += 1) {
    state = nextPollingState(state, { type: 'failure', generation: failure });
    assert.equal(state.consecutiveFailures, failure);
    assert.equal(state.snapshot, pendingSnapshot);
    assert.equal(state.mode, failure === 3 ? 'manual-retry' : 'polling');
  }
});

test('manual success resumes polling and replaces the last snapshot', () => {
  const manual = {
    ...initialPollingState(pendingSnapshot),
    mode: 'manual-retry' as const,
    consecutiveFailures: 3,
  };
  const nextSnapshot = snapshot('QUEUED');
  assert.deepEqual(nextPollingState(manual, { type: 'success', snapshot: nextSnapshot, generation: 1 }), {
    mode: 'polling',
    consecutiveFailures: 0,
    snapshot: nextSnapshot,
    generation: 1,
  });
});

test('확정 전환은 조회를 마치고 확정 알림을 남긴다(대기 중인 NFT가 없을 때)', () => {
  assert.deepEqual(
    nextPollingState(initialPollingState(pendingSnapshot), {
      type: 'success',
      snapshot: finalizedSnapshot,
      generation: 1,
    }),
    {
      mode: 'idle',
      consecutiveFailures: 0,
      snapshot: finalizedSnapshot,
      generation: 1,
      message: 'NFT_FINALIZED',
    },
  );
});

test('하나가 확정돼도 다른 NFT가 확인 중이면 알림을 띄우면서 계속 다시 묻는다', () => {
  const state = nextPollingState(initialPollingState(twoNfts('CONFIRMING', 'CONFIRMING'), 1), {
    type: 'success',
    snapshot: twoNfts('FINALIZED', 'CONFIRMING'),
    generation: 2,
  });
  assert.equal(state.mode, 'polling');
  assert.equal(state.message, 'NFT_FINALIZED');
  assert.equal(state.generation, 2);
});

test('A 확정·B 확인 중 뒤에 새 방문과 B 확정 스냅샷이 오면 적용하고 조회를 마친다', () => {
  const afterA = nextPollingState(initialPollingState(twoNfts('CONFIRMING', 'CONFIRMING'), 1), {
    type: 'success',
    snapshot: twoNfts('FINALIZED', 'CONFIRMING'),
    generation: 2,
  });
  // 새 방문(도감 새로고침·화면 복귀)이 가져온 최신 스냅샷.
  const newVisit = { ...twoNfts('FINALIZED', 'FINALIZED'), visits: [visit('visit-2')] };
  const afterB = nextPollingState(afterA, { type: 'success', snapshot: newVisit, generation: 3 });
  assert.equal(afterB.snapshot, newVisit);
  assert.equal(afterB.mode, 'idle');
  assert.equal(afterB.message, 'NFT_FINALIZED');
  assert.equal(afterB.generation, 3);
});

test('확정 뒤 idle 상태에서도 더 새로운 성공 응답은 적용하고, 대기 중이면 조회를 다시 시작한다', () => {
  const idle = nextPollingState(initialPollingState(pendingSnapshot, 1), {
    type: 'success',
    snapshot: finalizedSnapshot,
    generation: 2,
  });
  const next = twoNfts('FINALIZED', 'QUEUED');
  const state = nextPollingState(idle, { type: 'success', snapshot: next, generation: 3 });
  assert.equal(state.snapshot, next);
  assert.equal(state.mode, 'polling');
  assert.equal(state.message, 'NFT_FINALIZED');
});

test('더 늦게 시작한 요청이 이미 적용됐다면 오래된 세대의 성공·실패 응답은 무시한다', () => {
  const applied = nextPollingState(initialPollingState(twoNfts('CONFIRMING', 'CONFIRMING'), 1), {
    type: 'success',
    snapshot: twoNfts('FINALIZED', 'CONFIRMING'),
    generation: 5,
  });
  assert.equal(nextPollingState(applied, { type: 'success', snapshot: pendingSnapshot, generation: 4 }), applied);
  assert.equal(nextPollingState(applied, { type: 'failure', generation: 4 }), applied);
});

test('실패는 세대를 올리지 않아 먼저 시작한 요청의 성공 응답도 적용한다', () => {
  const failed = nextPollingState(initialPollingState(pendingSnapshot, 1), { type: 'failure', generation: 6 });
  assert.equal(failed.generation, 1);
  const nextSnapshot = snapshot('QUEUED');
  const state = nextPollingState(failed, { type: 'success', snapshot: nextSnapshot, generation: 5 });
  assert.equal(state.snapshot, nextSnapshot);
  assert.equal(state.consecutiveFailures, 0);
});

test('조회할 것이 없는 idle 상태에서는 실패 응답이 다시 조회를 시작시키지 않는다', () => {
  const idle = initialPollingState(finalizedSnapshot, 1);
  assert.equal(nextPollingState(idle, { type: 'failure', generation: 2 }), idle);
});

test('확정 알림은 실패·확정 없는 성공에도 남고 접수 시점의 clearFinalizedNotice로만 지운다', () => {
  const notified = nextPollingState(initialPollingState(twoNfts('CONFIRMING', 'CONFIRMING'), 1), {
    type: 'success',
    snapshot: twoNfts('FINALIZED', 'CONFIRMING'),
    generation: 2,
  });
  assert.equal(nextPollingState(notified, { type: 'failure', generation: 3 }).message, 'NFT_FINALIZED');
  const same = twoNfts('FINALIZED', 'CONFIRMING');
  assert.equal(nextPollingState(notified, { type: 'success', snapshot: same, generation: 3 }).message, 'NFT_FINALIZED');

  const cleared = clearFinalizedNotice(notified);
  assert.equal('message' in cleared, false);
  assert.deepEqual({ ...cleared, message: 'NFT_FINALIZED' }, notified);
});

test('알림을 지운 뒤 접수 조회가 오래된 응답으로 버려져도 알림은 되살아나지 않는다', () => {
  const notified = nextPollingState(initialPollingState(twoNfts('CONFIRMING', 'CONFIRMING'), 1), {
    type: 'success',
    snapshot: twoNfts('FINALIZED', 'CONFIRMING'),
    generation: 2,
  });
  const cleared = clearFinalizedNotice(notified);
  // 접수 뒤 조회(세대 3)보다 늦게 시작한 폴링(세대 4)이 먼저 적용된 경우.
  const polled = nextPollingState(cleared, { type: 'success', snapshot: twoNfts('FINALIZED', 'CONFIRMING'), generation: 4 });
  const afterStale = nextPollingState(polled, { type: 'success', snapshot: twoNfts('FINALIZED', 'CONFIRMING'), generation: 3 });
  assert.equal(afterStale, polled);
  assert.equal(afterStale.message, undefined);
});

test('알림이 없으면 clearFinalizedNotice는 같은 상태를 그대로 돌려준다', () => {
  const state = initialPollingState(pendingSnapshot, 1);
  assert.equal(clearFinalizedNotice(state), state);
});

function snapshot(nftStatus: CollectionSnapshot['collectibles'][number]['nftStatus']): CollectionSnapshot {
  return {
    visits: [],
    collectibles: [{
      entitlementId: 'entitlement-1',
      merchantId: 'merchant-1',
      merchantName: '월계 밥상',
      campaignId: 'campaign-1',
      campaignTitle: '월계 한 바퀴',
      targetVisitCount: 1,
      displayName: '첫 잎새',
      earnedAt: '2026-09-19T03:00:00.000Z',
      appCollectibleStatus: 'COLLECTED',
      mintJobId: 'job-1',
      recipient: '0x0000000000000000000000000000000000000001',
      nftStatus,
      nft: nftStatus === 'FINALIZED'
        ? { chainId: 84532, contractAddress: '0x0000000000000000000000000000000000000002', tokenId: '1' }
        : null,
    }],
  };
}

function twoNfts(
  first: CollectionSnapshot['collectibles'][number]['nftStatus'],
  second: CollectionSnapshot['collectibles'][number]['nftStatus'],
): CollectionSnapshot {
  const [a] = snapshot(first).collectibles;
  const [b] = snapshot(second).collectibles;
  return { visits: [], collectibles: [a, { ...b, entitlementId: 'entitlement-2', mintJobId: 'job-2' }] };
}

function visit(visitEventId: string): CollectionSnapshot['visits'][number] {
  return {
    visitEventId,
    merchantId: 'merchant-1',
    merchantName: '월계 밥상',
    campaignId: 'campaign-1',
    campaignTitle: '월계 한 바퀴',
    businessDate: '2026-09-30',
    progressCounted: true,
    verificationLevel: 'MERCHANT_CONFIRMED',
  };
}

test('발행 준비 중인 운영 도감은 접수·확인 중 NFT가 있어도 진행을 다시 묻지 않는다', () => {
  const preparing = { ...snapshot('QUEUED'), nftMinting: 'PREPARING' as const };
  assert.equal(initialPollingState(preparing).mode, 'idle');
  assert.equal(initialPollingState(snapshot('QUEUED')).mode, 'polling');
});
