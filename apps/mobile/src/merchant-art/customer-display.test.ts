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

// Every customer surface asks the art bridge with the merchant's own art path and the API origin; the bridge decides the order
// (owner's AI picture, then the bundled showcase picture, then the glyph), which art-source.test.ts checks by behavior.
test('list crest, map pin, detail hero, stamp page and collection card all draw through the art bridge with the merchant art path and API origin', () => {
  assert.match(read('screens/merchant-list/merchant-crest.tsx'), /merchantArtSource\(merchant, apiUrl\)/);
  assert.match(read('screens/merchant-list/index.tsx'), /<MerchantCrest merchant=\{merchant\} apiUrl=\{apiUrl\} \/>/);
  assert.match(read('screens/town-map/town-pin.tsx'), /merchantArtSource\(\{ id: pin\.merchantId, artUrl: pin\.artUrl \}, apiUrl\)/);
  assert.match(read('screens/town-map/index.tsx'), /<TownPinButton[\s\S]*?apiUrl=\{apiUrl\}[\s\S]*?\/>/);
  assert.match(read('screens/merchant-detail/index.tsx'), /merchantArt\(merchant, apiUrl\)/);
  assert.match(read('ui/passport-stamp-page.tsx'), /merchantArtSource\(\{ id: stamp\.merchantId, artUrl: stamp\.artUrl \}, apiUrl\)/);
  const collection = read('screens/collection/index.tsx');
  assert.match(collection, /<PassportStampPage apiUrl=\{apiUrl\}/);
  assert.match(collection, /toPassportStamp\(slot, merchantGoals\[index\]!, artUrlByMerchant\.get\(slot\.merchantId\) \?\? null\)/);
  assert.match(collection, /merchantArt\(\{ id: item\.merchantId, artUrl: artUrlByMerchant\.get\(item\.merchantId\) \}, apiUrl\)/);
});

test('the collection card no longer reaches into the showcase asset module and names an AI picture as one', () => {
  const collection = read('screens/collection/index.tsx');
  assert.doesNotMatch(collection, /showcase-collectible-art-assets|showcaseCollectibleArtKey|showcaseCollectibleArtSource/);
  // The AI picture's note is its own line (no "not an NFT" clause borrowed); the showcase note keeps it. The words are checked by
  // behavior in art-source.test.ts.
  assert.match(collection, /collectibleArtNote\(art\.fromServer\)/);
  assert.doesNotMatch(collection, /실제 NFT 발행 증거 아님/);
  assert.match(collection, /useArtFallback\(art\.source\)/);
});

test('customer screens use the art bridge except for validated acquired inline media; owner art screens can preview API data URLs', () => {
  const inlineMediaScreens = new Set(['screens/collection/index.tsx', 'screens/collection/collectible-detail.tsx']);
  const offenders = [...sources(join(src, 'screens')), ...sources(join(src, 'ui'))]
    .map((path) => ({ path, name: relative(src, path).replaceAll('\\', '/') }))
    .filter(({ path, name }) => !name.startsWith('screens/merchant-art/') && !inlineMediaScreens.has(name) && /\{ uri:/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(offenders.map(({ name }) => name), []);
  assert.match(read('commerce/commerce-api.ts'), /parsePublishedCollectible/);
  assert.match(read('commerce/collectible-artwork.ts'), /data:image/);
  assert.doesNotMatch(read('screens/collection/collectible-detail.tsx'), /https?:\/\//);
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
  assert.match(read('ui/back-header.tsx'), /<StoreArt source=\{art\} height=\{height\} note=\{artNote\} onError=\{onArtError\} \/>/);
  assert.match(read('ui/store-art.tsx'), /<Image source=\{source\} onError=\{onError\}/);
  assert.match(read('screens/collection/index.tsx'), /<Image source=\{source\} onError=\{onError\}/);
});
