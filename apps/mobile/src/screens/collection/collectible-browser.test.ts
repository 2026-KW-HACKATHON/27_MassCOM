import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source checks (react-native views can't go through the node:test/esbuild runner, see HANDOFF).
const source = readFileSync(new URL('./collectible-browser.tsx', import.meta.url), 'utf8');

// PR #301 리뷰: 묶인 카드(같은 그림을 두 번 이상 받음)는 요약 배지(nftGroupSummary)만 보이고, 각 벌의 실제 상태·수령인·
// 토큰 정보를 볼 길이 없었다. 요약 줄과 민트 단추(첫 발행 가능한 벌 대상)는 유지한 채 펼쳐 볼 수 있게 했다.
test('NftStatusRow lets a grouped (duplicate) card expand to each entitlement\'s own status/recipient/token (#301 review)', () => {
  const row = source.slice(source.indexOf('function NftStatusRow'), source.indexOf('/** A collectible earned without a published picture'));
  assert.match(row, /entitlements\.length > 1/);
  assert.match(row, /setExpanded/);
  assert.match(row, /entitlements\.map\(\(entry, index\) =>/);
  assert.match(row, /nftStatusLabel\(entry\.nftStatus, mint\.nftMinting\)/);
  // The summary line and the single mint button (first mint-eligible entry) must stay, not be replaced.
  assert.match(row, /nftGroupSummary\(entitlements, mint\.nftMinting\)/);
  assert.match(row, /entitlements\.find\(\(entry\) => canOfferMint\(entry\.nftStatus, mint\.nftMinting\)\)/);
});
