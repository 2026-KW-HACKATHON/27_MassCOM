import type { CollectionSnapshot } from '../../commerce/commerce-api';

/**
 * "받은 수집품 보기" 링크가 가리킨 권리로 무엇을 할지 정한다. 도감 탭은 계속 마운트돼 있어 들고 있는 스냅샷이 방금 받은 보상보다
 * 오래됐을 수 있다. 스냅샷에 그 권리가 없으면 한 번만 도감을 다시 읽어 보고(`fetch`), 그래도 없으면 안내 문구를 보인다.
 */
export type CollectibleFocusAction = 'open' | 'message' | 'fetch';

export function collectibleFocusAction(
  snapshot: Pick<CollectionSnapshot, 'collectibles'>,
  entitlementId: string | undefined,
  alreadyReread: boolean,
): CollectibleFocusAction {
  const item = snapshot.collectibles.find((value) => value.entitlementId === entitlementId);
  if (item) return item.artwork ? 'open' : 'message';
  return alreadyReread ? 'message' : 'fetch';
}
