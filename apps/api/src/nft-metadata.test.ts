// Issue #254: 공개 NFT 메타데이터 경로(/nft-metadata/<series>/<tokenId>.json, /nft-metadata/images/<sha256>.webp).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { DEFAULT_STAMP_V1_PNG, DEFAULT_STAMP_V1_SHA256 } from './nft-default-stamp.js';
import { matchNftMetadataRoute, type NftMetadataReader } from './nft-metadata.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

const metadata = '{"name":"월계 김밥 방문 도장","description":"월계동 월계 김밥 첫 방문 도장입니다.","image":"https://masscom.kr/assets/mascot-stamp.png","attributes":[]}';
const sha = 'a'.repeat(64);
const art = Buffer.from('webp-bytes');

async function start(t: TestContext, reader?: NftMetadataReader): Promise<string> {
  const service = new WalletChallengeService({
    store: new InMemoryChallengeStore(), domain: 'api.masscom.local', uri: 'https://api.masscom.local/wallet/verify',
    chainId: 84532, ttlMs: 60_000, nonce: () => 'abc12345def67890', challengeId: () => 'challenge-1',
  });
  const server = createApiServer(service, developmentHeaderAccountResolver,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, false, undefined, false, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, reader);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return `http://127.0.0.1:${address.port}`;
}

test('경로 규칙은 Caddy·시리즈 CHECK와 같고 정적 실증 시리즈는 API가 받지 않는다', () => {
  assert.deepEqual(matchNftMetadataRoute('/nft-metadata/series-worker/7.json'), { kind: 'token', seriesId: 'series-worker', tokenId: '7' });
  assert.deepEqual(matchNftMetadataRoute('/nft-metadata/Series_2/0.json'), { kind: 'token', seriesId: 'Series_2', tokenId: '0' });
  assert.deepEqual(matchNftMetadataRoute(`/nft-metadata/images/${sha}.webp`), { kind: 'image', sha256: sha });
  assert.deepEqual(matchNftMetadataRoute('/nft-metadata/default/mascot-stamp-v1.png'), { kind: 'default-stamp' });
  // 운영 시리즈 id는 뜻 없는 불투명 id(s- + hex 32자, 0036 CHECK)이고 이 경로 규칙이 받는다.
  const opaque = `s-${'0'.repeat(28)}c0de`;
  assert.deepEqual(matchNftMetadataRoute(`/nft-metadata/${opaque}/12.json`), { kind: 'token', seriesId: opaque, tokenId: '12' });
  for (const path of ['/nft-metadata/base-sepolia-proof/1.json', '/nft-metadata/BASE-SEPOLIA-PROOF/1.json',
    '/nft-metadata/Base-Sepolia-Proof/2.json', '/nft-metadata/default/mascot-stamp-v2.png', '/nft-metadata/default/x.png', '/nft-metadata/s/07.json', '/nft-metadata/s/1',
    '/nft-metadata/s/1.JSON', '/nft-metadata/-s/1.json', '/nft-metadata/s.x/1.json', '/nft-metadata/a/b/1.json',
    `/nft-metadata/images/${'A'.repeat(64)}.webp`, `/nft-metadata/images/${sha}.png`, '/nft-metadata/s/-1.json',
    `/nft-metadata/${'s'.repeat(129)}/1.json`, `/nft-metadata/s/1${'0'.repeat(78)}.json`]) {
    assert.equal(matchNftMetadataRoute(path), undefined, path);
  }
});

test('확정된 토큰 메타데이터는 저장된 바이트 그대로 JSON·CORS·오래 캐시로 내보낸다', async (t) => {
  const calls: unknown[][] = [];
  const base = await start(t, {
    findTokenMetadata: async (seriesId, tokenId) => {
      calls.push([seriesId, tokenId]);
      return seriesId === 'series-a' && tokenId === '7' ? metadata : null;
    },
    findImage: async (value) => (value === sha ? art : null),
  });
  const found = await fetch(`${base}/nft-metadata/series-a/7.json`);
  assert.equal(found.status, 200);
  assert.equal(found.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(found.headers.get('access-control-allow-origin'), '*');
  assert.equal(found.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(found.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(found.headers.get('content-length'), String(Buffer.byteLength(metadata)));
  assert.equal(await found.text(), metadata);

  const head = await fetch(`${base}/nft-metadata/series-a/7.json`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('access-control-allow-origin'), '*');
  assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(metadata)));
  assert.equal(await head.text(), '');

  const image = await fetch(`${base}/nft-metadata/images/${sha}.webp`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.equal(image.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(image.headers.get('access-control-allow-origin'), '*');
  assert.equal(image.headers.get('content-length'), String(art.length));
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), art);
  const imageHead = await fetch(`${base}/nft-metadata/images/${sha}.webp`, { method: 'HEAD' });
  assert.equal(imageHead.headers.get('content-length'), String(art.length));

  // 없는 토큰·다른 시리즈·확정 전·모르는 그림·잘못된 경로는 모두 같은 404이고 캐시하지 않는다.
  for (const path of ['/nft-metadata/series-a/8.json', '/nft-metadata/series-b/7.json', `/nft-metadata/images/${'b'.repeat(64)}.webp`,
    '/nft-metadata/series-a/07.json', '/nft-metadata/base-sepolia-proof/1.json', '/nft-metadata/series-a/']) {
    const missing = await fetch(`${base}${path}`);
    assert.equal(missing.status, 404, path);
    assert.deepEqual(await missing.json(), { code: 'NOT_FOUND' }, path);
    assert.equal(missing.headers.get('cache-control'), 'no-store', path);
    assert.equal(missing.headers.get('access-control-allow-origin'), '*', path);
  }
  assert.deepEqual(calls, [['series-a', '7'], ['series-a', '7'], ['series-a', '8'], ['series-b', '7']]);

  // 쓰기 메서드는 이 경로로 받지 않는다.
  const posted = await fetch(`${base}/nft-metadata/series-a/7.json`, { method: 'POST', body: '{}' });
  assert.equal(posted.status, 404);
  assert.equal(posted.headers.get('access-control-allow-origin'), null);
});

test('DB가 없는 서버는 메타데이터를 503으로 알리지만 판이 붙은 기본 도장은 준다', async (t) => {
  const base = await start(t);
  const response = await fetch(`${base}/nft-metadata/series-a/7.json`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'NFT_METADATA_NOT_CONFIGURED' });
  const stamp = await fetch(`${base}/nft-metadata/default/mascot-stamp-v1.png`);
  assert.equal(stamp.status, 200);
  assert.equal(stamp.headers.get('content-type'), 'image/png');
  assert.equal(stamp.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(stamp.headers.get('access-control-allow-origin'), '*');
  assert.equal(stamp.headers.get('content-length'), String(DEFAULT_STAMP_V1_PNG.length));
  assert.equal(createHash('sha256').update(Buffer.from(await stamp.arrayBuffer())).digest('hex'), DEFAULT_STAMP_V1_SHA256);
});

test('기본 도장 v1 바이트는 고정된 sha256이고 PNG다(바꾸려면 새 판을 더한다)', () => {
  const pinned = '147545653d7dca77c744aaf778ea4ae5836e8ce3c395aeb094eac5fec3926a11';
  assert.equal(DEFAULT_STAMP_V1_SHA256, pinned);
  assert.equal(createHash('sha256').update(DEFAULT_STAMP_V1_PNG).digest('hex'), pinned);
  assert.deepEqual([...DEFAULT_STAMP_V1_PNG.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});
