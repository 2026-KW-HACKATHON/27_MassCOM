import { useCallback, useEffect, useRef, useState } from 'react';

import type { FriendsApiClient, FriendsSnapshot } from './friends-api';

export type FriendsStatus = 'loading' | 'ready' | 'error';

/**
 * Loads the friends snapshot (me, my friends and the ranking are one server answer). A quiet refresh keeps what is on screen when
 * it fails, and a response that finishes after a newer request or a local change is ignored.
 */
export function useFriends(api: FriendsApiClient) {
  const [snapshot, setSnapshot] = useState<FriendsSnapshot>();
  const [status, setStatus] = useState<FriendsStatus>('loading');
  const [error, setError] = useState<unknown>();
  const [retrying, setRetrying] = useState(false);
  const generation = useRef(0);

  const fetchSnapshot = useCallback(async (quiet: boolean) => {
    const request = ++generation.current;
    try {
      const next = await api.getFriends();
      if (request !== generation.current) return;
      setSnapshot(next);
      setStatus('ready');
      setError(undefined);
    } catch (caught) {
      if (request !== generation.current) return;
      setError(caught);
      setStatus((current) => (quiet && current === 'ready' ? current : 'error'));
    }
  }, [api]);

  useEffect(() => {
    const request = ++generation.current;
    void api.getFriends()
      .then((next) => {
        if (request !== generation.current) return;
        setSnapshot(next);
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (request !== generation.current) return;
        setError(caught);
        setStatus('error');
      });
    return () => {
      generation.current += 1;
    };
  }, [api]);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await fetchSnapshot(false);
    } finally {
      setRetrying(false);
    }
  }, [fetchSnapshot]);

  const refreshQuietly = useCallback(() => fetchSnapshot(true), [fetchSnapshot]);

  /** A change the server just confirmed (new nickname or code) shows at once; the quiet refresh that follows re-ranks. */
  const applyMe = useCallback((change: { nickname?: string; code?: string }) => {
    generation.current += 1;
    setSnapshot((current) => current && { ...current, me: { ...current.me, ...change } });
    void fetchSnapshot(true);
  }, [fetchSnapshot]);

  return { snapshot, status, error, retrying, retry, refreshQuietly, applyMe };
}
