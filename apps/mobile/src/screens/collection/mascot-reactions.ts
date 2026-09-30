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

/**
 * Adds newly-eligible events to a display queue without duplicating one already waiting (or already showing, since
 * that is the queue's head). The screen shows one reaction at a time; only the event actually displayed is marked
 * shown (see reactionEventKey), so every queued event is still shown even though only one is ever on screen at once.
 */
export function enqueueReactionEvents(queue: readonly ReactionEvent[], additions: readonly ReactionEvent[]): readonly ReactionEvent[] {
  const queued = new Set(queue.map(reactionEventKey));
  const newOnes = additions.filter((event) => !queued.has(reactionEventKey(event)));
  return newOnes.length > 0 ? [...queue, ...newOnes] : queue;
}

export function reactionMessage(event: ReactionEvent): string {
  if (event.kind === 'first-collectible') return '첫 수집품을 도감에 모았어요!';
  if (event.kind === 'first-store') return `${event.merchantName}에서 첫 수집품을 받았어요!`;
  return `${event.merchantName} 수집품을 모두 모았어요!`;
}
