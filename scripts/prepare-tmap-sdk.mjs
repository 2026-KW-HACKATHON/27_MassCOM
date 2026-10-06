import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const zip = process.argv[2];
if (!zip) throw Error('Usage: node scripts/prepare-tmap-sdk.mjs /path/to/TMapVSMSDK_3.7.zip');
const expected = {
  zip: '513a1c170487306d62bb7dbb48604ecb73e61be3156ede1a892188ea49d9e008',
  'tmap-sdk-3.7.aar': 'fa1aee4c1cd9f484b67fdd510f42d6ef42bcdd8997b55aa7e2e54b9ac34979a9',
  'vsm-tmap-sdk-v2-eaa-2.0.14.aar': '62df36369e356cb28408cebfb653beddc304c7df44eca45181b6a0ad06f72b3d',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (hash(await readFile(zip)) !== expected.zip) throw Error('SDK ZIP hash mismatch');
const dest = new URL('../apps/mobile/modules/tmap-map/android/libs/', import.meta.url);
await mkdir(dest, { recursive: true });
for (const [filename, digest] of Object.entries(expected)) {
  if (filename === 'zip') continue;
  const bytes = execFileSync('unzip', ['-p', zip, `*lib/${filename}`], { maxBuffer: 30_000_000 });
  if (hash(bytes) !== digest) throw Error(`${filename} hash mismatch`);
  await writeFile(new URL(filename, dest), bytes);
  process.stdout.write(`${filename}: verified and prepared\n`);
}
