import assert from 'node:assert/strict';
import test from 'node:test';
import { isCollectibleArtwork, appendCollectibleArtwork, clearCollectibleViewers } from '../../apps/production-web/assets/collectible-viewer.mjs';
import { createProductionServer } from '../../apps/production-web/server.mjs';

const art = { publicationId: 'published', gradeId: 'bronze', gradeName: '브론즈', name: '방문 코인', thumbnailDataUrl: 'data:image/png;base64,iVBORw0KGgo=' };
test('수집품 목록은 인라인 정적 이미지만 받고 원격·SVG 그림을 거절한다', () => {
  assert.equal(Boolean(isCollectibleArtwork(art)), true);
  for (const thumbnailDataUrl of ['https://private.example/photo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'javascript:alert(1)', `data:image/png;base64,${'A'.repeat(400000)}`]) {
    assert.equal(Boolean(isCollectibleArtwork({ ...art, thumbnailDataUrl })), false);
  }
  assert.equal(Boolean(isCollectibleArtwork(null)), false);
});
test('썸네일 목록 구성은 상세 요청이나 움직임을 자동 실행하지 않는다', () => {
  const doc = { createElement: tag => ({ tag, children: [], append(...children) { this.children.push(...children); }, addEventListener(type, action) { this[type] = action; } }) };
  const card = doc.createElement('article');
  appendCollectibleArtwork(doc, card, { artwork: art, entitlementId: 'owned' }, () => { throw new Error('목록에서 미디어를 요청하면 안 됨'); });
  assert.deepEqual(card.children.map(node => node.tag), ['img', 'p', 'button']);
  assert.equal(card.children[0].src, art.thumbnailDataUrl);
  assert.equal(card.children[1].textContent, '방문 코인 · 브론즈');
  clearCollectibleViewers(doc);
});
test('페이지가 불러오는 모듈이 상대 경로로 가져오는 모듈도 모두 같은 경로에서 제공한다(새 파일을 허용 목록에 빠뜨리면 페이지 전체가 멈춘다)', async () => {
  const { readFileSync } = await import('node:fs');
  const assetDir = new URL('../../apps/production-web/assets/', import.meta.url);
  const server = createProductionServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [prefix, entry] of [['/merchant/assets/', 'merchant.mjs'], ['/assets/', 'production.mjs'], ['/admin/assets/', 'admin.mjs']]) {
      const seen = new Set(), queue = [entry];
      while (queue.length) {
        const file = queue.shift();
        if (seen.has(file)) continue;
        seen.add(file);
        const response = await fetch(`${base}${prefix}${file}`);
        assert.equal(response.status, 200, `${prefix}${file}`);
        const source = readFileSync(new URL(file, assetDir), 'utf8');
        for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"]\.\/([\w.-]+\.(?:mjs|css))['"]/g)) queue.push(match[1]);
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('제작기와 도감의 모듈·스타일은 허용된 정적 경로에서만 제공한다', async () => {
  const server = createProductionServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/merchant/assets/collectible-model.mjs', '/merchant/assets/collectible-errors.mjs', '/merchant/assets/collectible-studio.mjs', '/merchant/assets/collectible-renderer.mjs', '/merchant/assets/collectible-editor.css', '/assets/collectible-viewer.mjs', '/assets/collectible-viewer.css']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    assert.equal((await fetch(`${base}/assets/../../src/server.ts`)).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
