import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMerchantApiClient, MerchantApiError } from './merchant-api';

const merchantPayload = {
  merchants: [
    {
      id: 'merchant-1',
      name: '월계식당',
      story: '',
      roadAddress: '서울 노원구 월계로 1',
      minimumSpendWon: 10_000,
      businessHours: '월–금 10:00–18:00',
      menuItems: [{ name: '김밥', priceWon: 4500 }],
      demo: true,
      artUrl: null,
      category: '분식',
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

test('accepts genuinely empty story, menu, and hours without inventing operating content', async () => {
  const client = createMerchantApiClient('https://api.example.test', async () => Response.json({
    merchants: [{ ...merchantPayload.merchants[0], menuItems: [], businessHours: '' }],
  }));
  assert.deepEqual((await client.listMerchants())[0]?.menuItems, []);
  assert.equal((await client.listMerchants())[0]?.businessHours, '');
});

test('older operating and demo catalogs without menu or hours remain readable', async () => {
  const legacyMerchants = [false, true].map(demo => ({
    id: demo ? 'demo-old' : 'real-old', name: '기존 점포', story: '기존 소개',
    roadAddress: '서울 노원구', minimumSpendWon: 1000, demo,
    campaign: merchantPayload.merchants[0]!.campaign,
  }));
  const client = createMerchantApiClient('https://api.example.test', async () =>
    Response.json({ merchants: legacyMerchants }));
  assert.deepEqual(await client.listMerchants(), legacyMerchants.map(merchant => ({
    ...merchant, menuItems: [], businessHours: '', artUrl: null, category: null,
  })));
});

test('rejects malformed menu prices and hours', async () => {
  for (const merchant of [
    { ...merchantPayload.merchants[0], menuItems: [{ name: '김밥', priceWon: '4500' }] },
    { ...merchantPayload.merchants[0], menuItems: null },
    { ...merchantPayload.merchants[0], businessHours: null },
  ]) {
    const client = createMerchantApiClient('https://api.example.test', async () => Response.json({ merchants: [merchant] }));
    await assert.rejects(client.listMerchants(), /음식점 응답 형식/);
  }
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

const artPath = `/merchant-art/${'ab'.repeat(32)}.webp`;

test('keeps an owner-picked art path and turns a missing or foreign one into null', async () => {
  const artUrls = [artPath, undefined, null, '', 'https://evil.example/merchant-art/x.webp', `/merchant-art/${'AB'.repeat(32)}.webp`,
    `/merchant-art/${'ab'.repeat(31)}.webp`, `/merchant-art/${'ab'.repeat(32)}.png`, `${artPath}?x=1`, `/other/${'ab'.repeat(32)}.webp`, `//evil.example${artPath}`, 42, {}];
  const client = createMerchantApiClient('https://api.example.test', async () => Response.json({
    merchants: artUrls.map((artUrl, index) => ({ ...merchantPayload.merchants[0], id: `merchant-${index}`, artUrl })),
  }));
  const parsed = await client.listMerchants();
  assert.equal(parsed[0]?.artUrl, artPath);
  assert.deepEqual(parsed.slice(1).map((merchant) => merchant.artUrl), artUrls.slice(1).map(() => null));
});

test('an older catalog that has no artUrl field still reads, with no art', async () => {
  const { artUrl: _omitted, ...legacy } = merchantPayload.merchants[0]!;
  const client = createMerchantApiClient('https://api.example.test', async () => Response.json({ merchants: [legacy] }));
  assert.equal((await client.listMerchants())[0]?.artUrl, null);
});

test('reads the category, and a missing, null or unknown one becomes null without rejecting the list (#331)', async () => {
  const { category: _omitted, ...legacy } = merchantPayload.merchants[0]!;
  const categories = ['한식', '카페', '기타', undefined, null, '', '프랑스식', 42, {}];
  const client = createMerchantApiClient('https://api.example.test', async () => Response.json({
    merchants: [
      legacy,
      ...categories.map((category, index) => ({ ...merchantPayload.merchants[0], id: `merchant-${index}`, category })),
    ],
  }));
  const parsed = await client.listMerchants();
  assert.equal(parsed[0]?.category, null, 'an older server that has no category field');
  assert.deepEqual(parsed.slice(1).map((merchant) => merchant.category), ['한식', '카페', '기타', null, null, null, null, null, null]);
});
