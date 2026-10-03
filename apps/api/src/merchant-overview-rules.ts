// Issue #330: 점주 웹 "가게 현황"(요약 카드 + 오픈 준비 체크리스트)의 순수 규칙. DB 없이 시험할 수 있는 함수만 둔다.
// 날짜는 모두 한국 시간(KST, UTC+9, 서머타임 없음)이다. visit_events.business_date가 KST 날짜라서 같은 기준으로 센다.
import { missingPublishRequirements } from './store-go-live-rules.js';

// ---- 응답 모양 ----

export type DailyVisitCount = { date: string; count: number };

export type VisitComparison = {
  // 지난주 같은 시각까지의 방문 수(월요일 00:00부터 지금에서 7일 전 시각까지). 이번 주는 아직 끝나지 않았으므로 지난주 전체와
  // 비교하지 않고, 오늘도 지금까지만 세어지므로 지난주 같은 요일은 하루 전체가 아니라 같은 시각까지만 센다.
  lastWeekSameSpan: number;
  delta: number;
};

export type CampaignPhase = 'LIVE' | 'SCHEDULED' | 'NOT_PUBLIC' | 'EXPIRED' | 'DRAFT' | 'PAUSED' | 'ENDED';

export type OverviewCampaign = {
  title: string;
  status: CampaignStatus;
  isPublic: boolean;
  startsAt: string;
  endsAt: string;
  // 지금 이 캠페인이 고객 목록에 올라가는지, 아니라면 왜인지(서버 시계 기준이라 브라우저 시계가 틀려도 같은 말을 한다).
  phase: CampaignPhase;
};

export type ReadinessStepKey = 'basic' | 'menu' | 'members' | 'reward' | 'campaign' | 'visible';
export type ReadinessState = 'DONE' | 'NEEDS_SETUP' | 'CHECK' | 'WAITING_APPROVAL' | 'SCHEDULED';
export type ReadinessStep = { key: ReadinessStepKey; label: string; state: ReadinessState; hint: string };
export type Readiness = {
  steps: ReadinessStep[];
  // DONE이 아닌 단계 수. 고객 앱에 이미 보여도 수집품 연결처럼 남은 단계가 있으면 0보다 크다.
  remaining: number;
  message: string;
};

export type MerchantOverview = {
  generatedAt: string;
  // 서버가 계산한 오늘(KST)과 이번 주 시작(월요일, KST).
  businessDate: string;
  weekStartsOn: string;
  visits: { today: number; thisWeek: number; lastWeek: number; last7Days: DailyVisitCount[]; total: number };
  comparison: VisitComparison | null;
  couponsRedeemedThisWeek: number;
  repeatVisitors: number;
  campaign: OverviewCampaign | null;
  readiness: Readiness;
};

export interface MerchantOverviewReader {
  overview(input: { merchantId: string }): Promise<MerchantOverview>;
}

export class MerchantOverviewError extends Error {
  constructor(readonly code: 'MERCHANT_NOT_FOUND') {
    super(code);
    this.name = 'MerchantOverviewError';
  }
}

// ---- KST 날짜 ----

const kstOffsetMs = 9 * 60 * 60 * 1000;

function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`invalid date ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function kstDateOf(instant: Date): string {
  return new Date(instant.getTime() + kstOffsetMs).toISOString().slice(0, 10);
}

export function shiftDate(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

// 그 날짜(KST)가 속한 주의 월요일.
export function weekStartOf(date: string): string {
  const { year, month, day } = parseDate(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = 일요일
  return shiftDate(date, -((weekday + 6) % 7));
}

// 그 날짜(KST) 00:00:00이 가리키는 시각.
export function kstMidnight(date: string): Date {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day) - kstOffsetMs);
}

export type OverviewPeriods = {
  today: string;
  thisWeekStart: string;
  nextWeekStart: string;
  lastWeekStart: string;
  // 지난주에서 "이번 주가 지금까지 흐른 만큼"의 마지막 날(포함). 이 날은 시각까지 맞춰 세야 하므로 SQL이 지금에서 7일 전 시각으로 한 번 더 자른다.
  lastWeekSameSpanEnd: string;
  // 최근 7일(오늘 포함)의 첫날.
  sevenDayStart: string;
};

export function overviewPeriods(now: Date): OverviewPeriods {
  const today = kstDateOf(now);
  const thisWeekStart = weekStartOf(today);
  const lastWeekStart = shiftDate(thisWeekStart, -7);
  return {
    today,
    thisWeekStart,
    nextWeekStart: shiftDate(thisWeekStart, 7),
    lastWeekStart,
    lastWeekSameSpanEnd: shiftDate(lastWeekStart, daysBetween(thisWeekStart, today)),
    sevenDayStart: shiftDate(today, -6),
  };
}

// 오늘을 끝으로 하는 7일 막대. 방문이 없는 날도 0으로 채워 항상 7개를 오래된 날부터 돌려준다.
export function buildDailySeries(rows: readonly DailyVisitCount[], today: string): DailyVisitCount[] {
  const byDate = new Map<string, number>();
  for (const row of rows) byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.count);
  return Array.from({ length: 7 }, (_unused, index) => {
    const date = shiftDate(today, index - 6);
    return { date, count: byDate.get(date) ?? 0 };
  });
}

// 지난주 대비는 가게가 지난주 시작 전부터 공개돼 있었을 때만 공정하다(published_at이 없거나 더 늦으면 숨긴다).
export function buildComparison(input: {
  publishedAt: Date | null;
  now: Date;
  thisWeek: number;
  lastWeekSameSpan: number;
}): VisitComparison | null {
  if (input.publishedAt === null) return null;
  const lastWeekStart = kstMidnight(overviewPeriods(input.now).lastWeekStart);
  if (input.publishedAt.getTime() > lastWeekStart.getTime()) return null;
  return { lastWeekSameSpan: input.lastWeekSameSpan, delta: input.thisWeek - input.lastWeekSameSpan };
}

// ---- 캠페인·공개 판정 ----

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';

export type CampaignFacts = {
  id: string;
  title: string;
  status: CampaignStatus;
  isPublic: boolean;
  startsAt: Date;
  endsAt: Date;
  // 이 캠페인의 보상 목표 방문 횟수(campaign_goals).
  goals: readonly number[];
  // campaign_collectible_publications에 연결된 수집품 발행본이 있는지.
  collectibleLinked: boolean;
};

export type MerchantFacts = {
  name: string;
  roadAddress: string;
  businessHours: string;
  menuItemCount: number;
  status: 'ACTIVE' | 'PAUSED';
  publishedAt: Date | null;
  // 로그인 없는 체험 가게(#309). 고객 목록에는 어떤 경우에도 나오지 않는다.
  guestTrial: boolean;
};

export type ReadinessInput = {
  now: Date;
  merchant: MerchantFacts;
  // 활성 점주·직원 수.
  owners: number;
  staff: number;
  campaigns: readonly CampaignFacts[];
};

// 보상 목표가 정확히 {1, 3, 5}인지. campaign_goals는 (캠페인, 횟수)가 기본 키이고 횟수는 1·3·5뿐이라 개수가 3이면 정확히 같다.
const hasExactRewardGoals = (goals: readonly number[]): boolean =>
  goals.length === 3 && [...goals].sort((a, b) => a - b).join(',') === '1,3,5';

// 이 캠페인이 고객 목록에 올라가지 못하거나 올라가는 단 하나의 이유. 점수를 고르는 기준이라 순서가 중요하다.
export function campaignPhase(campaign: CampaignFacts, now: Date): CampaignPhase {
  if (campaign.status === 'DRAFT') return 'DRAFT';
  if (campaign.status === 'PAUSED') return 'PAUSED';
  if (campaign.status === 'ENDED') return 'ENDED';
  if (campaign.endsAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (!campaign.isPublic) return 'NOT_PUBLIC';
  if (campaign.startsAt.getTime() > now.getTime()) return 'SCHEDULED';
  return 'LIVE';
}

// 공개 목록 SQL(postgres/merchant-catalog.ts listPublicMerchants)의 캠페인 조건과 같다. 둘이 어긋나지 않는지는
// merchant-overview.postgres.integration.ts의 일치 시험이 실제 DB로 확인한다. 조건을 바꾸면 양쪽을 함께 바꾼다.
//   c.status = 'ACTIVE' AND c.is_public AND c.starts_at <= now AND c.ends_at > now AND 목표 집합 = {1, 3, 5}
export function isCampaignCustomerVisible(campaign: CampaignFacts, now: Date): boolean {
  return campaignPhase(campaign, now) === 'LIVE' && hasExactRewardGoals(campaign.goals);
}

// 공개 목록 SQL의 점포 조건까지 합친 판정: 점포 ACTIVE, 체험 가게 아님, 위 캠페인 조건을 채운 캠페인이 하나라도 있음.
export function isMerchantCustomerVisible(input: {
  now: Date;
  merchantStatus: 'ACTIVE' | 'PAUSED';
  guestTrial: boolean;
  campaigns: readonly CampaignFacts[];
}): boolean {
  return input.merchantStatus === 'ACTIVE' && !input.guestTrial &&
    input.campaigns.some(campaign => isCampaignCustomerVisible(campaign, input.now));
}

// 점주 화면이 보여 줄 대표 캠페인 하나: 고객에게 보이는 것 → 진행 중인 것 → 시작 전인 것 → 가장 최근 것.
export function selectRelevantCampaign(campaigns: readonly CampaignFacts[], now: Date): CampaignFacts | null {
  const rank = (campaign: CampaignFacts): number => {
    const phase = campaignPhase(campaign, now);
    if (phase === 'LIVE') return hasExactRewardGoals(campaign.goals) ? 0 : 1;
    if (phase === 'NOT_PUBLIC' && campaign.startsAt.getTime() <= now.getTime()) return 2;
    if (phase === 'SCHEDULED') return 3;
    return 4;
  };
  const ranked = [...campaigns].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    // 시작 전 캠페인은 가장 빨리 시작하는 것, 나머지는 가장 최근에 시작한 것이 먼저다.
    const byStart = rank(a) === 3
      ? a.startsAt.getTime() - b.startsAt.getTime()
      : b.startsAt.getTime() - a.startsAt.getTime();
    return byStart !== 0 ? byStart : a.id.localeCompare(b.id);
  });
  return ranked[0] ?? null;
}

// ---- 오픈 준비 체크리스트 ----

const stepLabels: Record<ReadinessStepKey, string> = {
  basic: '가게 기본 정보',
  menu: '메뉴',
  members: '점주·직원',
  reward: '방문 보상',
  campaign: '캠페인',
  visible: '고객 앱 공개',
};

const couponOfferNote = '쿠폰 혜택은 운영팀이 플랫폼 단위로 설정해요.';

function basicStep(input: ReadinessInput): ReadinessStep {
  const { merchant } = input;
  // 공개 요건(메뉴·영업시간·주소)은 관리자 공개 화면과 같은 함수로 판정하고, 가게 이름만 더 본다.
  const missing = missingPublishRequirements({
    menuItemCount: merchant.menuItemCount, businessHours: merchant.businessHours, roadAddress: merchant.roadAddress,
  });
  const lacking: string[] = [];
  if (!merchant.name.trim()) lacking.push('가게 이름');
  if (missing.includes('ADDRESS')) lacking.push('도로명 주소');
  if (missing.includes('HOURS')) lacking.push('영업시간');
  if (lacking.length === 0) return { key: 'basic', label: stepLabels.basic, state: 'DONE', hint: '' };
  return {
    key: 'basic', label: stepLabels.basic, state: 'NEEDS_SETUP',
    hint: `비어 있는 항목: ${lacking.join(', ')}. 운영팀에 입력을 요청해 주세요.`,
  };
}

function menuStep(input: ReadinessInput): ReadinessStep {
  const { merchant } = input;
  const missing = missingPublishRequirements({
    menuItemCount: merchant.menuItemCount, businessHours: merchant.businessHours, roadAddress: merchant.roadAddress,
  });
  if (!missing.includes('MENU')) {
    return { key: 'menu', label: stepLabels.menu, state: 'DONE', hint: `메뉴 ${merchant.menuItemCount}개가 등록돼 있어요.` };
  }
  return {
    key: 'menu', label: stepLabels.menu, state: 'NEEDS_SETUP',
    hint: '메뉴를 1개 이상 등록해야 고객 앱에 공개할 수 있어요. 운영팀에 등록을 요청해 주세요.',
  };
}

function membersStep(input: ReadinessInput): ReadinessStep {
  const counts = `점주 ${input.owners}명 · 직원 ${input.staff}명`;
  if (input.owners >= 1) return { key: 'members', label: stepLabels.members, state: 'DONE', hint: counts };
  return {
    key: 'members', label: stepLabels.members, state: 'CHECK',
    hint: `활성 점주가 없어요. 운영팀에 점주 지정을 요청해 주세요. (직원 ${input.staff}명)`,
  };
}

function rewardStep(input: ReadinessInput, selected: CampaignFacts | null): ReadinessStep {
  const done = input.campaigns.some(campaign =>
    campaign.status === 'ACTIVE' && hasExactRewardGoals(campaign.goals) && campaign.collectibleLinked);
  if (done) {
    return {
      key: 'reward', label: stepLabels.reward, state: 'DONE',
      hint: `방문 보상(1·3·5회 수집품)이 캠페인에 연결돼 있어요. ${couponOfferNote}`,
    };
  }
  const hint = !selected ? '캠페인이 있어야 방문 보상(1·3·5회)을 정할 수 있어요.'
    : !hasExactRewardGoals(selected.goals) ? '방문 보상 목표가 1·3·5회로 맞춰지지 않았어요. 운영팀에 확인을 요청해 주세요.'
      : !selected.collectibleLinked ? '방문 보상 수집품이 아직 캠페인에 연결되지 않았어요. 점주 계정으로 "가게 수집품 만들기"에서 수집품을 만들어 게시해 주세요.'
        : '캠페인이 진행(ACTIVE) 상태가 되어야 방문 보상이 적용돼요. 운영팀에 확인을 요청해 주세요.';
  return { key: 'reward', label: stepLabels.reward, state: 'NEEDS_SETUP', hint: `${hint} ${couponOfferNote}` };
}

const campaignHints: Record<Exclude<CampaignPhase, 'LIVE' | 'SCHEDULED'>, string> = {
  NOT_PUBLIC: '캠페인이 아직 고객에게 공개되지 않았어요. 운영팀에 공개를 요청해 주세요.',
  EXPIRED: '캠페인 기간이 끝났어요. 운영팀에 새 캠페인을 요청해 주세요.',
  DRAFT: '캠페인이 아직 초안이에요. 운영팀에 공개를 요청해 주세요.',
  PAUSED: '캠페인이 일시정지 상태예요. 운영팀에 재개를 요청해 주세요.',
  ENDED: '캠페인이 종료됐어요. 운영팀에 새 캠페인을 요청해 주세요.',
};

function campaignStep(input: ReadinessInput, selected: CampaignFacts | null): ReadinessStep {
  if (!selected) {
    return {
      key: 'campaign', label: stepLabels.campaign, state: 'NEEDS_SETUP',
      hint: '만들어진 캠페인이 없어요. 운영팀에 캠페인 생성을 요청해 주세요.',
    };
  }
  const phase = campaignPhase(selected, input.now);
  if (phase === 'LIVE') return { key: 'campaign', label: stepLabels.campaign, state: 'DONE', hint: '' };
  if (phase === 'SCHEDULED') {
    return {
      key: 'campaign', label: stepLabels.campaign, state: 'SCHEDULED',
      hint: '캠페인 시작일이 아직 되지 않아 고객 목록에는 표시되지 않습니다.',
    };
  }
  return { key: 'campaign', label: stepLabels.campaign, state: 'CHECK', hint: campaignHints[phase] };
}

function visibleStep(input: ReadinessInput, earlier: readonly ReadinessStep[]): ReadinessStep {
  const visible = isMerchantCustomerVisible({
    now: input.now, merchantStatus: input.merchant.status, guestTrial: input.merchant.guestTrial,
    campaigns: input.campaigns,
  });
  const base = { key: 'visible', label: stepLabels.visible } as const;
  if (visible) return { ...base, state: 'DONE', hint: '' };
  if (input.merchant.guestTrial) {
    return { ...base, state: 'CHECK', hint: '체험용 점포는 고객 목록에 표시되지 않아요.' };
  }
  const firstThreeDone = earlier.slice(0, 3).every(step => step.state === 'DONE');
  if (input.merchant.status === 'PAUSED' && firstThreeDone) {
    return { ...base, state: 'WAITING_APPROVAL', hint: '운영팀 공개 처리 대기 중이에요.' };
  }
  return { ...base, state: 'NEEDS_SETUP', hint: '위 단계를 먼저 마치면 고객 앱에 보여요.' };
}

// 6단계 체크리스트. 고객 앱 공개 단계는 공개 목록과 같은 조건으로 판정하므로(isMerchantCustomerVisible) 목록 SQL과 어긋나지 않는다.
// 가게 사진 칸은 데이터에 없어 단계에 넣지 않는다. 쿠폰 오퍼는 플랫폼 단위 설정이라 단계가 아니라 방문 보상 단계의 안내 문구로만 둔다.
export function buildReadiness(input: ReadinessInput): Readiness {
  const selected = selectRelevantCampaign(input.campaigns, input.now);
  const earlier = [basicStep(input), menuStep(input), membersStep(input), rewardStep(input, selected), campaignStep(input, selected)];
  const steps = [...earlier, visibleStep(input, earlier)];
  const remaining = steps.filter(step => step.state !== 'DONE').length;
  const visible = steps[5]!.state === 'DONE';
  return {
    steps,
    remaining,
    message: visible ? '고객 앱에 보이고 있어요.' : `고객 앱 공개까지 ${remaining}단계 남았습니다.`,
  };
}
