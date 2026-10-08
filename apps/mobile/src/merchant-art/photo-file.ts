export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export class PhotoFileError extends Error {
  constructor(readonly code: 'TYPE' | 'SIZE' | 'READ') {
    super(code);
  }
}

export function checkPhotoFile(type: string, size: number): void {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) throw new PhotoFileError('TYPE');
  if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) throw new PhotoFileError('SIZE');
}

export function photoFileErrorMessage(error: unknown): string {
  if (error instanceof PhotoFileError) {
    if (error.code === 'TYPE') return 'JPG, PNG, WebP 사진만 선택할 수 있어요.';
    if (error.code === 'SIZE') return '5MB 이하 사진을 선택해 주세요.';
  }
  return '사진을 읽지 못했어요. 다시 선택해 주세요.';
}
