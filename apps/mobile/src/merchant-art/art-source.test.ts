import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AI_ART_NOTE,
  SHOWCASE_ART_NOTE,
  chooseMerchantArt,
  collectibleArtNote,
  merchantArtNote,
  merchantArtUri,
  parseMerchantArtPath,
  remoteArtUri,
  usableArtSource,
} from './art-source';

const sha = 'ab'.repeat(32);
const path = `/merchant-art/${sha}.webp`;
const bundled = 12345;

test('only a /merchant-art/<64 lowercase hex>.webp path is an art path', () => {
  assert.equal(parseMerchantArtPath(path), path);
  for (const bad of [undefined, null, '', 7, {}, `/merchant-art/${sha}.png`, `/merchant-art/${sha}.webp?x=1`, `/merchant-art/${sha}.webp#x`,
    `/merchant-art/${'AB'.repeat(32)}.webp`, `/merchant-art/${'ab'.repeat(31)}.webp`, `/merchant-art/${'ab'.repeat(33)}.webp`,
    `merchant-art/${sha}.webp`, `/merchant-art/../${sha}.webp`, `https://evil.example${path}`, `//evil.example${path}`, ` ${path}`, `${path}\n`]) {
    assert.equal(parseMerchantArtPath(bad), null, String(bad));
  }
});

test('the art address is the API origin plus the art path, whatever trailing slashes the origin has', () => {
  assert.equal(merchantArtUri('https://api.example.test', path), `https://api.example.test${path}`);
  assert.equal(merchantArtUri('https://api.example.test///', path), `https://api.example.test${path}`);
  assert.equal(merchantArtUri('  http://10.0.2.2:3000/ ', path), `http://10.0.2.2:3000${path}`);
});

test('there is no art address without both an API origin and a valid path', () => {
  assert.equal(merchantArtUri(undefined, path), undefined);
  assert.equal(merchantArtUri('', path), undefined);
  assert.equal(merchantArtUri('https://api.example.test', null), undefined);
  assert.equal(merchantArtUri('https://api.example.test', undefined), undefined);
  assert.equal(merchantArtUri('https://api.example.test', 'https://evil.example/x.webp'), undefined);
});

test('the owner-chosen art beats the bundled showcase art', () => {
  assert.deepEqual(chooseMerchantArt({ artUrl: path, apiUrl: 'https://api.example.test', bundled }),
    { fromServer: true, source: { uri: `https://api.example.test${path}` } });
  assert.deepEqual(chooseMerchantArt({ artUrl: path, apiUrl: 'https://api.example.test', bundled: undefined }),
    { fromServer: true, source: { uri: `https://api.example.test${path}` } });
});

test('without owner art the bundled showcase art is used', () => {
  assert.deepEqual(chooseMerchantArt({ artUrl: null, apiUrl: 'https://api.example.test', bundled }), { fromServer: false, source: bundled });
  assert.deepEqual(chooseMerchantArt({ apiUrl: 'https://api.example.test', bundled }), { fromServer: false, source: bundled });
});

test('art that cannot be loaded (bad path, no API origin) never hides the bundled art', () => {
  assert.deepEqual(chooseMerchantArt({ artUrl: 'https://evil.example/x.webp', apiUrl: 'https://api.example.test', bundled }), { fromServer: false, source: bundled });
  assert.deepEqual(chooseMerchantArt({ artUrl: path, bundled }), { fromServer: false, source: bundled });
});

test('with neither there is no art and the caller draws the glyph stamp', () => {
  assert.equal(chooseMerchantArt({ artUrl: null, apiUrl: 'https://api.example.test', bundled: undefined }), undefined);
  assert.equal(chooseMerchantArt({ artUrl: path, bundled: undefined }), undefined);
  assert.equal(chooseMerchantArt({ artUrl: 'nope', apiUrl: 'https://api.example.test', bundled: undefined }), undefined);
});

test('a bundled source of 0 is still a source', () => {
  assert.deepEqual(chooseMerchantArt({ bundled: 0 }), { fromServer: false, source: 0 });
});

test('the picture note says whose picture it is', () => {
  assert.equal(merchantArtNote(true), '사장님이 고른 AI 그림');
  assert.equal(merchantArtNote(false), '가상 점포 시연 그림');
  assert.equal(AI_ART_NOTE, merchantArtNote(true));
  assert.equal(SHOWCASE_ART_NOTE, merchantArtNote(false));
});

test('the collection card note for an AI picture is only who chose it; the showcase picture keeps its not-an-NFT line', () => {
  assert.equal(collectibleArtNote(true), '사장님이 고른 AI 그림');
  assert.equal(collectibleArtNote(true).includes('NFT'), false);
  assert.equal(collectibleArtNote(false), '가상 점포 시연 그림 · 실제 NFT 발행 증거 아님');
});

test('only a picture with an address can fail to load; a bundled picture has none', () => {
  assert.equal(remoteArtUri({ uri: `https://api.example.test${path}` }), `https://api.example.test${path}`);
  for (const bundledLike of [12345, 0, undefined, null, [{ uri: 'x' }], { width: 1 }, { uri: 7 }, 'string']) {
    assert.equal(remoteArtUri(bundledLike), undefined, String(bundledLike));
  }
});

test('a picture whose address failed to load counts as missing; another address or a bundled picture is unaffected', () => {
  const failed = `https://api.example.test${path}`;
  const other = `https://api.example.test/merchant-art/${'cd'.repeat(32)}.webp`;
  assert.equal(usableArtSource({ uri: failed }, failed), undefined);
  assert.deepEqual(usableArtSource({ uri: other }, failed), { uri: other });
  assert.deepEqual(usableArtSource({ uri: failed }, null), { uri: failed });
  assert.equal(usableArtSource(bundled, failed), bundled);
  assert.equal(usableArtSource(0, failed), 0);
  assert.equal(usableArtSource(undefined, failed), undefined);
});
