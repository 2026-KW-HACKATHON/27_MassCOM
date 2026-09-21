import type * as SecureStore from 'expo-secure-store';

export const AUTH_SESSION_STORAGE_KEY = 'masscom.auth.session.v1';

export type StoredAuthSessionV1 = {
  version: 1;
  sessionToken: string;
  accountId: string;
  expiresAt: string;
};

export type AuthStorageErrorCode = 'READ_FAILED' | 'WRITE_FAILED' | 'DELETE_FAILED';

export class AuthStorageError extends Error {
  constructor(readonly code: AuthStorageErrorCode) {
    super(`AUTH_STORAGE_${code}`);
    this.name = 'AuthStorageError';
  }
}

type SecureStoreSurface = Pick<
  typeof SecureStore,
  'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'
>;

function parseSession(raw: string): StoredAuthSessionV1 | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  const sessionToken = typeof candidate.sessionToken === 'string' ? candidate.sessionToken.trim() : '';
  const accountId = typeof candidate.accountId === 'string' ? candidate.accountId.trim() : '';
  const expiresAt = typeof candidate.expiresAt === 'string' ? candidate.expiresAt.trim() : '';
  if (
    candidate.version !== 1
    || !sessionToken
    || !accountId
    || !expiresAt
    || !Number.isFinite(Date.parse(expiresAt))
  ) return undefined;
  return { version: 1, sessionToken, accountId, expiresAt };
}

export function createSessionStore(
  secureStore: SecureStoreSurface,
  now: () => Date = () => new Date(),
) {
  async function clear(): Promise<void> {
    try {
      await secureStore.deleteItemAsync(AUTH_SESSION_STORAGE_KEY);
    } catch {
      throw new AuthStorageError('DELETE_FAILED');
    }
  }

  return {
    async load(): Promise<StoredAuthSessionV1 | undefined> {
      let raw: string | null;
      try {
        raw = await secureStore.getItemAsync(AUTH_SESSION_STORAGE_KEY);
      } catch {
        throw new AuthStorageError('READ_FAILED');
      }
      if (raw === null) return undefined;
      const session = parseSession(raw);
      if (!session || Date.parse(session.expiresAt) <= now().getTime()) {
        await clear();
        return undefined;
      }
      return session;
    },

    async save(session: StoredAuthSessionV1): Promise<void> {
      const normalized = parseSession(JSON.stringify(session));
      if (!normalized) throw new AuthStorageError('WRITE_FAILED');
      try {
        await secureStore.setItemAsync(AUTH_SESSION_STORAGE_KEY, JSON.stringify(normalized));
      } catch {
        throw new AuthStorageError('WRITE_FAILED');
      }
    },

    clear,
  };
}
