import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WalletApiClient, WalletApiError } from './wallet-api';
import * as walletApiModule from './wallet-api';

type ActiveBindingMatcher = (
  response: walletApiModule.ActiveWalletBindingResponse,
  connectedAddress: string,
  chainId: number,
) => string | undefined;

test('the default fetcher works called as this.#fetcher(...), not just as a bare function (#309 web)', async () => {
  // A real browser's native fetch brand-checks its receiver and throws "Illegal invocation" unless
  // bound to window first; Node's fetch never checks this, so a mocked fetcher elsewhere in this
  // file would never catch a regression. This replaces the global to reproduce that browser check.
  const originalFetch = globalThis.fetch;
  function brandCheckedFetch(this: unknown) {
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(Response.json({ binding: null }));
  }
  globalThis.fetch = brandCheckedFetch as typeof fetch;
  try {
    const client = new WalletApiClient({
      apiUrl: 'https://api.example.test',
      credential: { kind: 'bearer', sessionToken: 'server-session' },
    });
    assert.deepEqual(await client.getActiveBinding(), { binding: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sends the account boundary and Base Sepolia challenge request', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = new WalletApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'server-session' },
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
  const challengeHeaders = new Headers(requests[0]?.init?.headers);
  assert.equal(challengeHeaders.get('authorization'), 'Bearer server-session');
  assert.equal(challengeHeaders.has('x-account-id'), false);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    address: '0x0000000000000000000000000000000000000001',
    chainId: 84532,
  });
});

test('preserves the server error code for recovery UI', async () => {
  const client = new WalletApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'demo', accountId: 'demo-user-1', allowInsecureReauthentication: false },
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

test('invalidates a rejected bearer session once', async () => {
  let invalidations = 0;
  const client = new WalletApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'expired-session' },
    onSessionInvalid: async () => { invalidations += 1; },
    fetcher: async () => Response.json({ code: 'SESSION_INVALID' }, { status: 401 }),
  });
  await assert.rejects(client.getActiveBinding(), /SESSION_INVALID/);
  assert.equal(invalidations, 1);
});

test('reads and disconnects the server wallet binding version', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const binding = {
    bindingId: 'binding-1',
    bindingVersion: 2,
    address: '0x0000000000000000000000000000000000000001',
    chainId: 84532 as const,
    verifiedAt: '2026-09-19T00:00:00.000Z',
  };
  const client = new WalletApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'demo', accountId: 'demo-user-1', allowInsecureReauthentication: false },
    fetcher: async (url, init) => {
      requests.push({ url: String(url), init });
      return String(url).endsWith('/active-binding')
        ? Response.json({ binding })
        : Response.json({ status: 'DISCONNECTED' });
    },
  });

  assert.deepEqual(await client.getActiveBinding(), { binding });
  assert.deepEqual(await client.disconnectBinding(binding.bindingId, binding.bindingVersion), {
    status: 'DISCONNECTED',
  });
  assert.equal(requests[0]?.url, 'https://api.example.test/wallets/active-binding');
  assert.equal(new Headers(requests[0]?.init?.headers).get('x-account-id'), 'demo-user-1');
  assert.equal(new Headers(requests[0]?.init?.headers).has('authorization'), false);
  assert.equal(requests[1]?.url, 'https://api.example.test/wallets/binding-1/binding');
  assert.equal(requests[1]?.init?.method, 'DELETE');
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), { bindingVersion: 2 });
});

test('restores the verified address when the active binding matches the wallet session', () => {
  const matchActiveBinding = (
    walletApiModule as typeof walletApiModule & { matchActiveBinding?: ActiveBindingMatcher }
  ).matchActiveBinding;
  const address = '0x00000000000000000000000000000000000000Aa';

  assert.equal(
    matchActiveBinding?.(
      {
        binding: {
          bindingId: 'binding-1',
          bindingVersion: 1,
          address,
          chainId: 84532,
          verifiedAt: '2026-09-21T06:19:00.000Z',
        },
      },
      address.toLowerCase(),
      84532,
    ),
    address,
  );
});

test('does not restore a binding for a different wallet address or chain', () => {
  const matchActiveBinding = (
    walletApiModule as typeof walletApiModule & { matchActiveBinding?: ActiveBindingMatcher }
  ).matchActiveBinding;
  const response: walletApiModule.ActiveWalletBindingResponse = {
    binding: {
      bindingId: 'binding-1',
      bindingVersion: 1,
      address: '0x00000000000000000000000000000000000000Aa',
      chainId: 84532,
      verifiedAt: '2026-09-21T06:19:00.000Z',
    },
  };

  assert.equal(
    matchActiveBinding?.(response, '0x00000000000000000000000000000000000000Bb', 84532),
    undefined,
  );
  assert.equal(
    matchActiveBinding?.(response, '0x00000000000000000000000000000000000000Aa', 1),
    undefined,
  );
});
