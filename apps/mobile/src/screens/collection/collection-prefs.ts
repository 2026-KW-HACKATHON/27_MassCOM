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
};

/** 로그아웃·계정 전환 때 다른 계정이 남긴 도감 취향을 지운다(지갑 세션과 같은 정리 방식). */
export async function purgeForeignCollectionPrefs(deps: PurgeDeps): Promise<number> {
  const ownPrefix = collectionPrefsPrefix(deps.accountId);
  const foreign = (await deps.listStoredKeys()).filter(
    (key) => key.startsWith(BASE_PREFIX) && !key.startsWith(ownPrefix),
  );
  if (foreign.length > 0) await deps.removeStoredKeys(foreign);
  return foreign.length;
}
