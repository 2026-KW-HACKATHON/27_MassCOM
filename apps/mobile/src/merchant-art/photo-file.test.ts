import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkPhotoFile, MAX_PHOTO_BYTES, PhotoFileError, photoFileErrorMessage } from './photo-file';

test('photo selection accepts JPEG, PNG and WebP through 5 MiB, rejects empty, other types and oversized files', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.doesNotThrow(() => checkPhotoFile(type, MAX_PHOTO_BYTES));
  }
  for (const type of ['image/svg+xml', 'image/gif', '', 'application/pdf']) {
    assert.throws(() => checkPhotoFile(type, 20), (error) => error instanceof PhotoFileError && error.code === 'TYPE');
  }
  for (const size of [0, -1, MAX_PHOTO_BYTES + 1, NaN]) {
    assert.throws(() => checkPhotoFile('image/png', size), (error) => error instanceof PhotoFileError && error.code === 'SIZE');
  }
  assert.match(photoFileErrorMessage(new PhotoFileError('SIZE')), /5MB/);
  assert.match(photoFileErrorMessage(new PhotoFileError('READ')), /읽지 못했어요/);
});
