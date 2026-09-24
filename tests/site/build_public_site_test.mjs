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
  'privacy.html',
].sort();

test('public bundle copies only the approved pages and matching bytes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'masscom-public-site-'));
  try {
    const target = join(scratch, 'public');
    assert.deepEqual((await buildPublicSite(repoRoot, target)).sort(), expected);
    assert.deepEqual((await collectFiles(target)).sort(), expected);
    for (const file of expected) {
      assert.deepEqual(
        await readFile(join(target, file)),
        await readFile(join(repoRoot, 'docs', file)),
        file,
      );
    }
    for (const hidden of ['HANDOFF.md', 'TEST_STATUS.md', 'evidence/showcase-host-local-2026-09-24.json']) {
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
