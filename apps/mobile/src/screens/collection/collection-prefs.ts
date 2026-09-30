import { accountStorageTag } from '@/wallet/account-scope';

// 대표 진열·마스코트 반응처럼 기기에만 남는 도감 취향은 계정별로 나눠 저장한다. 키 이름에 계정 ID를 그대로 넣지 않는 것은
// wallet/account-scope.ts와 같은 이유다: 다른 계정이 남긴 값을 우연히 읽지 않고, 계정을 바꿔도 이전 값이 섞이지 않는다.
const BASE_PREFIX = '@masscom:collection:';

export function collectionPrefsPrefix(accountId: string): string {
  return `${BASE_PREFIX}${accountStorageTag(accountId)}:`;
}

export function favoritesKey(accountId: string): string {
  return `${collectionPrefsPrefix(accountId)}favorites`;
}

export function shownReactionsKey(accountId: string): string {
  return `${collectionPrefsPrefix(accountId)}reactions`;
}

/** "대표 진열"은 몇 개만 놓는 자리라, 화면이 넘치지 않도록 개수를 제한한다. */
export const MAX_FAVORITES = 6;

/** 이미 즐겨찾기면 빼고, 아니면 더한다. 가득 찼으면 더하기는 조용히 무시한다(자리 없음을 화면에서 알리면 된다). */
export function toggleFavorite(current: readonly string[], key: string): readonly string[] {
  if (current.includes(key)) return current.filter((value) => value !== key);
  if (current.length >= MAX_FAVORITES) return current;
  return [...current, key];
}

type PurgeDeps = {
  accountId: string;
  listStoredKeys: () => Promise<readonly string[]>;
  removeStoredKeys: (keys: string[]) => Promise<void>;
  /**
   * Checked right before deleting, after the (possibly slow) listStoredKeys resolves. A sign-in effect keyed on the
   * new accountId can still be in flight when the account changes again (fast switch, or a stale call from an
   * account that has since logged out); without this guard it would delete the keys of whichever account is current
   * by the time it finishes, since those look "foreign" to the accountId it captured at the start. Defaults to true.
   */
  isStillCurrent?: () => boolean;
};

/** 로그아웃·계정 전환 때 다른 계정이 남긴 도감 취향을 지운다(지갑 세션과 같은 정리 방식). */
export async function purgeForeignCollectionPrefs(deps: PurgeDeps): Promise<number> {
  const ownPrefix = collectionPrefsPrefix(deps.accountId);
  const foreign = (await deps.listStoredKeys()).filter(
    (key) => key.startsWith(BASE_PREFIX) && !key.startsWith(ownPrefix),
  );
  if (foreign.length === 0) return 0;
  if (deps.isStillCurrent && !deps.isStillCurrent()) return 0;
  await deps.removeStoredKeys(foreign);
  return foreign.length;
}

type AccountPurgeDeps = {
  accountId: string;
  listStoredKeys: () => Promise<readonly string[]>;
  removeStoredKeys: (keys: string[]) => Promise<void>;
};

/**
 * Deletes exactly this account's own collection prefs (favorites, shown reactions). Called on logout, account
 * switch, and session invalidation so a former account's local prefs do not linger on a shared device and are not
 * silently restored if the same account signs back in later (purgeForeignCollectionPrefs above only ever protects
 * the *current* account's keys from *other* accounts — it never touches the current account's own data).
 */
export async function purgeOwnCollectionPrefs(deps: AccountPurgeDeps): Promise<number> {
  const ownPrefix = collectionPrefsPrefix(deps.accountId);
  const own = (await deps.listStoredKeys()).filter((key) => key.startsWith(ownPrefix));
  if (own.length > 0) await deps.removeStoredKeys(own);
  return own.length;
}
