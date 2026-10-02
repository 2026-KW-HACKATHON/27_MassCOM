import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAudit } from '../../scripts/audit-ci.mjs';

const forge = { url: 'https://github.com/advisories/GHSA-86w9-cpqp-85rv', severity: 'high', title: 'node-forge' };
const rule = {
  id: 'GHSA-86w9-cpqp-85rv', package: 'node-forge',
  allowedDependents: ['@expo/cli', '@expo/code-signing-certificates'], expires: '2026-10-31',
};
const report = (vulnerabilities) => ({ vulnerabilities });
const today = '2026-10-02';

test('the excepted advisory on its allowed path passes, transitive string vias are not judged again', () => {
  const result = evaluateAudit(report({
    'node-forge': { severity: 'high', via: [forge], effects: ['@expo/cli', '@expo/code-signing-certificates'] },
    '@expo/cli': { severity: 'high', via: ['node-forge', '@expo/code-signing-certificates'], effects: ['expo'] },
    uuid: { severity: 'moderate', via: [{ url: 'https://github.com/advisories/GHSA-w5hq-g745-h8pq', severity: 'moderate' }], effects: ['xcode'] },
  }), [rule], today);
  assert.deepEqual(result.failures, []);
  assert.equal(result.excused.length, 1);
});

test('any other high or critical advisory fails', () => {
  const result = evaluateAudit(report({
    lodash: { severity: 'critical', via: [{ url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'critical' }], effects: [] },
  }), [rule], today);
  assert.equal(result.failures.length, 1);
});

test('the exception stops working after it expires', () => {
  const result = evaluateAudit(report({
    'node-forge': { severity: 'high', via: [forge], effects: ['@expo/cli'] },
  }), [rule], '2026-11-01');
  assert.match(result.failures[0], /만료/);
});

test('the same advisory reached through a package outside the allowed dependents fails', () => {
  const result = evaluateAudit(report({
    'node-forge': { severity: 'high', via: [forge], effects: ['@expo/cli', 'some-runtime-lib'] },
  }), [rule], today);
  assert.match(result.failures[0], /허용하지 않은/);
});

test('the same advisory id on a different package is not covered', () => {
  const result = evaluateAudit(report({
    'other-forge': { severity: 'high', via: [forge], effects: [] },
  }), [rule], today);
  assert.equal(result.failures.length, 1);
});

test('an unreadable audit report fails closed', () => {
  assert.equal(evaluateAudit(undefined, [rule], today).failures.length, 1);
  assert.equal(evaluateAudit({}, [rule], today).failures.length, 1);
});
