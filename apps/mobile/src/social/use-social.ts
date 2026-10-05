import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SocialApiClient } from './social-api';
import { createSocialLoader, initialSocialLoad } from './social-loader';

export function useSocial(api: SocialApiClient) {
  const [state, setState] = useState(initialSocialLoad);
  const [retrying, setRetrying] = useState(false);
  const loader = useMemo(() => createSocialLoader(api, setState), [api]);

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

  return { snapshot: state.snapshot, status: state.status, error: state.error, retrying, retry, refreshQuietly };
}
