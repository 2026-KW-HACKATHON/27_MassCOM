const BASE_PREFIX = '@masscom:appkit:';

/**
 * Short non-reversible label for an account, so storage key names never contain the account ID.
 * ponytail: FNV-1a is not a secret-keeping hash; it only keeps the raw ID out of key names. Switch
 * to a keyed hash if account IDs ever become sensitive on their own.
 */
export function accountStorageTag(accountId: string): string {
  let hash = 0x811c9dc5;
  for (const char of accountId) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function walletSessionPrefix(accountId: string): string {
  return `${BASE_PREFIX}${accountStorageTag(accountId)}:`;
}

type PurgeDeps = {
  accountId: string;
  listStoredKeys: () => Promise<readonly string[]>;
  removeStoredKeys: (keys: string[]) => Promise<void>;
};

/** Deletes wallet sessions left on the device by any other account, including pre-scoping keys. */
export async function purgeForeignWalletSessions(deps: PurgeDeps): Promise<number> {
  const ownPrefix = walletSessionPrefix(deps.accountId);
  const foreign = (await deps.listStoredKeys()).filter(
    (key) => key.startsWith(BASE_PREFIX) && !key.startsWith(ownPrefix),
  );
  if (foreign.length > 0) await deps.removeStoredKeys(foreign);
  return foreign.length;
}
