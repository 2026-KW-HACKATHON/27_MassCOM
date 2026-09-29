import type { FriendsStatus } from './friends-loader';

/**
 * A friend code that arrives by link is judged against my own code (my own is only said to be mine, never asked about). A tab
 * that was mounted by that very link has not loaded my snapshot yet, so it cannot judge: the code waits here until the load has
 * ended. If the load failed the code is handed over anyway, and the server refuses adding myself. One code waits at a time, and
 * a newer one replaces it.
 */
export function createHeldFriendCode() {
  let held: string | undefined;
  return {
    /** The code to act on now, or undefined when it has to wait for my snapshot. */
    arrive(code: string, status: FriendsStatus): string | undefined {
      if (status === 'loading') {
        held = code;
        return undefined;
      }
      held = undefined;
      return code;
    },
    /** My snapshot finished (or failed): the waiting code, once, or undefined when nothing waits or it is still loading. */
    settle(status: FriendsStatus): string | undefined {
      if (status === 'loading' || held === undefined) return undefined;
      const code = held;
      held = undefined;
      return code;
    },
    /** Forgets a waiting code, for when the tab is left before the snapshot came. */
    clear(): void {
      held = undefined;
    },
  };
}
