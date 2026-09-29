import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';

// Issue #216 탐험 여권 계약(docs/superpowers/specs/2026-09-29-explorer-passport-design.md §4).
// 서버 계산이 정본이며, 앱은 형식이 어긋난 응답을 표시하지 않고 거절한다.

export const medalKinds = ['explorer', 'regular', 'steady'] as const;
export type MedalKind = (typeof medalKinds)[number];
export type MedalTier = 0 | 1 | 2 | 3;
export type RewardMilestone = 1 | 2 | 3;
export type RewardState = 'LOCKED' | 'READY' | 'UNAVAILABLE' | 'OPENED';
export type CouponStatus = 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'VOIDED';

export type Medal = {
  kind: MedalKind;
  value: number;
  tier: MedalTier;
  thresholds: readonly [number, number, number];
};

export type RewardOffer = {
  merchantId: string;
  merchantName: string;
  title: string;
  detail: string;
  validDays: number;
};

export type Coupon = {
  couponId: string;
  milestone: RewardMilestone;
  merchantId: string;
  merchantName: string;
  title: string;
  detail: string;
  status: CouponStatus;
  issuedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
};

export type Reward = {
  milestone: RewardMilestone;
  requiredTiers: number;
  state: RewardState;
  offer: RewardOffer | null;
  coupon: Coupon | null;
};

export type BadgeBook = {
  /** Always explorer, regular, steady in this order. */
  medals: readonly Medal[];
  earnedTiers: number;
  /** Always milestone 1, 2, 3 in this order. */
  rewards: readonly Reward[];
};

export type OpenedReward = { coupon: Coupon; replayed: boolean };

export class BadgeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'BadgeApiError';
  }
}

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

export type BadgeApiClient = ReturnType<typeof createBadgeApiClient>;

export function createBadgeApiClient(options: Options) {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) {
      headers.set(name, value);
    }
    const response = await fetcher(`${apiUrl}${path}`, { ...init, headers });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string'
        ? payload.code
        : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) {
        await options.onSessionInvalid?.();
      }
      throw new BadgeApiError(response.status, code);
    }
    return payload;
  }

  return {
    async getBadgeBook(): Promise<BadgeBook> {
      return parseBadgeBook(await request('/me/badges'));
    },

    async openReward(milestone: RewardMilestone): Promise<OpenedReward> {
      if (!isMilestone(milestone)) throw new BadgeApiError(400, 'INVALID_REQUEST');
      const payload = await request(`/me/badges/rewards/${milestone}/open`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      return parseOpenedReward(payload, milestone);
    },
  };
}

export function parseBadgeBook(value: unknown): BadgeBook {
  if (!isRecord(value) || !Array.isArray(value.medals) || !Array.isArray(value.rewards)) {
    throw invalidResponse('배지');
  }
  const medals = value.medals.map(parseMedal);
  if (medals.length !== medalKinds.length) throw invalidResponse('배지');
  const orderedMedals = medalKinds.map((kind) => {
    const matches = medals.filter((medal) => medal.kind === kind);
    if (matches.length !== 1) throw invalidResponse('배지');
    return matches[0]!;
  });
  const earnedTiers = orderedMedals.reduce((sum, medal) => sum + medal.tier, 0);
  if (value.earnedTiers !== earnedTiers) throw invalidResponse('배지');

  const rewards = value.rewards.map(parseReward);
  if (rewards.length !== 3) throw invalidResponse('보상 상자');
  const orderedRewards = ([1, 2, 3] as const).map((milestone) => {
    const matches = rewards.filter((reward) => reward.milestone === milestone);
    if (matches.length !== 1) throw invalidResponse('보상 상자');
    return matches[0]!;
  });
  for (let index = 1; index < orderedRewards.length; index += 1) {
    if (orderedRewards[index]!.requiredTiers <= orderedRewards[index - 1]!.requiredTiers) {
      throw invalidResponse('보상 상자');
    }
  }
  return { medals: orderedMedals, earnedTiers, rewards: orderedRewards };
}

export function parseOpenedReward(value: unknown, milestone: RewardMilestone): OpenedReward {
  if (!isRecord(value) || typeof value.replayed !== 'boolean') throw invalidResponse('상자 열기');
  const coupon = parseCoupon(value.coupon);
  if (coupon.milestone !== milestone) throw invalidResponse('상자 열기');
  return { coupon, replayed: value.replayed };
}

function parseMedal(value: unknown): Medal {
  if (
    !isRecord(value) ||
    !isMedalKind(value.kind) ||
    !isNonNegativeInteger(value.value) ||
    !isTier(value.tier) ||
    !isThresholds(value.thresholds)
  ) {
    throw invalidResponse('배지');
  }
  const thresholds = value.thresholds;
  const expectedTier = thresholds.filter((threshold) => value.value as number >= threshold).length;
  if (expectedTier !== value.tier) throw invalidResponse('배지');
  return { kind: value.kind, value: value.value, tier: value.tier, thresholds: [thresholds[0], thresholds[1], thresholds[2]] };
}

function parseReward(value: unknown): Reward {
  if (
    !isRecord(value) ||
    !isMilestone(value.milestone) ||
    !isPositiveInteger(value.requiredTiers) ||
    value.requiredTiers > 9 ||
    !isRewardState(value.state) ||
    !('offer' in value) ||
    !('coupon' in value)
  ) {
    throw invalidResponse('보상 상자');
  }
  const offer = value.offer === null ? null : parseOffer(value.offer);
  const coupon = value.coupon === null ? null : parseCoupon(value.coupon);
  // OPENED ⇔ coupon exists; a coupon from another box is a server bug, not something to display.
  if ((value.state === 'OPENED') !== (coupon !== null)) throw invalidResponse('보상 상자');
  if (coupon && coupon.milestone !== value.milestone) throw invalidResponse('보상 상자');
  return { milestone: value.milestone, requiredTiers: value.requiredTiers, state: value.state, offer, coupon };
}

function parseOffer(value: unknown): RewardOffer {
  if (
    !isRecord(value) ||
    !isString(value.merchantId) ||
    !isString(value.merchantName) ||
    !isString(value.title) ||
    typeof value.detail !== 'string' ||
    !isPositiveInteger(value.validDays) ||
    value.validDays > 365
  ) {
    throw invalidResponse('보상 혜택');
  }
  return {
    merchantId: value.merchantId,
    merchantName: value.merchantName,
    title: value.title,
    detail: value.detail,
    validDays: value.validDays,
  };
}

function parseCoupon(value: unknown): Coupon {
  if (
    !isRecord(value) ||
    !isString(value.couponId) ||
    !isMilestone(value.milestone) ||
    !isString(value.merchantId) ||
    !isString(value.merchantName) ||
    !isString(value.title) ||
    typeof value.detail !== 'string' ||
    !isCouponStatus(value.status) ||
    !isDate(value.issuedAt) ||
    !isDate(value.expiresAt) ||
    (value.redeemedAt !== null && !isDate(value.redeemedAt))
  ) {
    throw invalidResponse('쿠폰');
  }
  if ((value.status === 'REDEEMED') !== (value.redeemedAt !== null)) throw invalidResponse('쿠폰');
  return {
    couponId: value.couponId,
    milestone: value.milestone,
    merchantId: value.merchantId,
    merchantName: value.merchantName,
    title: value.title,
    detail: value.detail,
    status: value.status,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    redeemedAt: value.redeemedAt,
  };
}

function isMedalKind(value: unknown): value is MedalKind {
  return value === 'explorer' || value === 'regular' || value === 'steady';
}

function isTier(value: unknown): value is MedalTier {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

function isThresholds(value: unknown): value is [number, number, number] {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every(isPositiveInteger) &&
    value[0] < value[1] &&
    value[1] < value[2];
}

function isMilestone(value: unknown): value is RewardMilestone {
  return value === 1 || value === 2 || value === 3;
}

function isRewardState(value: unknown): value is RewardState {
  return value === 'LOCKED' || value === 'READY' || value === 'UNAVAILABLE' || value === 'OPENED';
}

function isCouponStatus(value: unknown): value is CouponStatus {
  return value === 'ISSUED' || value === 'REDEEMED' || value === 'EXPIRED' || value === 'VOIDED';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDate(value: unknown): value is string {
  return isString(value) && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function invalidResponse(label: string): BadgeApiError {
  return new BadgeApiError(200, 'INVALID_RESPONSE', `${label} 응답 형식이 올바르지 않습니다.`);
}
