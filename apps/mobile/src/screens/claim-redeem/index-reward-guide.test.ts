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

test('the success card shows the real earned delta, the held balance and the next-grade line', () => {
  assert.match(screen, /import \{ defaultVisitGoals, mileageBalanceLine, mileageDeltaLine, settleWithin, visitRewardGuide \} from '@\/commerce\/visit-reward-guide';/);
  const guide = between('const rewardGuide = redeemed', 'return (');
  assert.match(guide, /progressCount: redeemed\.visit\.progressVisitCount,/);
  // 점포 목록을 다시 읽지 않고 고정 1·3·5회 목표로 안내한다.
  assert.match(guide, /goals: defaultVisitGoals/);
  assert.doesNotMatch(guide, /progressCounted/);
  const card = between('{redeemed ? (', '</SkyScrollView>');
  assert.match(card, /\{currentRewardContext\?\.mileageLine \? <Text style=\{styles\.successHighlight\}>\{currentRewardContext\.mileageLine\}<\/Text> : null\}/);
  assert.match(card, /mileageBalanceLine\(rewardBalance\)/);
  assert.match(card, /\{rewardGuide\?\.nextGradeLine \? <Text style=\{styles\.successBody\}>\{rewardGuide\.nextGradeLine\}<\/Text> : null\}/);
  // 새 줄은 기존 안내 줄(진행 횟수·진행 안내·새 보상권) 뒤, 버튼 앞에 놓인다.
  assert.ok(card.indexOf('progressNote(redeemed.visit)') < card.indexOf('currentRewardContext?.mileageLine'));
  assert.ok(card.indexOf('rewardGuide?.nextGradeLine') < card.indexOf('styles.successActions'));
});

test('no app copy guesses the earn rules: no bonus suffixes and no hardcoded 50/100/200 anywhere in the screen or the guide', () => {
  const guideSource = readFileSync(new URL('../../commerce/visit-reward-guide.ts', import.meta.url), 'utf8');
  for (const source of [screen, guideSource]) {
    assert.doesNotMatch(source, /첫 방문 \+|시리즈 완성 \+|\+50 |\b(?:50|100|200)\b *마일리지/);
  }
  assert.doesNotMatch(guideSource, /progressCounted|newStoreMileage|seriesCompleteMileage|visitMileage/);
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

test('the guide context loads best-effort: the shop summary after the claim never blocks or breaks it, and no store list is fetched', () => {
  const loader = between('async function loadRewardContext', 'return (');
  assert.match(loader, /shopApi\.getShop\(\)/);
  assert.doesNotMatch(loader, /listMerchants|createMerchantApiClient/);
  // 상점 요약이 401이어도 세션을 무효화하지 않는다(조용히 실패): onSessionInvalid를 넘기지 않는다.
  assert.doesNotMatch(screen, /createShopApiClient\(\{[^}]*onSessionInvalid/);
  assert.match(screen, /const shopApi = useMemo\(\s*\(\) => createShopApiClient\(\{ apiUrl, credential \}\),/);
  // 늦게 온 이전 방문의 응답이 새 방문의 안내를 덮지 못한다.
  assert.match(loader, /const request = \+\+rewardContextRequest\.current;/);
  assert.match(loader, /if \(request !== rewardContextRequest\.current\) return;/);
  // 방문 후 요약이 없으면 보유·적립 줄은 둘 다 빠진다(추측하지 않는다).
  assert.match(loader, /balance: shop \? shop\.mileage\.balance : null/);
  assert.match(loader, /mileageLine: mileageDeltaLine\(\{ replayed: result\.replayed, before: earnedBefore, after: shop\?\.mileage\.earned \}\)/);
});

test('the earned total is snapshotted before the claim exactly like the badge book, and a slow snapshot is dropped instead of blocking', () => {
  const inspect = between('async function inspect', 'async function redeem');
  assert.match(inspect, /mileageBeforeClaim\.current = next\.status === 'AVAILABLE' \? readEarnedMileage\(shopApi\) : undefined;/);
  const redeem = between('async function redeem', 'async function createTestVisit');
  // 요청 전에 스냅샷이 끝났는지(또는 시간 안에 못 끝냈는지) 확인한다: 방문이 먼저 반영된 뒤의 값을 "이전"으로 읽지 않도록.
  assert.match(redeem, /const mileageBefore = await settleWithin\(mileageBeforeClaim\.current, mileageSnapshotWaitMs\);/);
  assert.ok(redeem.indexOf('settleWithin(mileageBeforeClaim.current') < redeem.indexOf('await api.redeemClaim(target)'));
  const testVisit = between('async function createTestVisit', 'async function findGrantedArtwork');
  assert.match(testVisit, /const mileageBefore = await settleWithin\(readEarnedMileage\(shopApi\), mileageSnapshotWaitMs\);/);
  assert.ok(testVisit.indexOf('settleWithin(readEarnedMileage') < testVisit.indexOf('await api.createTestVisit('));
  assert.match(screen, /function readEarnedMileage\(client: ShopApiClient\): Promise<number \| undefined> \{\s*return client\.getShop\(\)\.then\(\(shop\) => shop\.mileage\.earned, \(\) => undefined\);/);
});

test('both success paths (code redeem and test visit) load the guide context after the artwork lookup', () => {
  assert.match(between('async function redeem', 'async function createTestVisit'), /void findGrantedArtwork\(result\);\s*void loadRewardContext\(result, mileageBefore\);/);
  assert.match(between('async function createTestVisit', 'async function findGrantedArtwork'), /void findGrantedArtwork\(result\);\s*void loadRewardContext\(result, mileageBefore\);/);
});

test('a new code or a new claim never shows the previous claim\'s guide context', () => {
  const change = between('function changeToken', 'async function startScan');
  assert.match(change, /rewardContextRequest\.current \+= 1;\s*mileageBeforeClaim\.current = undefined;\s*setRewardContext\(undefined\);/);
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
