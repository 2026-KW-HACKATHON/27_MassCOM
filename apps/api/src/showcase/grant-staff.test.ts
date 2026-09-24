import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { staffAccountIdForHash } from './grant-staff.js';

test('staff subject hash resolves only a matching verified Google identity row', () => {
  const wantedHash = createHash('sha256').update('invited-subject').digest('hex');
  assert.equal(staffAccountIdForHash([
    { account_id: 'customer', subject: 'other-subject' },
    { account_id: 'staff', subject: 'invited-subject' },
  ], wantedHash), 'staff');
  assert.throws(() => staffAccountIdForHash([
    { account_id: 'customer', subject: 'other-subject' },
  ], wantedHash), /SHOWCASE_STAFF_NOT_ELIGIBLE/);
});

test('malformed or ambiguous staff hash never selects a role target', () => {
  assert.throws(() => staffAccountIdForHash([], 'not-a-hash'), /SHOWCASE_STAFF_NOT_ELIGIBLE/);
  const wantedHash = createHash('sha256').update('same-subject').digest('hex');
  assert.throws(() => staffAccountIdForHash([
    { account_id: 'first', subject: 'same-subject' },
    { account_id: 'second', subject: 'same-subject' },
  ], wantedHash), /SHOWCASE_STAFF_NOT_ELIGIBLE/);
});
