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
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const candidate =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;

  return typeof candidate === 'string' && allowedCodes.has(candidate)
    ? { event, errorName, errorCode: candidate }
    : { event, errorName };
}
