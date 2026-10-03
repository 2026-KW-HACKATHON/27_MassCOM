// Issue #330: 점주 가게 현황의 순수 규칙. 날짜 경계(KST 월요일 시작)와 오픈 준비 판정을 DB 없이 고정한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildComparison, buildDailySeries, buildReadiness, campaignPhase, isCampaignCustomerVisible,
  isMerchantCustomerVisible, kstDateOf, kstMidnight, overviewPeriods, selectRelevantCampaign, shiftDate, weekStartOf,
  type CampaignFacts, type MerchantFacts, type ReadinessInput, type ReadinessStep,
} from './merchant-overview-rules.js';

const at = (iso: string) => new Date(iso);

test('KST date flips at 15:00 UTC and the week starts on Monday 00:00 KST', () => {
  assert.equal(kstDateOf(at('2026-10-03T14:59:59.999Z')), '2026-10-03');
  assert.equal(kstDateOf(at('2026-10-03T15:00:00.000Z')), '2026-10-04');
  // 2026-10-03은 토요일, 2026-10-04는 일요일, 2026-10-05는 월요일이다.
  assert.equal(weekStartOf('2026-10-03'), '2026-09-28');
  assert.equal(weekStartOf('2026-10-04'), '2026-09-28');
  assert.equal(weekStartOf('2026-10-05'), '2026-10-05');
  assert.equal(weekStartOf('2026-09-28'), '2026-09-28');
  // 일요일 23:59:59 KST는 지난 주, 월요일 00:00:00 KST부터 새 주다.
  assert.equal(overviewPeriods(at('2026-10-04T14:59:59.999Z')).thisWeekStart, '2026-09-28');
  assert.equal(overviewPeriods(at('2026-10-04T15:00:00.000Z')).thisWeekStart, '2026-10-05');
  // 달·해가 바뀌어도 월요일을 찾는다.
  assert.equal(weekStartOf('2026-11-01'), '2026-10-26');
  assert.equal(weekStartOf('2027-01-01'), '2026-12-28');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(kstMidnight('2026-10-05').toISOString(), '2026-10-04T15:00:00.000Z');
});

test('overview periods give this week, last week, the same span of last week and the 7-day window', () => {
  // 2026-10-07(수) 정오 KST.
  const periods = overviewPeriods(at('2026-10-07T03:00:00.000Z'));
  assert.deepEqual(periods, {
    today: '2026-10-07', thisWeekStart: '2026-10-05', nextWeekStart: '2026-10-12', lastWeekStart: '2026-09-28',
    lastWeekSameSpanEnd: '2026-09-30', sevenDayStart: '2026-10-01',
  });
  // 월요일에는 지난주 같은 기간이 월요일 하루뿐이다. 일요일에는 지난주 전체와 같다.
  assert.equal(overviewPeriods(at('2026-10-04T15:00:00.000Z')).lastWeekSameSpanEnd, '2026-09-28');
  const sunday = overviewPeriods(at('2026-10-11T12:00:00.000Z'));
  assert.equal(sunday.lastWeekSameSpanEnd, shiftDate(sunday.thisWeekStart, -1));
});

test('the 7-day series always has seven days oldest first and fills days without visits with zero', () => {
  const series = buildDailySeries([
    { date: '2026-10-02', count: 3 }, { date: '2026-09-30', count: 1 }, { date: '2026-09-20', count: 99 },
  ], '2026-10-03');
  assert.deepEqual(series, [
    { date: '2026-09-27', count: 0 }, { date: '2026-09-28', count: 0 }, { date: '2026-09-29', count: 0 },
    { date: '2026-09-30', count: 1 }, { date: '2026-10-01', count: 0 }, { date: '2026-10-02', count: 3 },
    { date: '2026-10-03', count: 0 },
  ]);
  // 달이 바뀌는 구간과 빈 입력.
  assert.deepEqual(buildDailySeries([], '2026-11-02').map(day => day.date),
    ['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.ok(buildDailySeries([], '2026-11-02').every(day => day.count === 0));
  // 같은 날 행이 둘로 나뉘어 와도 더한다.
  assert.equal(buildDailySeries([{ date: '2026-10-03', count: 2 }, { date: '2026-10-03', count: 5 }], '2026-10-03')[6]!.count, 7);
});

test('week-over-week comparison is shown only when the store was published before last week began (KST)', () => {
  const now = at('2026-10-07T03:00:00.000Z'); // 지난주 시작은 2026-09-28 00:00 KST = 2026-09-27T15:00Z
  const input = { now, thisWeek: 12, lastWeekSameSpan: 9 };
  assert.equal(buildComparison({ ...input, publishedAt: null }), null);
  assert.equal(buildComparison({ ...input, publishedAt: at('2026-09-27T15:00:00.001Z') }), null);
  assert.equal(buildComparison({ ...input, publishedAt: at('2026-10-01T00:00:00.000Z') }), null);
  assert.deepEqual(buildComparison({ ...input, publishedAt: at('2026-09-27T15:00:00.000Z') }),
    { lastWeekSameSpan: 9, delta: 3 });
  assert.deepEqual(buildComparison({ ...input, publishedAt: at('2026-01-01T00:00:00.000Z') }),
    { lastWeekSameSpan: 9, delta: 3 });
  // 줄었으면 음수, 같으면 0이다.
  assert.equal(buildComparison({ now, thisWeek: 2, lastWeekSameSpan: 9, publishedAt: at('2026-01-01T00:00:00Z') })!.delta, -7);
  assert.equal(buildComparison({ now, thisWeek: 9, lastWeekSameSpan: 9, publishedAt: at('2026-01-01T00:00:00Z') })!.delta, 0);
  // 비교 가능 여부는 이번 주가 아니라 지난주 시작에 묶여, 월요일 00:00 KST에 기준이 한 주 밀린다.
  // 2026-10-05(월) 00:00 KST에 공개된 가게는 그 주 일요일 밤까지는 지난주 시작이 더 이르므로 숨기고, 다음 월요일부터 보인다.
  const publishedAt = at('2026-10-04T15:00:00.000Z');
  assert.equal(buildComparison({ ...input, publishedAt, now: at('2026-10-11T14:59:59.999Z') }), null);
  assert.notEqual(buildComparison({ ...input, publishedAt, now: at('2026-10-11T15:00:00.000Z') }), null);
});

// ---- 오픈 준비 판정 ----

const NOW = at('2026-10-03T03:00:00.000Z');
const liveCampaign = (over: Partial<CampaignFacts> = {}): CampaignFacts => ({
  id: 'camp-live', title: '가을 방문 캠페인', status: 'ACTIVE', isPublic: true,
  startsAt: at('2026-10-01T00:00:00.000Z'), endsAt: at('2026-12-31T00:00:00.000Z'),
  goals: [1, 3, 5], collectibleLinked: true, ...over,
});
const readyMerchant = (over: Partial<MerchantFacts> = {}): MerchantFacts => ({
  name: '월계 분식', roadAddress: '서울 노원구 월계로 1', businessHours: '월–금 10:00–20:00', menuItemCount: 2,
  status: 'ACTIVE', publishedAt: at('2026-09-01T00:00:00.000Z'), guestTrial: false, ...over,
});
const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  now: NOW, merchant: readyMerchant(), owners: 1, staff: 2, campaigns: [liveCampaign()], ...over,
});
const stateOf = (steps: readonly ReadinessStep[], key: ReadinessStep['key']) => steps.find(step => step.key === key)!.state;

test('a fully ready store has six DONE steps and says it is visible in the customer app', () => {
  const readiness = buildReadiness(input());
  assert.deepEqual(readiness.steps.map(step => step.key), ['basic', 'menu', 'members', 'reward', 'campaign', 'visible']);
  assert.deepEqual(readiness.steps.map(step => step.label),
    ['가게 기본 정보', '메뉴', '점주·직원', '방문 보상', '캠페인', '고객 앱 공개']);
  assert.ok(readiness.steps.every(step => step.state === 'DONE'));
  assert.equal(readiness.remaining, 0);
  assert.equal(readiness.message, '고객 앱에 보이고 있어요.');
  // 점주·직원 단계는 직원 수를 참고로 보이고, 쿠폰 오퍼는 단계가 아니라 방문 보상 안내 문구로만 나온다.
  assert.match(readiness.steps[2]!.hint, /점주 1명 · 직원 2명/);
  assert.match(readiness.steps[3]!.hint, /쿠폰 혜택은 운영팀이 플랫폼 단위로/);
  assert.equal(readiness.steps.some(step => /쿠폰/.test(step.label)), false);
  // 사진 칸은 없어 체크리스트 어디에도 사진을 말하지 않는다.
  assert.doesNotMatch(JSON.stringify(readiness), /사진/);
});

test('a new paused store with steps 1-3 done waits for operator approval', () => {
  const readiness = buildReadiness(input({ merchant: readyMerchant({ status: 'PAUSED', publishedAt: null }), campaigns: [] }));
  assert.equal(stateOf(readiness.steps, 'basic'), 'DONE');
  assert.equal(stateOf(readiness.steps, 'menu'), 'DONE');
  assert.equal(stateOf(readiness.steps, 'members'), 'DONE');
  assert.equal(stateOf(readiness.steps, 'reward'), 'NEEDS_SETUP');
  assert.equal(stateOf(readiness.steps, 'campaign'), 'NEEDS_SETUP');
  assert.equal(stateOf(readiness.steps, 'visible'), 'WAITING_APPROVAL');
  assert.match(readiness.steps[5]!.hint, /운영팀 공개 처리 대기/);
  assert.equal(readiness.remaining, 3);
  assert.equal(readiness.message, '고객 앱 공개까지 3단계 남았습니다.');
  // 1~3단계가 끝나지 않았으면 승인 대기가 아니다.
  const incomplete = buildReadiness(input({ merchant: readyMerchant({ status: 'PAUSED', menuItemCount: 0 }) }));
  assert.equal(stateOf(incomplete.steps, 'menu'), 'NEEDS_SETUP');
  assert.equal(stateOf(incomplete.steps, 'visible'), 'NEEDS_SETUP');
});

test('basic info and menu follow the same publish requirements the admin enforces', () => {
  for (const [over, missingHint] of [
    [{ name: '  ' }, /가게 이름/],
    [{ roadAddress: '' }, /도로명 주소/],
    [{ businessHours: '   ' }, /영업시간/],
  ] as const) {
    const steps = buildReadiness(input({ merchant: readyMerchant(over) })).steps;
    assert.equal(stateOf(steps, 'basic'), 'NEEDS_SETUP', JSON.stringify(over));
    assert.match(steps[0]!.hint, missingHint);
    assert.equal(stateOf(steps, 'menu'), 'DONE');
  }
  const noMenu = buildReadiness(input({ merchant: readyMerchant({ menuItemCount: 0 }) })).steps;
  assert.equal(stateOf(noMenu, 'menu'), 'NEEDS_SETUP');
  assert.equal(stateOf(noMenu, 'basic'), 'DONE');
  assert.match(noMenu[1]!.hint, /메뉴를 1개 이상/);
});

test('members step needs an active owner and only shows the staff count as information', () => {
  const noOwner = buildReadiness(input({ owners: 0, staff: 3 })).steps[2]!;
  assert.equal(noOwner.state, 'CHECK');
  assert.match(noOwner.hint, /활성 점주가 없어요/);
  assert.match(noOwner.hint, /직원 3명/);
  const staffOnly = buildReadiness(input({ owners: 0, staff: 0 })).steps[2]!;
  assert.equal(staffOnly.state, 'CHECK');
  assert.equal(buildReadiness(input({ owners: 2, staff: 0 })).steps[2]!.state, 'DONE');
});

test('reward step needs an ACTIVE campaign with goals exactly 1/3/5 linked to a collectible', () => {
  assert.equal(stateOf(buildReadiness(input()).steps, 'reward'), 'DONE');
  const unlinked = buildReadiness(input({ campaigns: [liveCampaign({ collectibleLinked: false })] })).steps[3]!;
  assert.equal(unlinked.state, 'NEEDS_SETUP');
  assert.match(unlinked.hint, /수집품/);
  for (const goals of [[1, 3], [1, 3, 5, 5], [3, 5], []]) {
    const wrongGoals = buildReadiness(input({ campaigns: [liveCampaign({ goals })] })).steps[3]!;
    assert.equal(wrongGoals.state, 'NEEDS_SETUP', JSON.stringify(goals));
    assert.match(wrongGoals.hint, /1·3·5회/);
  }
  assert.equal(buildReadiness(input({ campaigns: [liveCampaign({ status: 'DRAFT' })] })).steps[3]!.state, 'NEEDS_SETUP');
  assert.equal(buildReadiness(input({ campaigns: [] })).steps[3]!.state, 'NEEDS_SETUP');
  // 시작 전(SCHEDULED) 캠페인도 보상 설정이 끝났으면 완료다.
  const scheduled = liveCampaign({ startsAt: at('2026-11-01T00:00:00.000Z') });
  assert.equal(buildReadiness(input({ campaigns: [scheduled] })).steps[3]!.state, 'DONE');
});

test('campaign step: live is done, future start is scheduled with the not-listed hint, other states need a check', () => {
  assert.equal(stateOf(buildReadiness(input()).steps, 'campaign'), 'DONE');
  const scheduled = buildReadiness(input({ campaigns: [liveCampaign({ startsAt: at('2026-10-05T00:00:00.000Z') })] }));
  assert.equal(stateOf(scheduled.steps, 'campaign'), 'SCHEDULED');
  assert.equal(scheduled.steps[4]!.hint, '캠페인 시작일이 아직 되지 않아 고객 목록에는 표시되지 않습니다.');
  assert.equal(stateOf(scheduled.steps, 'visible'), 'NEEDS_SETUP');
  assert.equal(scheduled.message, '고객 앱 공개까지 2단계 남았습니다.');
  const cases: [Partial<CampaignFacts>, ReadinessStep['state'], RegExp][] = [
    [{ status: 'DRAFT' }, 'CHECK', /초안/],
    [{ status: 'PAUSED' }, 'CHECK', /일시정지/],
    [{ status: 'ENDED' }, 'CHECK', /종료/],
    [{ endsAt: at('2026-10-02T00:00:00.000Z') }, 'CHECK', /기간이 끝났/],
    [{ isPublic: false }, 'CHECK', /공개되지 않/],
  ];
  for (const [over, state, hint] of cases) {
    const steps = buildReadiness(input({ campaigns: [liveCampaign(over)] })).steps;
    assert.equal(steps[4]!.state, state, JSON.stringify(over));
    assert.match(steps[4]!.hint, hint, JSON.stringify(over));
    assert.equal(steps[5]!.state, 'NEEDS_SETUP', JSON.stringify(over));
  }
  const none = buildReadiness(input({ campaigns: [] })).steps[4]!;
  assert.equal(none.state, 'NEEDS_SETUP');
  assert.match(none.hint, /캠페인이 없어요/);
});

test('window edges: start is inclusive and end is exclusive, matching the public list', () => {
  const startsExactly = liveCampaign({ startsAt: NOW });
  assert.equal(isCampaignCustomerVisible(startsExactly, NOW), true);
  assert.equal(isCampaignCustomerVisible(startsExactly, at('2026-10-03T02:59:59.999Z')), false);
  const endsExactly = liveCampaign({ endsAt: NOW });
  assert.equal(isCampaignCustomerVisible(endsExactly, NOW), false);
  assert.equal(isCampaignCustomerVisible(endsExactly, at('2026-10-03T02:59:59.999Z')), true);
  assert.equal(campaignPhase(startsExactly, NOW), 'LIVE');
  assert.equal(campaignPhase(endsExactly, NOW), 'EXPIRED');
});

test('customer visibility needs an active store, no guest trial and a public in-window campaign with goals 1/3/5', () => {
  const visible = (over: Partial<Parameters<typeof isMerchantCustomerVisible>[0]> = {}) => isMerchantCustomerVisible({
    now: NOW, merchantStatus: 'ACTIVE', guestTrial: false, campaigns: [liveCampaign()], ...over,
  });
  assert.equal(visible(), true);
  assert.equal(visible({ merchantStatus: 'PAUSED' }), false);
  assert.equal(visible({ guestTrial: true }), false);
  assert.equal(visible({ campaigns: [] }), false);
  assert.equal(visible({ campaigns: [liveCampaign({ goals: [1, 3] })] }), false);
  assert.equal(visible({ campaigns: [liveCampaign({ isPublic: false })] }), false);
  assert.equal(visible({ campaigns: [liveCampaign({ status: 'PAUSED' })] }), false);
  // 다른 캠페인이 있어도 조건을 모두 채운 캠페인이 하나면 보인다.
  assert.equal(visible({ campaigns: [liveCampaign({ id: 'old', status: 'ENDED' }), liveCampaign()] }), true);
  // 수집품 연결은 노출 조건이 아니다.
  assert.equal(visible({ campaigns: [liveCampaign({ collectibleLinked: false })] }), true);
  const readiness = buildReadiness(input({ campaigns: [liveCampaign({ collectibleLinked: false })] }));
  assert.equal(stateOf(readiness.steps, 'visible'), 'DONE');
  assert.equal(stateOf(readiness.steps, 'reward'), 'NEEDS_SETUP');
  assert.equal(readiness.message, '고객 앱에 보이고 있어요.');
  assert.equal(readiness.remaining, 1);
});

test('a guest-trial store is never listed, so its visible step is not done', () => {
  const steps = buildReadiness(input({ merchant: readyMerchant({ guestTrial: true }) })).steps;
  assert.equal(stateOf(steps, 'visible'), 'CHECK');
  assert.match(steps[5]!.hint, /체험/);
});

test('the relevant campaign is the customer-visible one, else active, else upcoming, else the latest', () => {
  const base = { id: 'c', title: 't', isPublic: true, goals: [1, 3, 5], collectibleLinked: false } as const;
  const make = (id: string, over: Partial<CampaignFacts>): CampaignFacts => ({
    ...base, id, status: 'ACTIVE', startsAt: at('2026-09-01T00:00:00Z'), endsAt: at('2026-12-31T00:00:00Z'), ...over,
  });
  assert.equal(selectRelevantCampaign([], NOW), null);
  const ended = make('ended', { status: 'ENDED', startsAt: at('2026-01-01T00:00:00Z'), endsAt: at('2026-02-01T00:00:00Z') });
  const draftFuture = make('draft', { status: 'DRAFT', startsAt: at('2027-01-01T00:00:00Z'), endsAt: at('2027-06-01T00:00:00Z') });
  const upcomingEarly = make('up-early', { startsAt: at('2026-10-10T00:00:00Z') });
  const upcomingLate = make('up-late', { startsAt: at('2026-11-10T00:00:00Z') });
  const hiddenInWindow = make('hidden', { isPublic: false });
  const badGoals = make('bad-goals', { goals: [1, 3] });
  const visible = make('visible', {});
  // 최신 순 폴백: 끝난 것과 먼 미래 초안이면 가장 최근 시작인 초안.
  assert.equal(selectRelevantCampaign([ended, draftFuture], NOW)!.id, 'draft');
  assert.equal(selectRelevantCampaign([ended], NOW)!.id, 'ended');
  // 시작 전 캠페인은 가장 빨리 시작하는 것이 먼저다.
  assert.equal(selectRelevantCampaign([ended, upcomingLate, upcomingEarly], NOW)!.id, 'up-early');
  // 진행 중인 캠페인이 시작 전 캠페인보다 먼저다. 목표가 틀린 것·비공개보다 고객에게 보이는 것이 먼저다.
  assert.equal(selectRelevantCampaign([upcomingEarly, hiddenInWindow], NOW)!.id, 'hidden');
  assert.equal(selectRelevantCampaign([hiddenInWindow, badGoals, visible, upcomingEarly], NOW)!.id, 'visible');
  assert.equal(selectRelevantCampaign([hiddenInWindow, badGoals], NOW)!.id, 'bad-goals');
  // 입력 순서와 무관하다.
  assert.equal(selectRelevantCampaign([visible, ended, upcomingEarly], NOW)!.id, 'visible');
});

test('campaign phase names the single reason a campaign is or is not on the customer list', () => {
  assert.equal(campaignPhase(liveCampaign(), NOW), 'LIVE');
  assert.equal(campaignPhase(liveCampaign({ startsAt: at('2026-10-05T00:00:00Z') }), NOW), 'SCHEDULED');
  assert.equal(campaignPhase(liveCampaign({ endsAt: at('2026-10-02T00:00:00Z') }), NOW), 'EXPIRED');
  assert.equal(campaignPhase(liveCampaign({ isPublic: false }), NOW), 'NOT_PUBLIC');
  assert.equal(campaignPhase(liveCampaign({ status: 'DRAFT' }), NOW), 'DRAFT');
  assert.equal(campaignPhase(liveCampaign({ status: 'PAUSED' }), NOW), 'PAUSED');
  assert.equal(campaignPhase(liveCampaign({ status: 'ENDED' }), NOW), 'ENDED');
});
