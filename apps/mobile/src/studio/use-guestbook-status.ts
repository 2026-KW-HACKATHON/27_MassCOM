import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { AccountCredential } from '@/auth/account-credential';
import { createRoomApiClient, roomErrorMessage } from './room-api';
import { subscribeGuestbookChanged } from './guestbook-state';

/** Scope every result to its authenticated client and retain the last count while refreshing. */
export function useGuestbookStatus(apiUrl: string, credential: AccountCredential, onSessionInvalid: () => Promise<void>) {
  const client = useMemo(() => createRoomApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [result, setResult] = useState<{ client: typeof client; unreadCount?: number; roomId?: string | null; error?: string }>();
  const generation = useRef(0);
  const active = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const page = await client.ownGuestbook();
      if (active.current && request === generation.current) setResult({ client, unreadCount: page.unreadCount, roomId: page.roomId });
    } catch (caught) {
      if (active.current && request === generation.current) setResult((current) => ({
        ...(current?.client === client ? current : { client }), error: roomErrorMessage(caught),
      }));
    }
  }, [client]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    void refresh();
    const unsubscribe = subscribeGuestbookChanged(() => { void refresh(); });
    return () => { active.current = false; generation.current += 1; unsubscribe(); };
  }, [refresh]));
  const current = result?.client === client ? result : undefined;
  return { unreadCount: current?.unreadCount, roomId: current?.roomId, error: current?.error, refresh };
}
