export type ApprovedEvmAccount = {
  address: string;
  chainId: number;
};

type SessionProvider = {
  session?: {
    namespaces?: Record<string, { accounts?: unknown }>;
  };
};

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;

export function readApprovedEvmAccount(
  provider: unknown,
  targetChainId: number,
): ApprovedEvmAccount | undefined {
  if (!provider || typeof provider !== 'object') return undefined;

  const accounts = (provider as SessionProvider).session?.namespaces?.eip155?.accounts;
  if (!Array.isArray(accounts)) return undefined;

  const approvedAccounts = accounts.flatMap((account) => {
    if (typeof account !== 'string') return [];

    const [namespace, chainIdText, address] = account.split(':');
    const chainId = Number(chainIdText);
    if (
      namespace !== 'eip155' ||
      !Number.isSafeInteger(chainId) ||
      chainId <= 0 ||
      !EVM_ADDRESS_PATTERN.test(address ?? '')
    ) {
      return [];
    }

    return [{ address, chainId }];
  });

  return approvedAccounts.find((account) => account.chainId === targetChainId) ?? approvedAccounts[0];
}
