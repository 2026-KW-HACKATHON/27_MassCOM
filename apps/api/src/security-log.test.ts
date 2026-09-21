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

test('uses a fixed error name when Error.name contains secret data', () => {
  const signature = `0x${'cd'.repeat(65)}`;
  const error = new Error('private detail');
  error.name = `AttackerControlled-${signature}`;

  const metadata = safeErrorMetadata('wallet.verify.failed', error);

  assert.deepEqual(metadata, {
    event: 'wallet.verify.failed',
    errorName: 'Error',
  });
  assert.equal(JSON.stringify(metadata).includes(signature), false);
});

test('does not invoke hostile Error property getters', () => {
  const error = new Error('private detail');
  Object.defineProperties(error, {
    name: {
      get: () => {
        throw new Error('name getter must not run');
      },
    },
    code: {
      get: () => {
        throw new Error('code getter must not run');
      },
    },
  });

  const metadata = safeErrorMetadata('wallet.verify.failed', error);

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
