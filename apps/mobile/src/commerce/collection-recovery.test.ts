import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ActiveWalletBindingResponse } from '@/wallet/wallet-api';

import type { CollectionSnapshot } from './commerce-api';
import {
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
    state = nextPollingState(state, { type: 'failure' });
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
  assert.deepEqual(nextPollingState(manual, { type: 'success', snapshot: nextSnapshot }), {
    mode: 'polling',
    consecutiveFailures: 0,
    snapshot: nextSnapshot,
  });
});

test('finalized transition completes polling with an explicit message', () => {
  assert.deepEqual(
    nextPollingState(initialPollingState(pendingSnapshot), {
      type: 'success',
      snapshot: finalizedSnapshot,
    }),
    {
      mode: 'complete',
      consecutiveFailures: 0,
      snapshot: finalizedSnapshot,
      message: 'NFT_FINALIZED',
    },
  );
});

test('finalized polling state is monotonic under stale success and failure completions', () => {
  const complete = nextPollingState(initialPollingState(pendingSnapshot), {
    type: 'success',
    snapshot: finalizedSnapshot,
  });
  assert.equal(nextPollingState(complete, { type: 'success', snapshot: pendingSnapshot }), complete);
  assert.equal(nextPollingState(complete, { type: 'failure' }), complete);
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

test('발행 준비 중인 운영 도감은 접수·확인 중 NFT가 있어도 진행을 다시 묻지 않는다', () => {
  const preparing = { ...snapshot('QUEUED'), nftMinting: 'PREPARING' as const };
  assert.equal(initialPollingState(preparing).mode, 'idle');
  assert.equal(initialPollingState(snapshot('QUEUED')).mode, 'polling');
});
