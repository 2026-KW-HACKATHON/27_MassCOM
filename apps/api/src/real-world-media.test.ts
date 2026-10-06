import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { RealWorldError } from './real-world-contract.js';
import { PostgresRealWorldMediaStore } from './real-world-media.js';

function store() {
  const rows = new Map<string, Buffer>();
  const writes: string[] = [];
  const pool = { query: async (sql: string, params: unknown[]) => {
    if (sql.startsWith('INSERT')) {
      writes.push(sql);
      rows.set(params[0] as string, params[3] as Buffer);
      return { rows: [] };
    }
    return { rows: rows.has(params[0] as string) ? [{ image_bytes: rows.get(params[0] as string) }] : [] };
  } } as unknown as Pool;
  return { media: new PostgresRealWorldMediaStore(pool), rows, writes };
}

const invalid = (error: unknown) => error instanceof RealWorldError && error.code === 'PHOTO_INVALID' && error.status === 400;

test('JPEG EXIF including GPS is stripped and orientation is applied before storing', async () => {
  const { media, rows } = store();
  // A 40x20 JPEG with EXIF Orientation=6 and GPS latitude/longitude, generated with exiftool.
  const jpeg = Buffer.from('/9j/4QCsRXhpZgAATU0AKgAAAAgAAwESAAMAAAABAAYAAAITAAMAAAABAAEAAIglAAQAAAABAAAAMgAAAAAABQAAAAEAAAAEAgMAAAABAAIAAAACTgAAAAACAAUAAAADAAAAdAADAAIAAAACRQAAAAAEAAUAAAADAAAAjAAAAAAAAAAlAAAAAQAAAB4AAAABAAAAAAAAAAEAAAB/AAAAAQAAAAAAAAABAAAAAAAAAAH/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAUACgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAcJ/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AnQBDGqYAAAAAAAAAD//Z', 'base64');
  assert.ok((await sharp(jpeg).metadata()).exif);
  const saved = await media.save(jpeg, 'image/jpeg');
  assert.deepEqual({ width: saved.width, height: saved.height }, { width: 20, height: 40 });
  const bytes = rows.get(saved.digest)!;
  assert.equal(saved.digest, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await media.read(saved.digest), bytes);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.orientation, undefined);
  assert.equal(await media.read('bad-digest'), null);
});

test('PNG and WebP decode and store as metadata-free WebP', async () => {
  const { media, rows } = store();
  for (const format of ['png', 'webp'] as const) {
    const input = await sharp({ create: { width: 13, height: 7, channels: 4, background: '#03b6f0' } })[format]().toBuffer();
    const saved = await media.save(input, `image/${format}`);
    assert.equal((await sharp(rows.get(saved.digest)).metadata()).format, 'webp');
    assert.deepEqual([saved.width, saved.height], [13, 7]);
  }
});

test('rejects malformed, mismatched, animated and overlarge decoded images', async () => {
  const { media } = store();
  const jpeg = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } }).jpeg().toBuffer();
  await assert.rejects(media.save(Buffer.from('not an image'), 'image/jpeg'), invalid);
  await assert.rejects(media.save(jpeg, 'image/png'), invalid);
  await assert.rejects(media.save(Buffer.concat([Buffer.from('GIF89a'), jpeg]), 'image/jpeg'), invalid);
  await assert.rejects(media.save(Buffer.concat([jpeg, Buffer.from('<script>')]), 'image/jpeg'), invalid);
  await assert.rejects(media.save(Buffer.alloc(3 * 1024 * 1024 + 1, 0xff), 'image/jpeg'),
    (error: unknown) => error instanceof RealWorldError && error.code === 'UPLOAD_LIMIT' && error.status === 413);
  const twoFrameGif = Buffer.from('47494638396101000100800000ffffff00000021f90401000000002c000000000100010000020244010021f90401000000002c00000000010001000002024c01003b', 'hex');
  const animated = await sharp(twoFrameGif, { animated: true }).webp().toBuffer();
  await assert.rejects(media.save(animated, 'image/webp'), invalid);
  const huge = await sharp({ create: { width: 4097, height: 4097, channels: 3, background: 'red' } })
    .png().toBuffer();
  await assert.rejects(media.save(huge, 'image/png'), invalid);
});

test('large valid images fit inside 2048 pixels without enlargement', async () => {
  const { media } = store();
  const large = await sharp({ create: { width: 4000, height: 2000, channels: 3, background: 'blue' } }).png().toBuffer();
  assert.deepEqual(await media.save(large, 'image/png').then(({ width, height }) => [width, height]), [2048, 1024]);
});

test('saving the same digest refreshes retention grace for a pending photo attach', async () => {
  const { media, rows, writes } = store();
  const input = await sharp({ create: { width: 12, height: 8, channels: 3, background: 'green' } }).jpeg().toBuffer();
  const first = await media.save(input, 'image/jpeg');
  assert.deepEqual(await media.save(input, 'image/jpeg'), first);
  assert.equal(rows.size, 1);
  assert.equal(writes.length, 2);
  assert.match(writes[1]!, /ON CONFLICT \(digest\) DO UPDATE SET created_at = now\(\)/i);
});
