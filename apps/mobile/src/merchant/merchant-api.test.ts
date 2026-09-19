import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMerchantApiClient, MerchantApiError } from './merchant-api';

const merchantPayload = {
  merchants: [
    {
      id: 'merchant-1',
      name: '월계식당',
      story: '동네에서 오래 이어온 한 끼',
      roadAddress: '서울 노원구 월계로 1',
      minimumSpendWon: 10_000,
      demo: true,
      campaign: {
        id: 'campaign-1',
        title: '월계 한 바퀴',
        startsAt: '2026-09-01T00:00:00.000Z',
        endsAt: '2026-09-30T23:59:59.000Z',
        enrollmentStatus: 'OPEN',
        rewardGoals: [
          { targetVisitCount: 1, displayName: '첫 방문 잎새' },
          { targetVisitCount: 3, displayName: '단골 새싹' },
          { targetVisitCount: 5, displayName: '월계수 관' },
        ],
      },
    },
  ],
};

test('returns a validated public merchant list', async () => {
  const client = createMerchantApiClient('https://api.example.test', async (input) => {
    assert.equal(input, 'https://api.example.test/merchants');
    return Response.json(merchantPayload);
  });

  assert.deepEqual(await client.listMerchants(), merchantPayload.merchants);
});

test('rejects malformed merchant payloads instead of rendering unknown data', async () => {
  const client = createMerchantApiClient('https://api.example.test', async () =>
    Response.json({ merchants: [{ ...merchantPayload.merchants[0], minimumSpendWon: '10000' }] }),
  );

  await assert.rejects(client.listMerchants(), /음식점 응답 형식/);
});

test('preserves the HTTP status for user-facing error mapping', async () => {
  const client = createMerchantApiClient('https://api.example.test', async () =>
    Response.json({ message: 'service unavailable' }, { status: 503 }),
  );

  await assert.rejects(client.listMerchants(), (error: unknown) => {
    assert.ok(error instanceof MerchantApiError);
    assert.equal(error.status, 503);
    return true;
  });
});

test('forwards an abort signal to the network request', async () => {
  const controller = new AbortController();
  const client = createMerchantApiClient('https://api.example.test', async (_input, init) => {
    assert.equal(init?.signal, controller.signal);
    return Response.json(merchantPayload);
  });

  await client.listMerchants(controller.signal);
});
