import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ShopApiClient, ShopRerollResult } from './shop-api';
import { createShopLoader, initialShopLoad } from './shop-loader';

export type { ShopStatus } from './shop-loader';

/** 상점 한 판(마일리지·등급·가진 친구·대표 캐릭터)을 불러온다. use-friends.ts와 같은 모양. */
export function useShop(api: ShopApiClient) {
  const [state, setState] = useState(initialShopLoad);
  const [retrying, setRetrying] = useState(false);
  const loader = useMemo(() => createShopLoader(api, setState), [api]);

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
  const applyReroll = useCallback((result: ShopRerollResult) => loader.applyReroll(result), [loader]);
  const applyAvatar = useCallback((avatar: string | null) => loader.applyAvatar(avatar), [loader]);

  return {
    snapshot: state.snapshot, status: state.status, error: state.error, retrying,
    retry, refreshQuietly, applyReroll, applyAvatar,
  };
}
