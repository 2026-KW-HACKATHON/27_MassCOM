import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { contrast } from '../../theme/contrast';
import { darkColors, lightColors } from '../../theme/palette';
import { uiMetrics } from '../../theme/ui-metrics';
import { darkWorld, lightWorld } from '../../theme/world';
import { makeClaimRedeemStyles } from './styles';

// 이 저장소에는 RN 렌더러가 없어 방문 완료 카드의 #332 배선은 소스 본문으로 확인한다(index.test.ts와 같은 방식).
const screen = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

function between(start: string, end: string): string {
  const from = screen.indexOf(start);
  const to = screen.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return screen.slice(from, to);
}

test('the success card shows the mileage line, the held balance and the next-grade line from visitRewardGuide', () => {
  assert.match(screen, /import \{ defaultVisitGoals, mileageBalanceLine, visitRewardGuide, type VisitGoal \} from '@\/commerce\/visit-reward-guide';/);
  const guide = between('const rewardGuide = redeemed', 'return (');
  assert.match(guide, /progressCounted: redeemed\.visit\.progressCounted,/);
  assert.match(guide, /progressCount: redeemed\.visit\.progressVisitCount,/);
  // 점포의 실제 목표를 못 읽었을 때만 기본 1·3·5회로 안내한다.
  assert.match(guide, /\?\? defaultVisitGoals/);
  const card = between('{redeemed ? (', '</SkyScrollView>');
  assert.match(card, /\{rewardGuide\?\.mileageLine \? <Text style=\{styles\.successHighlight\}>\{rewardGuide\.mileageLine\}<\/Text> : null\}/);
  assert.match(card, /mileageBalanceLine\(rewardBalance\)/);
  assert.match(card, /\{rewardGuide\?\.nextGradeLine \? <Text style=\{styles\.successBody\}>\{rewardGuide\.nextGradeLine\}<\/Text> : null\}/);
  // 새 줄은 기존 안내 줄(진행 횟수·진행 안내·새 보상권) 뒤, 버튼 앞에 놓인다.
  assert.ok(card.indexOf('progressNote(redeemed.visit)') < card.indexOf('rewardGuide?.mileageLine'));
  assert.ok(card.indexOf('rewardGuide?.nextGradeLine') < card.indexOf('styles.successActions'));
});

test('"상점에서 뽑기" sits next to the existing buttons and routes to the shop tab; none of them is removed', () => {
  const actions = between('<View style={styles.successActions}>', '</SkyScrollView>');
  assert.match(actions, /받은 수집품 보기/);
  assert.match(actions, /claimSuccessCopy\(redeemed\)\.destinations\.map/);
  assert.match(actions, /router\.navigate\('\/shop'\)/);
  assert.match(actions, />상점에서 뽑기</);
  assert.match(actions, /accessibilityRole="button"[^>]*onPress=\{\(\) => router\.navigate\('\/shop'\)\}/);
  assert.ok(actions.indexOf('destinations.map') < actions.indexOf('상점에서 뽑기'), 'next to (after) the existing destinations');
});

test('the guide context loads best-effort: the shop summary and the store goals never block or break the claim', () => {
  const loader = between('async function loadRewardContext', 'return (');
  assert.match(loader, /createMerchantApiClient\(apiUrl\)\.listMerchants\(\)/);
  assert.match(loader, /createShopApiClient\(\{ apiUrl, credential \}\)\.getShop\(\)/);
  assert.match(loader, /Promise\.allSettled\(/);
  // 상점 요약이 401이어도 세션을 무효화하지 않는다(조용히 실패): onSessionInvalid를 넘기지 않는다.
  assert.doesNotMatch(loader, /createShopApiClient\(\{[^}]*onSessionInvalid/);
  // 늦게 온 이전 방문의 응답이 새 방문의 안내를 덮지 못한다.
  assert.match(loader, /const request = \+\+rewardContextRequest\.current;/);
  assert.match(loader, /if \(request !== rewardContextRequest\.current\) return;/);
  assert.match(loader, /merchants\.value\.find\(\(item\) => item\.id === result\.merchantId\)/);
  assert.match(loader, /balance: shop\.status === 'fulfilled' \? shop\.value\.mileage\.balance : null/);
});

test('both success paths (code redeem and test visit) load the guide context after the artwork lookup', () => {
  assert.match(between('async function redeem', 'async function createTestVisit'), /void findGrantedArtwork\(result\);\s*void loadRewardContext\(result\);/);
  assert.match(between('async function createTestVisit', 'async function findGrantedArtwork'), /void findGrantedArtwork\(result\);\s*void loadRewardContext\(result\);/);
});

test('a new code or a new claim never shows the previous claim\'s guide context', () => {
  assert.match(between('function changeToken', 'async function startScan'), /rewardContextRequest\.current \+= 1;\s*setRewardContext\(undefined\);/);
  // 안내 문맥은 방문(claimSlotId)에 묶여 있어 다른 방문의 문맥은 쓰지 않는다.
  assert.match(screen, /rewardContext\?\.claimSlotId === redeemed\.claimSlotId/);
});

test('the highlighted mileage line stays readable on the success card and the shop button keeps a 48dp target', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeClaimRedeemStyles(palette, world);
    assert.ok(contrast(styles.successHighlight.color as string, styles.successCard.backgroundColor as string) >= 4.5);
    assert.ok((styles.collectionButton.minHeight as number) >= uiMetrics.minTouch);
  }
});
