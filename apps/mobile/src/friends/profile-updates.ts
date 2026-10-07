const listeners = new Set<() => void>();
export function subscribeProfileUpdates(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyProfileUpdated() { for (const listener of listeners) listener(); }
