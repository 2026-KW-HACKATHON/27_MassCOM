type ProviderErrorShape = {
  code?: unknown;
  message?: unknown;
};

const userRejectionCodes = new Set([4001, 5000, 5001, 5002, 5003]);

export function isWalletUserRejection(error: unknown): boolean {
  if (hasUserRejectionCode(error)) return true;

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

function hasUserRejectionCode(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as ProviderErrorShape).code === 'number' &&
    userRejectionCodes.has((value as ProviderErrorShape).code as number)
  );
}
