import { pendingPurchaseScopeKey, type PendingPurchaseScope } from './pending-purchase-storage';

export type ShopPurchaseLease = Readonly<{ key: string; ownerId: number }>;

const activePurchaseScopes = new Map<string, number>();
const scopeListeners = new Map<string, Set<() => void>>();
let nextOwnerId = 1;

export function enterShopPurchaseScope(scope: PendingPurchaseScope): ShopPurchaseLease | undefined {
  const key = pendingPurchaseScopeKey(scope);
  if (activePurchaseScopes.has(key)) return undefined;
  const ownerId = nextOwnerId;
  nextOwnerId += 1;
  activePurchaseScopes.set(key, ownerId);
  return { key, ownerId };
}

export function leaveShopPurchaseScope(lease: ShopPurchaseLease): void {
  if (activePurchaseScopes.get(lease.key) !== lease.ownerId) return;
  activePurchaseScopes.delete(lease.key);
  const listeners = scopeListeners.get(lease.key);
  if (!listeners) return;
  for (const listener of listeners) listener();
}

export function subscribeShopPurchaseScope(scope: PendingPurchaseScope, listener: () => void): () => void {
  const key = pendingPurchaseScopeKey(scope);
  const listeners = scopeListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  scopeListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) scopeListeners.delete(key);
  };
}

export function isShopPurchaseScopeActive(scope: PendingPurchaseScope): boolean {
  return activePurchaseScopes.has(pendingPurchaseScopeKey(scope));
}

export function resetShopPurchaseCoordinatorForTest(): void {
  activePurchaseScopes.clear();
  scopeListeners.clear();
  nextOwnerId = 1;
}