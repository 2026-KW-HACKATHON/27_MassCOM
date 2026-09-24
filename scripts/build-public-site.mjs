import { copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const publicFiles = [
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
];

export async function buildPublicSite(repoRoot, targetDirectory) {
  const sourceRoot = join(repoRoot, 'docs');
  const target = resolve(targetDirectory);
  for (const file of publicFiles) {
    const source = await lstat(join(sourceRoot, file));
    if (!source.isFile()) throw new Error('PUBLIC_SITE_SOURCE_INVALID');
  }
  try {
    await lstat(target);
    throw new Error('PUBLIC_SITE_TARGET_EXISTS');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await mkdir(target);
  try {
    for (const file of publicFiles) {
      await mkdir(dirname(join(target, file)), { recursive: true });
      await copyFile(join(sourceRoot, file), join(target, file));
    }
    return [...publicFiles];
  } catch (error) {
    await rm(target, { recursive: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node scripts/build-public-site.mjs <new-target-directory>');
    process.exitCode = 2;
  } else {
    buildPublicSite(resolve(dirname(fileURLToPath(import.meta.url)), '..'), target)
      .then((files) => console.log(`PUBLIC_SITE_BUILT ${files.length}`))
      .catch(() => { console.error('PUBLIC_SITE_BUILD_FAILED'); process.exitCode = 1; });
  }
}
