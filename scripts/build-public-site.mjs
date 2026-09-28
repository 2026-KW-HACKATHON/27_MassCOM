import { copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const publicFiles = [
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
  'privacy.html',
];
const sources = [
  ...publicFiles.map((file) => ({ source: join('docs', file), target: file })),
  { source: join('apps', 'showcase-web', 'index.html'), target: join('preview', 'index.html') },
  { source: join('apps', 'showcase-web', 'assets', 'showcase.css'), target: join('preview', 'assets', 'showcase.css') },
  { source: join('apps', 'showcase-web', 'assets', 'mascot-stamp.png'), target: join('preview', 'assets', 'mascot-stamp.png') },
];

export async function buildPublicSite(repoRoot, targetDirectory) {
  const target = resolve(targetDirectory);
  for (const file of sources) {
    const source = await lstat(join(repoRoot, file.source));
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
    for (const file of sources) {
      await mkdir(dirname(join(target, file.target)), { recursive: true });
      await copyFile(join(repoRoot, file.source), join(target, file.target));
    }
    return sources.map((file) => file.target);
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
