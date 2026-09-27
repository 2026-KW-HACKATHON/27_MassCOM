import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canIssueCustomerIdentity, createIdentityRequestGate, customerIdentityCode, isCustomerIdentityExpired, parseCustomerIdentityToken } from './customer-identity';

const token = `masscom-customer:v1:${'A'.repeat(43)}`;

test('accepts only the versioned customer QR and displays a matching short code', () => {
  assert.equal(parseCustomerIdentityToken(` ${token}\n`), token);
  assert.equal(customerIdentityCode(token), 'AAAA-AAAA');
  for (const raw of ['', 'A'.repeat(43), `https://example.test/${token}`, 'masscom-customer:v2:' + 'A'.repeat(43), token + '?x=1']) {
    assert.equal(parseCustomerIdentityToken(raw), undefined);
  }
});

test('expires the displayed identity when its server expiry has passed', () => {
  assert.equal(isCustomerIdentityExpired('2026-09-28T10:00:00.000Z', Date.parse('2026-09-28T09:59:59.999Z')), false);
  assert.equal(isCustomerIdentityExpired('2026-09-28T10:00:00.000Z', Date.parse('2026-09-28T10:00:00.000Z')), true);
});

test('cancelling a pending identity resolve ignores its late result and permits a fresh retry', () => {
  const gate = createIdentityRequestGate();
  const pending = gate.start();
  gate.cancel();
  assert.equal(gate.isCurrent(pending), false);
  const retry = gate.start();
  assert.equal(gate.isCurrent(retry), true);
});

test('allows expired identity only for a previously attempted issue recovery', () => {
  const expiry = '2026-09-28T10:00:00.000Z';
  const now = Date.parse(expiry);
  assert.equal(canIssueCustomerIdentity(expiry, false, now - 1), true);
  assert.equal(canIssueCustomerIdentity(expiry, false, now), false);
  assert.equal(canIssueCustomerIdentity(expiry, true, now), true);
});
