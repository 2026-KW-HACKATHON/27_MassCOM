import { useCallback, useEffect, useRef, useState } from 'react';

import type { BadgeApiClient, BadgeBook, OpenedReward } from './badge-api';

export type BadgeBookStatus = 'loading' | 'ready' | 'error';

/**
 * Loads the badge book independently of the collection so a badge failure only affects the
 * badge sections. Stale responses (older request finishing last) are ignored.
 * `api` is undefined while signed out (#331 discovery chips share this hook): nothing is requested and a book from the
 * account that just left is dropped.
 */
export function useBadgeBook(api: BadgeApiClient | undefined) {
  const [book, setBook] = useState<BadgeBook>();
  const [status, setStatus] = useState<BadgeBookStatus>('loading');
  const [retrying, setRetrying] = useState(false);
  const generation = useRef(0);

  const fetchBook = useCallback(async (quiet: boolean) => {
    if (!api) return;
    const request = ++generation.current;
    try {
      const next = await api.getBadgeBook();
      if (request !== generation.current) return;
      setBook(next);
      setStatus('ready');
    } catch {
      if (request !== generation.current) return;
      // A quiet refresh keeps what is already on screen.
      setStatus((current) => (quiet && current === 'ready' ? current : 'error'));
    }
  }, [api]);

  // 로그아웃뿐 아니라 계정·API 변경에도 이전 책을 지워 다른 계정의 보상을 보여 주지 않는다.
  const [lastApi, setLastApi] = useState(api);
  if (api !== lastApi) {
    setLastApi(api);
    setBook(undefined);
    setStatus('loading');
  }

  useEffect(() => {
    if (!api) return;
    const request = ++generation.current;
    void api.getBadgeBook()
      .then((next) => {
        if (request !== generation.current) return;
        setBook(next);
        setStatus('ready');
      })
      .catch(() => {
        if (request === generation.current) setStatus('error');
      });
    return () => {
      generation.current += 1;
    };
  }, [api]);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await fetchBook(false);
    } finally {
      setRetrying(false);
    }
  }, [fetchBook]);

  const refreshQuietly = useCallback(() => fetchBook(true), [fetchBook]);

  /** Put a freshly opened coupon on the box right away, then confirm with the server. */
  const applyOpened = useCallback((result: OpenedReward) => {
    generation.current += 1;
    setBook((current) => current && {
      ...current,
      rewards: current.rewards.map((reward) => reward.milestone === result.coupon.milestone
        ? { ...reward, state: 'OPENED', offer: null, coupon: result.coupon }
        : reward),
    });
    void refreshQuietly();
  }, [refreshQuietly]);

  /** Accept a book fetched elsewhere (coupon polling) without another request. */
  const replace = useCallback((next: BadgeBook) => {
    generation.current += 1;
    setBook(next);
    setStatus('ready');
  }, []);

  return {
    book,
    status,
    retrying,
    retry,
    refreshQuietly,
    applyOpened,
    replace,
  };
}
