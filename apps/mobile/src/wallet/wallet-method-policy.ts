export class WalletMethodNotAllowedError extends Error {
  readonly code = 'WALLET_METHOD_NOT_ALLOWED';

  constructor(readonly method: string) {
    super(`Wallet method is not allowed: ${method}`);
    this.name = 'WalletMethodNotAllowedError';
  }
}

const allowedMethods = new Set([
  'eth_requestAccounts',
  'eth_accounts',
  'eth_chainId',
  'wallet_switchEthereumChain',
  'personal_sign',
]);

export function assertAllowedWalletMethod(method: string): void {
  if (!allowedMethods.has(method)) {
    throw new WalletMethodNotAllowedError(method);
  }
}

export async function safeWalletRequest<T>(
  provider: {
    request<TResult>(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<TResult>;
  },
  args: { method: string; params?: unknown[] | Record<string, unknown> },
): Promise<T> {
  assertAllowedWalletMethod(args.method);
  return provider.request<T>(args);
}

export function buildPersonalSignRequest(message: string, address: string): {
  method: 'personal_sign';
  params: [string, string];
} {
  const encodedMessage = Array.from(
    new TextEncoder().encode(message),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

  return {
    method: 'personal_sign',
    params: [`0x${encodedMessage}`, address],
  };
}
