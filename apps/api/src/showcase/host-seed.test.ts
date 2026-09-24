import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertHostedShowcaseDatabaseName, assertHostedShowcaseDatabaseUrl } from './host-seed.js';

test('hosted seed accepts only the exact showcase database name', () => {
  assert.doesNotThrow(() => assertHostedShowcaseDatabaseName('masscom_showcase'));
  for (const name of ['masscom', 'masscom_showcase_test', 'masscom_showcase_backup', undefined]) {
    assert.throws(() => assertHostedShowcaseDatabaseName(name), /SHOWCASE_HOST_DATABASE_REQUIRED/);
  }
});

test('hosted seed command refuses operating, local-test, and modified database URLs', () => {
  const expected = 'postgresql://masscom_showcase@postgres:5432/masscom_showcase';
  assert.equal(assertHostedShowcaseDatabaseUrl(expected), expected);
  for (const raw of [
    'postgresql://masscom@postgres:5432/masscom',
    'postgresql://masscom_showcase@postgres:5432/masscom_showcase_test',
    'postgresql://masscom_showcase@operating-db:5432/masscom_showcase',
    expected + '?host=operating-db',
    expected + '#other',
    '',
  ]) {
    assert.throws(() => assertHostedShowcaseDatabaseUrl(raw), /SHOWCASE_HOST_DATABASE_REQUIRED/);
  }
});
