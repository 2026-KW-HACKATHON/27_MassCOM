import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

function between(start: string, end: string): string {
  const from = screen.indexOf(start);
  const to = screen.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return screen.slice(from, to);
}

test('the code check is gated by createIdentityRequestGate (#265)', () => {
  assert.match(screen, /const inspectGate = useRef\(createIdentityRequestGate\(\)\)\.current;/);
});

test('changing the input cancels a code check still in flight', () => {
  const changeToken = between('function changeToken', 'async function startScan');
  assert.match(changeToken, /inspectGate\.cancel\(\);/);
});

test('a code check result reaches the preview only through the current-request check', () => {
  const inspect = between('async function inspect', 'async function redeem');
  assert.match(inspect, /const request = inspectGate\.start\(\);/);
  assert.match(inspect, /const accepted = acceptInspection\(inspectGate\.isCurrent\(request\), code, next\);\s*if \(!accepted\) return;/);
  assert.match(inspect, /setPreview\(accepted\.preview\);/);
  assert.match(inspect, /setPendingRedeemToken\(accepted\.pendingRedeemToken\);/);
  // The raw response never goes to state directly, and a stale failure shows no message.
  assert.doesNotMatch(inspect, /setPreview\(next\)|setPendingRedeemToken\(code\)/);
  assert.match(inspect, /if \(inspectGate\.isCurrent\(request\)\) setMessage\(messageFor\(error\)\);/);
  // The busy flag is always released, so a dropped answer never leaves the buttons disabled.
  assert.match(inspect, /finally \{[^}]*setBusy\(false\);/);
});

test('confirming redeems only the code checked for the current input', () => {
  const redeem = between('async function redeem', 'async function celebrate');
  assert.match(redeem, /const target = redeemTarget\(token, pendingRedeemToken, preview\);/);
  assert.match(redeem, /await api\.redeemClaim\(target\)/);
  assert.doesNotMatch(redeem, /redeemClaim\(pendingRedeemToken\)/);
});
