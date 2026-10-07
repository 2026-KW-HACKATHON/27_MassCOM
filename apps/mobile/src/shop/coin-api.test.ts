import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CoinApiError, coinErrorMessage, coinProbabilityText, createCoinApiClient, finalRerollFailure, parseCoinCollection, parseCoinShop } from './coin-api';

test('coin probability never rounds the smallest supported chance to zero and retains the exact ratio', () => {
  assert.equal(coinProbabilityText(1, 1_000_000), '0.0001% · 1/1000000');
  assert.equal(coinProbabilityText(1, 3), '33.3333% · 1/3');
});

const ticket = { id: 'ticket-1', poolId: 'pool-1', merchantId: 'merchant-1', eventName: '여름 축제',
  grade: 'SILVER', acquiredAt: '2026-07-01T00:00:00Z', expiresAt: '2026-07-31T00:00:00Z', status: 'UNUSED' };
const coin = { publicationId: 'publication-1', gradeId: 'silver', name: '실버 코인', summary: {},
  quantity: 2, visitQuantity: 1, drawQuantity: 1 };
const pool = { id: 'pool-1', merchantId: 'merchant-1', merchantName: '참여 가게', eventName: '여름 축제',
  grade: 'SILVER', price: 200, purchaseStartsAt: '2026-07-01T00:00:00Z', purchaseEndsAt: '2026-07-20T00:00:00Z',
  useExpiresAt: ticket.expiresAt, perAccountLimit: 2, issuanceCap: 10, issuedCount: 1, status: 'ACTIVE',
  entries: [{ publicationId: coin.publicationId, gradeId: coin.gradeId, name: coin.name, weight: 1, probability: 1, summary: {} }] };

test('shop and collection show server pool odds, ticket rights and duplicate quantities', () => {
  assert.equal(parseCoinShop({ mileage: { earned: 500, spent: 0, balance: 500 }, pools: [pool], tickets: [ticket] }).pools[0]!.entries[0]!.probability, 1);
  assert.equal(parseCoinCollection({ coins: [coin], series: [] }).coins[0]!.quantity, 2);
  assert.throws(() => parseCoinShop({ mileage: { earned: 500, spent: 0, balance: 500 }, pools: [{ ...pool, entries: [{ ...pool.entries[0], probability: 2 }] }], tickets: [] }), /INVALID_COIN_RESPONSE/);
  assert.throws(() => parseCoinCollection({ coins: [{ ...coin, quantity: 1 }], series: [] }), /INVALID_COIN_RESPONSE/);
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
