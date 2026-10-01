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

export type CollectibleLinkOutcome =
  | { action: 'open'; entitlementId: string; merchantName: string }
  | { action: 'message' }
  /** The screen moved on (blurred, or a newer link took over) before this resolved; the caller must not act on it. */
  | { action: 'stale' };

/**
 * What a resolved (or freshly re-fetched) snapshot means for a pending focus=collectible link — but only if nothing
 * has invalidated the attempt since it started. A re-read is an in-flight network request the screen cannot cancel;
 * if the person left the tab (or a newer link started) before it resolves, acting on it would reopen a reveal or
 * message for a link they already left. `generation` is the value the caller's own counter held when the attempt
 * started; `currentGeneration` reads that counter now, so a change in between (bump on blur/unmount/new link) shows
 * up here without this function needing to know why it changed.
 */
export function resolveCollectibleLink(
  snapshot: Pick<CollectionSnapshot, 'collectibles'>,
  entitlementId: string | undefined,
  generation: number,
  currentGeneration: () => number,
): CollectibleLinkOutcome {
  if (currentGeneration() !== generation) return { action: 'stale' };
  const item = snapshot.collectibles.find((value) => value.entitlementId === entitlementId);
  if (item?.artwork) return { action: 'open', entitlementId: item.entitlementId, merchantName: item.merchantName };
  return { action: 'message' };
}
