import { useCallback, useEffect, useMemo, useState } from 'react';

import { createMerchantApiClient, type PublicMerchant } from './merchant-api';

export function useMerchantCatalog(apiUrl: string) {
  const api = useMemo(() => createMerchantApiClient(apiUrl), [apiUrl]);
  const [merchants, setMerchants] = useState<readonly PublicMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (signal?: AbortSignal, refresh = false) => {
      if (refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(undefined);

      try {
        setMerchants(await api.listMerchants(signal));
      } catch {
        if (!signal?.aborted) {
          setError('음식점 정보를 불러오지 못했습니다. API 연결을 확인하고 다시 시도해 주세요.');
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void api
      .listMerchants(controller.signal)
      .then(setMerchants)
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('음식점 정보를 불러오지 못했습니다. API 연결을 확인하고 다시 시도해 주세요.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [api]);

  return {
    merchants,
    loading,
    refreshing,
    error,
    retry: () => load(),
    refresh: () => load(undefined, true),
  };
}
