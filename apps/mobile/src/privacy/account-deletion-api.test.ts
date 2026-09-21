import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AccountDeletionApiClient } from './account-deletion-api';

test('requests account deletion through the authenticated API without wallet secrets', async () => {
  let receivedUrl = '';
  let receivedInit: RequestInit | undefined;
  const client = new AccountDeletionApiClient({
    apiUrl: 'https://api.example.test',
    credential: {
      kind: 'demo',
      accountId: 'customer-delete',
      allowInsecureReauthentication: true,
    },
    fetchImpl: async (input, init) => {
      receivedUrl = String(input);
      receivedInit = init;
      return new Response(
        JSON.stringify({
          requestId: '90000000-0000-4000-8000-000000000001',
          status: 'WAITING_FOR_MINT_FINALITY',
          requestedAt: '2026-09-19T15:00:00.000Z',
          completedAt: null,
          cancelledMintJobs: 1,
          pendingMintJobs: 1,
          retainedFinalizedNfts: 1,
          replayed: false,
        }),
        { status: 202, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  const result = await client.requestDeletion();

  assert.equal(receivedUrl, 'https://api.example.test/account-deletion-requests');
  assert.equal(receivedInit?.method, 'POST');
  assert.deepEqual(JSON.parse(String(receivedInit?.body)), {
    confirmation: 'DELETE MY ACCOUNT',
  });
  const headers = new Headers(receivedInit?.headers);
  assert.equal(headers.get('x-account-id'), 'customer-delete');
  assert.equal(headers.get('x-demo-reauthenticated'), 'true');
  assert.equal(headers.has('authorization'), false);
  assert.equal(result.status, 'WAITING_FOR_MINT_FINALITY');
  assert.equal(result.pendingMintJobs, 1);
});

test('does not claim demo reauthentication unless the caller explicitly enables it', async () => {
  let receivedHeaders: Headers | undefined;
  const client = new AccountDeletionApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'server-session' },
    fetchImpl: async (_input, init) => {
      receivedHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          requestId: 'request-2',
          status: 'COMPLETED',
          requestedAt: '2026-09-19T15:00:00.000Z',
          completedAt: '2026-09-19T15:00:00.000Z',
          cancelledMintJobs: 0,
          pendingMintJobs: 0,
          retainedFinalizedNfts: 0,
          replayed: false,
        }),
        { status: 202 },
      );
    },
  });

  await client.requestDeletion();
  assert.equal(receivedHeaders?.get('authorization'), 'Bearer server-session');
  assert.equal(receivedHeaders?.has('x-account-id'), false);
  assert.equal(receivedHeaders?.has('x-demo-reauthenticated'), false);
});

test('rejects malformed deletion status instead of claiming completion', async () => {
  const client = new AccountDeletionApiClient({
    apiUrl: 'https://api.example.test',
    credential: {
      kind: 'demo',
      accountId: 'customer-delete',
      allowInsecureReauthentication: false,
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          requestId: 'request-1',
          status: 'DELETED_FROM_BLOCKCHAIN',
          requestedAt: '2026-09-19T15:00:00.000Z',
          completedAt: null,
          cancelledMintJobs: 0,
          pendingMintJobs: 0,
          retainedFinalizedNfts: 0,
          replayed: false,
        }),
        { status: 202 },
      ),
  });

  await assert.rejects(client.requestDeletion(), /INVALID_ACCOUNT_DELETION_RESPONSE/);
});
