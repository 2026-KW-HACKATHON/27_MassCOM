import type { ActiveWalletBindingResponse } from '@/wallet/wallet-api';

import type { CollectionSnapshot } from './commerce-api';

export const MAX_CONSECUTIVE_POLL_FAILURES = 3;

export type CollectionLoadState =
  | {
      ok: true;
      collection: CollectionSnapshot;
      binding: ActiveWalletBindingResponse['binding'] | undefined;
      bindingError?: 'WALLET_BINDING_UNAVAILABLE';
    }
  | { ok: false; error: 'COLLECTION_UNAVAILABLE' };

export type PollingState = {
  mode: 'idle' | 'polling' | 'manual-retry' | 'complete';
  consecutiveFailures: number;
  snapshot: CollectionSnapshot;
  message?: 'NFT_FINALIZED';
};

export type PollingEvent =
  | { type: 'failure' }
  | { type: 'success'; snapshot: CollectionSnapshot };

export function resolveCollectionLoad(
  collectionResult: PromiseSettledResult<CollectionSnapshot>,
  bindingResult: PromiseSettledResult<ActiveWalletBindingResponse>,
): CollectionLoadState {
  if (collectionResult.status === 'rejected') {
    return { ok: false, error: 'COLLECTION_UNAVAILABLE' };
  }
  if (bindingResult.status === 'rejected') {
    return {
      ok: true,
      collection: collectionResult.value,
      binding: undefined,
      bindingError: 'WALLET_BINDING_UNAVAILABLE',
    };
  }
  return {
    ok: true,
    collection: collectionResult.value,
    binding: bindingResult.value.binding ?? undefined,
  };
}

export function initialPollingState(snapshot: CollectionSnapshot): PollingState {
  return {
    mode: hasPendingMint(snapshot) ? 'polling' : 'idle',
    consecutiveFailures: 0,
    snapshot,
  };
}

export function nextPollingState(current: PollingState, event: PollingEvent): PollingState {
  if (current.mode === 'complete') return current;
  if (event.type === 'failure') {
    const consecutiveFailures = current.consecutiveFailures + 1;
    return {
      mode: consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES ? 'manual-retry' : 'polling',
      consecutiveFailures,
      snapshot: current.snapshot,
    };
  }

  if (hasFinalizedTransition(current.snapshot, event.snapshot)) {
    return {
      mode: 'complete',
      consecutiveFailures: 0,
      snapshot: event.snapshot,
      message: 'NFT_FINALIZED',
    };
  }
  return {
    mode: hasPendingMint(event.snapshot) ? 'polling' : 'idle',
    consecutiveFailures: 0,
    snapshot: event.snapshot,
  };
}

function hasPendingMint(snapshot: CollectionSnapshot): boolean {
  // 발행 준비 중(운영, #246)에는 워커가 없어 진행을 기다려도 바뀌지 않으므로 다시 묻지 않는다.
  if (snapshot.nftMinting === 'PREPARING') return false;
  return snapshot.collectibles.some(
    (item) => item.nftStatus === 'QUEUED' || item.nftStatus === 'CONFIRMING',
  );
}

function hasFinalizedTransition(
  previous: CollectionSnapshot,
  next: CollectionSnapshot,
): boolean {
  const pendingIds = new Set(
    previous.collectibles
      .filter((item) => item.nftStatus === 'QUEUED' || item.nftStatus === 'CONFIRMING')
      .map((item) => item.entitlementId),
  );
  return next.collectibles.some(
    (item) => pendingIds.has(item.entitlementId) && item.nftStatus === 'FINALIZED',
  );
}
