import { checkPhotoFile, PhotoFileError } from './photo-file';

export async function pickMerchantPhoto(): Promise<string | null> {
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
  if (!file) return null;
  checkPhotoFile(file.type, file.size);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new PhotoFileError('READ'));
    reader.onerror = () => reject(new PhotoFileError('READ'));
    reader.readAsDataURL(file);
  });
}
