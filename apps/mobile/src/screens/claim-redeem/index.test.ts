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

test('"받은 수집품 보기"는 받은 보상에 수집품 외형이 실제로 붙었을 때만, 그 보상으로 보인다', () => {
  // 방문 수령 응답에는 외형 정보가 없어 도감을 읽어 확인하고, 첫 보상이 아니라 외형이 붙은 보상을 연다.
  const find = between('async function findGrantedArtwork', 'async function celebrate');
  assert.match(find, /await api\.getCollection\(\)/);
  assert.match(find, /grantedArtworkEntitlement\(result\.grantedRewards, snapshot\.collectibles\)/);
  assert.match(find, /setArtworkReward\(\{ claimSlotId: result\.claimSlotId, entitlementId \}\)/);
  // 조회 실패는 버튼만 숨긴다.
  assert.match(find, /catch \{[^}]*\}/);
  assert.doesNotMatch(screen, /grantedRewards\[0\]/);
  assert.match(screen, /\{artworkReward\?\.claimSlotId === redeemed\.claimSlotId \? \(/);
  assert.match(screen, /entitlement: artworkReward\.entitlementId/);
  // 새 수령·코드 변경 때 이전 버튼 대상이 남지 않는다.
  assert.match(between('function changeToken', 'async function startScan'), /setArtworkReward\(undefined\);/);
  assert.match(between('async function redeem', 'async function findGrantedArtwork'), /setArtworkReward\(undefined\);\s*void findGrantedArtwork\(result\);/);
});
