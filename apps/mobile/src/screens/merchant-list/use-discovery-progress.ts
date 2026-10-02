import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { AccountCredential } from '@/auth/account-credential';
import { createBadgeApiClient } from '@/gamification/badge-api';
import { useBadgeBook } from '@/gamification/use-badge-book';

import { useTownCollection } from '../town-map/use-town-collection';

/**
 * 탐색 목록의 진행 칩(#331)이 읽는 계정 데이터. 새 API는 없다: 방문·수집은 지도·도감이 읽는 /collection(useTownCollection),
 * 쿠폰은 여권 칩이 읽는 /me/badges(useBadgeBook)다. 로그아웃이면 둘 다 요청하지 않고 undefined다.
 * 탭이 계속 떠 있으므로 다른 탭에서 방문을 인증하고 돌아오면 조용히 다시 읽고(지도 쪽은 useTownCollection이 포커스마다),
 * 당겨서 새로고침(`refreshToken`)에도 같이 다시 읽는다.
 */
export function useDiscoveryProgress(options: {
  apiUrl: string;
  credential: AccountCredential | undefined;
  onSessionInvalid: () => Promise<void>;
  /** Bumped by the home screen's pull-to-refresh. */
  refreshToken: number;
}) {
  const { apiUrl, credential, onSessionInvalid, refreshToken } = options;
  const town = useTownCollection({ apiUrl, credential, onSessionInvalid });
  const badgeApi = useMemo(
    () => (credential ? createBadgeApiClient({ apiUrl, credential, onSessionInvalid }) : undefined),
    [apiUrl, credential, onSessionInvalid],
  );
  const { book, refreshQuietly } = useBadgeBook(badgeApi);

  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void refreshQuietly();
  }, [refreshQuietly]));

  const { reload } = town;
  const seenToken = useRef(refreshToken);
  useEffect(() => {
    if (seenToken.current === refreshToken) return;
    seenToken.current = refreshToken;
    void reload();
    void refreshQuietly();
  }, [refreshToken, reload, refreshQuietly]);

  return { collection: town.collection, book: credential ? book : undefined };
}
