import { useCallback, useState } from 'react';

import { remoteArtUri, usableArtSource } from './art-source';

/**
 * Wraps a picture source for an `<Image onError>`: when the API picture fails to load, `source` becomes undefined so the caller
 * shows its glyph instead. The failure is remembered for that address only; a new address (the catalog changed) is tried again.
 */
export function useArtFallback<Source>(source: Source | undefined): { source: Source | undefined; onError: () => void } {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const uri = remoteArtUri(source);
  const onError = useCallback(() => {
    if (uri !== undefined) setFailedUri(uri);
  }, [uri]);
  return { source: usableArtSource(source, failedUri), onError };
}
