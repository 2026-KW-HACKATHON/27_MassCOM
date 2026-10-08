import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createProductionServer } from '../../apps/production-web/server.mjs';
import { COLLECTIBLE_BACK_VERSION, COLLECTIBLE_BACK_SHAPES, COLLECTIBLE_BACK_GRADES, COLLECTIBLE_BACK_FILES, fixedCollectibleBack } from '../../apps/production-web/assets/collectible-back-assets.mjs';

test('fixed back mapping defines twelve unique immutable versioned shape and grade combinations', () => {
  assert.equal(COLLECTIBLE_BACK_VERSION, 'v1');
  assert.deepEqual(COLLECTIBLE_BACK_SHAPES, ['circle', 'stamp', 'serrated']);
  assert.deepEqual(COLLECTIBLE_BACK_GRADES, ['bronze', 'silver', 'gold', 'prism']);
  assert.equal(COLLECTIBLE_BACK_FILES.length, 12);
  assert.equal(new Set(COLLECTIBLE_BACK_FILES).size, 12);
  for (const shape of COLLECTIBLE_BACK_SHAPES) for (const grade of COLLECTIBLE_BACK_GRADES) {
    assert.equal(fixedCollectibleBack(shape, grade).path, `/app/assets/collectible-backs/v1/${shape}-${grade}.png`);
  }
  assert.equal(fixedCollectibleBack('unknown', 'festival-gold').path, '/app/assets/collectible-backs/v1/circle-bronze.png');
  assert.equal(fixedCollectibleBack('serrated', 'special').path, '/app/assets/collectible-backs/v1/serrated-bronze.png');
  assert.equal(fixedCollectibleBack('gear', 'silver').path, '/app/assets/collectible-backs/v1/serrated-silver.png');
  assert.equal(fixedCollectibleBack('stamp', 'festival-gold', '프리즘').path, '/app/assets/collectible-backs/v1/stamp-bronze.png', '사용자 등급 이름을 재질로 추측하지 않는다');
});

test('확정 v1 뒷면의 웹·앱 파일은 같은 바이트이며 기록된 해시와 일치한다', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../docs/evidence/fixed-collectible-backs-2026-10-08/assets.json', import.meta.url), 'utf8'));
  assert.equal(manifest.length, 12);
  const digests = new Set();
  for (const file of COLLECTIBLE_BACK_FILES) {
    const [web, mobile] = await Promise.all([
      readFile(new URL(`../../apps/production-web/assets/collectible-backs/v1/${file}`, import.meta.url)),
      readFile(new URL(`../../apps/mobile/assets/images/collectibles/backs/v1/${file}`, import.meta.url)),
    ]);
    assert.equal(web.compare(mobile), 0, `${file}: 웹과 앱의 디자인이 같다`);
    const digest = createHash('sha256').update(web).digest('hex');
    assert.equal(digest, manifest.find(asset => asset.file === file)?.sha256, `${file}: v1 확정 디자인을 교체하지 않는다`);
    assert.ok(web.readUInt32BE(16) >= 512 && web.readUInt32BE(20) >= 512, `${file}: 게시 크기 이상의 원본`);
    digests.add(digest);
  }
  assert.equal(digests.size, 12, '모양·재질별 이미지가 서로 다르다');
});

test('all twelve fixed back PNGs and their mapping module are served from the three explicit web prefixes', async () => {
  const server = createProductionServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const prefix of ['/assets/', '/app/assets/', '/merchant/assets/']) {
      const module = await fetch(`${base}${prefix}collectible-back-assets.mjs`);
      assert.equal(module.status, 200); assert.match(module.headers.get('content-type'), /text\/javascript/);
      for (const file of COLLECTIBLE_BACK_FILES) {
        const path = `${prefix}collectible-backs/v1/${file}`;
        const response = await fetch(`${base}${path}`);
        assert.equal(response.status, 200, path); assert.equal(response.headers.get('content-type'), 'image/png');
        const bytes = new Uint8Array(await response.arrayBuffer());
        assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], path);
      }
      assert.equal((await fetch(`${base}${prefix}collectible-backs/v1/circle-special.png`)).status, 404, '임의 파일 이름은 제공하지 않는다');
      assert.equal((await fetch(`${base}${prefix}collectible-backs/v2/circle-bronze.png`)).status, 404, '미확정 버전은 제공하지 않는다');
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
