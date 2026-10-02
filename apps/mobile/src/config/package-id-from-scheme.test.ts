import assert from 'node:assert/strict';
import { test } from 'node:test';

import { packageIdFromScheme } from './package-id-from-scheme';

test('maps each variant scheme to its Android package, including an array-valued scheme', () => {
  assert.equal(packageIdFromScheme('masscom'), 'kr.masscom.wolgye');
  assert.equal(packageIdFromScheme('masscom-dev'), 'kr.masscom.wolgye.dev');
  assert.equal(packageIdFromScheme('masscom-demo'), 'kr.masscom.wolgye.demo');
  assert.equal(packageIdFromScheme(['masscom-demo', 'other']), 'kr.masscom.wolgye.demo');
});

test('an unknown or missing scheme resolves to undefined rather than a guess', () => {
  assert.equal(packageIdFromScheme(undefined), undefined);
  assert.equal(packageIdFromScheme('not-a-masscom-scheme'), undefined);
});
