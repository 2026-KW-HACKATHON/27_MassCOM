import assert from 'node:assert/strict';
import test from 'node:test';

import { createStudioApiClient, parseFriendStudioSnapshot, parseFurnitureSnapshot, parseStudioSnapshot, studioErrorMessage, StudioApiError } from './studio-api';

const studio = { theme: 'daylight', layout: 'shelf', accent: 'mint', slots: ['owned-1'], goal: { kind: 'discover', merchantId: 'shop-1' } };
const item = { entitlementId: 'owned-1', merchantId: 'shop-1', merchantName: '가게', campaignTitle: '방문', displayName: '첫 그림' };

test('self studio keeps only selected entitlement identity and chosen display', () => {
  const parsed = parseStudioSnapshot({ studio, items: [item], avatar: 'cook-cat', records: [], unlockedThemes: ['daylight'] });
  assert.deepEqual(parsed.studio.slots, ['owned-1']);
  assert.equal(parsed.items[0].entitlementId, 'owned-1');
  assert.equal(parsed.avatar, 'cook-cat');
});

test('studio furniture parses legacy defaults and rejects malformed ownership placements', () => {
  const legacy = parseStudioSnapshot({ studio, items: [item], avatar: null, records: [], unlockedThemes: [] });
  assert.deepEqual(legacy.studio.furniture, []);
  assert.equal(legacy.studio.wall, null);
  assert.equal(legacy.studio.floor, null);
  const placed = { ...studio, wall: 'garden', floor: null, furniture: [{ inventoryId: 'owned-chair', x: .25, y: .7, rotation: 90 }] };
  assert.deepEqual(parseStudioSnapshot({ studio: placed, items: [item], avatar: null, records: [], unlockedThemes: [], revision: 2 }).studio.furniture, placed.furniture);
  assert.throws(() => parseStudioSnapshot({ studio: { ...placed, furniture: [{ ...placed.furniture[0], x: 2 }] }, items: [], avatar: null, records: [], unlockedThemes: [] }));
  assert.deepEqual(parseFurnitureSnapshot({ catalog: [{ id: 'chair', name: '의자', kind: 'FURNITURE', assetId: null, priceMileage: null, sellable: false }],
    inventory: [{ id: 'owned-chair', itemId: 'chair' }] }).inventory, [{ id: 'owned-chair', itemId: 'chair' }]);
});

test('source-based coin exhibit stays editable for owner and hides acquisition IDs in public parse', () => {
  const source = { sourceKind: 'REROLL', sourceId: 'reroll-1' } as const;
  const coinItem = { ...source, merchantId: 'shop-1', merchantName: '가게', publicationId: 'coin-1', gradeId: 'silver', name: '실버 코인' };
  const mine = parseStudioSnapshot({ studio: { ...studio, coinSlots: [source] }, items: [item], coinItems: [coinItem],
    avatar: null, records: [], unlockedThemes: [] });
  assert.deepEqual(mine.studio.coinSlots, [source]);
  assert.equal(mine.coinItems[0]?.sourceId, 'reroll-1');
  const visitor = parseFriendStudioSnapshot({ nickname: '이웃', studio: { ...studio, coinSlots: [source] },
    items: [], coinItems: [coinItem], avatar: null });
  assert.equal('coinSlots' in visitor.studio, false);
  assert.equal('sourceId' in visitor.coinItems[0]!, false);
});

test('furniture purchase uses request identity and parses the resulting inventory ID', async () => {
  let body: unknown;
  const client = createStudioApiClient({ apiUrl: 'https://api.test', credential: { kind: 'bearer', sessionToken: 'session' },
    fetcher: async (_, init) => { body = JSON.parse(String(init?.body));
      return Response.json({ inventoryItem: { id: 'owned-chair', itemId: 'oak-chair' }, balance: 25, replayed: false }); },
  });
  assert.deepEqual((await client.purchaseFurniture('oak-chair', 'request-1')).inventoryItem, { id: 'owned-chair', itemId: 'oak-chair' });
  assert.deepEqual(body, { itemId: 'oak-chair', requestId: 'request-1' });
});

test('studio parses an exact wanted collectible and rejects an incomplete target', () => {
  const goal = { kind: 'collectible', merchantId: 'shop-1', campaignId: 'campaign-1',
    publicationId: 'publication-1', targetVisitCount: 3 };
  assert.deepEqual(parseStudioSnapshot({ studio: { ...studio, goal }, items: [item], avatar: null, records: [], unlockedThemes: [] }).studio.goal, goal);
  for (const invalid of [{ ...goal, publicationId: '' }, { ...goal, campaignId: undefined }, { ...goal, targetVisitCount: 2 }]) {
    assert.throws(() => parseStudioSnapshot({ studio: { ...studio, goal: invalid }, items: [item], avatar: null, records: [], unlockedThemes: [] }));
  }
});

test('friend studio drops accidental entitlement IDs even if present in response', () => {
  const parsed = parseFriendStudioSnapshot({ nickname: '친구', studio, items: [item], avatar: null });
  assert.equal('slots' in parsed.studio, false);
  assert.equal('entitlementId' in parsed.items[0], false);
});

test('friend clothing accepts only a bounded optional public item id', () => {
  const base = { nickname: '친구', studio, items: [], avatar: 'cook-cat' };
  assert.equal(parseFriendStudioSnapshot(base).avatarClothingId, undefined);
  assert.equal(parseFriendStudioSnapshot({ ...base, avatarClothingId: null }).avatarClothingId, null);
  assert.equal(parseFriendStudioSnapshot({ ...base, avatarClothingId: 'green-apron' }).avatarClothingId, 'green-apron');
  for (const id of ['', 42, {}, 'x'.repeat(81)]) {
    assert.throws(() => parseFriendStudioSnapshot({ ...base, avatarClothingId: id }));
  }
});

test('friend room link is accepted only as a real room identifier', () => {
  const base = { nickname: '친구', studio, items: [], avatar: null };
  assert.equal(parseFriendStudioSnapshot({ ...base, roomId: 'room-1' }).roomId, 'room-1');
  assert.equal(parseFriendStudioSnapshot({ ...base, roomId: null }).roomId, null);
  assert.throws(() => parseFriendStudioSnapshot({ ...base, roomId: 42 }));
});

test('studio rejects duplicate or excessive owned slots', () => {
  assert.throws(() => parseStudioSnapshot({ studio: { ...studio, slots: ['owned-1', 'owned-1'] }, items: [], avatar: null, records: [], unlockedThemes: ['daylight'] }));
  assert.throws(() => parseStudioSnapshot({ studio: { ...studio, slots: Array.from({ length: 7 }, (_, index) => `${index}`) }, items: [], avatar: null, records: [], unlockedThemes: ['daylight'] }));
});

test('studio retains 403 CONSENT_REQUIRED on own and friend reads and explains re-consent in Korean', async () => {
  const api = createStudioApiClient({ apiUrl: 'https://api.test',
    credential: { kind: 'bearer', sessionToken: 'test-session' },
    fetcher: async () => Response.json({ code: 'CONSENT_REQUIRED' }, { status: 403 }) });
  for (const read of [() => api.getMine(), () => api.getFriend('friend-1')]) {
    await assert.rejects(read, (error) => error instanceof StudioApiError
      && error.status === 403 && error.code === 'CONSENT_REQUIRED'
      && studioErrorMessage(error) === '개인정보 처리방침이 바뀌어 다시 동의가 필요해요.');
  }
});


test('studio keeps version two records separate and rejects malformed counts', () => {
  const payload = { studio, items: [item], avatar: null, records: [{ kind: 'stack', bestScore: 999, plays: 12, version2BestScore: 20, version2Plays: 1 }], unlockedThemes: ['daylight'] };
  assert.deepEqual(parseStudioSnapshot(payload).records, payload.records);
  assert.throws(() => parseStudioSnapshot({ ...payload, records: [{ ...payload.records[0], version2Plays: -1 }] }));
  for (const version2BestScore of [Infinity, -1, .5, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.throws(() => parseStudioSnapshot({ ...payload, records: [{ ...payload.records[0], version2BestScore }] }));
  }
  assert.throws(() => parseStudioSnapshot({ ...payload, records: [{ ...payload.records[0], version2Plays: 13 }] }));
  assert.throws(() => parseStudioSnapshot({ ...payload, records: [{ kind: 'stack', bestScore: 0, plays: 0, version2BestScore: 0 }] }));
});
