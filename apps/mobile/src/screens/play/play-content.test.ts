import assert from 'node:assert/strict';
import test from 'node:test';
import { coinEntryRoute, fetchPlayContent, merchantDetailRoute, ownedGameArt, playContent, startWithCurrentContent } from './play-content';
import type { OwnedArt } from './play-art';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import type { RealGameContext } from '../../../../api/src/real-world-contract';

const apiUrl = 'https://demo-api.masscom.kr';
const context: RealGameContext = {
  merchantId: 'shop-1', merchantName: '실제 가게', roadAddress: '실제 주소', profileVersion: 7, campaign: null,
  menuItems: [{ id: 'm1', name: '등록된 메뉴', priceWon: null, priceNote: null, photoId: 'photo-1' }],
  photos: [
    { id: 'photo-1', kind: 'MENU', source: 'OWNER_PHOTO', url: '/photos/1', width: 300, height: 300, caption: null, updatedAt: '2026-10-06' },
    { id: 'photo-2', kind: 'PACKAGING', source: 'OWNER_PHOTO', url: '/photos/2', width: 300, height: 300, caption: null, updatedAt: '2026-10-06' },
    { id: 'photo-3', kind: 'SIGN', source: 'OWNER_PHOTO', url: '/photos/3', width: 300, height: 300, caption: null, updatedAt: '2026-10-06' },
  ],
};

test('unowned and empty context show practice only', () => {
  assert.equal(playContent([], [context], apiUrl).tokens.every((item) => item.source === 'practice'), true);
  assert.equal(playContent([], [context], apiUrl).merchantName, undefined);
});

test('published menu, packaging and sign remain distinct from owned collectible', () => {
  const content = playContent([{ merchantId: 'shop-1', merchantName: '실제 가게', name: '내 수집품', uri: 'data:image/png;base64,a' }], [context], apiUrl);
  assert.equal(content.contentVersion, 7);
  assert.deepEqual(content.tokens.map((item) => item.source), ['menu', 'practice', 'practice', 'practice', 'sign', 'collectible']);
  assert.equal(content.tokens[0]?.uri, `${apiUrl}/photos/1`);
  assert.equal(content.package.uri, `${apiUrl}/photos/2`);
  assert.equal(content.destination.uri, `${apiUrl}/photos/3`);
});

test('removed photo and cross-origin URL never remain as a real image', () => {
  const changed = { ...context, photos: [{ ...context.photos[0]!, url: 'https://other.example/photo' }] };
  const content = playContent([{ merchantId: 'shop-1', name: '내 수집품', uri: 'owned' }], [changed], apiUrl);
  assert.equal(content.tokens[0]?.name, '등록된 메뉴');
  assert.equal(content.tokens[0]?.uri, undefined);
  assert.equal(content.package.source, 'collectible');
  assert.equal(content.destination.uri, undefined);
  assert.equal(content.destination.source, 'merchant');
});

test('a new run fetches current profile version and drops a revoked photo', async () => {
  let current = context;
  const fetcher: typeof fetch = async (_url, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { merchantIds: ['shop-1'] });
    return new Response(JSON.stringify({ schemaVersion: 1, asOf: '2026-10-06T00:00:00Z', contexts: [current] }));
  };
  const art = [{ merchantId: 'shop-1', name: '내 수집품', uri: 'owned' }];
  const signal = new AbortController().signal;
  const before = playContent(art, await fetchPlayContent(apiUrl, ['shop-1'], signal, fetcher), apiUrl);
  current = { ...context, profileVersion: 8, photos: context.photos.filter((item) => item.id !== 'photo-2') };
  const after = playContent(art, await fetchPlayContent(apiUrl, ['shop-1'], signal, fetcher), apiUrl);
  assert.equal(before.package.source, 'packaging');
  assert.equal(after.package.source, 'collectible');
  assert.equal(after.contentVersion, 8);
});

test('malformed content is an error, not an empty merchant list', async () => {
  const malformed: typeof fetch = async () => new Response(JSON.stringify({ schemaVersion: 1, asOf: '2026-10-06T00:00:00Z', contexts: [{ merchantId: 'shop-1' }] }));
  await assert.rejects(fetchPlayContent(apiUrl, ['shop-1'], new AbortController().signal, malformed), /INVALID_GAME_CONTENT/);
});

test('start waits for holdings and context; failure never issues a run but successful empty data starts practice', async () => {
  let release!: (value: typeof context[]) => void;
  const pending = new Promise<typeof context[]>((resolve) => { release = resolve; });
  let issued = 0;
  const owned = [{ merchantId: 'shop-1', name: '내 수집품', uri: 'owned' }];
  const issue = async () => { issued++; return { id: 'run-1' }; };
  const waiting = startWithCurrentContent(async () => owned, async () => pending, issue, apiUrl, new AbortController().signal);
  await Promise.resolve();
  assert.equal(issued, 0);
  release([context]);
  assert.equal((await waiting).content.merchantName, '실제 가게');
  assert.equal(issued, 1);

  await assert.rejects(startWithCurrentContent(async () => { throw new Error('collection failed'); }, async () => [context], issue, apiUrl, new AbortController().signal), /COLLECTION_UNAVAILABLE/);
  await assert.rejects(startWithCurrentContent(async () => owned, async () => { throw new Error('context failed'); }, issue, apiUrl, new AbortController().signal), /GAME_CONTENT_UNAVAILABLE/);
  assert.equal(issued, 1);
  const empty = await startWithCurrentContent(async () => [], async () => [], issue, apiUrl, new AbortController().signal);
  assert.equal(empty.content.merchantName, undefined);
  assert.equal(empty.content.tokens.every((item) => item.source === 'practice'), true);
  assert.equal(issued, 2);
});

// Memory game: the six cards are distinct visited stores' coins (owner direction 7).
const goals = [{ targetVisitCount: 1, displayName: '첫 우표' }, { targetVisitCount: 3, displayName: '단골 우표' }, { targetVisitCount: 5, displayName: '최고 우표' }] as const;
const campaign = (overrides: Partial<NonNullable<RealGameContext['campaign']>> = {}): NonNullable<RealGameContext['campaign']> => ({
  id: 'campaign-1', title: '가을 방문', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', state: 'ACTIVE', enrollment: 'OPEN',
  rewardAvailability: 'AVAILABLE', goals: goals.map((goal) => ({ ...goal })), ...overrides,
});
const store = (id: string, overrides: Partial<RealGameContext> = {}): RealGameContext => ({ ...context, merchantId: id, merchantName: `가게 ${id}`, campaign: campaign(), ...overrides });
const coin = (id: string, held: OwnedArt['held'] = [{ entitlementId: `ent-${id}`, campaignId: 'campaign-1', targetVisitCount: 1 }]): OwnedArt =>
  ({ merchantId: id, merchantName: `가게 ${id}`, name: `${id} 코인`, uri: `data:image/png;base64,${id}`, entitlementId: `ent-${id}`, held });

test('memory tokens are the coins of distinct visited stores, each naming its store', () => {
  const stores = ['a', 'b', 'c'];
  const content = playContent(stores.map((id) => coin(id)), stores.map((id) => store(id)), apiUrl);
  assert.deepEqual(content.memoryTokens.slice(0, 3).map((item) => [item.source, item.merchantId, item.merchantName, item.name, item.entitlementId]), [
    ['collectible', 'a', '가게 a', 'a 코인', 'ent-a'], ['collectible', 'b', '가게 b', 'b 코인', 'ent-b'], ['collectible', 'c', '가게 c', 'c 코인', 'ent-c'],
  ]);
  assert.equal(content.memoryTokens.length, 6);
  assert.equal(content.memoryTokens[0]?.uri, 'data:image/png;base64,a');
});

test('six stores fill every card and a seventh is ignored', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const content = playContent(ids.map((id) => coin(id)), ids.map((id) => store(id)), apiUrl);
  assert.deepEqual(content.memoryTokens.map((item) => item.merchantId), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('one store never supplies two cards, even with several coins or repeated entries', () => {
  const content = playContent([coin('a'), { ...coin('a'), name: '같은 가게 다른 코인' }, coin('b')], [store('a'), store('b')], apiUrl);
  assert.deepEqual(content.memoryTokens.map((item) => item.merchantId), ['a', 'b', undefined, undefined, undefined, undefined]);
  assert.equal(content.memoryTokens[0]?.name, 'a 코인');
});

test('fewer than six stores keep practice cards in the empty places; a store without published context is practice too', () => {
  const content = playContent([coin('a'), coin('gone'), coin('b')], [store('a'), store('b')], apiUrl);
  assert.deepEqual(content.memoryTokens.map((item) => item.source), ['collectible', 'collectible', 'practice', 'practice', 'practice', 'practice']);
  assert.deepEqual(content.memoryTokens.slice(2).map((item) => item.name), ['연습 그림 3', '연습 그림 4', '연습 그림 5', '연습 그림 6']);
  assert.ok(content.memoryTokens.slice(2).every((item) => !item.merchantId && !item.entitlementId && !item.nextSlot));
  const none = playContent([], [store('a')], apiUrl);
  assert.equal(none.memoryTokens.every((item) => item.source === 'practice'), true);
});

test('multi-store memory does not change the menu tokens other games use', () => {
  const content = playContent([coin('shop-1'), coin('b')], [context, store('b')], apiUrl);
  assert.deepEqual(content.tokens.map((item) => item.source), ['menu', 'practice', 'practice', 'practice', 'sign', 'collectible']);
  assert.equal(content.merchantName, '실제 가게');
  assert.deepEqual(content.memoryTokens.slice(0, 2).map((item) => item.merchantId), ['shop-1', 'b']);
});

test('nextSlot is the first stage of the store campaign the account does not hold yet', () => {
  const held = (...stages: (1 | 3 | 5)[]) => stages.map((targetVisitCount) => ({ entitlementId: `ent-${targetVisitCount}`, campaignId: 'campaign-1', targetVisitCount }));
  const next = (art: OwnedArt, ctx = store('a')) => playContent([art], [ctx], apiUrl).memoryTokens[0]?.nextSlot;
  assert.deepEqual(next(coin('a', held(1))), { targetVisitCount: 3, displayName: '단골 우표', owned: false, entitlementId: undefined });
  assert.deepEqual(next(coin('a', held(1, 3))), { targetVisitCount: 5, displayName: '최고 우표', owned: false, entitlementId: undefined });
  assert.equal(next(coin('a', held(1, 3, 5))), undefined);
  // A coin from another campaign does not fill this campaign's stages.
  assert.equal(next(coin('a', [{ entitlementId: 'old', campaignId: 'campaign-0', targetVisitCount: 1 }]))?.targetVisitCount, 1);
});

test('no next collectible is promised unless the holdings are known and the campaign can still give one', () => {
  const art = coin('a');
  const next = (item: OwnedArt, ctx: RealGameContext) => playContent([item], [ctx], apiUrl).memoryTokens[0]?.nextSlot;
  assert.equal(next({ ...art, held: undefined }, store('a')), undefined);
  assert.equal(next(art, store('a', { campaign: null })), undefined);
  assert.equal(next(art, store('a', { campaign: campaign({ goals: [] }) })), undefined);
  for (const rewardAvailability of ['EXHAUSTED', 'NOT_RUNNING', 'UNKNOWN'] as const) {
    assert.equal(next(art, store('a', { campaign: campaign({ rewardAvailability }) })), undefined, rewardAvailability);
  }
  assert.equal('nextSlot' in playContent([art], [store('a', { campaign: null })], apiUrl).memoryTokens[0]!, false);
});

test('visited stores come from the collection snapshot, one coin per store with its own holdings', () => {
  const item = (merchantId: string, entitlementId: string, targetVisitCount: 1 | 3 | 5, artwork = true) => ({
    entitlementId, merchantId, merchantName: `가게 ${merchantId}`, campaignId: 'campaign-1', campaignTitle: '가을 방문', targetVisitCount, displayName: '수집품',
    earnedAt: '2026-10-07T00:00:00Z', appCollectibleStatus: 'COLLECTED' as const, mintJobId: null, recipient: null, nftStatus: 'NOT_REQUESTED' as const, nft: null,
    ...(artwork ? { artwork: { publicationId: `pub-${entitlementId}`, name: `코인 ${entitlementId}`, thumbnailDataUrl: `data:image/png;base64,${entitlementId}` } } : {}),
  });
  const snapshot = { visits: [], collectibles: [
    item('a', 'a5', 5), item('b', 'b3', 3, false), item('b', 'b1', 1), item('a', 'a1', 1), item('c', 'c1', 1, false),
  ] } as unknown as CollectionSnapshot;
  const owned = ownedGameArt(snapshot);
  assert.deepEqual(owned.map((entry) => [entry.merchantId, entry.entitlementId, entry.name]), [['a', 'a5', '코인 a5'], ['b', 'b1', '코인 b1']]);
  assert.deepEqual(owned[1]?.held?.map((held) => held.targetVisitCount), [3, 1]);
  assert.deepEqual(ownedGameArt(undefined), []);
  // Holdings without artwork still count toward the series, so the next stage is not offered twice.
  const content = playContent(owned, [store('a'), store('b')], apiUrl);
  assert.equal(content.memoryTokens[0]?.nextSlot?.targetVisitCount, 3);
  assert.equal(content.memoryTokens[1]?.nextSlot?.targetVisitCount, 5);
});

test('a coin opens its own 도감 entry and a menu item opens its store, only when they are known', () => {
  const content = playContent([coin('a')], [store('a')], apiUrl);
  assert.deepEqual(coinEntryRoute(content.memoryTokens[0]!), { pathname: '/collection', params: { focus: 'collectible', entitlement: 'ent-a' } });
  assert.equal(coinEntryRoute(content.memoryTokens[1]!), undefined);
  assert.equal(coinEntryRoute({ name: '코인', source: 'collectible', merchantId: 'a' }), undefined);
  // The store link belongs to the content, so it exists with or without menu items and never for practice content.
  assert.deepEqual(merchantDetailRoute(playContent([coin('shop-1')], [context], apiUrl)), { pathname: '/merchants/[merchantId]', params: { merchantId: 'shop-1' } });
  const noMenu = playContent([coin('shop-1')], [{ ...context, menuItems: [] }], apiUrl);
  assert.equal(noMenu.tokens[0]?.source, 'practice');
  assert.equal(merchantDetailRoute(noMenu)?.params.merchantId, 'shop-1');
  assert.equal(merchantDetailRoute(playContent([], [context], apiUrl)), undefined);
});

test('menu prices never reach any game token', () => {
  const priced = { ...context, menuItems: [{ id: 'm1', name: '등록된 메뉴', priceWon: 4_567, priceNote: '시가 8,910원', photoId: null }] };
  const content = playContent([coin('shop-1')], [priced], apiUrl);
  assert.doesNotMatch(JSON.stringify(content), /4567|4,567|8,910|priceWon|priceNote/);
});

test('a malformed campaign or goals only drops the next-collectible line and never blocks starting a game', async () => {
  const broken: unknown[] = [
    'campaign', { ...campaign(), goals: 'goals' }, { ...campaign(), goals: [null] }, { ...campaign(), goals: [{ targetVisitCount: 2, displayName: '둘' }] },
    { ...campaign(), goals: [{ targetVisitCount: 1 }] }, { ...campaign(), id: undefined }, { ...campaign(), goals: undefined },
  ];
  for (const bad of broken) {
    const ctx = store('a', { campaign: bad as RealGameContext['campaign'] });
    const content = playContent([coin('a')], [ctx], apiUrl);
    assert.equal(content.memoryTokens[0]?.source, 'collectible', JSON.stringify(bad));
    assert.equal(content.memoryTokens[0]?.nextSlot, undefined, JSON.stringify(bad));
    // The same context passes the strict server-content check and starts a run.
    const started = await startWithCurrentContent(async () => [coin('a')], async () => [ctx], async () => ({ id: 'run' }), apiUrl, new AbortController().signal);
    assert.equal(started.content.memoryTokens[0]?.merchantId, 'a');
  }
});

test('with more than six stores the six cards start at a different store each KST day, steady within a day', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const art = ids.map((id) => coin(id));
  const contexts = ids.map((id) => store(id));
  const kst = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour - 9));
  const cards = (at: Date) => playContent(art, contexts, apiUrl, at).memoryTokens.map((item) => item.merchantId);
  assert.equal(cards(kst(8)).length, 6);
  assert.equal(new Set(cards(kst(8))).size, 6);
  // Deterministic within a KST day, including its first and last minute, and across a retry of the same run.
  assert.deepEqual(cards(kst(8, 0)), cards(kst(8, 23)));
  assert.deepEqual(cards(kst(8)), cards(kst(8)));
  // The day changes at 00:00 KST (15:00 UTC), not at 00:00 UTC.
  assert.notDeepEqual(cards(new Date('2026-10-08T14:59:00Z')), cards(new Date('2026-10-08T15:00:00Z')));
  const shownOverTime = new Set(Array.from({ length: 8 }, (_, day) => cards(kst(1 + day))).flat());
  assert.deepEqual([...shownOverTime].sort(), ids);
  // Six stores or fewer keep the collection order whatever the day.
  assert.deepEqual(playContent(art.slice(0, 6), contexts, apiUrl, kst(3)).memoryTokens.map((item) => item.merchantId), ids.slice(0, 6));
});

test('a store whose coin picture another store already uses is skipped, so no two cards look alike', () => {
  const same = { ...coin('b'), uri: coin('a').uri };
  const content = playContent([coin('a'), same, coin('c')], [store('a'), store('b'), store('c')], apiUrl);
  assert.deepEqual(content.memoryTokens.map((item) => item.merchantId), ['a', 'c', undefined, undefined, undefined, undefined]);
  const uris = content.memoryTokens.flatMap((item) => item.uri ? [item.uri] : []);
  assert.equal(new Set(uris).size, uris.length);
});
