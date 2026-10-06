import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPlayContent, playContent, startWithCurrentContent } from './play-content';
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
