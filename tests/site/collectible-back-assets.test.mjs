import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createProductionServer } from '../../apps/production-web/server.mjs';
import {
  COLLECTIBLE_BACK_EXTENSION,
  COLLECTIBLE_BACK_FILES,
  COLLECTIBLE_BACK_GRADES,
  COLLECTIBLE_BACK_SHAPES,
  COLLECTIBLE_BACK_VERSION,
  fixedCollectibleBack,
} from '../../apps/production-web/assets/collectible-back-assets.mjs';

function webpDimensions(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  throw new Error(`unsupported WebP chunk ${chunk}`);
}

test('fixed back mapping defines twelve unique immutable versioned shape and grade combinations', () => {
  assert.equal(COLLECTIBLE_BACK_VERSION, 'v2');
  assert.equal(COLLECTIBLE_BACK_EXTENSION, 'webp');
  assert.deepEqual(COLLECTIBLE_BACK_SHAPES, ['circle', 'stamp', 'serrated']);
  assert.deepEqual(COLLECTIBLE_BACK_GRADES, ['bronze', 'silver', 'gold', 'prism']);
  assert.equal(COLLECTIBLE_BACK_FILES.length, 12);
  assert.equal(new Set(COLLECTIBLE_BACK_FILES).size, 12);
  for (const shape of COLLECTIBLE_BACK_SHAPES) for (const grade of COLLECTIBLE_BACK_GRADES) {
    assert.equal(fixedCollectibleBack(shape, grade).path, `/app/assets/collectible-backs/v2/${shape}-${grade}.webp`);
  }
  assert.equal(fixedCollectibleBack('unknown', 'festival-gold').path, '/app/assets/collectible-backs/v2/circle-bronze.webp');
  assert.equal(fixedCollectibleBack('serrated', 'special').path, '/app/assets/collectible-backs/v2/serrated-bronze.webp');
  assert.equal(fixedCollectibleBack('gear', 'silver').path, '/app/assets/collectible-backs/v2/serrated-silver.webp');
  assert.equal(fixedCollectibleBack('stamp', 'festival-gold', '프리즘').path, '/app/assets/collectible-backs/v2/stamp-bronze.webp', '사용자 등급 이름을 재질로 추측하지 않는다');
});

test('현재 v2 WebP 뒷면은 웹·앱 파일이 같은 바이트이고 모바일 번들 용량 한도 안에 있다', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../docs/evidence/prism-collectibles-2026-10-08/assets.json', import.meta.url), 'utf8'));
  assert.equal(manifest.length, 12);
  let total = 0;
  const digests = new Set();
  for (const file of COLLECTIBLE_BACK_FILES) {
    const [web, mobile] = await Promise.all([
      readFile(new URL(`../../apps/production-web/assets/collectible-backs/v2/${file}`, import.meta.url)),
      readFile(new URL(`../../apps/mobile/assets/images/collectibles/backs/v2/${file}`, import.meta.url)),
    ]);
    assert.equal(web.compare(mobile), 0, `${file}: 웹과 앱의 현재 디자인이 같다`);
    assert.equal(web.toString('ascii', 0, 4), 'RIFF', `${file}: WebP RIFF`);
    assert.equal(web.toString('ascii', 8, 12), 'WEBP', `${file}: WebP magic`);
    const dimensions = webpDimensions(web);
    assert.deepEqual(dimensions, { width: 512, height: 512 }, `${file}: 512px 확정 자산`);
    assert.ok(web.byteLength <= 256 * 1024, `${file}: 개별 WebP는 256KiB 이하`);
    total += web.byteLength;
    const digest = createHash('sha256').update(web).digest('hex');
    const entry = manifest.find(asset => asset.file === file);
    assert.equal(digest, entry?.sha256, `${file}: v2 manifest hash`);
    assert.equal(entry?.bytes, web.byteLength, `${file}: v2 manifest byte size`);
    assert.equal(entry?.width, 512, `${file}: v2 manifest width`);
    assert.equal(entry?.height, 512, `${file}: v2 manifest height`);
    digests.add(digest);
  }
  assert.ok(total <= 1024 * 1024, 'v2 기본 뒷면 전체 모바일 자산은 1MiB 이하');
  assert.equal(digests.size, 12, '모양·재질별 v2 이미지가 서로 다르다');
});

test('all twelve current fixed back WebPs and their mapping module are served from the three explicit web prefixes', async () => {
  const server = createProductionServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const prefix of ['/assets/', '/app/assets/', '/merchant/assets/']) {
      const module = await fetch(`${base}${prefix}collectible-back-assets.mjs`);
      assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /text\/javascript/);
      for (const file of COLLECTIBLE_BACK_FILES) {
        const path = `${prefix}collectible-backs/v2/${file}`;
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 200, path); assert.equal(response.headers.get('content-type'), 'image/webp');
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF', path);
        assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), 'WEBP', path);
      }
      assert.equal((await fetch(`${base}${prefix}collectible-backs/v1/circle-bronze.png`)).status, 404, '삭제한 v1 자산은 제공하지 않는다');
      assert.equal((await fetch(`${base}${prefix}collectible-backs/v2/circle-bronze.png`)).status, 404, '확정 확장자만 제공한다');
      assert.equal((await fetch(`${base}${prefix}collectible-backs/v3/circle-bronze.webp`)).status, 404, '미확정 버전은 제공하지 않는다');
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
