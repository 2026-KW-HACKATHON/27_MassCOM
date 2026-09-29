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
  'assets/project.css',
  'assets/wallet-mark.svg',
  'evidence/android-collection.png',
  'evidence/android-merchant-list.png',
  'evidence/screenshots/android-account-settings.png',
  'evidence/screenshots/android-nft-finalized.png',
  'index.html',
  'nft-metadata/base-sepolia-proof/1.json',
  'open.html',
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

test('published NFT metadata stays a plain public record without personal or visit details', async () => {
  const metadata = JSON.parse(await readFile(join(repoRoot, 'docs/nft-metadata/base-sepolia-proof/1.json'), 'utf8'));
  // Allowlist: any new key (image, external_url, …) must be added here on purpose after a privacy review.
  assert.deepEqual(Object.keys(metadata).sort(), ['attributes', 'description', 'name']);
  assert.equal(typeof metadata.name, 'string');
  assert.equal(typeof metadata.description, 'string');
  assert.deepEqual(metadata.attributes.map((attribute) => attribute.trait_type).sort(), ['발행 방식', '양도', '환경'].sort());
  for (const attribute of metadata.attributes) assert.deepEqual(Object.keys(attribute).sort(), ['trait_type', 'value']);
  // AGENTS.md: no personal data, order number or exact meal time on-chain or in token metadata. Only unambiguous backstops here.
  const text = JSON.stringify(metadata);
  for (const forbidden of [/@/, /0x[0-9a-fA-F]{40,}/, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/]) {
    assert.doesNotMatch(text, forbidden, String(forbidden));
  }
});

test('the token URI recorded on-chain is served by the public bundle', async () => {
  const deployment = JSON.parse(await readFile(join(repoRoot, 'docs/evidence/base-sepolia-deployment.json'), 'utf8'));
  const origin = 'https://masscom.kr/';
  const tokenUri = deployment.workerProof.tokenUri;
  assert.ok(tokenUri.startsWith(deployment.proofSeries.metadataBase), tokenUri);
  assert.ok(tokenUri.startsWith(origin), tokenUri);
  assert.ok(expected.includes(tokenUri.slice(origin.length)), tokenUri);
});
