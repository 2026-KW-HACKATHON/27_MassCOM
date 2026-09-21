import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deletionCapability } from './deletion-capability';

test('blocks destructive deletion for production bearer sessions', () => {
  assert.deepEqual(
    deletionCapability({ kind: 'bearer', sessionToken: 'live' }, 'BLOCKED'),
    { allowed: false, reason: 'DESTRUCTIVE_REAUTHENTICATION_BLOCKED' },
  );
});

test('allows only the explicit development DEMO reauthentication fixture', () => {
  assert.deepEqual(
    deletionCapability(
      { kind: 'demo', accountId: 'demo', allowInsecureReauthentication: true },
      'BLOCKED',
    ),
    { allowed: true },
  );
  assert.deepEqual(
    deletionCapability(
      { kind: 'demo', accountId: 'demo', allowInsecureReauthentication: false },
      'BLOCKED',
    ),
    { allowed: false, reason: 'DEMO_REAUTHENTICATION_REQUIRED' },
  );
});
