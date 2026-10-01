import type { CollectibleGroup } from './collectible-groups';
import type { StoreSeries } from './store-series';

export type ReactionEvent =
  | { kind: 'first-collectible' }
  | { kind: 'first-store'; merchantId: string; merchantName: string }
  | { kind: 'store-complete'; merchantId: string; merchantName: string };

export function reactionEventKey(event: ReactionEvent): string {
  return event.kind === 'first-collectible' ? event.kind : `${event.kind}:${event.merchantId}`;
}

/**
 * Every event the current snapshot currently qualifies for (17.1): owning at least one collectible at all, owning
 * one from a given store, and having completed a store's series. This reads the *current* state rather than diffing
 * against a previous snapshot, so a reaction dedupes purely against what has already been shown (see
 * pendingReactionEvents) — simpler, and unaffected by app restarts between claim and next screen visit.
 */
export function eligibleReactionEvents(groups: readonly CollectibleGroup[], series: readonly StoreSeries[]): readonly ReactionEvent[] {
  const events: ReactionEvent[] = [];
  if (groups.length > 0) events.push({ kind: 'first-collectible' });
  const seenMerchants = new Set<string>();
  for (const group of groups) {
    if (seenMerchants.has(group.merchantId)) continue;
    seenMerchants.add(group.merchantId);
    events.push({ kind: 'first-store', merchantId: group.merchantId, merchantName: group.merchantName });
  }
  for (const store of series) {
    if (store.completed) events.push({ kind: 'store-complete', merchantId: store.merchantId, merchantName: store.merchantName });
  }
  return events;
}

/** Eligible events not yet shown to this account, in priority order (see reactionMessage). */
export function pendingReactionEvents(eligible: readonly ReactionEvent[], shown: ReadonlySet<string>): readonly ReactionEvent[] {
  const pending = eligible.filter((event) => !shown.has(reactionEventKey(event)));
  const rank = { 'first-collectible': 0, 'store-complete': 1, 'first-store': 2 } as const;
  return [...pending].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

export type ReactionQueue = readonly ReactionEvent[];

/**
 * A tiny queue "controller" the screen is meant to use directly rather than reimplement: enqueue newly-eligible
 * events, read the one currently on screen, dismiss it, and find out which key (if any) that display just earned
 * persisting. Kept as plain functions over a plain array (no React) so it is fully testable without a renderer —
 * see mascot-reactions.test.ts for the full "several events become eligible at once, only one shown at a time,
 * only the shown one persisted" cycle this exists to get right.
 */

/**
 * Adds newly-eligible events to a display queue without duplicating one already waiting (or already showing, since
 * that is the queue's head). The screen shows one reaction at a time; only the event actually displayed is marked
 * shown (see reactionKeyToPersist), so every queued event is still shown even though only one is ever on screen at once.
 */
export function enqueueReactionEvents(queue: ReactionQueue, additions: readonly ReactionEvent[]): ReactionQueue {
  const queued = new Set(queue.map(reactionEventKey));
  const newOnes = additions.filter((event) => !queued.has(reactionEventKey(event)));
  return newOnes.length > 0 ? [...queue, ...newOnes] : queue;
}

/** The event currently on screen, if any — always the queue's head. */
export function currentReactionEvent(queue: ReactionQueue): ReactionEvent | undefined {
  return queue[0];
}

/** The event to show now: only while the collection tab is on screen and no full-screen overlay covers the toast. */
export function visibleReactionEvent(queue: ReactionQueue, onScreen: boolean): ReactionEvent | undefined {
  return onScreen ? currentReactionEvent(queue) : undefined;
}

/** Removes the currently-displayed event from the queue, e.g. when its toast closes. A no-op on an empty queue. */
export function dismissReactionEvent(queue: ReactionQueue): ReactionQueue {
  return queue.slice(1);
}

/**
 * The key to persist as "shown", given what is currently on screen and what has already been persisted — or
 * undefined if there is nothing new. This is the one place that decides what gets marked shown, and it only ever
 * looks at the queue's head: an event still waiting its turn is never marked shown before it is actually shown.
 */
export function reactionKeyToPersist(queue: ReactionQueue, alreadyShown: ReadonlySet<string>, onScreen = true): string | undefined {
  // 다른 전체 화면(획득 연출·상세)에 가려져 있거나 탭이 안 보이면 아직 "본 것"이 아니다.
  if (!onScreen) return undefined;
  const current = currentReactionEvent(queue);
  if (!current) return undefined;
  const key = reactionEventKey(current);
  return alreadyShown.has(key) ? undefined : key;
}

export function reactionMessage(event: ReactionEvent): string {
  if (event.kind === 'first-collectible') return '첫 수집품을 도감에 모았어요!';
  if (event.kind === 'first-store') return `${event.merchantName}에서 첫 수집품을 받았어요!`;
  return `${event.merchantName} 수집품을 모두 모았어요!`;
}
