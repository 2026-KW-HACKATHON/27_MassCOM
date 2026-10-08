// 가게 사이를 잇는 코스(Issue #412, D-093). DB 없이 시험할 수 있는 순수 규칙·타입만 둔다.
// 코스 진행은 이 파일이 reward_entitlements 목록에서 계산한다: 클라이언트가 완료를 주장하는 경로는 없다.
import type { CollectibleArtwork } from './collectible-project.js';
import { normalizeDocumentReference } from './store-go-live-rules.js';

export const COURSE_SITUATIONS = ['AFTER_MEAL', 'TAKEOUT', 'OTHER'] as const;
export type CourseSituation = (typeof COURSE_SITUATIONS)[number];
// 문구는 상황을 설명한다. 가게 소개나 이야기를 지어내지 않는다.
export const COURSE_SITUATION_LABEL: Record<CourseSituation, string> = {
  AFTER_MEAL: '식사 후 들르기 좋은 곳',
  TAKEOUT: '포장해서 가져가기 좋은 곳',
  OTHER: '함께 들러볼 만한 곳',
};
export type CourseGoal = 1 | 3 | 5;
export const COURSE_GOALS: readonly CourseGoal[] = [1, 3, 5];
export type CourseStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';

export const COURSE_MIN_STEPS = 2;
export const COURSE_MAX_STEPS = 4;
// 게시는 이 시간 안의 점검 스냅샷이 있을 때만 된다.
export const COURSE_CHECK_FRESH_MS = 60 * 60 * 1000;
// 직선거리가 이보다 멀면 경고한다(막지는 않는다: 같은 날 방문을 강요하지 않는 코스다).
export const COURSE_PAIR_DISTANCE_WARN_METERS = 1500;
const CAMPAIGN_ENDING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export type CourseErrorCode =
  | 'COURSE_INVALID_INPUT' | 'COURSE_NOT_FOUND' | 'COURSE_STATE_CONFLICT' | 'COURSE_NOT_PUBLISHABLE'
  | 'COURSE_INCOMPLETE' | 'COURSE_UNAVAILABLE' | 'ACCOUNT_DELETED';

export class CourseError extends Error {
  // reasons는 게시를 막은 이유 코드 목록(COURSE_NOT_PUBLISHABLE일 때만)이다.
  constructor(readonly code: CourseErrorCode, readonly reasons: readonly string[] = []) {
    super(code);
    this.name = 'CourseError';
  }
}

// ---------- 초안 입력 ----------

export type CourseStepInput = {
  merchantId: string;
  targetVisitCount: CourseGoal;
  pieceKey: string;
  pieceLabel: string;
  ownerOptinRef: string | null;
};
export type CourseDraftInput = {
  title: string;
  situation: CourseSituation;
  sceneKey: string;
  startsAt: string | null;
  endsAt: string | null;
  countsFrom: string | null;
  steps: CourseStepInput[];
};

const keyPattern = /^[a-z0-9-]{1,40}$/;
const bad = (): never => { throw new CourseError('COURSE_INVALID_INPUT'); };
const length = (value: string) => Array.from(value).length;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad();
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(value).some(key => !keys.includes(key))) bad();
};
function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') return bad();
  const trimmed = value.trim();
  return length(trimmed) >= min && length(trimmed) <= max ? trimmed : bad();
}
function instant(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return bad();
  return new Date(value).toISOString();
}

/** 관리자 웹이 보낸 본문을 검증해 정규화한다. 단계는 2–4개이고 가게는 겹치지 않으며 점주 동의 참조는 형식이 맞아야 한다. */
export function parseCourseDraft(raw: unknown): CourseDraftInput {
  const body = record(raw);
  onlyKeys(body, ['title', 'situation', 'sceneKey', 'startsAt', 'endsAt', 'countsFrom', 'steps']);
  if (!COURSE_SITUATIONS.includes(body.situation as CourseSituation)) bad();
  const sceneKey = typeof body.sceneKey === 'string' ? body.sceneKey.trim() : '';
  if (!keyPattern.test(sceneKey)) bad();
  if (!Array.isArray(body.steps) || body.steps.length < COURSE_MIN_STEPS || body.steps.length > COURSE_MAX_STEPS) bad();
  const steps = (body.steps as unknown[]).map((rawStep, index): CourseStepInput => {
    const step = record(rawStep);
    onlyKeys(step, ['merchantId', 'targetVisitCount', 'pieceKey', 'pieceLabel', 'ownerOptinRef']);
    const goal = step.targetVisitCount === undefined ? 1 : step.targetVisitCount;
    if (!COURSE_GOALS.includes(goal as CourseGoal)) bad();
    const pieceKey = step.pieceKey === undefined ? `piece-${index + 1}` : step.pieceKey;
    if (typeof pieceKey !== 'string' || !keyPattern.test(pieceKey)) bad();
    let ownerOptinRef: string | null = null;
    if (typeof step.ownerOptinRef === 'string' && step.ownerOptinRef.trim() !== '') {
      ownerOptinRef = normalizeDocumentReference(step.ownerOptinRef);
      if (ownerOptinRef === null) bad();
    } else if (step.ownerOptinRef !== undefined && step.ownerOptinRef !== null &&
      (typeof step.ownerOptinRef !== 'string' || step.ownerOptinRef.trim() !== '')) bad();
    return { merchantId: text(step.merchantId, 1, 100), targetVisitCount: goal as CourseGoal,
      pieceKey: pieceKey as string, pieceLabel: text(step.pieceLabel, 1, 20), ownerOptinRef };
  });
  if (new Set(steps.map(step => step.merchantId)).size !== steps.length) bad();
  if (new Set(steps.map(step => step.pieceKey)).size !== steps.length) bad();
  const refs = steps.flatMap(step => step.ownerOptinRef ? [step.ownerOptinRef] : []);
  if (new Set(refs).size !== refs.length) bad();
  const startsAt = instant(body.startsAt), endsAt = instant(body.endsAt), countsFrom = instant(body.countsFrom);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) bad();
  return { title: text(body.title, 1, 40), situation: body.situation as CourseSituation, sceneKey,
    startsAt, endsAt, countsFrom, steps };
}

/** 점검에 쓸 "권하는 시각"(KST 0–23시). 없으면 영업시간 점검은 건너뛴다. */
export function parseSuggestedHour(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 23) return bad();
  return raw;
}

// ---------- 진행 계산 ----------

export type StepKey = { position: number; merchantId: string; targetVisitCount: number };
// reward_entitlements 한 행의 필요한 부분. status가 CANCELED이면 세지 않는다(방문 취소가 보상권을 취소한다).
export type StepEntitlement = {
  entitlementId: string;
  merchantId: string;
  targetVisitCount: number;
  earnedAt: Date;
  status: string;
};
export type StepProgress = { position: number; done: boolean; entitlementId: string | null; earnedAt: string | null };

/**
 * 단계 완료 = 그 가게(merchant) × 목표 방문 횟수의 취소되지 않은 보상권이 있다.
 * 리롤로 코인을 잃어도 보상권은 남으므로 단계는 되돌아가지 않는다(코인 보유가 아니라 보상권 존재로 판정한다).
 * countsFrom이 있으면 그 시각 이후에 받은 보상권만 센다. 없으면 게시 전 방문도 센다.
 */
export function evaluateSteps(
  steps: readonly StepKey[], entitlements: readonly StepEntitlement[], countsFrom: Date | null,
): StepProgress[] {
  return steps.map(step => {
    const first = entitlements
      .filter(entitlement => entitlement.status !== 'CANCELED' && entitlement.merchantId === step.merchantId &&
        entitlement.targetVisitCount === step.targetVisitCount &&
        (countsFrom === null || entitlement.earnedAt.getTime() >= countsFrom.getTime()))
      .sort((left, right) => left.earnedAt.getTime() - right.earnedAt.getTime() ||
        left.entitlementId.localeCompare(right.entitlementId))[0];
    return { position: step.position, done: first !== undefined, entitlementId: first?.entitlementId ?? null,
      earnedAt: first?.earnedAt.toISOString() ?? null };
  });
}

export type CourseProgress = { done: number; total: number; complete: boolean; nextPosition: number | null };
export function summarizeProgress(progress: readonly StepProgress[]): CourseProgress {
  const done = progress.filter(step => step.done).length;
  const next = [...progress].sort((left, right) => left.position - right.position).find(step => !step.done);
  return { done, total: progress.length, complete: progress.length > 0 && done === progress.length,
    nextPosition: next?.position ?? null };
}

export type CourseUserState = 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'UNLOCKED' | 'STALE';
/** 열어 본 기록이 있는데 단계가 다시 모자라면(방문 취소 등) STALE이다. 장면은 STALE에서 열리지 않는다. */
export function courseUserState(progress: CourseProgress, unlocked: boolean): CourseUserState {
  if (unlocked) return progress.complete ? 'UNLOCKED' : 'STALE';
  if (progress.complete) return 'READY';
  return progress.done === 0 ? 'NOT_STARTED' : 'IN_PROGRESS';
}

export type CourseHint = {
  courseId: string; title: string; situation: CourseSituation; done: number; total: number;
};
export function courseChipText(hint: Pick<CourseHint, 'situation' | 'done' | 'total'>): string {
  return `'${COURSE_SITUATION_LABEL[hint.situation]}' 코스 ${hint.done}/${hint.total}`;
}
export function courseReasonText(hint: Pick<CourseHint, 'situation' | 'done' | 'total'>): string {
  return `${courseChipText(hint)} · 다음은 이 가게예요.`;
}

// ---------- 점검 스냅샷 ----------

export type CourseMerchantFact = {
  position: number;
  merchantId: string;
  targetVisitCount: number;
  exists: boolean;
  name: string;
  category: string | null;
  active: boolean;
  published: boolean;
  demo: boolean;
  guestTrial: boolean;
  point: { latitude: number; longitude: number } | null;
  campaign: { id: string; endsAt: string; goals: readonly number[]; enrollmentOpen: boolean; hasCoin: boolean } | null;
  // 권하는 시각의 영업 상태. 시각을 주지 않았으면 null.
  hours: 'OPEN' | 'CLOSED' | 'BREAK' | 'UNKNOWN' | 'ORDER_CLOSED' | null;
};
export type CheckKey = 'MERCHANT_ELIGIBLE' | 'LOCATION_OWNED' | 'DISTANCE' | 'HOURS' | 'CATEGORY_MIX' |
  'CAMPAIGN_GOAL' | 'ENROLLMENT_OPEN' | 'CAMPAIGN_WINDOW' | 'COIN_ART';
export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED';
export type CheckItem = { key: CheckKey; status: CheckStatus; positions: number[]; detail: string };
export type CourseCheckSummary = {
  schemaVersion: 1;
  // 점검한 순간의 기록이다. 이후 가게·캠페인 상태가 바뀌어도 이 값은 그대로이며, 게시 때 다시 확인한다.
  snapshot: true;
  label: string;
  basis: 'STRAIGHT_LINE';
  evaluatedAt: string;
  suggestedHour: number | null;
  steps: { position: number; merchantId: string; name: string; category: string | null }[];
  distances: { from: number; to: number; meters: number }[];
  items: CheckItem[];
  ok: boolean;
  failures: number;
  warnings: number;
};

export function straightLineMeters(
  origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number },
): number {
  const toRad = Math.PI / 180;
  const a = Math.sin((destination.latitude - origin.latitude) * toRad / 2) ** 2 +
    Math.cos(origin.latitude * toRad) * Math.cos(destination.latitude * toRad) *
    Math.sin((destination.longitude - origin.longitude) * toRad / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const where = (positions: readonly number[]) => positions.map(position => `${position}번`).join(', ');

export function buildCheckSummary(input: {
  facts: readonly CourseMerchantFact[]; suggestedHour: number | null; evaluatedAt: Date; courseEndsAt: Date | null;
}): CourseCheckSummary {
  const facts = [...input.facts].sort((left, right) => left.position - right.position);
  const items: CheckItem[] = [];
  const add = (key: CheckKey, status: CheckStatus, positions: number[], detail: string) =>
    items.push({ key, status, positions, detail });
  const failing = (key: CheckKey, passDetail: string, failDetail: string, predicate: (fact: CourseMerchantFact) => boolean) => {
    const positions = facts.filter(predicate).map(fact => fact.position);
    positions.length ? add(key, 'FAIL', positions, `${where(positions)} ${failDetail}`) : add(key, 'PASS', [], passDetail);
  };

  failing('MERCHANT_ELIGIBLE', '모든 가게가 공개 운영 중인 일반 점포예요.',
    '가게는 공개 운영 중인 일반 점포가 아니에요(시연·체험 점포이거나 공개 전·중지 상태).',
    fact => !fact.exists || !fact.active || !fact.published || fact.demo || fact.guestTrial);
  failing('LOCATION_OWNED', '모든 가게에 점주가 확인한 위치가 있어요.',
    '가게에 점주가 확인한 위치(좌표)가 없어요.', fact => fact.point === null);

  const located = facts.filter(fact => fact.point !== null);
  const distances: CourseCheckSummary['distances'] = [];
  for (const [index, from] of located.entries()) {
    for (const to of located.slice(index + 1)) {
      distances.push({ from: from.position, to: to.position, meters: straightLineMeters(from.point!, to.point!) });
    }
  }
  const far = distances.filter(pair => pair.meters > COURSE_PAIR_DISTANCE_WARN_METERS);
  if (distances.length === 0) add('DISTANCE', 'SKIPPED', [], '위치가 확인된 가게가 둘 미만이라 거리를 재지 않았어요.');
  else if (far.length) {
    add('DISTANCE', 'WARN', [...new Set(far.flatMap(pair => [pair.from, pair.to]))],
      `직선거리 ${COURSE_PAIR_DISTANCE_WARN_METERS}m를 넘는 가게 쌍이 있어요(${far.map(pair => `${pair.from}-${pair.to}번 ${pair.meters}m`).join(', ')}). 도보 경로가 아닌 직선거리예요.`);
  } else add('DISTANCE', 'PASS', [], '모든 가게 쌍이 직선거리 기준 가까워요(도보 경로가 아닌 직선거리).');

  if (input.suggestedHour === null) add('HOURS', 'SKIPPED', [], '권하는 시각을 주지 않아 영업시간을 확인하지 않았어요.');
  else {
    const notOpen = facts.filter(fact => fact.hours !== 'OPEN');
    notOpen.length
      ? add('HOURS', 'WARN', notOpen.map(fact => fact.position),
        `${where(notOpen.map(fact => fact.position))} 가게는 ${input.suggestedHour}시에 영업 중인지 확인되지 않아요(휴무·휴게·주문 마감 또는 영업시간 미등록).`)
      : add('HOURS', 'PASS', [], `모든 가게가 ${input.suggestedHour}시에 영업 중이에요.`);
  }

  const categories = new Set(facts.map(fact => fact.category?.trim()).filter((category): category is string => !!category));
  categories.size >= 2
    ? add('CATEGORY_MIX', 'PASS', [], `업종이 ${categories.size}가지로 섞여 있어요.`)
    : add('CATEGORY_MIX', 'WARN', [], '업종이 한 가지뿐이거나 등록되지 않았어요.');

  failing('CAMPAIGN_GOAL', '모든 가게에 목표 방문 횟수를 담은 공개 캠페인이 있어요.',
    '가게에 목표 방문 횟수를 담은 진행 중인 공개 캠페인이 없어요.',
    fact => fact.campaign === null || !fact.campaign.goals.includes(fact.targetVisitCount));
  failing('ENROLLMENT_OPEN', '모든 가게의 캠페인에 자리가 있어요.', '가게의 캠페인 정원이 다 찼어요.',
    fact => fact.campaign !== null && !fact.campaign.enrollmentOpen);

  const soon = facts.filter(fact => fact.campaign !== null && (
    Date.parse(fact.campaign.endsAt) - input.evaluatedAt.getTime() < CAMPAIGN_ENDING_SOON_MS ||
    (input.courseEndsAt !== null && Date.parse(fact.campaign.endsAt) < input.courseEndsAt.getTime())));
  soon.length
    ? add('CAMPAIGN_WINDOW', 'WARN', soon.map(fact => fact.position),
      `${where(soon.map(fact => fact.position))} 가게의 캠페인이 코스 기간보다 먼저 끝나거나 7일 안에 끝나요.`)
    : add('CAMPAIGN_WINDOW', 'PASS', [], '캠페인 기간이 코스 기간을 덮어요.');

  const noCoin = facts.filter(fact => fact.campaign !== null && !fact.campaign.hasCoin);
  noCoin.length
    ? add('COIN_ART', 'WARN', noCoin.map(fact => fact.position),
      `${where(noCoin.map(fact => fact.position))} 가게에는 이 목표에 걸린 게시 코인 그림이 없어 장면에 보일 코인이 없어요.`)
    : add('COIN_ART', 'PASS', [], '모든 가게의 코인 그림이 연결돼 있어요.');

  const failures = items.filter(item => item.status === 'FAIL').length;
  return {
    schemaVersion: 1, snapshot: true, basis: 'STRAIGHT_LINE',
    label: '점검한 순간의 스냅샷입니다. 직선거리 기준이며 도보 경로·실시간 영업 여부가 아닙니다.',
    evaluatedAt: input.evaluatedAt.toISOString(), suggestedHour: input.suggestedHour,
    steps: facts.map(fact => ({ position: fact.position, merchantId: fact.merchantId, name: fact.name, category: fact.category })),
    distances, items, ok: failures === 0, failures, warnings: items.filter(item => item.status === 'WARN').length,
  };
}

// ---------- 게시 체크리스트 ----------

export type PublishReason =
  | 'COURSE_STATE' | 'COURSE_STEP_COUNT' | 'COURSE_OPTIN_MISSING' | 'COURSE_WINDOW_ENDED'
  | 'COURSE_CHECK_MISSING' | 'COURSE_CHECK_STALE' | 'COURSE_CHECK_FAILED';

/**
 * 게시를 막는 이유 목록(비어 있으면 게시 가능). 저장된 점검이 최근 것이어야 하고, 점검(저장본)과 게시 순간의 재점검(live) 모두
 * 실패 항목이 없어야 하며, 모든 단계에 점주 동의 참조가 있어야 한다. 경고(WARN)는 막지 않는다.
 */
export function publishBlockers(input: {
  status: CourseStatus; stepCount: number; stepsWithoutOptin: number; endsAt: Date | null;
  checkedAt: Date | null; stored: CourseCheckSummary | null; live: CourseCheckSummary; now: Date;
}): PublishReason[] {
  const reasons: PublishReason[] = [];
  if (input.status !== 'DRAFT' && input.status !== 'PAUSED') reasons.push('COURSE_STATE');
  if (input.stepCount < COURSE_MIN_STEPS || input.stepCount > COURSE_MAX_STEPS) reasons.push('COURSE_STEP_COUNT');
  if (input.stepsWithoutOptin > 0) reasons.push('COURSE_OPTIN_MISSING');
  if (input.endsAt !== null && input.endsAt.getTime() <= input.now.getTime()) reasons.push('COURSE_WINDOW_ENDED');
  if (input.checkedAt === null || input.stored === null) reasons.push('COURSE_CHECK_MISSING');
  else if (input.now.getTime() - input.checkedAt.getTime() > COURSE_CHECK_FRESH_MS ||
    input.checkedAt.getTime() > input.now.getTime()) reasons.push('COURSE_CHECK_STALE');
  if (!input.live.ok || (input.stored !== null && !input.stored.ok)) reasons.push('COURSE_CHECK_FAILED');
  return reasons;
}

// ---------- 화면용 타입 ----------

export type CourseStepView = {
  position: number;
  merchantId: string;
  merchantName: string;
  targetVisitCount: CourseGoal;
  pieceKey: string;
  pieceLabel: string;
  state: 'AVAILABLE' | 'UNAVAILABLE';
  done: boolean;
  earnedAt: string | null;
  // 이 가게의 진행 중인 캠페인에서 센 방문 일수(없으면 null). 단계 완료 판정에는 쓰지 않는다.
  progressVisitCount: number | null;
  // 아직 안 한 단계의 가게 정원이 찼으면 true("자리 없음").
  full: boolean;
  // 상세에서만, 완료한 단계의 코인 그림(그 가게 자신의 게시 코인)이다. 새 그림을 만들지 않는다.
  artwork?: CollectibleArtwork;
};
export type CourseView = {
  id: string;
  title: string;
  situation: CourseSituation;
  situationLabel: string;
  sceneKey: string;
  status: CourseStatus;
  startsAt: string | null;
  endsAt: string | null;
  done: number;
  total: number;
  state: CourseUserState;
  stale: boolean;
  unlockedAt: string | null;
  steps: CourseStepView[];
};
export type AdminCourseStep = {
  position: number; merchantId: string; merchantName: string; targetVisitCount: CourseGoal;
  pieceKey: string; pieceLabel: string; ownerOptinRef: string | null; ownerOptinAt: string | null;
};
export type AdminCourse = {
  id: string; title: string; situation: CourseSituation; sceneKey: string; status: CourseStatus;
  startsAt: string | null; endsAt: string | null; countsFrom: string | null;
  checkedAt: string | null; checkSummary: CourseCheckSummary | null; createdAt: string;
  steps: AdminCourseStep[];
};

export interface CourseService {
  adminList(actorAccountId: string): Promise<AdminCourse[]>;
  adminCreate(actorAccountId: string, input: unknown): Promise<AdminCourse>;
  adminCheck(actorAccountId: string, courseId: string, suggestedHour: number | null): Promise<AdminCourse>;
  adminPublish(actorAccountId: string, courseId: string): Promise<AdminCourse>;
  adminPause(actorAccountId: string, courseId: string): Promise<AdminCourse>;
  list(accountId: string): Promise<CourseView[]>;
  get(accountId: string, courseId: string): Promise<CourseView>;
  unlock(accountId: string, courseId: string): Promise<{ course: CourseView; replayed: boolean }>;
}
