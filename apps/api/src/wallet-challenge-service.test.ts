import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Wallet } from 'ethers';

import {
  InMemoryChallengeStore,
  WalletChallengeError,
  WalletChallengeService,
} from './wallet-challenge-service.js';
import { InMemoryWalletBindingStore } from './wallet-binding.js';

const domain = 'api.masscom.local';
const uri = 'https://api.masscom.local/wallet/verify';
const chainId = 84532;
const accountId = 'user-001';

function createFixture() {
  let now = new Date('2026-09-18T00:00:00.000Z');
  let nonceIndex = 0;
  const nonces = ['abc12345def67890', 'fedcba9876543210'];

  const service = new WalletChallengeService({
    store: new InMemoryChallengeStore(),
    domain,
    uri,
    chainId,
    ttlMs: 5 * 60 * 1000,
    now: () => now,
    nonce: () => nonces[nonceIndex++]!,
    challengeId: () => `challenge-${nonceIndex}`,
    bindingStore: new InMemoryWalletBindingStore({
      now: () => now,
      nextId: () => `binding-${nonceIndex}`,
    }),
  });

  return {
    service,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

test('creates an account-bound Base Sepolia SIWE challenge', async () => {
  const wallet = Wallet.createRandom();
  const { service } = createFixture();

  const challenge = await service.createChallenge({
    accountId,
    address: wallet.address,
    chainId,
  });

  assert.equal(challenge.address, wallet.address);
  assert.equal(challenge.chainId, chainId);
  assert.match(challenge.message, new RegExp(`^${domain} wants you to sign in with your Ethereum account:`));
  assert.match(challenge.message, /Verify the wallet address for Wolgye Mascot NFT delivery\./);
  assert.match(challenge.message, new RegExp(`URI: ${uri}`));
  assert.match(challenge.message, /Version: 1/);
  assert.match(challenge.message, /Chain ID: 84532/);
  assert.match(challenge.message, /Nonce: abc12345def67890/);
  assert.equal(challenge.expiresAt, '2026-09-18T00:05:00.000Z');
});

test('verifies the signer and consumes the challenge once', async () => {
  const wallet = Wallet.createRandom();
  const { service } = createFixture();
  const challenge = await service.createChallenge({ accountId, address: wallet.address, chainId });
  const signature = await wallet.signMessage(challenge.message);

  const verification = await service.verifyChallenge({
    accountId,
    challengeId: challenge.challengeId,
    message: challenge.message,
    signature,
    currentAddress: wallet.address,
  });

  assert.equal(verification.verifiedAddress, wallet.address);
  assert.equal(verification.walletLinkVersion, challenge.challengeId);
  assert.equal(verification.walletBindingId, 'binding-1');
  assert.equal(verification.bindingVersion, 1);

  await assert.rejects(
    service.verifyChallenge({
      accountId,
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature,
      currentAddress: wallet.address,
    }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'NONCE_ALREADY_USED',
  );
});

test('rejects a connected account when no signature is supplied', async () => {
  const wallet = Wallet.createRandom();
  const { service } = createFixture();
  const challenge = await service.createChallenge({ accountId, address: wallet.address, chainId });

  await assert.rejects(
    service.verifyChallenge({
      accountId,
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature: '',
      currentAddress: wallet.address,
    }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'SIGNATURE_REQUIRED',
  );
});

test('rejects a challenge after its five-minute expiration', async () => {
  const wallet = Wallet.createRandom();
  const fixture = createFixture();
  const challenge = await fixture.service.createChallenge({ accountId, address: wallet.address, chainId });
  const signature = await wallet.signMessage(challenge.message);
  fixture.setNow('2026-09-18T00:05:00.001Z');

  await assert.rejects(
    fixture.service.verifyChallenge({
      accountId,
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature,
      currentAddress: wallet.address,
    }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'SIGNATURE_EXPIRED',
  );
});

test('treats the exact expiration instant as expired', async () => {
  const wallet = Wallet.createRandom();
  const fixture = createFixture();
  const challenge = await fixture.service.createChallenge({ accountId, address: wallet.address, chainId });
  const signature = await wallet.signMessage(challenge.message);
  fixture.setNow('2026-09-18T00:05:00.000Z');

  await assert.rejects(
    fixture.service.verifyChallenge({
      accountId,
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature,
      currentAddress: wallet.address,
    }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'SIGNATURE_EXPIRED',
  );
});

test('rejects the wrong domain or any message that differs from the issued challenge', async () => {
  const wallet = Wallet.createRandom();
  const { service } = createFixture();
  const challenge = await service.createChallenge({ accountId, address: wallet.address, chainId });
  const tamperedMessage = challenge.message.replace(domain, 'attacker.example');
  const signature = await wallet.signMessage(tamperedMessage);

  await assert.rejects(
    service.verifyChallenge({
      accountId,
      challengeId: challenge.challengeId,
      message: tamperedMessage,
      signature,
      currentAddress: wallet.address,
    }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'MESSAGE_MISMATCH',
  );
});

test('rejects signatures made by a different wallet', async () => {
  const expectedWallet = Wallet.createRandom();
  const differentWallet = Wallet.createRandom();
  const { service } = createFixture();
  const challenge = await service.createChallenge({ accountId, address: expectedWallet.address, chainId });
  const signature = await differentWallet.signMessage(challenge.message);

  await assert.rejects(
    service.verifyChallenge({
      accountId,
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature,
      currentAddress: expectedWallet.address,
    }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'SIGNER_MISMATCH',
  );
});

test('rejects verification under a different service account', async () => {
  const wallet = Wallet.createRandom();
  const { service } = createFixture();
  const challenge = await service.createChallenge({ accountId, address: wallet.address, chainId });
  const signature = await wallet.signMessage(challenge.message);

  await assert.rejects(
    service.verifyChallenge({
      accountId: 'different-user',
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature,
      currentAddress: wallet.address,
    }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'ACCOUNT_MISMATCH',
  );
});

test('rejects verification when the selected wallet address changes before signing returns', async () => {
  const requestedWallet = Wallet.createRandom();
  const changedWallet = Wallet.createRandom();
  const { service } = createFixture();
  const challenge = await service.createChallenge({ accountId, address: requestedWallet.address, chainId });
  const signature = await requestedWallet.signMessage(challenge.message);

  await assert.rejects(
    service.verifyChallenge({
      accountId,
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature,
      currentAddress: changedWallet.address,
    }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'WALLET_CHANGED',
  );
});

test('rejects chains other than Base Sepolia before issuing a challenge', async () => {
  const wallet = Wallet.createRandom();
  const { service } = createFixture();

  await assert.rejects(
    service.createChallenge({ accountId, address: wallet.address, chainId: 8453 }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'CHAIN_NOT_ALLOWED',
  );
});

test('rejects an insecure SIWE URI at service configuration time', () => {
  assert.throws(
    () =>
      new WalletChallengeService({
        store: new InMemoryChallengeStore(),
        domain,
        uri: 'http://api.masscom.local/wallet/verify',
        chainId,
        ttlMs: 5 * 60 * 1000,
      }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'INVALID_SERVICE_CONFIG',
  );
});

test('a consume failure after the binding is recorded never reopens the nonce for replay', async () => {
  const wallet = Wallet.createRandom();
  const store = new InMemoryChallengeStore();
  const consume = store.consume.bind(store);
  let failConsume = true;
  store.consume = async (challengeId) => {
    if (failConsume) throw new Error('database unavailable');
    await consume(challengeId);
  };
  const service = new WalletChallengeService({
    store,
    domain,
    uri,
    chainId,
    ttlMs: 5 * 60 * 1000,
    now: () => new Date('2026-09-18T00:00:00.000Z'),
    nonce: () => 'abc12345def67890',
    challengeId: () => 'challenge-consume-failure',
  });
  const challenge = await service.createChallenge({ accountId, address: wallet.address, chainId });
  const input = {
    accountId,
    challengeId: challenge.challengeId,
    message: challenge.message,
    signature: await wallet.signMessage(challenge.message),
    currentAddress: wallet.address,
  };

  await assert.rejects(service.verifyChallenge(input), /database unavailable/);
  failConsume = false;
  await assert.rejects(
    service.verifyChallenge(input),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'NONCE_IN_PROGRESS',
  );
});

test('a challenge removed during verification does not mask the signer failure', async () => {
  const wallet = Wallet.createRandom();
  const store = new InMemoryChallengeStore();
  store.release = async () => {
    throw new WalletChallengeError('CHALLENGE_NOT_FOUND');
  };
  const service = new WalletChallengeService({
    store,
    domain,
    uri,
    chainId,
    ttlMs: 5 * 60 * 1000,
    now: () => new Date('2026-09-18T00:00:00.000Z'),
    nonce: () => 'abc12345def67890',
    challengeId: () => 'challenge-release-failure',
  });
  const challenge = await service.createChallenge({ accountId, address: wallet.address, chainId });

  await assert.rejects(
    service.verifyChallenge({
      accountId,
      challengeId: challenge.challengeId,
      message: challenge.message,
      signature: await Wallet.createRandom().signMessage(challenge.message),
      currentAddress: wallet.address,
    }),
    (error: unknown) => error instanceof WalletChallengeError && error.code === 'SIGNER_MISMATCH',
  );
});
