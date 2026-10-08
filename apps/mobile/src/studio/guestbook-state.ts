import type { GuestbookEntry, GuestbookPage } from './room-api';

/** A later page may overlap after a new post; preserve one entry for each ID. */
export function appendGuestbookPage(current: GuestbookPage, next: GuestbookPage): GuestbookPage {
  if (current.roomId !== next.roomId) return next;
  const entries = new Map(current.entries.map((entry) => [entry.id, entry]));
  for (const entry of next.entries) entries.set(entry.id, entry);
  return { ...next, entries: [...entries.values()] };
}

/** Only IDs in the loaded page and actually visible in the list can be acknowledged. */
export function visibleUnreadGuestbookIds(entries: readonly GuestbookEntry[], visibleIds: readonly string[]): string[] {
  const visible = new Set(visibleIds);
  return entries.filter((entry) => entry.unread && !entry.mine && visible.has(entry.id)).map((entry) => entry.id);
}

const listeners = new Set<() => void>();
export function notifyGuestbookChanged() { for (const listener of listeners) listener(); }
export function subscribeGuestbookChanged(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
