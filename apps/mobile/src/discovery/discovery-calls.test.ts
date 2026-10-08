import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCalls, joinInFlight, type Answers } from './discovery-calls';
import { parseFriendsSnapshot } from '@/friends/friends-api';

const credential = { kind: 'bearer', sessionToken: 'token' } as const;

/** Counts requests per path; bodies are empty on purpose: a rejected parse still counts as one request. */
function counting(bodies: Record<string, unknown> = {}) {
  const hits: string[] = [];
  const fetcher = (async (url: string) => {
    const path = new URL(url).pathname;
    hits.push(path);
    return Response.json(bodies[path] ?? {});
  }) as unknown as typeof fetch;
  return { hits, fetcher, count: (path: string) => hits.filter((hit) => hit === path).length };
}
const tally = (hits: string[]) => Object.fromEntries([...new Set(hits)].sort().map((path) => [path, hits.filter((hit) => hit === path).length]));
const noop = async () => undefined;
const settle = (...promises: Promise<unknown>[]) => Promise.allSettled(promises);

/** A stand-in for the provider's state, shared by several call sets so an account switch can be played out. */
function store() {
  let state: Answers | undefined;
  return {
    set: (update: Answers | undefined | ((current: Answers | undefined) => Answers | undefined)) => { state = typeof update === 'function' ? update(state) : update; },
    get: () => state,
  };
}
function harness(bodies?: Record<string, unknown>) {
  const probe = counting(bodies);
  const shared = store();
  const calls = createCalls({ apiUrl: 'https://api.test', credential, onSessionInvalid: noop, fetcher: probe.fetcher }, shared.set);
  shared.set({ owner: calls.owner, strip: {} });
  return { calls, probe, shared, answers: () => shared.get()! };
}

test('joinInFlight runs one request for callers that overlap and a new one after it settles', async () => {
  let runs = 0;
  const call = joinInFlight(async () => { runs += 1; await Promise.resolve(); return runs; });
  const [a, b] = await Promise.all([call(), call()]);
  assert.deepEqual([a, b, runs], [1, 1, 1]);
  assert.equal(await call(), 2);
});

test('a failed request is not remembered: the next call asks again', async () => {
  let runs = 0;
  const call = joinInFlight(async () => { runs += 1; if (runs === 1) throw new Error('offline'); return runs; });
  await assert.rejects(call(), /offline/);
  assert.equal(await call(), 2);
});

// --- request counts (Issue #412) ---

test('a tab screen gaining focus asks for the strip alone: three requests, whatever the stage', async () => {
  const { calls, probe } = harness();
  // ProfileStrip's focus effect (refresh) on 도감, 놀이 or any other screen with the strip.
  await settle(calls.loadStrip());
  assert.deepEqual(tally(probe.hits), { '/me/friends': 1, '/me/social': 1, '/shop': 1 });
  assert.equal(probe.count('/collection') + probe.count('/coin-shop'), 0, 'no stage answers and so no duplicate of 도감 or 놀이');
});

test('Home\'s focus: the strip and Home\'s own load hit each endpoint once, even when a claim asks for the stage answers at the same time', async () => {
  const { calls, probe } = harness();
  await settle(calls.loadStrip(), calls.loadStrip(), /* Home: */ calls.loadCollection(), calls.loadCoinShop(), calls.loadStage());
  assert.deepEqual(tally(probe.hits), { '/coin-shop': 1, '/collection': 1, '/me/friends': 1, '/me/social': 1, '/shop': 1 });
});

test('after a claim the stage answers alone are asked, once each, and nothing else', async () => {
  const { calls, probe } = harness();
  await settle(calls.loadStage(), calls.loadStage());
  assert.deepEqual(tally(probe.hits), { '/coin-shop': 1, '/collection': 1 });
});

test('the next focus asks again (nothing is cached between focuses)', async () => {
  const { calls, probe } = harness();
  await settle(calls.loadStrip());
  await settle(calls.loadStrip());
  assert.deepEqual(tally(probe.hits), { '/me/friends': 2, '/me/social': 2, '/shop': 2 });
});

test('one failing stage answer does not stop the other', async () => {
  const { calls, probe } = harness();
  await calls.loadStage(); // every body is empty, so both fail to parse: still two requests, and loadStage itself never rejects
  assert.equal(probe.hits.length, 2);
});

test('answers land in the current owner\'s state', async () => {
  const coinShop = { mileage: { earned: 0, spent: 0, balance: 0 }, pools: [], tickets: [] };
  const { calls, answers } = harness({ '/coin-shop': coinShop });
  await calls.loadCoinShop();
  assert.deepEqual(answers().coinShop, coinShop);
  assert.equal(typeof answers().coinShopAt, 'number');
});

test('a reply that lands after an account switch is dropped instead of overwriting the new account', async () => {
  const coinShop = { mileage: { earned: 0, spent: 0, balance: 0 }, pools: [], tickets: [] };
  const shared = store();
  const options = { apiUrl: 'https://api.test', credential, onSessionInvalid: noop, fetcher: counting({ '/coin-shop': coinShop }).fetcher };
  const before = createCalls(options, shared.set);
  const after = createCalls(options, shared.set);
  shared.set({ owner: before.owner, strip: {} });
  const pending = before.loadCoinShop();
  shared.set({ owner: after.owner, strip: { nickname: '새 계정' } });
  await pending;
  assert.equal(shared.get()!.owner, after.owner);
  assert.equal(shared.get()!.coinShop, undefined);
  assert.equal(shared.get()!.strip.nickname, '새 계정');
});

test('a failed strip request keeps the earlier value on screen', async () => {
  // Every body here is empty, so friends, shop and social all fail to parse.
  const { calls, shared } = harness();
  shared.set({ owner: calls.owner, strip: { nickname: '가나다', unread: 2 } });
  await calls.loadStrip();
  assert.deepEqual(shared.get()!.strip, { nickname: '가나다', unread: 2 });
});

test('the strip remembers how many friends the account has, so existing social users keep their doors', async () => {
  const medals = ['explorer', 'regular', 'steady'].map((key) => ({ key, tier: 1 }));
  const friend = (id: string, rank: number) => ({
    friendshipId: id, nickname: '민지', badges: { earned: 3, total: 9 }, medals, stamps: [], rank,
  });
  const body = {
    me: { nickname: '탐험가 K7M2', code: 'K7M2Q9XP', badges: { earned: 3, total: 9 }, medals, rank: 2, asOf: '2026-09-28' },
    friends: [friend('11111111-1111-4111-8111-111111111111', 1), friend('22222222-2222-4222-8222-222222222222', 3)],
  };
  assert.equal(parseFriendsSnapshot(body).friends.length, 2, 'the fixture is a valid server answer');
  const { calls, shared } = harness({ '/me/friends': body });
  await calls.loadStrip();
  assert.equal(shared.get()!.strip.friendCount, 2);
  assert.equal(shared.get()!.strip.nickname, '탐험가 K7M2');
  // A later failure keeps the earlier count instead of reading as "no friends".
  const failing = harness();
  failing.shared.set({ owner: failing.calls.owner, strip: { friendCount: 2 } });
  await failing.calls.loadStrip();
  assert.equal(failing.shared.get()!.strip.friendCount, 2);
});
