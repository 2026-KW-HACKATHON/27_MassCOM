// 앱 세션에서 실제로 보인 카드만 기억한다. 권리·획득 상태는 서버 도감이 정본이다.
const presented = new Map<string, Set<string>>();

function scope(apiUrl: string, accountId: string): string {
  return `${apiUrl}\u0000${accountId}`;
}

export function markCollectiblePresented(apiUrl: string, accountId: string, entitlementId: string): void {
  const key = scope(apiUrl, accountId);
  const ids = presented.get(key) ?? new Set<string>();
  ids.add(entitlementId);
  presented.set(key, ids);
}

export function presentedCollectibleIds(apiUrl: string, accountId: string): ReadonlySet<string> {
  return new Set(presented.get(scope(apiUrl, accountId)) ?? []);
}

const acknowledged = new Map<string, Set<string>>();
/** Repeated reveal events share one receipt; a failed acknowledgement remains retryable. */
export async function acknowledgeCollectibleReceipt(
  apiUrl: string, accountId: string, entitlementId: string, recordOpening: (id: string) => Promise<unknown>,
): Promise<void> {
  const key = scope(apiUrl, accountId);
  const ids = acknowledged.get(key) ?? new Set<string>();
  if (ids.has(entitlementId)) return;
  ids.add(entitlementId);
  acknowledged.set(key, ids);
  try { await recordOpening(entitlementId); }
  catch (error) { ids.delete(entitlementId); throw error; }
}
