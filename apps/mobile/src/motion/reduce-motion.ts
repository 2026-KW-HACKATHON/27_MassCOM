export type ReduceMotionSource = {
  /** Current OS "reduce motion" value. */
  read: () => Promise<boolean>;
  /** Called with the new value each time the person toggles the OS setting. */
  listen: (onChange: (reduced: boolean) => void) => void;
};

/**
 * Live view of the OS reduce-motion switch, shared by every component that animates.
 * The source is started lazily and once; the app-lifetime listener is intentional.
 */
export function createReduceMotionStore(source: ReduceMotionSource) {
  let reduced = false;
  let started = false;
  let heardChange = false;
  const listeners = new Set<() => void>();

  const set = (next: boolean) => {
    if (next === reduced) return;
    reduced = next;
    listeners.forEach((listener) => listener());
  };

  const start = () => {
    if (started) return;
    started = true;
    source.listen((next) => { heardChange = true; set(next); });
    // A change heard while the first read was in flight is newer than that read.
    source.read().then((next) => { if (!heardChange) set(next); }, () => undefined);
  };

  return {
    get: () => reduced,
    subscribe: (listener: () => void) => {
      start();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
