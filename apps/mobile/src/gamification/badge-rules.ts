import type { BadgeBook, Coupon, CouponStatus, Medal, MedalKind, MedalTier, Reward, RewardMilestone } from './badge-api';

// 표시 전용 규칙. 등급·상자 판정은 서버가 정본이고, 여기서는 받은 값을 말로 옮긴다(spec §2·§3).

export type ShareVariant = 'showcase' | 'production';

type MedalCopy = {
  name: string;
  unit: string;
  /** "서로 다른 가게 3곳" */
  measure: (value: number) => string;
  /** One-line rule shown in the detail sheet. */
  rule: string;
  /** Share body, e.g. "서로 다른 가게 3곳을 발견했어요" */
  achievement: (value: number) => string;
};

const medalCopies: Record<MedalKind, MedalCopy> = {
  explorer: {
    name: '동네 탐험가',
    unit: '곳',
    measure: (value) => `서로 다른 가게 ${value}곳`,
    rule: '인증한 방문 중 서로 다른 가게 수를 세요.',
    achievement: (value) => `서로 다른 가게 ${value}곳을 발견했어요`,
  },
  regular: {
    name: '단골손님',
    unit: '번',
    measure: (value) => `한 가게 ${value}번`,
    rule: '가장 자주 찾은 한 가게의 방문 날 수를 세요.',
    achievement: (value) => `한 가게를 ${value}번 찾아갔어요`,
  },
  steady: {
    name: '꾸준한 걸음',
    unit: '일',
    measure: (value) => `방문한 날 ${value}일`,
    rule: '방문을 인증한 서로 다른 날 수를 세요.',
    achievement: (value) => `${value}일 동안 동네를 걸었어요`,
  },
};

export const sameDayRuleNote = '같은 가게는 하루에 한 번만 세요.';

export function medalCopy(kind: MedalKind): MedalCopy {
  return medalCopies[kind];
}

const tierNames = ['미획득', '브론즈', '실버', '골드'] as const;

export function tierName(tier: MedalTier): (typeof tierNames)[number] {
  return tierNames[tier];
}

export type TierProgress = {
  nextTier: 1 | 2 | 3 | null;
  target: number | null;
  remaining: number | null;
  /** 0–1 progress from the current tier's threshold toward the next one; 1 at gold. */
  fraction: number;
};

export function nextTierProgress(medal: Pick<Medal, 'value' | 'tier' | 'thresholds'>): TierProgress {
  const tier = medal.tier;
  if (tier === 3) return { nextTier: null, target: null, remaining: null, fraction: 1 };
  const nextTier = (tier + 1) as 1 | 2 | 3;
  const target = medal.thresholds[tier];
  const floor = tier === 0 ? 0 : medal.thresholds[tier - 1]!;
  const span = Math.max(1, target - floor);
  return {
    nextTier,
    target,
    remaining: Math.max(0, target - medal.value),
    fraction: clamp((medal.value - floor) / span),
  };
}

/** "실버까지 1곳 더" · "골드 달성! 최고 등급이에요" */
export function medalProgressText(medal: Medal): string {
  const progress = nextTierProgress(medal);
  if (!progress.nextTier) return '골드 달성! 최고 등급이에요';
  const { unit } = medalCopies[medal.kind];
  return `${tierName(progress.nextTier)}까지 ${progress.remaining}${unit} 더`;
}

/** Two deliberate lines for narrow medal cards: ["브론즈까지", "1곳 더"] · ["골드 달성!", "최고 등급"]. */
export function medalProgressLines(medal: Medal): [string, string] {
  const progress = nextTierProgress(medal);
  if (!progress.nextTier) return ['골드 달성!', '최고 등급'];
  return [`${tierName(progress.nextTier)}까지`, `${progress.remaining}${medalCopies[medal.kind].unit} 더`];
}

/** "동네 탐험가 실버" or "동네 탐험가" before the first tier. */
export function medalTitle(medal: Pick<Medal, 'kind' | 'tier'>): string {
  const { name } = medalCopies[medal.kind];
  return medal.tier === 0 ? name : `${name} ${tierName(medal.tier)}`;
}

export function medalAccessibilityLabel(medal: Medal): string {
  const copy = medalCopies[medal.kind];
  return `${copy.name} 배지, ${tierName(medal.tier)}, ${copy.measure(medal.value)}, ${medalProgressText(medal)}`;
}

export type ExplorerRank = { title: string; level: 0 | 1 | 2 | 3 | 4 };

export function explorerRank(earnedTiers: number): ExplorerRank {
  if (earnedTiers >= 9) return { title: '월계 마스터', level: 4 };
  if (earnedTiers >= 6) return { title: '월계 미식가', level: 3 };
  if (earnedTiers >= 3) return { title: '골목 탐험가', level: 2 };
  if (earnedTiers >= 1) return { title: '동네 산책가', level: 1 };
  return { title: '새내기 탐험가', level: 0 };
}

const rewardBoxNames: Record<RewardMilestone, string> = {
  1: '첫 번째 상자',
  2: '두 번째 상자',
  3: '황금 상자',
};

export function rewardBoxName(milestone: RewardMilestone): string {
  return rewardBoxNames[milestone];
}

/** Badges still needed for the next box that is not reached yet, or null when every box is reached. */
export function badgesToNextBox(book: Pick<BadgeBook, 'earnedTiers' | 'rewards'>): number | null {
  const next = book.rewards.find((reward) => reward.requiredTiers > book.earnedTiers);
  return next ? next.requiredTiers - book.earnedTiers : null;
}

export function rewardStatusText(
  reward: Pick<Reward, 'state' | 'requiredTiers' | 'unavailableReason'>,
  earnedTiers: number,
): string {
  switch (reward.state) {
    case 'LOCKED': return `배지 ${Math.max(1, reward.requiredTiers - earnedTiers)}개 더`;
    case 'READY': return '지금 열 수 있어요';
    // 관리자가 쿠폰을 무효로 한 상자는 "준비 중"이 아니라 더 받을 수 없다고 알린다.
    case 'UNAVAILABLE': return reward.unavailableReason === 'COUPON_REVOKED'
      ? '이 혜택은 더 이상 받을 수 없어요'
      : '달성! 참여 가게 혜택 준비 중';
    case 'OPENED': return '쿠폰을 받았어요';
  }
}

export function rewardAccessibilityLabel(reward: Reward, earnedTiers: number): string {
  const offer = reward.offer && reward.state !== 'OPENED'
    ? `, 혜택 ${reward.offer.merchantName} ${reward.offer.title}`
    : '';
  const coupon = reward.coupon ? `, ${reward.coupon.merchantName} ${reward.coupon.title}` : '';
  return `${rewardBoxName(reward.milestone)}, 배지 ${reward.requiredTiers}개 필요, ${rewardStatusText(reward, earnedTiers)}${offer}${coupon}`;
}

export type RaisedMedal = { kind: MedalKind; fromTier: MedalTier; toTier: MedalTier; medal: Medal };
export type BadgeBookDiff = { raisedMedals: readonly RaisedMedal[]; newlyReady: readonly Reward[] };

/**
 * What changed between the badge book seen before a visit claim and after it.
 * Without a trustworthy "before" snapshot nothing is announced as new.
 */
export function diffBadgeBooks(before: BadgeBook | undefined, after: BadgeBook | undefined): BadgeBookDiff {
  if (!before || !after) return { raisedMedals: [], newlyReady: [] };
  const raisedMedals = after.medals.flatMap((medal) => {
    const previous = before.medals.find((item) => item.kind === medal.kind);
    return previous && medal.tier > previous.tier
      ? [{ kind: medal.kind, fromTier: previous.tier, toTier: medal.tier, medal }]
      : [];
  });
  const newlyReady = after.rewards.filter((reward) => {
    const previous = before.rewards.find((item) => item.milestone === reward.milestone);
    return reward.state === 'READY' && previous?.state !== 'READY' && previous?.state !== 'OPENED';
  });
  return { raisedMedals, newlyReady };
}

/** The most impressive medal to share after a claim: highest new tier, explorer first on ties. */
export function featuredRaisedMedal(diff: BadgeBookDiff): Medal | undefined {
  return [...diff.raisedMedals].sort((a, b) => b.toTier - a.toTier)[0]?.medal;
}

export const shareDestination: Record<ShareVariant, string> = {
  showcase: 'https://www.masscom.kr/preview/',
  production: 'https://www.masscom.kr/app/',
};

export const showcaseRecordNote = '체험용 가상 기록';

export type ShareCardCopy = {
  eyebrow: string;
  title: string;
  body: string;
  footer: string;
  demoNote: string | null;
};

/** Text drawn on the share image. Only the medal and its count: no account, dates, shops, wallet or QR. */
export function shareCardCopy(medal: Medal, variant: ShareVariant): ShareCardCopy {
  if (medal.tier === 0) throw new Error('BADGE_NOT_EARNED');
  return {
    eyebrow: '나의 동네 배지',
    title: medalTitle(medal),
    body: medalCopies[medal.kind].achievement(medal.value),
    footer: '월계 마스코트 · masscom.kr',
    demoNote: variant === 'showcase' ? showcaseRecordNote : null,
  };
}

/** Text fallback when image sharing is unavailable; same privacy boundary as the card. */
export function shareMessage(medal: Medal, variant: ShareVariant): string {
  const card = shareCardCopy(medal, variant);
  const demo = card.demoNote ? `${card.demoNote}이에요. 실제 방문·혜택이 아니에요.\n` : '';
  return `월계 마스코트에서 '${card.title}' 배지를 받았어요!\n${card.body}.\n${demo}${shareDestination[variant]}`;
}

const kstOffsetMs = 9 * 60 * 60 * 1000;

export function kstParts(iso: string) {
  const shifted = new Date(Date.parse(iso) + kstOffsetMs);
  return { month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** KST 달력 날짜의 순번. 시각 차이가 아니라 자정을 지난 횟수를 비교한다. */
export function kstCalendarDay(iso: string): number {
  return Math.floor((Date.parse(iso) + kstOffsetMs) / (24 * 60 * 60 * 1000));
}

/** "~10월 29일까지" in Asia/Seoul (no DST, so a fixed +9h offset is exact). */
export function couponExpiryLabel(expiresAt: string): string {
  const { month, day } = kstParts(expiresAt);
  return `~${month}월 ${day}일까지`;
}

export function couponStatusLabel(status: CouponStatus): string {
  if (status === 'REDEEMED') return '사용 완료';
  if (status === 'EXPIRED') return '만료';
  if (status === 'VOIDED') return '사용할 수 없는 쿠폰';
  return '사용 가능';
}

export function couponAccessibilityLabel(coupon: Coupon): string {
  const base = `쿠폰 ${coupon.title}, ${coupon.merchantName}, ${couponStatusLabel(coupon.status)}`;
  // 무효 쿠폰에는 "~까지"가 오해를 부르므로 만료 날짜를 읽어 주지 않는다.
  return coupon.status === 'VOIDED' ? base : `${base}, ${couponExpiryLabel(coupon.expiresAt).replace('~', '')}`;
}

export function couponsOf(book: Pick<BadgeBook, 'rewards'> | undefined): readonly Coupon[] {
  return book?.rewards.flatMap((reward) => (reward.coupon ? [reward.coupon] : [])) ?? [];
}

export function findCoupon(book: Pick<BadgeBook, 'rewards'> | undefined, couponId: string): Coupon | undefined {
  return couponsOf(book).find((coupon) => coupon.couponId === couponId);
}

/**
 * 쿠폰 사용 시트가 열려 있는 동안 3초마다 받은 도감으로 쿠폰이 바뀌었는지 본다. 바뀐 쿠폰을 돌려주고, 아직 쓸 수 있으면 undefined다.
 * 방문 취소로 조건이 깨져 무효가 된 쿠폰은 도감에서 사라지므로 목록에 없으면 사용할 수 없는 쿠폰(VOIDED)이다.
 */
export function couponAfterPoll(current: Coupon, book: Pick<BadgeBook, 'rewards'>): Coupon | undefined {
  const next = findCoupon(book, current.couponId);
  if (!next) return { ...current, status: 'VOIDED' };
  return next.status === 'ISSUED' ? undefined : next;
}

/** "1분 42초 남음" · "8초 남음" · "만료됐어요" */
export function remainingLabel(expiresAt: string, now: number): string {
  const seconds = Math.ceil((Date.parse(expiresAt) - now) / 1000);
  if (seconds <= 0) return '만료됐어요';
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}분 ${seconds % 60}초 남음` : `${seconds}초 남음`;
}

export function openRewardErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'REWARD_LOCKED': return '아직 배지가 조금 모자라요. 도감을 새로 고쳐 확인해 볼게요.';
    case 'REWARD_OFFER_UNAVAILABLE': return '참여 가게 혜택이 잠시 준비 중이에요. 상자는 그대로 남아 있어요.';
    case 'REWARD_CAPACITY_EXHAUSTED': return '이번 혜택이 모두 소진됐어요. 새 혜택이 오면 다시 열 수 있어요.';
    case 'INVALID_REQUEST': return '상자 정보를 확인하지 못했어요. 도감을 새로 고쳐 주세요.';
    case 'INVALID_RESPONSE': return '상자 결과를 확인하지 못했어요. 새로 고치면 받은 쿠폰이 보여요.';
    case undefined: return '연결이 불안정해요. 상자는 그대로니 잠시 뒤 다시 열어 주세요.';
    default: return '상자를 열지 못했어요. 잠시 뒤 다시 시도해 주세요.';
  }
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Closest next tier across all medals, e.g. "단골손님 브론즈까지 1번 더"; null when every medal is gold. */
export function closestNextGoal(book: Pick<BadgeBook, 'medals'> | undefined): string | null {
  if (!book) return null;
  const candidates = book.medals
    .map((medal) => ({ medal, progress: nextTierProgress(medal) }))
    .filter((item) => item.progress.nextTier !== null)
    .sort((a, b) => (a.progress.remaining ?? 0) - (b.progress.remaining ?? 0));
  const first = candidates[0];
  if (!first) return null;
  const copy = medalCopies[first.medal.kind];
  return `${copy.name} ${tierName(first.progress.nextTier!)}까지 ${first.progress.remaining}${copy.unit} 더`;
}

/** First box that can be opened now, for the passport call to action. */
export function firstReadyReward(book: Pick<BadgeBook, 'rewards'> | undefined): Reward | undefined {
  return book?.rewards.find((reward) => reward.state === 'READY');
}

/**
 * The one box worth showing on the home screen's compact reward teaser (#296): a box ready to open, else the next
 * locked box worth working toward, else (every box opened or unavailable) the last one, so the card always has
 * something to say while any reward exists.
 */
export function homeFeaturedReward(book: Pick<BadgeBook, 'earnedTiers' | 'rewards'> | undefined): Reward | undefined {
  if (!book) return undefined;
  return firstReadyReward(book)
    ?? book.rewards.find((reward) => reward.requiredTiers > book.earnedTiers)
    ?? book.rewards[book.rewards.length - 1];
}

/** Three-up rows (medals, boxes) fall back to one column when the text would not fit. */
export function shouldStackTrio(width: number, fontScale: number): boolean {
  return width / Math.max(fontScale, 1) < 340 || fontScale >= 1.5;
}

/** Celebration stamp stage: min(0.52·width, 0.3·height), capped at 220dp, so buttons stay in view. */
export function celebrationStageSize(width: number, height: number): number {
  return Math.round(Math.min(width * 0.52, height * 0.3, 220));
}

/** Coupon-use QR: min(width − 96, 0.34·height), capped at 240dp and never below 160dp. */
export function couponQrSize(width: number, height: number): number {
  return Math.round(Math.max(160, Math.min(width - 96, height * 0.34, 240)));
}
