import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../', import.meta.url));
const read = (relative: string) => readFileSync(join(src, relative), 'utf8');

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [path] : [];
  });
}

// Legacy collectible art retains its fallback bridge; discovery renders separately labelled owner photos.
test('legacy collectible art uses the fallback bridge while discovery only renders published owner photos', () => {
  assert.match(read('screens/merchant-list/merchant-crest.tsx'), /merchantArtSource\(merchant, apiUrl\)/);
  assert.match(read('screens/merchant-list/index.tsx'), /<RealMapScreen[^>]*initialMode="list"/);
  assert.match(read('screens/real-map/index.tsx'), /merchant\.thumbnail&&publishedPhotoUri\(apiUrl,merchant\.thumbnail\.url\)/);
  assert.match(read('screens/town-map/town-pin.tsx'), /merchantArtSource\(\{ id: pin\.merchantId, artUrl: pin\.artUrl \}, apiUrl\)/);
  assert.match(read('screens/town-map/index.tsx'), /<TownPinButton[\s\S]*?apiUrl=\{apiUrl\}[\s\S]*?\/>/);
  const detail = read('screens/merchant-detail/index.tsx');
  assert.match(detail, /leadPhoto=photos\.find\(photo=>publishedPhotoUri\(apiUrl,photo\.url\)\)/);
  assert.match(detail, /photos\.filter\(photo=>photo\.id!==leadPhoto\?\.id&&publishedPhotoUri\(apiUrl,photo\.url\)\)/);
  assert.match(read('ui/passport-stamp-page.tsx'), /merchantArtSource\(\{ id: stamp\.merchantId, artUrl: stamp\.artUrl \}, apiUrl\)/);
  const collection = read('screens/collection/index.tsx');
  assert.match(collection, /<PassportStampPage apiUrl=\{apiUrl\}/);
  assert.match(collection, /toPassportStamp\(slot, merchantGoals\[index\]!, artUrlByMerchant\.get\(slot\.merchantId\) \?\? null\)/);
  // #296: the merged album moved the legacy (no-artwork) card's own picture into CollectibleBrowser.
  assert.match(read('screens/collection/collectible-browser.tsx'), /merchantArt\(\{ id: item\.merchantId, artUrl \}, mint\.apiUrl\)/);
});

test('the collection card no longer reaches into the showcase asset module and names an AI picture as one', () => {
  const collection = read('screens/collection/index.tsx');
  assert.doesNotMatch(collection, /showcase-collectible-art-assets|showcaseCollectibleArtKey|showcaseCollectibleArtSource/);
  // The AI picture's note is its own line (no "not an NFT" clause borrowed); the showcase note keeps it. The words are checked by
  // behavior in art-source.test.ts. #296: this card now lives in CollectibleBrowser (the merged album), not index.tsx.
  const browser = read('screens/collection/collectible-browser.tsx');
  assert.match(browser, /collectibleArtNote\(art\.fromServer\)/);
  assert.doesNotMatch(collection, /실제 NFT 발행 증거 아님/);
  assert.match(browser, /useArtFallback\(art\?\.source\)/);
});

test('customer screens use the art bridge except for validated collectible inline media; owner art screens can preview API data URLs', () => {
  const inlineMediaScreens = new Set([
    // #354: 공개 수집품 API도 도감과 같은 검증된 인라인 썸네일만 제공한다.
    'screens/merchant-detail/index.tsx',
    'screens/collection/index.tsx',
    'screens/collection/collectible-detail.tsx',
    'screens/collection/collectible-reveal.tsx',
    'screens/collection/envelope/envelope-card.tsx',
    'screens/collection/collectible-browser.tsx',
    'screens/collection/collectible-share.tsx',
    // #349: 검증된 수집품 사진 또는 기존 art bridge가 고른 그림의 알파만 재사용하는 재질 마스크다.
    'screens/collection/grade-material-layer.tsx',
    // #332: the 인스타 카드 draws the same validated data-URL thumbnails (never a remote URL), just six at a time.
    'screens/collection/collection-share.tsx',
    // 게임 카드도 commerce-api가 검증한 보유 수집품 인라인 그림만 사용한다.
    'screens/play/play-art.tsx',
    'screens/play/quality-session.tsx',
    'screens/real-map/index.tsx',
    // 가게 코인도 발행 수집품 파서가 확인한 인라인 썸네일만 표시한다.
    'screens/coin-shop/index.tsx',
    'screens/coin-collection/index.tsx',
    // 코스 장면은 course-api가 parseCollectibleArtwork로 검증한 가게별 코인 썸네일만 사용한다.
    'screens/courses/index.tsx',
    // 새 등급 뽑기 응답도 grade-draw-api가 검증한 인라인 썸네일만 그린다.
    'screens/shop/grade-draw-machine.tsx',
  ]);
  const offenders = [...sources(join(src, 'screens')), ...sources(join(src, 'ui'))]
    .map((path) => ({ path, name: relative(src, path).replaceAll('\\', '/') }))
    .filter(({ path, name }) => !name.startsWith('screens/merchant-art/') && !inlineMediaScreens.has(name) && /\{ uri:/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders.map(({ name }) => name), []);
  assert.match(read('commerce/commerce-api.ts'), /parsePublishedCollectible/);
  assert.match(read('commerce/collectible-artwork.ts'), /data:image/);
  assert.match(read('merchant/collectible-preview-api.ts'), /data:image/);
  for (const file of ['screens/coin-shop/index.tsx', 'screens/coin-collection/index.tsx']) {
    assert.match(read(file), /parseCollectibleArtwork\([^)]*\.summary\)/);
    assert.match(read(file), /\.thumbnailDataUrl/);
    assert.doesNotMatch(read(file), /uri: (?:coin|entry|result)\.summary/);
  }
  assert.match(read('shop/grade-draw-api.ts'), /parseCollectibleArtwork\(value\.artwork\)/);
  assert.match(read('screens/shop/grade-draw-machine.tsx'), /reward\.artwork\.thumbnailDataUrl/);
  assert.match(read('screens/play/quality-session.tsx'), /if \(item\.uri\) return <Image source=\{\{ uri: item\.uri \}\}/);
  assert.match(read('screens/play/play-content.ts'), /url\.origin === base\.origin \? url\.toString\(\) : undefined/);
  assert.match(read('screens/real-map/index.tsx'), /merchant\.thumbnail&&publishedPhotoUri\(apiUrl,merchant\.thumbnail\.url\)/);
  assert.doesNotMatch(read('screens/merchant-detail/index.tsx'), /https?:\/\//);
  assert.doesNotMatch(read('screens/collection/collectible-detail.tsx'), /https?:\/\//);
  assert.doesNotMatch(read('screens/collection/grade-material-layer.tsx'), /https?:\/\/|fetch\(/);
});

test('the friend passport stays glyph-only: it never asks the art bridge', () => {
  for (const file of ['screens/friends/passport.tsx', 'screens/friends/index.tsx']) {
    assert.doesNotMatch(read(file), /merchantArt|merchant-art/, file);
  }
});

// A stale catalog can still point at art that was reset and now answers 404: every surface that draws the API picture drops it for
// the glyph (or the sky) when the picture fails to load. The rule itself is checked by behavior in art-source.test.ts.
test('every surface that draws the API picture falls back when it fails to load', () => {
  const crest = read('screens/merchant-list/merchant-crest.tsx');
  assert.match(crest, /const \{ source: art, onError \} = useArtFallback\(merchantArtSource\(merchant, apiUrl\)\);/);
  assert.match(crest, /<Image source=\{art\} onError=\{onError\}/);
  const pin = read('screens/town-map/town-pin.tsx');
  assert.match(pin, /useArtFallback\(merchantArtSource\(\{ id: pin\.merchantId, artUrl: pin\.artUrl \}, apiUrl\)\)/);
  assert.equal((pin.match(/<Image source=\{art\} onError=\{onError\}/g) ?? []).length, 2, 'visited and not yet visited marks');
  const stamp = read('ui/passport-stamp-page.tsx');
  assert.match(stamp, /useArtFallback\(merchantArtSource\(\{ id: stamp\.merchantId, artUrl: stamp\.artUrl \}, apiUrl\)\)/);
  assert.match(stamp, /<Image source=\{art\} onError=\{onError\}/);
  // The detail hero goes through the header, which hands the error back so the page can stop passing the picture.
  assert.match(read('ui/back-header.tsx'), /<StoreArt source=\{art\} height=\{180\} note=\{artNote\} onError=\{onArtError\} \/>/);
  assert.match(read('ui/store-art.tsx'), /<Image source=\{source\} onError=\{onError\}/);
  // #296: the merged album's legacy (no-artwork) card lives in CollectibleBrowser now, not index.tsx.
  assert.match(read('screens/collection/collectible-browser.tsx'), /<Image source=\{source\} onError=\{onError\}/);
});
