import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { RealWorldError, type RealWorldMediaStore } from './real-world-contract.js';

const MAX_INPUT_BYTES = 3 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const MAX_PIXELS = 4096 * 4096;
const formats = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' } as const;

export function completeImage(bytes: Uint8Array, format: keyof typeof formats): boolean {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === 'image/jpeg') return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b.at(-2) === 0xff && b.at(-1) === 0xd9;
  if (format === 'image/png') return b.length >= 20 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.subarray(-12, -4).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68]));
  return b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' &&
    b.readUInt32LE(4) + 8 === b.length;
}

export class PostgresRealWorldMediaStore implements RealWorldMediaStore {
  constructor(private readonly pool: Pool) {}

  async save(bytes: Uint8Array, mimeType: keyof typeof formats): Promise<{ digest: string; width: number; height: number }> {
    if (bytes instanceof Uint8Array && bytes.length > MAX_INPUT_BYTES) throw new RealWorldError('UPLOAD_LIMIT', 413);
    if (!(bytes instanceof Uint8Array) || !Object.hasOwn(formats, mimeType) || !completeImage(bytes, mimeType)) {
      throw new RealWorldError('PHOTO_INVALID');
    }

    let image: Buffer;
    let width: number;
    let height: number;
    try {
      const source = sharp(bytes, { limitInputPixels: MAX_PIXELS, animated: true, failOn: 'warning' });
      const metadata = await source.metadata();
      if (metadata.format !== formats[mimeType] || metadata.pages !== undefined && metadata.pages !== 1 ||
          !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
        throw new RealWorldError('PHOTO_INVALID');
      }
      const result = await source.rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
      image = result.data;
      width = result.info.width;
      height = result.info.height;
    } catch {
      throw new RealWorldError('PHOTO_INVALID');
    }
    if (image.length > MAX_OUTPUT_BYTES) throw new RealWorldError('UPLOAD_LIMIT', 413);
    const digest = createHash('sha256').update(image).digest('hex');
    await this.pool.query(`INSERT INTO merchant_real_world_media (digest, width, height, image_bytes)
      VALUES ($1, $2, $3, $4) ON CONFLICT (digest) DO UPDATE SET created_at = now()`, [digest, width, height, image]);
    return { digest, width, height };
  }

  async read(digest: string): Promise<Uint8Array | null> {
    if (!/^[a-f0-9]{64}$/.test(digest)) return null;
    const result = await this.pool.query<{ image_bytes: Buffer }>(
      'SELECT image_bytes FROM merchant_real_world_media WHERE digest = $1', [digest]);
    return result.rows[0]?.image_bytes ?? null;
  }
}
