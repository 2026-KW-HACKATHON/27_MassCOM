type ProviderErrorShape = {
  code?: unknown;
  message?: unknown;
};

type AppKitEventShape = {
  data?: unknown;
};

const userRejectionCodes = new Set([4001, 5000, 5001, 5002, 5003]);

export function isReownChainSwitchRejection(error: unknown): boolean {
  // AppKit Ethers Adapter 2.0.6 rewrites a provider "user rejected" error to this exact message.
  return (
    error instanceof Error &&
    error.message === 'Chain is not supported' &&
    (error as Error & ProviderErrorShape).code === undefined
  );
}

export function isWalletUserRejection(error: unknown): boolean {
  if (hasUserRejectionCode(error) || hasAppKitUserRejectionEvent(error)) return true;

  const serialized =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? (error as ProviderErrorShape).message
        : error;

  if (typeof serialized !== 'string') return false;

  try {
    return hasUserRejectionCode(JSON.parse(serialized) as unknown);
  } catch {
    return false;
  }
}

function hasAppKitUserRejectionEvent(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('data' in value)) return false;

  const data = (value as AppKitEventShape).data;
  return (
    typeof data === 'object' &&
    data !== null &&
    'event' in data &&
    (data as { event?: unknown }).event === 'USER_REJECTED'
  );
}

function hasUserRejectionCode(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as ProviderErrorShape).code === 'number' &&
    userRejectionCodes.has((value as ProviderErrorShape).code as number)
  );
}
