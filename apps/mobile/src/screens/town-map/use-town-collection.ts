import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient, type CollectionSnapshot } from '@/commerce/commerce-api';

export type TownCollectionStatus = 'signedOut' | 'loading' | 'ready' | 'error';

/**
 * The account's collection, for the stamps on the map (the same /collection the 도감 reads, no new API). The tab stays mounted, so
 * coming back to it after a visit was claimed quietly picks up the new stamp. A failed reload keeps the data already shown, and a
 * response that arrives after a newer request was made is ignored.
 */
export function useTownCollection(options: {
  apiUrl: string;
  credential: AccountCredential | undefined;
  onSessionInvalid: () => Promise<void>;
}) {
  const { apiUrl, credential, onSessionInvalid } = options;
  const api = useMemo(
    () => (credential ? createCommerceApiClient({ apiUrl, credential, onSessionInvalid }) : undefined),
    [apiUrl, credential, onSessionInvalid],
  );
  const [collection, setCollection] = useState<CollectionSnapshot>();
  const [status, setStatus] = useState<TownCollectionStatus>('loading');
  const generation = useRef(0);

  const fetchCollection = useCallback(async () => {
    if (!api) return;
    const request = ++generation.current;
    try {
      const next = await api.getCollection();
      if (request !== generation.current) return;
      setCollection(next);
      setStatus('ready');
    } catch {
      // Stamps already on screen stay; only a first load that fails is an error.
      if (request === generation.current) setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const request = ++generation.current;
    void api.getCollection()
      .then((next) => {
        if (request !== generation.current) return;
        setCollection(next);
        setStatus('ready');
      })
      .catch(() => {
        if (request === generation.current) setStatus('error');
      });
    return () => { generation.current += 1; };
  }, [api]);

  // For a person's retry or pull-to-refresh: an earlier failure shows "checking" again while it loads.
  const reload = useCallback(async () => {
    setStatus((current) => (current === 'error' ? 'loading' : current));
    await fetchCollection();
  }, [fetchCollection]);

  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void fetchCollection();
  }, [fetchCollection]));

  return { collection, status: api ? status : 'signedOut', reload };
}
