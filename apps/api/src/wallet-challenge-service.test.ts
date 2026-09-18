import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Wallet } from 'ethers';

import {
  InMemoryChallengeStore,
  WalletChallengeError,
  WalletChallengeService,
} from './wallet-challenge-service.js';

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
