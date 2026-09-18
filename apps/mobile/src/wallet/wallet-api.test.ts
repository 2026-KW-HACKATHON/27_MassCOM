import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WalletApiClient, WalletApiError } from './wallet-api';

test('sends the account boundary and Base Sepolia challenge request', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = new WalletApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'demo-user-1',
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json(
        {
          challengeId: 'challenge-1',
          address: '0x0000000000000000000000000000000000000001',
          chainId: 84532,
          message: 'message',
          expiresAt: '2026-09-18T00:05:00.000Z',
        },
        { status: 201 },
      );
    },
  });

  const result = await client.createChallenge('0x0000000000000000000000000000000000000001');

  assert.equal(result.challengeId, 'challenge-1');
  assert.equal(requests[0]?.url, 'https://api.example.test/wallet/challenges');
  assert.equal(new Headers(requests[0]?.init?.headers).get('x-account-id'), 'demo-user-1');
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    address: '0x0000000000000000000000000000000000000001',
    chainId: 84532,
  });
});

test('preserves the server error code for recovery UI', async () => {
  const client = new WalletApiClient({
    apiUrl: 'https://api.example.test',
    accountId: 'demo-user-1',
    fetcher: async () => Response.json({ code: 'SIGNATURE_EXPIRED' }, { status: 410 }),
  });

  await assert.rejects(
    client.verifyChallenge({
      challengeId: 'challenge-1',
      message: 'message',
      signature: '0xsigned',
      currentAddress: '0x0000000000000000000000000000000000000001',
    }),
    (error: unknown) =>
      error instanceof WalletApiError && error.code === 'SIGNATURE_EXPIRED' && error.status === 410,
  );
});
