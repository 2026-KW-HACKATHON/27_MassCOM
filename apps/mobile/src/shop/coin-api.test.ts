import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CoinApiError, coinEntryLabel, coinErrorMessage, createCoinApiClient, finalRerollFailure, maskRerollOdds, parseCoinCollection, parseCoinShop, sameRerollOption, sortCoinEntries } from './coin-api';

const ticket = { id: 'ticket-1', poolId: 'pool-1', merchantId: 'merchant-1', eventName: '여름 축제',
  grade: 'SILVER', acquiredAt: '2026-07-01T00:00:00Z', expiresAt: '2026-07-31T00:00:00Z', status: 'UNUSED' };
const coin = { publicationId: 'publication-1', gradeId: 'silver', name: '실버 코인', summary: {},
  quantity: 2, visitQuantity: 1, drawQuantity: 1 };
const pool = { id: 'pool-1', merchantId: 'merchant-1', merchantName: '참여 가게', eventName: '여름 축제',
  grade: 'SILVER', price: 200, purchaseStartsAt: '2026-07-01T00:00:00Z', purchaseEndsAt: '2026-07-20T00:00:00Z',
  useExpiresAt: ticket.expiresAt, perAccountLimit: 2, issuanceCap: 10, issuedCount: 1, status: 'ACTIVE',
  entries: [{ publicationId: coin.publicationId, gradeId: coin.gradeId, name: coin.name, weight: 1, probability: 1, summary: {} }] };

test('odds rows identify the published grade and order canonical grades without moving legacy peers', () => {
  assert.equal(coinEntryLabel({ name: 'QA 도장', gradeId: 'silver', summary: { gradeName: '은빛' } }), 'QA 도장 · 은빛');
  assert.equal(coinEntryLabel({ name: 'QA 도장', gradeId: 'prism' }), 'QA 도장 · 프리즘');
  assert.equal(coinEntryLabel({ name: '옛 코인', gradeId: 'custom' }), '옛 코인');
  const entries = ['bronze', 'gold', 'prism', 'silver', 'legacy-a', 'legacy-b'].map((gradeId) => ({ gradeId }));
  assert.deepEqual(sortCoinEntries(entries).map((entry) => entry.gradeId),
    ['bronze', 'silver', 'gold', 'prism', 'legacy-a', 'legacy-b']);
  assert.equal(entries[1]?.gradeId, 'gold', 'sorting does not mutate the API response');
});

test('shop and collection show server pool odds, ticket rights and duplicate quantities', () => {
  assert.equal(parseCoinShop({ mileage: { earned: 500, spent: 0, balance: 500 }, pools: [pool], tickets: [ticket] }).pools[0]!.entries[0]!.probability, 1);
  assert.equal(parseCoinCollection({ coins: [coin], series: [] }).coins[0]!.quantity, 2);
  assert.throws(() => parseCoinShop({ mileage: { earned: 500, spent: 0, balance: 500 }, pools: [{ ...pool, entries: [{ ...pool.entries[0], probability: 2 }] }], tickets: [] }), /INVALID_COIN_RESPONSE/);
  assert.throws(() => parseCoinCollection({ coins: [{ ...coin, quantity: 1 }], series: [] }), /INVALID_COIN_RESPONSE/);
});

test('shop accepts hidden odds and live shared stock without inventing probabilities', () => {
  const hidden = parseCoinShop({ mileage: { earned: 500, spent: 0, balance: 500 },
    pools: [{ ...pool, cycle: 3, remaining: 49, entries: [] }], tickets: [] });
  assert.equal(hidden.pools[0]?.entries.length, 0);
  assert.equal(hidden.pools[0]?.remaining, 49);
  const visible = parseCoinShop({ mileage: { earned: 500, spent: 0, balance: 500 },
    pools: [{ ...pool, cycle: 3, remaining: 49, entries: [{ ...pool.entries[0], remaining: 20, probability: 20 / 49 }] }], tickets: [ticket] });
  assert.equal(visible.pools[0]?.entries[0]?.remaining, 20);
  assert.throws(() => parseCoinShop({ mileage: { earned: 500, spent: 0, balance: 500 },
    pools: [{ ...pool, remaining: -1 }], tickets: [] }), /INVALID_COIN_RESPONSE/);
});

test('same purchase request yields ticket only; use yields one coin and a stable replay', async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client = createCoinApiClient({ apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'token' },
    fetcher: async (input, init) => {
      calls.push({ path: String(input), body: JSON.parse(String(init?.body)) });
      if (String(input).endsWith('/purchases')) return Response.json({ ticket, balance: 300, replayed: calls.length > 1 });
      return Response.json({ ticket: { ...ticket, status: 'USED' }, coin, replayed: false });
    } });
  const first = await client.purchase('pool-1', 'request-1');
  const replay = await client.purchase('pool-1', 'request-1');
  const used = await client.useTicket(ticket.id);
  assert.equal(first.ticket.id, ticket.id);
  assert.equal('coin' in first, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(calls.slice(0, 2).map((call) => call.body), [
    { poolId: 'pool-1', requestId: 'request-1' }, { poolId: 'pool-1', requestId: 'request-1' },
  ]);
  assert.equal(used.coin.drawQuantity, 1);
  assert.equal(calls[2]!.path, 'https://api.example.test/coin-tickets/ticket-1/use');
});

test('purchase replay accepts signed balance after a visit mileage reversal', async () => {
  const client = createCoinApiClient({ apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'token' },
    fetcher: async () => Response.json({ ticket, balance: -50, replayed: true }) });
  assert.equal((await client.purchase('pool-1', 'request-1')).balance, -50);
});

test('collection keeps unowned album grades and locks pending NFT coin sources', async () => {
  const source = { sourceKind: 'VISIT', sourceId: 'visit-1', publicationId: coin.publicationId,
    gradeId: coin.gradeId, merchantId: 'merchant-1', nftStatus: 'PENDING', rerollEligible: false };
  const value = parseCoinCollection({ coins: [coin], series: [], catalog: [{ merchantId: 'merchant-1',
    merchantName: '참여 가게', types: [{ publicationId: coin.publicationId, name: '컵', grades: [
      { publicationId: coin.publicationId, gradeId: coin.gradeId, name: coin.name, summary: {}, quantity: 2, sources: [source] },
      { publicationId: coin.publicationId, gradeId: 'gold', name: '골드', summary: {}, quantity: 0, sources: [] },
    ] }] }], reroll: { tickets: [], sources: [source], options: [] } });
  assert.equal(value.catalog[0]!.types[0]!.grades[1]!.quantity, 0);
  assert.equal(value.reroll.sources[0]!.rerollEligible, false);
  assert.equal(value.reroll.sources[0]!.nftStatus, 'PENDING');
});

test('collection accepts all reroll tiers and hidden candidate odds', () => {
  const parsed = parseCoinCollection({ coins: [coin], series: [], reroll: {
    tickets: ['NORMAL', 'BRONZE', 'SILVER', 'GOLD'].map((grade) => ({ id: grade, grade, status: 'UNUSED', acquiredAt: '2026-10-09T00:00:00Z' })),
    sources: [], options: [{ poolId: 'pool-1', merchantId: 'merchant-1', merchantName: '참여 가게', eventName: '축제', grade: 'GOLD', entries: [] }],
  } });
  assert.equal(parsed.reroll.tickets.length, 4);
  assert.deepEqual(parsed.reroll.options[0]?.entries, []);
});

test('reroll odds disappear at the exact ticket expiry and after focus clears the last ticket', () => {
  const expiresAt = '2026-10-16T00:00:00.000Z';
  const option = { poolId: 'pool-1', merchantId: 'merchant-1', merchantName: '참여 가게', eventName: '축제',
    grade: 'GOLD' as const, oddsExpiresAt: expiresAt,
    entries: [{ publicationId: 'pub-1', gradeId: 'gold', name: '골드', probability: 1, weight: 1 }] };
  const clock = Date.parse(expiresAt);
  assert.equal(maskRerollOdds([option], clock - 1)[0]?.entries.length, 1);
  assert.equal(maskRerollOdds([option], clock)[0]?.entries.length, 0);
  assert.equal(maskRerollOdds([option], clock - 1, true)[0]?.entries.length, 0);
  assert.equal(maskRerollOdds([option], clock, true)[0]?.poolId, 'pool-1');
  assert.equal(maskRerollOdds([{ ...option, oddsExpiresAt: undefined }], clock - 1)[0]?.entries.length, 0);
  assert.equal(parseCoinCollection({ coins: [], series: [], reroll: { tickets: [], sources: [], options: [option] } })
    .reroll.options[0]?.oddsExpiresAt, expiresAt);
});

test('one pool can offer NORMAL and GOLD rerolls without selecting both rows', () => {
  const normal = { poolId: 'pool-1', grade: 'NORMAL' as const };
  const gold = { poolId: 'pool-1', grade: 'GOLD' as const };
  assert.equal(sameRerollOption(normal, normal), true);
  assert.equal(sameRerollOption(normal, gold), false);
  assert.equal(sameRerollOption(undefined, gold), false);
});

test('owned coin detail uses the collection permission endpoint and parses full artwork', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=';
  let requested = '';
  const detail = { publicationId: 'pub/one', projectId: 'project', gradeId: 'silver', gradeName: '실버', name: '한 잔',
    shape: 'circle', theme: { name: '카페' }, thumbnailDataUrl: png, imageDataUrl: png, thickness: 8, angle: 0,
    animation: 'rotate', greeting: '', audio: null, story: { type: 'none', frames: [], cartoon: 0, strength: 0 }, backImageDataUrl: png };
  const client = createCoinApiClient({ apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'token' },
    fetcher: async (input) => { requested = String(input); return Response.json(detail); } });
  assert.equal((await client.getOwnedDetail('pub/one', 'silver')).backImageDataUrl, png);
  assert.equal(requested, 'https://api.example.test/me/coins/pub%2Fone/grades/silver/detail');
});

test('reroll sends the disclosed pool and stable request key without using the normal ticket endpoint', async () => {
  const calls: { path: string; body: unknown }[] = [];
  const source = { sourceKind: 'STORE_DRAW', sourceId: 'draw-1', publicationId: coin.publicationId,
    gradeId: coin.gradeId, merchantId: 'merchant-1', nftStatus: 'NOT_REQUESTED', rerollEligible: true } as const;
  const client = createCoinApiClient({ apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'token' },
    fetcher: async (input, init) => { calls.push({ path: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ rerollId: 'reroll-1', coin: { ...coin, rerollQuantity: 1, quantity: 3 }, replayed: false }); } });
  const result = await client.reroll('reroll-ticket-1', source, 'pool-1', 'request-1');
  assert.equal(result.coin.rerollQuantity, 1);
  assert.deepEqual(calls, [{ path: 'https://api.example.test/coin-reroll-tickets/reroll-ticket-1/use',
    body: { sourceKind: 'STORE_DRAW', sourceId: 'draw-1', poolId: 'pool-1', requestId: 'request-1' } }]);
});

test('series shows base and prism slots, a single highest-tier claim, and issued coupon expiry', async () => {
  const slot = { publicationId: coin.publicationId, gradeId: coin.gradeId, name: coin.name, quantity: 2 };
  const base = { slots: [slot], complete: true, title: '기본 세트', detail: '참여 가게 조건' };
  const prism = { slots: [{ ...slot, gradeId: 'prism', quantity: 1 }], complete: true, title: '프리즘 세트', detail: '빛나는 코인 조건' };
  const series = { id: 'series-1', title: '가게 코인 시리즈', merchantId: 'merchant-1', merchantName: '참여 가게',
    endsAt: '2026-12-31T00:00:00Z', base, prism, claimable: 'PRISM', coupon: null };
  const client = createCoinApiClient({ apiUrl: 'https://api.example.test', credential: { kind: 'bearer', sessionToken: 'token' },
    fetcher: async (input) => String(input).endsWith('/claim') ? Response.json({ replayed: false, series: {
      ...series, claimable: null, coupon: { id: 'coupon-1', tier: 'PRISM', title: '실제 설정된 혜택', detail: '매장 조건',
        expiresAt: '2026-12-20T00:00:00Z', status: 'ISSUED', redeemedAt: null },
    } }) : Response.json({ coins: [coin], series: [series] }) });
  const before = await client.getCollection();
  assert.equal(before.series[0]!.claimable, 'PRISM');
  const claimed = await client.claimSeries('series-1');
  assert.equal(claimed.series.claimable, null);
  assert.equal(claimed.series.coupon?.tier, 'PRISM');
  assert.equal(claimed.series.coupon?.expiresAt, '2026-12-20T00:00:00Z');
  const revoked = parseCoinCollection({ coins: [], series: [{ ...series, coupon: {
    id: 'coupon-1', tier: 'BASE', title: '이전 혜택', detail: '매장 조건',
    expiresAt: '2026-12-20T00:00:00Z', status: 'REVOKED', redeemedAt: null,
  } }] });
  assert.equal(revoked.series[0]!.coupon?.status, 'REVOKED');
});

test('revoked reroll replay is final but network uncertainty retains the saved request', () => {
  const revoked = new CoinApiError(409, 'COIN_REROLL_RESULT_REVOKED');
  assert.equal(finalRerollFailure(revoked), true);
  assert.match(coinErrorMessage(revoked), /이전 리롤 결과가 철회/);
  assert.equal(finalRerollFailure(new CoinApiError(0, 'NETWORK_ERROR')), false);
});
