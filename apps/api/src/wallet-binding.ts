import { randomUUID } from 'node:crypto';

import { getAddress } from 'ethers';

export type VerifiedWalletBinding = {
  bindingId: string;
  bindingVersion: number;
  address: string;
  chainId: number;
  verifiedAt: string;
};

export interface WalletBindingStore {
  recordVerified(input: {
    accountId: string;
    address: string;
    chainId: number;
    verifiedAt?: Date;
  }): Promise<VerifiedWalletBinding>;
  getActive(accountId: string): Promise<VerifiedWalletBinding | undefined>;
  disconnect(input: {
    accountId: string;
    bindingId: string;
    bindingVersion: number;
  }): Promise<void>;
}

export type WalletBindingErrorCode =
  | 'WALLET_ADDRESS_IN_USE'
  | 'WALLET_BINDING_NOT_FOUND'
  | 'WALLET_BINDING_CHANGED';

export class WalletBindingError extends Error {
  constructor(readonly code: WalletBindingErrorCode) {
    super(code);
    this.name = 'WalletBindingError';
  }
}

type MemoryBinding = VerifiedWalletBinding & {
  accountId: string;
  addressNormalized: string;
  status: 'VERIFIED' | 'DISCONNECTED';
};

export class InMemoryWalletBindingStore implements WalletBindingStore {
  readonly #bindings: MemoryBinding[] = [];

  constructor(
    private readonly options: {
      now?: () => Date;
      nextId?: () => string;
    } = {},
  ) {}

  async recordVerified(input: {
    accountId: string;
    address: string;
    chainId: number;
    verifiedAt?: Date;
  }): Promise<VerifiedWalletBinding> {
    const address = getAddress(input.address);
    const normalized = address.toLowerCase();
    const verifiedAt = (input.verifiedAt ?? this.options.now?.() ?? new Date()).toISOString();
    const activeForAccount = this.#bindings.find(
      (binding) => binding.accountId === input.accountId && binding.status === 'VERIFIED',
    );
    if (
      activeForAccount &&
      activeForAccount.addressNormalized === normalized &&
      activeForAccount.chainId === input.chainId
    ) {
      activeForAccount.verifiedAt = verifiedAt;
      return publicBinding(activeForAccount);
    }
    const activeForAddress = this.#bindings.find(
      (binding) =>
        binding.addressNormalized === normalized &&
        binding.chainId === input.chainId &&
        binding.status === 'VERIFIED',
    );
    if (activeForAddress && activeForAddress.accountId !== input.accountId) {
      throw new WalletBindingError('WALLET_ADDRESS_IN_USE');
    }
    if (activeForAccount) activeForAccount.status = 'DISCONNECTED';
    const version = Math.max(
      0,
      ...this.#bindings
        .filter((binding) => binding.accountId === input.accountId)
        .map((binding) => binding.bindingVersion),
    ) + 1;
    const binding: MemoryBinding = {
      bindingId: this.options.nextId?.() ?? randomUUID(),
      bindingVersion: version,
      address,
      addressNormalized: normalized,
      chainId: input.chainId,
      verifiedAt,
      accountId: input.accountId,
      status: 'VERIFIED',
    };
    this.#bindings.push(binding);
    return publicBinding(binding);
  }

  async getActive(accountId: string): Promise<VerifiedWalletBinding | undefined> {
    const binding = this.#bindings.find(
      (candidate) => candidate.accountId === accountId && candidate.status === 'VERIFIED',
    );
    return binding ? publicBinding(binding) : undefined;
  }

  async disconnect(input: {
    accountId: string;
    bindingId: string;
    bindingVersion: number;
  }): Promise<void> {
    const binding = this.#bindings.find(
      (candidate) => candidate.bindingId === input.bindingId && candidate.accountId === input.accountId,
    );
    if (!binding) throw new WalletBindingError('WALLET_BINDING_NOT_FOUND');
    if (binding.bindingVersion !== input.bindingVersion || binding.status !== 'VERIFIED') {
      throw new WalletBindingError('WALLET_BINDING_CHANGED');
    }
    binding.status = 'DISCONNECTED';
  }
}

function publicBinding(binding: MemoryBinding): VerifiedWalletBinding {
  return {
    bindingId: binding.bindingId,
    bindingVersion: binding.bindingVersion,
    address: binding.address,
    chainId: binding.chainId,
    verifiedAt: binding.verifiedAt,
  };
}
