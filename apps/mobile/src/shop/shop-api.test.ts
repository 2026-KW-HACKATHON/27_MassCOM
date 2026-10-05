import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ShopApiError, createShopApiClient, shopErrorMessage } from './shop-api';

function snapshotBody(overrides: Record<string, unknown> = {}) {
  return {
    mileage: { earned: 500, spent: 100, balance: 400, rules: { visit: 50, newStore: 100, series: 200 } },
    grades: [
      { grade: 'BRONZE', price: 100, total: 3, owned: 1, remaining: 2, probabilityPerItem: 0.5 },
      { grade: 'SILVER', price: 200, total: 3, owned: 0, remaining: 3, probabilityPerItem: 1 / 3 },
      { grade: 'GOLD', price: 400, total: 3, owned: 3, remaining: 0, probabilityPerItem: null },
    ],
    items: [
      { id: 'cook-cat', grade: 'BRONZE', name: '요리사 냥이', owned: true },
      { id: 'cafe-bear', grade: 'BRONZE', name: '카페 곰돌이', owned: false },
    ],
    avatar: 'cook-cat',
    clothing: {
      items: [{ id: 'green-apron', name: '초록 앞치마', owned: true, equipped: true }],
      equipped: 'green-apron',
      draw: { probability: 0.5 },
    },
    drawRewards: { bonusMileage: { min: 10, max: 50, probabilityPerAmount: 1 / 41 } },
    ...overrides,
  };
}

test('parses a GET /shop snapshot', async () => {
  const client = createShopApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input) => {
      assert.equal(String(input), 'https://api.example.test/shop');
      return Response.json(snapshotBody());
    },
  });
  const shop = await client.getShop();
  assert.equal(shop.mileage.balance, 400);
  assert.equal(shop.grades[2]!.probabilityPerItem, null);
  assert.equal(shop.avatar, 'cook-cat');
  assert.equal(shop.items[0]!.owned, true);
  assert.equal(shop.clothing.items[0]!.equipped, true);
  assert.equal(shop.drawRewards.bonusMileage.min, 10);
});

test('showcaseBonus: a missing field means 0, a present one is read as the separate bonus on top of the real balance', async () => {
  const fetchSnapshot = async (mileage: Record<string, unknown>) => createShopApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => Response.json(snapshotBody({ mileage })),
  }).getShop();
  const rules = { visit: 50, newStore: 100, series: 200 };

  const operating = await fetchSnapshot({ earned: 500, spent: 100, balance: 400, rules });
  assert.equal(operating.mileage.showcaseBonus, 0);
  assert.equal(operating.mileage.balance, 400);

  const showcase = await fetchSnapshot({ earned: 500, spent: 100, balance: 100_400, showcaseBonus: 100_000, rules });
  assert.equal(showcase.mileage.showcaseBonus, 100_000);
  assert.equal(showcase.mileage.earned, 500);
  assert.equal(showcase.mileage.balance, 100_400);

  for (const bad of [-1, 1.5, '100000', null, true]) {
    await assert.rejects(
      fetchSnapshot({ earned: 500, spent: 100, balance: 400, showcaseBonus: bad, rules }),
      (error) => error instanceof ShopApiError && error.code === 'INVALID_RESPONSE',
      `showcaseBonus ${JSON.stringify(bad)}`,
    );
  }
});

test('rejects a snapshot that is not the documented shape', async () => {
  const cases: [string, (body: ReturnType<typeof snapshotBody>) => void][] = [
    ['unknown grade letter', (body) => { body.grades[0]!.grade = 'PLATINUM' as never; }],
    ['negative price', (body) => { body.grades[0]!.price = -1; }],
    ['balance not an integer', (body) => { body.mileage.balance = 1.5; }],
    ['missing earn rules', (body) => { (body.mileage as Record<string, unknown>).rules = undefined; }],
    ['item without a name', (body) => { body.items[0] = { ...body.items[0]!, name: '' }; }],
    ['avatar neither string nor null', (body) => { (body as Record<string, unknown>).avatar = 7; }],
  ];
  for (const [label, corrupt] of cases) {
    const body = snapshotBody();
    corrupt(body);
    const client = createShopApiClient({
      apiUrl: 'https://api.example.test',
      credential: { kind: 'bearer', sessionToken: 'session' },
      fetcher: async () => Response.json(body),
    });
    await assert.rejects(
      client.getShop(),
      (error) => error instanceof ShopApiError && error.code === 'INVALID_RESPONSE',
      label,
    );
  }
});

test('getHistory appends the cursor and parses the page', async () => {
  const client = createShopApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input) => {
      assert.equal(String(input), 'https://api.example.test/shop/history?cursor=abc');
      return Response.json({
        mileage: { earned: 500, spent: 100, balance: 400 },
        spends: [{ id: 's1', amount: 100, grade: 'BRONZE', itemId: 'cook-cat', itemName: '요리사 냥이', createdAt: '2026-09-30T00:00:00.000Z' }],
        nextCursor: null,
      });
    },
  });
  const history = await client.getHistory('abc');
  assert.equal(history.spends[0]!.itemName, '요리사 냥이');
  assert.equal(history.nextCursor, null);
});

test('reroll posts grade, requestId and expectedRemaining', async () => {
  const calls: unknown[] = [];
  const client = createShopApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
      return Response.json({
        item: { id: 'cafe-bear', grade: 'BRONZE', name: '카페 곰돌이' },
        bonus: { id: 'cafe-hat', name: '카페 모자', slot: 'hat' },
        balance: 330,
        replayed: false,
        rewards: {
          mileage: { amount: 30, min: 10, max: 50, probabilityPerAmount: 1 / 41 },
          clothing: { awarded: true, duplicate: false, item: { id: 'green-apron', name: '초록 앞치마' }, probability: 0.5 },
          sequence: ['MILEAGE', 'CLOTHING', 'CHARACTER'],
        },
      }, { status: 201 });
    },
  });
  const result = await client.reroll({ grade: 'BRONZE', requestId: 'req-1', expectedRemaining: 2 });
  assert.deepEqual(calls[0], {
    url: 'https://api.example.test/shop/rerolls', method: 'POST',
    body: { grade: 'BRONZE', requestId: 'req-1', expectedRemaining: 2 },
  });
  assert.equal(result.item.id, 'cafe-bear');
  assert.deepEqual(result.bonus, { id: 'cafe-hat', name: '카페 모자', slot: 'hat' });
  assert.equal(result.balance, 330);
  assert.equal(result.replayed, false);
  assert.equal(result.rewards.mileage.amount, 30);
  assert.equal(result.rewards.clothing.item?.id, 'green-apron');
});

test('setAvatar PUTs itemId (or null) and reads the avatar back', async () => {
  const bodies: unknown[] = [];
  const client = createShopApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ avatar: (bodies.at(-1) as { itemId: string | null }).itemId });
    },
  });
  assert.deepEqual(await client.setAvatar('cook-cat'), { avatar: 'cook-cat' });
  assert.deepEqual(await client.setAvatar(null), { avatar: null });
  assert.deepEqual(bodies, [{ itemId: 'cook-cat' }, { itemId: null }]);
});

test('setClothing PUTs itemId (or null) and reads the equipped clothing back', async () => {
  const bodies: unknown[] = [];
  const client = createShopApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ equippedClothing: (bodies.at(-1) as { itemId: string | null }).itemId });
    },
  });
  assert.deepEqual(await client.setClothing('green-apron'), { equippedClothing: 'green-apron' });
  assert.deepEqual(await client.setClothing(null), { equippedClothing: null });
  assert.deepEqual(bodies, [{ itemId: 'green-apron' }, { itemId: null }]);
});


test('maps every documented error status to its code and reads Retry-After only on 429', async () => {
  const responses = [
    Response.json({ code: 'SHOP_INSUFFICIENT_MILEAGE' }, { status: 402 }),
    Response.json({ code: 'SHOP_GRADE_COMPLETE' }, { status: 409 }),
    Response.json({ code: 'SHOP_ITEM_NOT_OWNED' }, { status: 404 }),
    Response.json({ code: 'ACCOUNT_DELETED' }, { status: 410 }),
    Response.json({ code: 'SHOP_RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '120' } }),
  ];
  const client = createShopApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => responses.shift()!,
  });
  const codes: [string, number | undefined][] = [];
  for (let i = 0; i < 5; i += 1) {
    try {
      await client.getShop();
    } catch (error) {
      assert.ok(error instanceof ShopApiError);
      codes.push([error.code, error.retryAfterSeconds]);
    }
  }
  assert.deepEqual(codes, [
    ['SHOP_INSUFFICIENT_MILEAGE', undefined],
    ['SHOP_GRADE_COMPLETE', undefined],
    ['SHOP_ITEM_NOT_OWNED', undefined],
    ['ACCOUNT_DELETED', undefined],
    ['SHOP_RATE_LIMITED', 120],
  ]);
});

test('a thrown fetch becomes NETWORK_ERROR, not an unhandled rejection shape', async () => {
  const client = createShopApiClient({
    apiUrl: 'https://api.example.test',
    credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async () => { throw new TypeError('Network request failed'); },
  });
  await assert.rejects(client.getShop(), (error) => error instanceof ShopApiError && error.code === 'NETWORK_ERROR');
});

test('shopErrorMessage covers every documented code and never leaks a raw status or code', () => {
  const codes = [
    'INVALID_REQUEST', 'SHOP_INSUFFICIENT_MILEAGE', 'SHOP_GRADE_COMPLETE', 'SHOP_STATE_CHANGED',
    'SHOP_REQUEST_CONFLICT', 'SHOP_RATE_LIMITED', 'SHOP_ITEM_NOT_OWNED', 'SHOP_CLOTHING_NOT_OWNED', 'ACCOUNT_DELETED',
    'MILEAGE_SHOP_NOT_CONFIGURED', 'SESSION_INVALID', 'NETWORK_ERROR', 'INVALID_RESPONSE', 'HTTP_500',
  ];
  for (const code of codes) {
    const message = shopErrorMessage(new ShopApiError(0, code));
    assert.equal(typeof message, 'string');
    assert.ok(message.length > 0, code);
    assert.doesNotMatch(message, /HTTP_|^[A-Z_]+$/, code);
  }
  assert.match(shopErrorMessage(new ShopApiError(429, 'SHOP_RATE_LIMITED', 90)), /2분/);
  assert.equal(shopErrorMessage(new Error('plain')), '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
});
