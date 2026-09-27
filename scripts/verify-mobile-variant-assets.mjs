import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const productionAssets = resolve(process.argv[2] ?? join(root, 'apps/mobile/dist/production/assets'));
const showcaseAssets = resolve(process.argv[3] ?? join(root, 'apps/mobile/dist/showcase/assets'));
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const bundleDigests = (directory) => new Set(readdirSync(directory).map((name) => digest(join(directory, name))));
const production = bundleDigests(productionAssets);
const showcase = bundleDigests(showcaseAssets);

for (const name of ['a', 'b', 'c']) {
  const source = digest(join(root, `apps/mobile/assets/images/collectibles/showcase-${name}.png`));
  if (production.has(source)) throw new Error(`OPERATING_BUNDLE_CONTAINS_SHOWCASE_ART:${name}`);
  if (!showcase.has(source)) throw new Error(`SHOWCASE_BUNDLE_MISSING_ART:${name}`);
}

console.log('Android variant asset boundary verified');
