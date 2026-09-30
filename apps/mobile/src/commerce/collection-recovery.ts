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

// mode는 "계속 다시 물을지"만 정한다. 확정 알림(message)은 조회 종료와 별개로 남는다.
export type PollingState = {
  mode: 'idle' | 'polling' | 'manual-retry';
  consecutiveFailures: number;
  snapshot: CollectionSnapshot;
  // 지금까지 적용한 응답 중 가장 늦게 시작한 요청의 세대. 이보다 오래된 응답은 버린다.
  generation: number;
  message?: 'NFT_FINALIZED';
};

// generation은 요청을 시작할 때 화면이 1씩 올려 붙이는 번호다.
export type PollingEvent =
  | { type: 'failure'; generation: number }
  | { type: 'success'; snapshot: CollectionSnapshot; generation: number };

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

export function initialPollingState(snapshot: CollectionSnapshot, generation = 0): PollingState {
  return {
    mode: hasPendingMint(snapshot) ? 'polling' : 'idle',
    consecutiveFailures: 0,
    snapshot,
    generation,
  };
}

export function nextPollingState(current: PollingState, event: PollingEvent): PollingState {
  // 나중에 시작한 요청의 결과가 이미 적용됐다면 이 응답은 오래된 것이다. 그것만 버린다.
  if (event.generation < current.generation) return current;
  if (event.type === 'failure') {
    // 대기 중인 NFT가 없으면 조회 실패가 다시 조회를 시작하게 만들지 않는다.
    if (current.mode === 'idle') return current;
    const consecutiveFailures = current.consecutiveFailures + 1;
    return {
      ...current,
      mode: consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES ? 'manual-retry' : 'polling',
      consecutiveFailures,
    };
  }

  const message = hasFinalizedTransition(current.snapshot, event.snapshot)
    ? 'NFT_FINALIZED'
    : current.message;
  return {
    // 하나가 확정돼도 다른 NFT가 접수·확인 중이면 계속 다시 묻는다.
    mode: hasPendingMint(event.snapshot) ? 'polling' : 'idle',
    consecutiveFailures: 0,
    snapshot: event.snapshot,
    generation: event.generation,
    ...(message ? { message } : {}),
  };
}

/**
 * 새 발행을 접수하려는 순간에 이전 확정 알림을 지운다. 알림이 접수 안내를 가리지 않게 하려는 것이라,
 * 뒤따르는 조회가 오래된 응답으로 버려져도 접수 안내가 보인다.
 */
export function clearFinalizedNotice(current: PollingState): PollingState {
  if (!current.message) return current;
  const { message: _cleared, ...rest } = current;
  return rest;
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
