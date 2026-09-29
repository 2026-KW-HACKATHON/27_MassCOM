import type { FriendsApiClient, FriendsSnapshot } from './friends-api';

// The request bookkeeping behind useFriends, kept free of React so it can be tested: which answer may still be applied, and
// what a failed answer does to what is on screen.

export type FriendsStatus = 'loading' | 'ready' | 'error';

export type FriendsLoad = { snapshot?: FriendsSnapshot; status: FriendsStatus; error?: unknown };

export const initialFriendsLoad: FriendsLoad = { status: 'loading' };

/** A change the server just confirmed for me: my new nickname or my new code. */
export type MeChange = { nickname?: string; code?: string };

/** An answer arrived: it replaces the snapshot, whatever happened before. */
export function loaded(_state: FriendsLoad, snapshot: FriendsSnapshot): FriendsLoad {
  return { snapshot, status: 'ready', error: undefined };
}

/** A failed quiet refresh keeps what is on screen (`ready` stays `ready`); a failed first load or retry is an error. */
export function failed(state: FriendsLoad, error: unknown, quiet: boolean): FriendsLoad {
  return { ...state, error, status: quiet && state.status === 'ready' ? 'ready' : 'error' };
}

/** Shows my confirmed nickname or code at once, before the refresh that follows re-ranks everything. */
export function withMe(state: FriendsLoad, change: MeChange): FriendsLoad {
  return state.snapshot ? { ...state, snapshot: { ...state.snapshot, me: { ...state.snapshot.me, ...change } } } : state;
}

/** Hands out request tokens; only the newest token may still apply its answer. */
export function createLatestGate() {
  let latest = 0;
  return {
    begin(): number {
      latest += 1;
      return latest;
    },
    /** A local change or a teardown: every request still in flight is now out of date. */
    invalidate(): void {
      latest += 1;
    },
    isLatest(token: number): boolean {
      return token === latest;
    },
  };
}

/**
 * Loads the friends snapshot (me, my friends and the ranking are one server answer) and reports each change of state through
 * `apply`. An answer that finishes after a newer request, a local change or `dispose` is ignored.
 */
export function createFriendsLoader(
  api: Pick<FriendsApiClient, 'getFriends'>,
  apply: (update: (state: FriendsLoad) => FriendsLoad) => void,
) {
  const gate = createLatestGate();

  async function load(quiet: boolean): Promise<void> {
    const request = gate.begin();
    try {
      const next = await api.getFriends();
      if (gate.isLatest(request)) apply((state) => loaded(state, next));
    } catch (caught) {
      if (gate.isLatest(request)) apply((state) => failed(state, caught, quiet));
    }
  }

  return {
    load,
    changeMe(change: MeChange): void {
      gate.invalidate();
      apply((state) => withMe(state, change));
      void load(true);
    },
    dispose(): void {
      gate.invalidate();
    },
  };
}
