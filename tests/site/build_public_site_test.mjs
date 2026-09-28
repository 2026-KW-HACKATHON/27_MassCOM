import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { buildPublicSite } from '../../scripts/build-public-site.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const expected = [
  '.well-known/assetlinks.json',
  'account-deletion.html',
  'assets/legal.css',
  'assets/mascot-stamp.png',
  'assets/passport/phone-coupon.png',
  'assets/passport/phone-passport.png',
  'assets/passport/phone-stamp.png',
  'assets/presentation.css',
  'assets/project.css',
  'assets/wallet-mark.svg',
  'evidence/android-collection.png',
  'evidence/android-merchant-list.png',
  'evidence/screenshots/android-account-settings.png',
  'evidence/screenshots/android-nft-finalized.png',
  'index.html',
  'open.html',
  'presentation.html',
  'preview/assets/mascot-stamp.png',
  'preview/assets/showcase.css',
  'preview/index.html',
  'privacy.html',
].sort();
const previewSources = new Map([
  ['preview/index.html', 'apps/showcase-web/index.html'],
  ['preview/assets/showcase.css', 'apps/showcase-web/assets/showcase.css'],
  ['preview/assets/mascot-stamp.png', 'apps/showcase-web/assets/mascot-stamp.png'],
]);

test('public bundle copies only the approved pages and matching bytes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'masscom-public-site-'));
  try {
    const target = join(scratch, 'public');
    assert.deepEqual((await buildPublicSite(repoRoot, target)).sort(), expected);
    assert.deepEqual((await collectFiles(target)).sort(), expected);
    for (const file of expected) {
      assert.deepEqual(
        await readFile(join(target, file)),
        await readFile(join(repoRoot, previewSources.get(file) ?? join('docs', file))),
        file,
      );
    }
    for (const hidden of ['HANDOFF.md', 'TEST_STATUS.md', 'evidence/showcase-host-local-2026-09-24.json',
      'preview/.vercel/project.json', 'preview/.env.local']) {
      assert.equal((await collectFiles(target)).includes(hidden), false, hidden);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('missing source and existing output never produce a partial or overwritten bundle', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'masscom-public-site-'));
  try {
    const emptyRoot = join(scratch, 'empty');
    await mkdir(join(emptyRoot, 'docs'), { recursive: true });
    await assert.rejects(buildPublicSite(emptyRoot, join(scratch, 'missing-output')));
    const target = join(scratch, 'existing');
    await mkdir(target);
    await writeFile(join(target, 'owned.txt'), 'preserve me');
    await assert.rejects(buildPublicSite(repoRoot, target));
    assert.equal(await readFile(join(target, 'owned.txt'), 'utf8'), 'preserve me');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

async function collectFiles(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, relative));
    else files.push(relative);
  }
  return files;
}
