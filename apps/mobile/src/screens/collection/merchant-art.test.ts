import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../', import.meta.url));

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('merchant artwork reaches screens only through the metro-swapped showcase selection module', () => {
  const art = readFileSync(fileURLToPath(new URL('./merchant-art.ts', import.meta.url)), 'utf8');
  assert.match(art, /from '\.\/showcase-collectible-art-assets'/);
  assert.match(art, /showcaseCollectibleArtKey\(Application\.applicationId, merchantId\)/);
  const offenders = sources(src).filter((path) => {
    if (path.endsWith('.test.ts')) return false;
    if (path.endsWith('showcase-collectible-art-assets.showcase.ts')) return false;
    return /collectibles\/showcase-[abc]\.png/.test(readFileSync(path, 'utf8'));
  });
  assert.deepEqual(offenders, [], 'showcase art must be required only from the .showcase.ts selection file');
});

test('production selection returns no art so the operating bundle carries none', () => {
  const stub = readFileSync(fileURLToPath(new URL('./showcase-collectible-art-assets.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(stub, /require\(/);
});

test('the bridge takes the merchant and API origin, and lets the shared chooser put server art before the bundled art', () => {
  const art = readFileSync(fileURLToPath(new URL('./merchant-art.ts', import.meta.url)), 'utf8');
  assert.match(art, /export function merchantArt\(merchant: MerchantArtSubject, apiUrl\?: string\)/);
  assert.match(art, /chooseMerchantArt<ImageSourcePropType>\(\{ artUrl, apiUrl, bundled: key \? showcaseCollectibleArtSource\(key\) : undefined \}\)/);
  assert.match(art, /export function merchantArtSource\(merchant: MerchantArtSubject, apiUrl\?: string\)/);
});

test('server art adds no bundled asset: the chooser and its bridge require no image file', () => {
  const chooser = readFileSync(fileURLToPath(new URL('../../merchant-art/art-source.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(chooser, /require\(|assets\/images/);
});
