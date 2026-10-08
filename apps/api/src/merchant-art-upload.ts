import sharp from 'sharp';

import { MerchantArtError } from './merchant-art.js';
import { completeImage } from './real-world-media.js';

const maxUploadBytes = 5 * 1024 * 1024;
const uploadFormats = { jpeg: 'jpeg', png: 'png', webp: 'webp' } as const;

export async function normalizeMerchantArtUpload(imageDataUrl: string): Promise<Buffer> {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageDataUrl);
  if (!match) throw new MerchantArtError('MERCHANT_ART_IMAGE_INVALID');
  const encoded = match[2]!;
  if (encoded.length > 4 * Math.ceil(maxUploadBytes / 3)) throw new MerchantArtError('MERCHANT_ART_IMAGE_TOO_LARGE');
  if (encoded.length % 4 !== 0) throw new MerchantArtError('MERCHANT_ART_IMAGE_INVALID');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > maxUploadBytes) throw new MerchantArtError('MERCHANT_ART_IMAGE_TOO_LARGE');
  const mimeType = `image/${match[1]}` as 'image/jpeg' | 'image/png' | 'image/webp';
  if (bytes.toString('base64') !== encoded || !completeImage(bytes, mimeType)) {
    throw new MerchantArtError('MERCHANT_ART_IMAGE_INVALID');
  }
  let image: Buffer;
  try {
    const source = sharp(bytes, { animated: true, limitInputPixels: 4096 * 4096, failOn: 'warning' });
    const metadata = await source.metadata();
    if (metadata.format !== uploadFormats[match[1] as keyof typeof uploadFormats] ||
        metadata.pages !== undefined && metadata.pages !== 1 || !metadata.width || !metadata.height ||
        metadata.width * metadata.height > 4096 * 4096) throw new Error('invalid image');
    image = await source.rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
  } catch {
    throw new MerchantArtError('MERCHANT_ART_IMAGE_INVALID');
  }
  if (image.length > maxUploadBytes) throw new MerchantArtError('MERCHANT_ART_IMAGE_TOO_LARGE');
  return image;
}
