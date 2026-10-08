import { File } from 'expo-file-system';

import { checkPhotoFile, PhotoFileError } from './photo-file';

export async function pickMerchantPhoto(): Promise<string | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['image/jpeg', 'image/png', 'image/webp'], multipleFiles: false });
  if (picked.canceled) return null;
  const file = picked.result;
  checkPhotoFile(file.type, file.size);
  try {
    const base64 = await file.base64();
    if (!base64) throw new Error('empty file');
    return `data:${file.type};base64,${base64}`;
  } catch {
    throw new PhotoFileError('READ');
  }
}
