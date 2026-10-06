type SecureStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export type PendingClaim = { accountId: string; merchantId: string; token: string; expiresAt: string };
const key = 'masscom.claim.pending.v1';
// Consumed-identity/claim replay can outlive the display time; bound local recovery to server cleanup plus margin.
const RECOVERY_GRACE_MS = 48 * 60 * 60 * 1000;
export const isTerminalPendingClaimCode = (code: string): boolean =>
  code === 'CLAIM_TOKEN_EXPIRED' || code === 'CLAIM_TOKEN_INVALID' || code === 'CLAIM_SLOT_NOT_FOUND';
const accountKey = (accountId: string, kind: 'staff' | 'customer') => `${key}.${kind}.${Array.from(
  { length: accountId.length }, (_, index) => accountId.charCodeAt(index).toString(16).padStart(4, '0'),
).join('')}`;

const pendingOperations = new Map<string, Promise<void>>();
function forKey<T>(storageKey: string, operation: () => Promise<T>): Promise<T> {
  const previous = pendingOperations.get(storageKey) ?? Promise.resolve();
  const result = previous.then(operation);
  const settled = result.then(() => undefined, () => undefined);
  pendingOperations.set(storageKey, settled);
  void settled.then(() => { if (pendingOperations.get(storageKey) === settled) pendingOperations.delete(storageKey); });
  return result;
}

/** Keep only the short-lived identity needed to replay the same server issue request. */
export function createClaimPendingStore(storage: SecureStore, now = Date.now, kind: 'staff' | 'customer' = 'staff') {
  return {
    async loadState(accountId: string, merchantId?: string): Promise<{ state: 'none' } | { state: 'expired' | 'available'; pending: PendingClaim }> {
      if (!accountId) return { state: 'none' };
      const storageKey = accountKey(accountId, kind);
      return forKey(storageKey, async () => {
      const raw = await storage.getItemAsync(storageKey);
      if (!raw) return { state: 'none' };
      let value: unknown;
      try { value = JSON.parse(raw); } catch { await storage.deleteItemAsync(storageKey); return { state: 'none' }; }
      if (!value || typeof value !== 'object') { await storage.deleteItemAsync(storageKey); return { state: 'none' }; }
      const pending = value as Partial<PendingClaim>;
      if (pending.accountId !== accountId || merchantId && pending.merchantId !== merchantId) return { state: 'none' };
      if (typeof pending.expiresAt !== 'string' || !Number.isFinite(Date.parse(pending.expiresAt))
        || typeof pending.token !== 'string' || !pending.token
        || typeof pending.accountId !== 'string' || !pending.accountId
        || typeof pending.merchantId !== 'string' || !pending.merchantId) {
        await storage.deleteItemAsync(storageKey);
        return { state: 'none' };
      }
      if (now() > Date.parse(pending.expiresAt) + RECOVERY_GRACE_MS) {
        await storage.deleteItemAsync(storageKey);
        return { state: 'none' };
      }
      return { state: Date.parse(pending.expiresAt) <= now() ? 'expired' : 'available', pending: pending as PendingClaim };
      });
    },
    async load(accountId: string, merchantId?: string): Promise<PendingClaim | undefined> {
      const result = await this.loadState(accountId, merchantId);
      return result.state === 'none' ? undefined : result.pending;
    },
    async save(pending: PendingClaim): Promise<void> {
      if (!pending.accountId || !pending.merchantId || !pending.token
        || !Number.isFinite(Date.parse(pending.expiresAt))) {
        throw new Error('Pending claim has expired or is incomplete');
      }
      const storageKey = accountKey(pending.accountId, kind);
      await forKey(storageKey, () => storage.setItemAsync(storageKey, JSON.stringify(pending)));
    },
    async clearIfMatches(accountId: string, expected: Pick<PendingClaim, 'merchantId' | 'token'>): Promise<boolean> {
      if (!accountId) return false;
      const storageKey = accountKey(accountId, kind);
      return forKey(storageKey, async () => {
        const raw = await storage.getItemAsync(storageKey);
        if (!raw) return false;
        let pending: Partial<PendingClaim>;
        try { pending = JSON.parse(raw) as Partial<PendingClaim>; } catch { return false; }
        if (pending.accountId !== accountId || pending.merchantId !== expected.merchantId || pending.token !== expected.token) return false;
        await storage.deleteItemAsync(storageKey);
        return true;
      });
    },
    async clear(accountId: string): Promise<void> {
      if (accountId) { const storageKey = accountKey(accountId, kind); await forKey(storageKey, () => storage.deleteItemAsync(storageKey)); }
    },
  };
}

export async function clearClaimPendingIntent(storage: SecureStore, accountId: string): Promise<void> {
  if (accountId) await Promise.all(['staff', 'customer'].map((kind) => {
    const storageKey = accountKey(accountId, kind as 'staff' | 'customer');
    return forKey(storageKey, () => storage.deleteItemAsync(storageKey));
  }));
}
