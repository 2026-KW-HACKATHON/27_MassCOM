import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isMigrationFilename } from './postgres/migrate.js';

test('migration discovery accepts numbered SQL files and rejects macOS metadata sidecars', () => {
  assert.equal(isMigrationFilename('0001_merchant_catalog.sql'), true);
  assert.equal(isMigrationFilename('0010_auth_sessions.sql'), true);
  assert.equal(isMigrationFilename('._0001_merchant_catalog.sql'), false);
  assert.equal(isMigrationFilename('.hidden.sql'), false);
  assert.equal(isMigrationFilename('README.sql'), false);
  assert.equal(isMigrationFilename('0001_merchant_catalog.sql.bak'), false);
});
