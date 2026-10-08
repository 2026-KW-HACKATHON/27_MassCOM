import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { visitRewardGuide, type VisitGoal } from '../../commerce/visit-reward-guide';

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
  assert.match(screen, /import \{ mileageBalanceLine, mileageDeltaLine, settleWithin, visitRewardGuide, type VisitGoal \} from '@\/commerce\/visit-reward-guide';/);
  const guide = between('const rewardGuide = redeemed', 'return (');
  assert.match(guide, /progressCount: redeemed\.visit\.progressVisitCount,/);
  // 실제 캠페인 목표 조회가 성공한 뒤에만 등급 안내를 보여 준다.
  assert.match(screen, /merchant\.campaign\.rewardGoals/);
  assert.match(guide, /campaignGoals\?\.claimSlotId === redeemed\.claimSlotId && campaignGoals\.status === 'ready' \? campaignGoals\.goals : undefined/);
  assert.doesNotMatch(guide, /progressCounted/);
  const card = between('{redeemed ? (', '</SkyScrollView>');
  // #412: 적립·보유 줄은 코인 공개(축하 화면)가 끝난 뒤에만 보인다(revealDone). 데이터와 호출은 그대로다.
  assert.match(card, /\{revealDone && currentRewardContext\?\.mileageLine \? <Text style=\{styles\.successHighlight\}>\{currentRewardContext\.mileageLine\}<\/Text> : null\}/);
  assert.match(card, /\{revealDone && rewardBalance !== null \? <Text style=\{styles\.successBody\}>\{mileageBalanceLine\(rewardBalance\)\}<\/Text> : null\}/);
  assert.match(card, /\{rewardGuide\?\.nextGradeLine \? <Text style=\{styles\.successBody\}>\{rewardGuide\.nextGradeLine\}<\/Text> : null\}/);
  // 새 줄은 기존 안내 줄(진행 횟수·진행 안내·새 보상권) 뒤, 버튼 앞에 놓인다.
  assert.ok(card.indexOf('progressNote(redeemed.visit)') < card.indexOf('currentRewardContext?.mileageLine'));
  assert.ok(card.indexOf('rewardGuide?.nextGradeLine') < card.indexOf('styles.successActions'));
});

test('목표 지연·실패·재시도 중에는 가짜 등급이 없고 성공한 실제 목표만 안내한다', async () => {
  const source = between('// 수령 후 추천과 목표', '// 의견 조회는 선택 사항');
  const effect = source.slice(0, source.indexOf('  useEffect(() => {', source.indexOf('  useEffect(() => {') + 1));
  type GoalsState = { claimSlotId: string; status: 'ready'; goals: readonly VisitGoal[] } | { claimSlotId: string; status: 'error' } | undefined;
  let state: GoalsState;
  const getState = (): GoalsState => state;
  let load!: () => (() => void);
  let resolve!: (merchants: unknown[]) => void;
  let reject!: (error: Error) => void;
  let response = new Promise<unknown[]>((yes, no) => { resolve = yes; reject = no; });
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  runInNewContext(ts.transpileModule(effect, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    apiUrl: 'api', campaignGoalsRetry: 0, AbortController,
    redeemed: { claimSlotId: 'claim', merchantId: 'merchant', visit: { campaignId: 'campaign' } },
    useEffect: (callback: typeof load) => { load = callback; },
    setCampaignGoals: (next: GoalsState) => { state = next; },
    createMerchantApiClient: () => ({ listMerchants: () => response }),
  });
  const guide = () => visitRewardGuide({ progressCount: 1, goals: state?.status === 'ready' ? state.goals : undefined });
  let cleanup = load();
  assert.equal(state, undefined);
  assert.equal(guide().nextGradeLine, null);
  reject(new Error('offline')); await flush();
  assert.equal(getState()?.status, 'error');
  assert.equal(guide().nextGradeLine, null);
  assert.match(effect, /\[apiUrl, redeemed, campaignGoalsRetry\]/);
  const card = between('{redeemed ? (', '</SkyScrollView>');
  assert.match(card, /campaignGoals\.status === 'error'/);
  assert.match(card, /수집품 목표를 확인하지 못했어요/);
  assert.match(card, /accessibilityLabel="수집품 목표 다시 불러오기"[\s\S]*?onPress=\{\(\) => \{ setCampaignGoals\(undefined\); setCampaignGoalsRetry\(\(value\) => value \+ 1\); \}\}/);
  cleanup();
  state = undefined;
  response = new Promise<unknown[]>((yes, no) => { resolve = yes; reject = no; });
  cleanup = load();
  assert.equal(guide().nextGradeLine, null);
  resolve([{ id: 'merchant', campaign: { id: 'campaign', rewardGoals: [
    { targetVisitCount: 2, displayName: '새싹' }, { targetVisitCount: 4, displayName: '단골' },
  ] } }]); await flush();
  assert.equal(guide().nextGradeLine, '새싹 수집품까지 1번 남았어요 (같은 가게는 하루 1번)');
  cleanup();
});

test('조회 성공해도 같은 캠페인을 찾지 못하면 재시도 가능한 오류로 남긴다', async () => {
  const source = between('// 수령 후 추천과 목표', '// 의견 조회는 선택 사항');
  assert.match(source, /item\.id === redeemed\.merchantId && item\.campaign\.id === redeemed\.visit\.campaignId/);
  assert.match(source, /merchant \? \{ claimSlotId, status: 'ready', goals: merchant\.campaign\.rewardGoals \} : \{ claimSlotId, status: 'error' \}/);
});

test('no app copy guesses the earn rules: no bonus suffixes and no hardcoded 50/100/200 anywhere in the screen or the guide', () => {
  const guideSource = readFileSync(new URL('../../commerce/visit-reward-guide.ts', import.meta.url), 'utf8');
  for (const source of [screen, guideSource]) {
    assert.doesNotMatch(source, /첫 방문 \+|시리즈 완성 \+|\+50 |\b(?:50|100|200)\b *마일리지/);
  }
  assert.doesNotMatch(guideSource, /progressCounted|newStoreMileage|seriesCompleteMileage|visitMileage/);
});

test('완료 카드에는 주 행동 하나와 홈·도감·상점·의견의 보조 링크가 있다', () => {
  const actions = between('<View style={styles.successActions}>', '</SkyScrollView>');
  assert.match(actions, /followAfterVisitAction\(primaryAction\)/);
  assert.match(actions, /\{primaryAction\.label\}/);
  assert.match(actions, /styles\.secondaryLinks/);
  assert.match(actions, /router\.replace\('\/'\)/);
  assert.match(actions, /router\.navigate\('\/shop'\)/);
  assert.match(actions, />홈으로</);
  assert.match(actions, />상점 뽑기</);
  assert.match(actions, />도감</);
  assert.match(actions, /이 가게 어땠나요\?\(선택\)/);
});

test('the mileage context loads best-effort: the shop summary after the claim never blocks it', () => {
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

test('#412 the mileage lines wait for the coin reveal: a claim with a celebration shows them only after it closes, a replay shows them at once', () => {
  assert.match(screen, /const \[celebratedSlot, setCelebratedSlot\] = useState<string>\(\);/);
  // 축하가 열리면 그 방문을 기억한다: 열리기 전(배지 조회 중)에는 줄이 없고, 닫히면 곧바로 보인다.
  assert.match(screen, /if \(celebration\?\.claimSlotId && celebration\.claimSlotId !== celebratedSlot\) setCelebratedSlot\(celebration\.claimSlotId\);/);
  assert.match(screen, /const revealDone = redeemed !== undefined && !celebration && \(redeemed\.replayed \|\| celebratedSlot === redeemed\.claimSlotId\);/);
  // 상점 요약 호출과 축하 화면에 넘기는 마일리지 값은 그대로다.
  assert.match(screen, /void loadRewardContext\(result, mileageBefore\);/);
  assert.match(screen, /mileageDelta: currentRewardContext\?\.mileageDelta,\s*mileageBalance: currentRewardContext\?\.balance \?\? undefined,/);
  const card = between('{redeemed ? (', '</SkyScrollView>');
  assert.ok(card.indexOf('새 보상권') < card.indexOf('revealDone && currentRewardContext'));
});
