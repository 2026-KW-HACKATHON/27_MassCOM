import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldInvalidateSession } from './session-invalid';

test('invalidates only a rejected bearer session', () => {
  assert.equal(
    shouldInvalidateSession({ kind: 'bearer', sessionToken: 'live' }, 401, 'SESSION_INVALID'),
    true,
  );
  assert.equal(
    shouldInvalidateSession(
      { kind: 'demo', accountId: 'demo', allowInsecureReauthentication: false },
      401,
      'SESSION_INVALID',
    ),
    false,
  );
  assert.equal(
    shouldInvalidateSession({ kind: 'bearer', sessionToken: 'live' }, 403, 'SESSION_INVALID'),
    false,
  );
});
