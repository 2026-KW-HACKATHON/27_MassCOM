const BASE_PREFIX = '@masscom:appkit:';

/**
 * Short non-reversible label for an account, so storage key names never contain the account ID.
 * Two independently seeded 32-bit FNV-1a passes give 64 bits: a collision would let one account
 * read another's session, and 32 bits alone collide at tens of thousands of accounts.
 * ponytail: not a secret-keeping hash; switch to a keyed hash if account IDs become sensitive.
 */
export function accountStorageTag(accountId: string): string {
  return fnv1a(accountId, 0x811c9dc5) + fnv1a(accountId, 0x9747b28c);
}

function fnv1a(value: string, seed: number): string {
  let hash = seed;
  for (const char of value) {
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
