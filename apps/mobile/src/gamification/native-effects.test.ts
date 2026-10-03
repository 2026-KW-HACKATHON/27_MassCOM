import assert from 'node:assert/strict';
import { test } from 'node:test';

import { captureRefOptions } from './native-effects';

test('without options the capture keeps the original badge settings', () => {
  assert.deepEqual(captureRefOptions(), { format: 'png', quality: 1, result: 'tmpfile', fileName: 'masscom-badge' });
  assert.deepEqual(captureRefOptions({}), captureRefOptions());
});

test('a collection card asks for an exact output size and its own file name', () => {
  assert.deepEqual(captureRefOptions({ width: 1080, height: 1350, fileName: 'masscom-collection' }), {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
    fileName: 'masscom-collection',
    width: 1080,
    height: 1350,
  });
});

test('a size is only passed along when both sides are usable, so the capture never stretches one axis', () => {
  assert.equal('width' in captureRefOptions({ width: 1080 }), false);
  assert.equal('height' in captureRefOptions({ height: 1350 }), false);
  assert.equal('width' in captureRefOptions({ width: 0, height: 1350 }), false);
  assert.equal('width' in captureRefOptions({ width: Number.NaN, height: 1350 }), false);
});
