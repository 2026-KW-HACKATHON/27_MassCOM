import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createScanGate, parseScannedClaimCode } from './claim-code';

const code = 'A'.repeat(43);

test('accepts a base64url claim code and trims what the camera adds around it', () => {
  assert.deepEqual(parseScannedClaimCode(` ${code}\n`), { ok: true, code });
  assert.deepEqual(parseScannedClaimCode('abc-DEF_123'.repeat(4)), { ok: true, code: 'abc-DEF_123'.repeat(4) });
});

test('refuses anything that is not a claim code before it can reach the API', () => {
  for (const raw of [
    'https://example.com/pay?to=someone',
    'WIFI:S:cafe;T:WPA;P:secret;;',
    'short',
    `${code} ${code}`,
    `${code}?x=1`,
    'A'.repeat(129),
  ]) {
    assert.deepEqual(parseScannedClaimCode(raw), { ok: false, reason: 'NOT_A_CLAIM_CODE' }, raw);
  }
  assert.deepEqual(parseScannedClaimCode('   '), { ok: false, reason: 'EMPTY' });
});

test('lets one scan through and ignores the repeats until it is reset', () => {
  const gate = createScanGate();
  assert.equal(gate.accept(code), true);
  assert.equal(gate.accept(code), false);
  assert.equal(gate.accept('B'.repeat(43)), false);
  gate.reset();
  assert.equal(gate.accept(code), true);
});
