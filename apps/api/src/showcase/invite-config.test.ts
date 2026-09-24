import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveShowcaseInviteConfig } from './invite-config.js';

const valid = {
  SHOWCASE_MODE: 'true',
  DATABASE_URL: 'postgresql://masscom_showcase@showcase-postgres:5432/masscom_showcase',
  GOOGLE_OAUTH_CLIENT_IDS: '123-showcase.apps.googleusercontent.com',
  SHOWCASE_INVITED_SUBJECT_SHA256: 'a'.repeat(64),
  ALLOW_INSECURE_DEMO_ACCOUNT: 'false',
};

test('showcase mode requires an isolated database and a nonempty invited-subject list', () => {
  const config = resolveShowcaseInviteConfig(valid);
  assert.deepEqual(config?.allowedSubjectHashes, new Set(['a'.repeat(64)]));
  for (const [name, override] of [
    ['wrong DB', { DATABASE_URL: valid.DATABASE_URL.replace(':5432/masscom_showcase', ':5432/masscom') }],
    ['missing DB', { DATABASE_URL: undefined }],
    ['missing audience', { GOOGLE_OAUTH_CLIENT_IDS: undefined }],
    ['multiple audiences', { GOOGLE_OAUTH_CLIENT_IDS: '123-showcase.apps.googleusercontent.com,456-other.apps.googleusercontent.com' }],
    ['missing invite list', { SHOWCASE_INVITED_SUBJECT_SHA256: undefined }],
    ['bad hash', { SHOWCASE_INVITED_SUBJECT_SHA256: 'not-a-hash' }],
    ['unsafe demo header', { ALLOW_INSECURE_DEMO_ACCOUNT: 'true' }],
  ] as const) {
    assert.throws(() => resolveShowcaseInviteConfig({ ...valid, ...override }),
      /SHOWCASE_CONFIGURATION_REQUIRED/, name);
  }
});

test('operating mode cannot silently accept showcase invite settings', () => {
  assert.equal(resolveShowcaseInviteConfig({}), undefined);
  assert.throws(() => resolveShowcaseInviteConfig({
    SHOWCASE_INVITED_SUBJECT_SHA256: 'a'.repeat(64),
  }), /SHOWCASE_CONFIGURATION_REQUIRED/);
});
