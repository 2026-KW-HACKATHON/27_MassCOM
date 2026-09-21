import assert from 'node:assert/strict';
import { test } from 'node:test';

import { safeErrorMetadata } from './security-log.js';

test('returns only allowlisted error metadata', () => {
  const signature = `0x${'ab'.repeat(65)}`;
  const error = Object.assign(new Error(`invalid signature ${signature}`), {
    code: 'SIGNER_MISMATCH',
    cause: new Error(signature),
    signature,
  });

  const metadata = safeErrorMetadata(
    'wallet.verify.failed',
    error,
    new Set(['SIGNER_MISMATCH']),
  );

  assert.deepEqual(metadata, {
    event: 'wallet.verify.failed',
    errorName: 'Error',
    errorCode: 'SIGNER_MISMATCH',
  });
  assert.equal(JSON.stringify(metadata).includes(signature), false);
});

test('omits unallowlisted string error codes', () => {
  const metadata = safeErrorMetadata(
    'wallet.verify.failed',
    Object.assign(new Error('private detail'), { code: 'PRIVATE_DETAIL' }),
    new Set(['SIGNER_MISMATCH']),
  );

  assert.deepEqual(metadata, {
    event: 'wallet.verify.failed',
    errorName: 'Error',
  });
});

test('returns the closed metadata shape for non-Error values', () => {
  const metadata = safeErrorMetadata('wallet.verify.failed', 'private thrown value');

  assert.deepEqual(metadata, {
    event: 'wallet.verify.failed',
    errorName: 'UnknownError',
  });
});
