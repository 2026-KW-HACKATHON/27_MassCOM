import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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
  const [account, setAccount] = useState({ api });
  const activeAccount = useRef<typeof account | undefined>(undefined);
  const retryGeneration = useRef(0);

  // 계정 변경 렌더 직후 layout effect에서 기존 콜백을 무효화한다.
  if (account.api !== api) {
    setAccount({ api });
    setBook(undefined);
    setStatus('loading');
    setRetrying(false);
  }
  useLayoutEffect(() => {
    activeAccount.current = account;
    return () => { activeAccount.current = undefined; generation.current += 1; };
  }, [account]);
  const isCurrent = useCallback(() => activeAccount.current === account, [account]);

  const fetchBook = useCallback(async (quiet: boolean) => {
    if (!api || !isCurrent()) return;
    const request = ++generation.current;
    try {
      const next = await api.getBadgeBook();
      if (!isCurrent() || request !== generation.current) return;
      setBook(next);
      setStatus('ready');
    } catch {
      if (!isCurrent() || request !== generation.current) return;
      // A quiet refresh keeps what is already on screen.
      setStatus((current) => (quiet && current === 'ready' ? current : 'error'));
    }
  }, [api, isCurrent]);

  useEffect(() => {
    if (!api) return;
    const request = ++generation.current;
    void api.getBadgeBook()
      .then((next) => {
        if (!isCurrent() || request !== generation.current) return;
        setBook(next);
        setStatus('ready');
      })
      .catch(() => {
        if (isCurrent() && request === generation.current) setStatus('error');
      });
    return () => {
      generation.current += 1;
    };
  }, [api, isCurrent]);

  const retry = useCallback(async () => {
    if (!api || !isCurrent()) return;
    const retryRequest = ++retryGeneration.current;
    setRetrying(true);
    try {
      await fetchBook(false);
    } finally {
      if (isCurrent() && retryRequest === retryGeneration.current) setRetrying(false);
    }
  }, [api, fetchBook, isCurrent]);

  const refreshQuietly = useCallback(() => fetchBook(true), [fetchBook]);

  /** Put a freshly opened coupon on the box right away, then confirm with the server. */
  const applyOpened = useCallback((result: OpenedReward) => {
    if (!api || !isCurrent()) return;
    generation.current += 1;
    setBook((current) => current && {
      ...current,
      rewards: current.rewards.map((reward) => reward.milestone === result.coupon.milestone
        ? { ...reward, state: 'OPENED', offer: null, coupon: result.coupon }
        : reward),
    });
    void refreshQuietly();
  }, [api, isCurrent, refreshQuietly]);

  /** Accept a book fetched elsewhere (coupon polling) without another request. */
  const replace = useCallback((next: BadgeBook) => {
    if (!api || !isCurrent()) return;
    generation.current += 1;
    setBook(next);
    setStatus('ready');
  }, [api, isCurrent]);

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
