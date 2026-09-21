import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertCredential, headersForCredential } from './account-credential';

test('bearer and demo headers are mutually exclusive', () => {
  assert.deepEqual(
    headersForCredential({ kind: 'bearer', sessionToken: 'server-session' }),
    { Authorization: 'Bearer server-session' },
  );
  assert.deepEqual(
    headersForCredential({
      kind: 'demo',
      accountId: 'customer-1',
      allowInsecureReauthentication: false,
    }),
    { 'x-account-id': 'customer-1' },
  );
});

test('credential validation rejects empty identity values', () => {
  assert.throws(
    () => assertCredential({ kind: 'bearer', sessionToken: '   ' }),
    /bearer session token is required/,
  );
  assert.throws(
    () => assertCredential({
      kind: 'demo',
      accountId: '',
      allowInsecureReauthentication: false,
    }),
    /demo account ID is required/,
  );
});
