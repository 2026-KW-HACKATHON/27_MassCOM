export type SafeErrorMetadata = {
  event: string;
  errorName: string;
  errorCode?: string;
};

export function safeErrorMetadata(
  event: string,
  error: unknown,
  allowedCodes: ReadonlySet<string> = new Set(),
): SafeErrorMetadata {
  const errorName = error instanceof Error ? 'Error' : 'UnknownError';
  let candidate: unknown;
  if (typeof error === 'object' && error !== null) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
      candidate = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    } catch {
      candidate = undefined;
    }
  }

  return typeof candidate === 'string' && allowedCodes.has(candidate)
    ? { event, errorName, errorCode: candidate }
    : { event, errorName };
}
