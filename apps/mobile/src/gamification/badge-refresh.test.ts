import assert from 'node:assert/strict';
import { test } from 'node:test';

import { quietBadgeRefreshCodes, shouldRefreshBadgesQuietly } from './badge-refresh';

test('shouldRefreshBadgesQuietly matches exactly the codes that mean the local badge book is stale', () => {
  for (const code of quietBadgeRefreshCodes) assert.equal(shouldRefreshBadgesQuietly(code), true, code);
  assert.equal(shouldRefreshBadgesQuietly('SOMETHING_ELSE'), false);
  assert.equal(shouldRefreshBadgesQuietly(undefined), false);
});
