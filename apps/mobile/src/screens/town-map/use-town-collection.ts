import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useReducer, useRef } from 'react';

import type { AccountCredential } from '@/auth/account-credential';
import { createCommerceApiClient } from '@/commerce/commerce-api';

import { INITIAL_TOWN_COLLECTION, townCollectionReducer, type TownCollectionStatus } from './town-collection-state';

export type { TownCollectionStatus };

/**
 * The account's collection, for the stamps on the map (the same /collection the 도감 reads, no new API). The tab stays mounted, so
 * it loads whenever the map comes into focus: the first time, and after a visit was claimed elsewhere it quietly picks up the new
 * stamp. A failed reload keeps the data already shown and flags it `stale`, and a response that arrives after a newer request was
 * made (or after the map lost focus) is ignored.
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
  const [state, dispatch] = useReducer(townCollectionReducer, INITIAL_TOWN_COLLECTION);
  const generation = useRef(0);

  const fetchCollection = useCallback(async () => {
    if (!api) return;
    const request = ++generation.current;
    try {
      const collection = await api.getCollection();
      if (request === generation.current) dispatch({ type: 'loaded', collection });
    } catch {
      if (request === generation.current) dispatch({ type: 'failed' });
    }
  }, [api]);

  // One place starts the loads: focusing the map (its first focus included) and a new `api` both run it once, so a changed
  // client never fetches twice. Leaving the map, or unmounting, drops whatever is still in flight.
  useFocusEffect(useCallback(() => {
    void fetchCollection();
    return () => { generation.current += 1; };
  }, [fetchCollection]));

  // For a person's retry or pull-to-refresh: an earlier failure shows "checking" again while it loads.
  const reload = useCallback(async () => {
    dispatch({ type: 'retry' });
    await fetchCollection();
  }, [fetchCollection]);

  const status: TownCollectionStatus = api ? state.status : 'signedOut';
  return { collection: api ? state.collection : undefined, status, stale: api ? state.stale : false, reload };
}
