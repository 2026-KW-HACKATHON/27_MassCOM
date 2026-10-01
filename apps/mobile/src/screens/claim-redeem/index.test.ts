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
  assert.match(inspect, /if \(inspectGate\.isCurrent\(request\)\) \{\s*playUiSound\('error'\);\s*setMessage\(messageFor\(error\)\);\s*\}/);
  // The busy flag is always released, so a dropped answer never leaves the buttons disabled.
  assert.match(inspect, /finally \{[^}]*setBusy\(false\);/);
});

test('confirming redeems only the code checked for the current input', () => {
  const redeem = between('async function redeem', 'async function celebrate');
  assert.match(redeem, /const target = redeemTarget\(token, pendingRedeemToken, preview\);/);
  assert.match(redeem, /await api\.redeemClaim\(target\)/);
  assert.doesNotMatch(redeem, /redeemClaim\(pendingRedeemToken\)/);
});

test('"받은 수집품 보기"는 받은 보상 중 수집품 외형이 실제로 붙은 것 전부를(297번: 한 번에 여럿이어도) 목표 순서대로 모아 보인다', () => {
  // 방문 수령 응답에는 외형 정보가 없어 도감을 읽어 확인하고, 외형이 붙은 보상만 목표(targetVisitCount) 오름차순으로 모은다.
  const find = between('async function findGrantedArtwork', 'async function celebrate');
  assert.match(find, /await api\.getCollection\(\)/);
  assert.match(find, /\.sort\(\(a, b\) => a\.targetVisitCount - b\.targetVisitCount\)/);
  assert.match(find, /setArtworkReward\(\{ claimSlotId: result\.claimSlotId, entitlementIds \}\)/);
  // 조회 실패는 버튼만 숨긴다.
  assert.match(find, /catch \{[^}]*\}/);
  assert.doesNotMatch(screen, /grantedRewards\[0\]/);
  assert.match(screen, /\{artworkReward\?\.claimSlotId === redeemed\.claimSlotId \? \(/);
  assert.match(screen, /entitlement: artworkReward\.entitlementIds\.join\(','\)/);
  // 새 수령·코드 변경 때 이전 버튼 대상이 남지 않는다.
  assert.match(between('function changeToken', 'async function startScan'), /setArtworkReward\(undefined\);/);
  assert.match(between('async function redeem', 'async function findGrantedArtwork'), /setArtworkReward\(undefined\);\s*void findGrantedArtwork\(result\);/);
});
