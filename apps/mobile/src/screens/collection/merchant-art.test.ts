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
