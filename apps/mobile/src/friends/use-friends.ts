import { useCallback, useEffect, useMemo, useState } from 'react';

import type { FriendsApiClient } from './friends-api';
import { createFriendsLoader, initialFriendsLoad, type MeChange } from './friends-loader';

export type { FriendsStatus } from './friends-loader';

/**
 * Loads the friends snapshot (me, my friends and the ranking are one server answer). A quiet refresh keeps what is on screen when
 * it fails, and a response that finishes after a newer request or a local change is ignored (see friends-loader.ts).
 */
export function useFriends(api: FriendsApiClient) {
  const [state, setState] = useState(initialFriendsLoad);
  const [retrying, setRetrying] = useState(false);
  const loader = useMemo(() => createFriendsLoader(api, setState), [api]);

  useEffect(() => {
    void loader.load(false);
    return () => loader.dispose();
  }, [loader]);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await loader.load(false);
    } finally {
      setRetrying(false);
    }
  }, [loader]);

  const refreshQuietly = useCallback(() => loader.load(true), [loader]);

  /** A change the server just confirmed (new nickname or code) shows at once; the quiet refresh that follows re-ranks. */
  const applyMe = useCallback((change: MeChange) => loader.changeMe(change), [loader]);

  return { snapshot: state.snapshot, status: state.status, error: state.error, retrying, retry, refreshQuietly, applyMe };
}
