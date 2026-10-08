import assert from 'node:assert/strict';
import { test } from 'node:test';

import sharp from 'sharp';

import { MerchantArtError } from './merchant-art.js';
import { normalizeMerchantArtUpload } from './merchant-art-upload.js';

const dataUrl = (bytes: Buffer, format: string) => `data:image/${format};base64,${bytes.toString('base64')}`;
const invalid = (error: unknown) => error instanceof MerchantArtError && error.code === 'MERCHANT_ART_IMAGE_INVALID';

test('merchant photos decode as metadata-free WebP and fit within 1024 pixels', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const bytes = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: 'red' } })
      [format]().toBuffer();
    const normalized = await normalizeMerchantArtUpload(dataUrl(bytes, format));
    const metadata = await sharp(normalized).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height, metadata.exif], ['webp', 1024, 512, undefined]);
  }
});

test('merchant photos reject mismatched, malformed, animated and oversized input', async () => {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } })
    .jpeg().toBuffer();
  for (const value of [
    dataUrl(jpeg, 'png'), dataUrl(jpeg.subarray(0, -2), 'jpeg'),
    dataUrl(Buffer.concat([jpeg, Buffer.from('<script>')]), 'jpeg'),
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,@@@@',
  ]) await assert.rejects(normalizeMerchantArtUpload(value), invalid);
  const gif = Buffer.from('47494638396101000100800000ffffff00000021f90401000000002c000000000100010000020244010021f90401000000002c00000000010001000002024c01003b', 'hex');
  const animated = await sharp(gif, { animated: true }).webp().toBuffer();
  await assert.rejects(normalizeMerchantArtUpload(dataUrl(animated, 'webp')), invalid);
  await assert.rejects(normalizeMerchantArtUpload(dataUrl(Buffer.alloc(5 * 1024 * 1024 + 1), 'jpeg')),
    (error: unknown) => error instanceof MerchantArtError && error.code === 'MERCHANT_ART_IMAGE_TOO_LARGE');
});
