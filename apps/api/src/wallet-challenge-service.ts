import { getAddress, verifyMessage } from 'ethers';
import { SiweMessage } from 'siwe';

import {
  InMemoryWalletBindingStore,
  WalletBindingError,
  type WalletBindingStore,
  type VerifiedWalletBinding,
} from './wallet-binding.js';

type ChallengeStatus = 'pending' | 'verifying' | 'used';

type ChallengeRecord = {
  challengeId: string;
  accountId: string;
  address: string;
  chainId: number;
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
  status: ChallengeStatus;
};

export type IssuedWalletChallenge = Pick<
  ChallengeRecord,
  'challengeId' | 'address' | 'chainId' | 'message' | 'expiresAt'
>;

export type VerifiedWalletChallenge = {
  verifiedAddress: string;
  walletLinkVersion: string;
  walletBindingId: string;
  bindingVersion: number;
  verifiedAt: string;
};

export class WalletChallengeError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'WalletChallengeError';
  }
}

export class InMemoryChallengeStore {
  readonly #records = new Map<string, ChallengeRecord>();

  create(record: ChallengeRecord): void {
    if (this.#records.has(record.challengeId)) {
      throw new WalletChallengeError('CHALLENGE_ID_CONFLICT');
    }
    this.#records.set(record.challengeId, record);
  }

  get(challengeId: string): ChallengeRecord | undefined {
    return this.#records.get(challengeId);
  }

  claim(challengeId: string): void {
    const record = this.#required(challengeId);
    if (record.status === 'used') {
      throw new WalletChallengeError('NONCE_ALREADY_USED');
    }
    if (record.status === 'verifying') {
      throw new WalletChallengeError('NONCE_IN_PROGRESS');
    }
    record.status = 'verifying';
  }

  release(challengeId: string): void {
    const record = this.#required(challengeId);
    if (record.status === 'verifying') {
      record.status = 'pending';
    }
  }

  consume(challengeId: string): void {
    const record = this.#required(challengeId);
    if (record.status !== 'verifying') {
      throw new WalletChallengeError('NONCE_NOT_CLAIMED');
    }
    record.status = 'used';
  }

  #required(challengeId: string): ChallengeRecord {
    const record = this.#records.get(challengeId);
    if (!record) {
      throw new WalletChallengeError('CHALLENGE_NOT_FOUND');
    }
    return record;
  }
}

type WalletChallengeServiceOptions = {
  store: InMemoryChallengeStore;
  domain: string;
  uri: string;
  chainId: number;
  ttlMs: number;
  now?: () => Date;
  nonce?: () => string;
  challengeId?: () => string;
  bindingStore?: WalletBindingStore;
};

type CreateChallengeInput = {
  accountId: string;
  address: string;
  chainId: number;
};

type VerifyChallengeInput = {
  accountId: string;
  challengeId: string;
  message: string;
  signature: string;
  currentAddress: string;
};

export class WalletChallengeService {
  readonly #store: InMemoryChallengeStore;
  readonly #domain: string;
  readonly #uri: string;
  readonly #chainId: number;
  readonly #ttlMs: number;
  readonly #now: () => Date;
  readonly #nonce: () => string;
  readonly #challengeId: () => string;
  readonly #bindingStore: WalletBindingStore;

  constructor(options: WalletChallengeServiceOptions) {
    validateServiceOptions(options);
    this.#store = options.store;
    this.#domain = options.domain;
    this.#uri = options.uri;
    this.#chainId = options.chainId;
    this.#ttlMs = options.ttlMs;
    this.#now = options.now ?? (() => new Date());
    this.#nonce = options.nonce ?? defaultNonce;
    this.#challengeId = options.challengeId ?? defaultChallengeId;
    this.#bindingStore = options.bindingStore ?? new InMemoryWalletBindingStore();
  }

  async createChallenge(input: CreateChallengeInput): Promise<IssuedWalletChallenge> {
    if (!input.accountId.trim()) {
      throw new WalletChallengeError('ACCOUNT_REQUIRED');
    }
    if (input.chainId !== this.#chainId) {
      throw new WalletChallengeError('CHAIN_NOT_ALLOWED');
    }

    const address = normalizeAddress(input.address);
    const issuedAt = this.#now();
    const expiresAt = new Date(issuedAt.getTime() + this.#ttlMs);
    const nonce = this.#nonce();
    const challengeId = this.#challengeId();

    if (!/^[A-Za-z0-9]{8,}$/.test(nonce)) {
      throw new WalletChallengeError('INVALID_NONCE');
    }

    const siwe = new SiweMessage({
      domain: this.#domain,
      address,
      statement: 'Verify the wallet address for Wolgye Mascot NFT delivery.',
      uri: this.#uri,
      version: '1',
      chainId: this.#chainId,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expiresAt.toISOString(),
      requestId: challengeId,
    });
    const message = siwe.prepareMessage();

    const record: ChallengeRecord = {
      challengeId,
      accountId: input.accountId,
      address,
      chainId: this.#chainId,
      nonce,
      message,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: 'pending',
    };
    this.#store.create(record);

    return {
      challengeId,
      address,
      chainId: this.#chainId,
      message,
      expiresAt: record.expiresAt,
    };
  }

  async verifyChallenge(input: VerifyChallengeInput): Promise<VerifiedWalletChallenge> {
    if (!input.signature.trim()) {
      throw new WalletChallengeError('SIGNATURE_REQUIRED');
    }

    const record = this.#store.get(input.challengeId);
    if (!record) {
      throw new WalletChallengeError('CHALLENGE_NOT_FOUND');
    }
    if (record.status === 'used') {
      throw new WalletChallengeError('NONCE_ALREADY_USED');
    }
    if (record.accountId !== input.accountId) {
      throw new WalletChallengeError('ACCOUNT_MISMATCH');
    }
    if (record.message !== input.message) {
      throw new WalletChallengeError('MESSAGE_MISMATCH');
    }

    const currentAddress = normalizeAddress(input.currentAddress);
    if (currentAddress !== record.address) {
      throw new WalletChallengeError('WALLET_CHANGED');
    }

    const now = this.#now();
    if (now.getTime() >= new Date(record.expiresAt).getTime()) {
      throw new WalletChallengeError('SIGNATURE_EXPIRED');
    }

    const parsed = parseAndMatchMessage(record, input.message, this.#domain, this.#uri);
    this.#store.claim(record.challengeId);

    try {
      const verification = await parsed.verify(
        {
          signature: input.signature,
          domain: this.#domain,
          nonce: record.nonce,
          time: now.toISOString(),
        },
        { suppressExceptions: true },
      );
      if (!verification.success) {
        throw new WalletChallengeError('SIGNER_MISMATCH');
      }

      const recoveredAddress = normalizeAddress(verifyMessage(input.message, input.signature));
      if (recoveredAddress !== record.address || normalizeAddress(verification.data.address) !== record.address) {
        throw new WalletChallengeError('SIGNER_MISMATCH');
      }

      const binding = await this.#bindingStore.recordVerified({
        accountId: record.accountId,
        address: record.address,
        chainId: record.chainId,
        verifiedAt: now,
      });
      this.#store.consume(record.challengeId);
      return {
        verifiedAddress: record.address,
        walletLinkVersion: record.challengeId,
        walletBindingId: binding.bindingId,
        bindingVersion: binding.bindingVersion,
        verifiedAt: binding.verifiedAt,
      };
    } catch (error) {
      this.#store.release(record.challengeId);
      if (error instanceof WalletChallengeError) {
        throw error;
      }
      if (error instanceof WalletBindingError) {
        throw new WalletChallengeError(error.code);
      }
      throw new WalletChallengeError('SIGNER_MISMATCH');
    }
  }

  async disconnectBinding(input: {
    accountId: string;
    bindingId: string;
    bindingVersion: number;
  }): Promise<void> {
    try {
      await this.#bindingStore.disconnect(input);
    } catch (error) {
      if (error instanceof WalletBindingError) {
        throw new WalletChallengeError(error.code);
      }
      throw error;
    }
  }

  getActiveBinding(accountId: string): Promise<VerifiedWalletBinding | undefined> {
    return this.#bindingStore.getActive(accountId);
  }
}

function parseAndMatchMessage(
  record: ChallengeRecord,
  message: string,
  domain: string,
  uri: string,
): SiweMessage {
  let parsed: SiweMessage;
  try {
    parsed = new SiweMessage(message);
  } catch {
    throw new WalletChallengeError('MALFORMED_MESSAGE');
  }

  const exactMatch =
    parsed.domain === domain &&
    parsed.address === record.address &&
    parsed.uri === uri &&
    parsed.version === '1' &&
    parsed.chainId === record.chainId &&
    parsed.nonce === record.nonce &&
    parsed.issuedAt === record.issuedAt &&
    parsed.expirationTime === record.expiresAt &&
    parsed.requestId === record.challengeId;

  if (!exactMatch) {
    throw new WalletChallengeError('MESSAGE_FIELDS_MISMATCH');
  }
  return parsed;
}

function normalizeAddress(address: string): string {
  try {
    return getAddress(address);
  } catch {
    throw new WalletChallengeError('INVALID_ADDRESS');
  }
}

function validateServiceOptions(options: WalletChallengeServiceOptions): void {
  try {
    const uri = new URL(options.uri);
    const valid =
      uri.protocol === 'https:' &&
      uri.host === options.domain &&
      Number.isInteger(options.chainId) &&
      options.chainId > 0 &&
      Number.isFinite(options.ttlMs) &&
      options.ttlMs > 0 &&
      options.ttlMs <= 10 * 60 * 1000;
    if (!valid) {
      throw new Error('invalid service config');
    }
  } catch {
    throw new WalletChallengeError('INVALID_SERVICE_CONFIG');
  }
}

function defaultNonce(): string {
  return crypto.getRandomValues(new Uint8Array(16)).reduce((value, byte) => value + byte.toString(16).padStart(2, '0'), '');
}

function defaultChallengeId(): string {
  return crypto.randomUUID();
}
