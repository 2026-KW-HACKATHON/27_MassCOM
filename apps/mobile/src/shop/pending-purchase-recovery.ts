import type { MileageGrade, ShopRerollResult } from './shop-api';
import type { PendingPurchaseScope, StoredPendingPurchase } from './pending-purchase-storage';

type RerollInput = { grade: MileageGrade; requestId: string; expectedRemaining: number };

export type PendingPurchaseRecoveryDeps = {
  scope: PendingPurchaseScope;
  readPending: (scope: PendingPurchaseScope) => Promise<StoredPendingPurchase | null>;
  clearPending: (scope: PendingPurchaseScope) => Promise<void>;
  reroll: (input: RerollInput) => Promise<ShopRerollResult>;
  isCurrent: () => boolean;
  onStart: (pending: StoredPendingPurchase) => void;
  onSuccess: (result: ShopRerollResult) => void;
  onError: (error: unknown) => void;
  onFinish: () => void;
};

export type PendingPurchaseRecoveryStatus = 'empty' | 'success' | 'error' | 'stale';

export async function recoverPendingPurchase(deps: PendingPurchaseRecoveryDeps): Promise<PendingPurchaseRecoveryStatus> {
  let started = false;
  try {
    const stored = await deps.readPending(deps.scope);
    if (!stored || !deps.isCurrent()) return stored ? 'stale' : 'empty';

    deps.onStart(stored);
    started = true;
    const result = await deps.reroll({ grade: stored.grade, requestId: stored.requestId, expectedRemaining: stored.expectedRemaining });
    if (!deps.isCurrent()) return 'stale';
    await deps.clearPending(deps.scope).catch(() => undefined);
    if (!deps.isCurrent()) return 'stale';
    deps.onSuccess(result);
    return 'success';
  } catch (error) {
    if (!deps.isCurrent()) return 'stale';
    deps.onError(error);
    return 'error';
  } finally {
    if (started && deps.isCurrent()) deps.onFinish();
  }
}
