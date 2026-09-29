import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  BadgeRewardError,
  type BadgeCoupon,
  type BadgeReward,
  type BadgeRewardService,
  type BadgeSnapshot,
  type OpenedBadgeReward,
  type RedeemedBadgeCoupon,
  type StaffCouponLookup,
} from '../badge-rewards.js';
import {
  buildMedals,
  couponExpiry,
  customerCouponView,
  earnedTiers,
  isReissuableVoid,
  offerHasCapacity,
  rewardMilestones,
  rewardState,
  type CouponStatus,
  type CouponStoredStatus,
  type MedalValues,
  type RewardMilestone,
} from '../badge-rules.js';
import { CustomerIdentityError } from '../customer-identity.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { isCustomerIdentityToken, resolveBoundCustomerIdentity } from './customer-identity.js';

type OfferRow = {
  id: string;
  milestone: number;
  merchant_id: string;
  merchant_name: string;
  title: string;
  detail: string;
  valid_days: number;
  issuance_cap: number | null;
  issued_count: number;
};

type CouponRow = {
  id: string;
  customer_account_id: string;
  milestone: number;
  merchant_id: string;
  merchant_name: string;
  title: string;
  detail: string;
  status: CouponStoredStatus;
  issued_at: Date;
  expires_at: Date;
  redeemed_at: Date | null;
  void_reason: string | null;
  merchant_is_demo: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 본인 방문만 입력으로 쓴다. progress_counted는 (계정, 점포, 한국 날짜)당 최대 1건이다.
// 실제 점포(is_demo = false)에서 본인이 직접 발급한 수령 슬롯의 방문은 세지 않는다. 시연 점포는
// 한 사람이 점원과 고객을 함께 시연하므로 그대로 센다.
// 친구 화면(friends.ts)이 같은 규칙으로 친구의 메달·도장을 계산하도록 이 두 조각을 함께 쓴다.
export const countedVisitFromSql = `
    FROM visit_events AS visit
    JOIN merchants AS merchant ON merchant.id = visit.merchant_id
    JOIN claim_slots AS slot ON slot.id = visit.claim_slot_id`;
export const countedVisitFilterSql = `visit.status = 'VALID' AND visit.progress_counted
      AND (merchant.is_demo OR slot.created_by_account_id <> visit.customer_account_id)`;

export const medalValuesSql = `
  WITH counted AS (
    SELECT visit.merchant_id, visit.business_date
    ${countedVisitFromSql}
    WHERE visit.customer_account_id = $1 AND ${countedVisitFilterSql}
  )
  SELECT
    (SELECT count(DISTINCT merchant_id) FROM counted)::integer AS explorer,
    (SELECT coalesce(max(visits), 0) FROM (
       SELECT count(*) AS visits FROM counted GROUP BY merchant_id
     ) AS per_merchant)::integer AS regular,
    (SELECT count(DISTINCT business_date) FROM counted)::integer AS steady`;

const couponSelectSql = `
  SELECT coupon.id, coupon.customer_account_id, coupon.milestone, coupon.merchant_id,
         merchant.name AS merchant_name, coupon.title, coupon.detail, coupon.status,
         coupon.issued_at, coupon.expires_at, coupon.redeemed_at, coupon.void_reason,
         merchant.is_demo AS merchant_is_demo
  FROM badge_coupons AS coupon
  JOIN merchants AS merchant ON merchant.id = coupon.merchant_id`;

export class PostgresBadgeRewardService implements BadgeRewardService {
  private readonly now: () => Date;
  private readonly nextCouponId: () => string;
  private readonly accountLifecycle: PostgresAccountLifecycle;

  constructor(private readonly pool: Pool, options: {
    now?: () => Date;
    nextCouponId?: () => string;
    accountLifecycle: PostgresAccountLifecycle;
  }) {
    this.now = options.now ?? (() => new Date());
    this.nextCouponId = options.nextCouponId ?? randomUUID;
    this.accountLifecycle = options.accountLifecycle;
  }

  async getBadges(accountId: string): Promise<BadgeSnapshot> {
    const now = this.now();
    const [medalRow, offers, coupons] = await Promise.all([
      this.pool.query<MedalValues>(medalValuesSql, [accountId]),
      this.pool.query<OfferRow>(
        `SELECT offer.id, offer.milestone, offer.merchant_id, merchant.name AS merchant_name,
                offer.title, offer.detail, offer.valid_days, offer.issuance_cap, offer.issued_count
         FROM badge_reward_offers AS offer
         JOIN merchants AS merchant ON merchant.id = offer.merchant_id
         WHERE offer.status = 'ACTIVE' AND merchant.status = 'ACTIVE'`,
      ),
      this.pool.query<CouponRow>(
        `${couponSelectSql} WHERE coupon.customer_account_id = $1`,
        [accountId],
      ),
    ]);
    const medals = buildMedals(medalRow.rows[0]!);
    const earned = earnedTiers(medals);
    const rewards: BadgeReward[] = rewardMilestones.map(({ milestone, requiredTiers }) => {
      const offerRow = offers.rows.find((row) => row.milestone === milestone);
      const couponRow = coupons.rows.find((row) => row.milestone === milestone);
      // 방문 취소로 조건이 깨져 무효가 된 쿠폰은 숨기고 상자를 다시 잠김·열기 가능 상태로 돌려 보낸다(조건을 다시 채우면 되살린다).
      // 관리자가 무효로 한 상자는 쿠폰을 보내지 않고 열 수 없음(UNAVAILABLE)으로 보낸다. 기존 앱의 파서가 이 짝을 받아들인다.
      const view = couponRow ? customerCouponView(toFacts(couponRow), now) : undefined;
      if (view?.visibility === 'UNAVAILABLE') {
        return { milestone, requiredTiers, state: 'UNAVAILABLE' as const, offer: null, coupon: null };
      }
      const shown = couponRow && view?.visibility === 'SHOWN' ? mapCoupon(couponRow, view.status) : null;
      const offer = offerRow ? {
        issuanceCap: offerRow.issuance_cap, issuedCount: offerRow.issued_count,
      } : null;
      return {
        milestone,
        requiredTiers,
        state: rewardState({
          requiredTiers, earnedTiers: earned, offer, hasCoupon: Boolean(shown),
        }),
        // 이미 연 상자는 발급 시점 사본인 쿠폰으로만 표시한다.
        offer: offerRow && !shown ? {
          merchantId: offerRow.merchant_id,
          merchantName: offerRow.merchant_name,
          title: offerRow.title,
          detail: offerRow.detail,
          validDays: offerRow.valid_days,
        } : null,
        coupon: shown,
      };
    });
    return { medals, earnedTiers: earned, rewards };
  }

  async openReward(input: { accountId: string; milestone: RewardMilestone }): Promise<OpenedBadgeReward> {
    const requiredTiers = rewardMilestones.find(({ milestone }) => milestone === input.milestone)?.requiredTiers;
    if (requiredTiers === undefined) throw new RangeError('reward milestone must be 1, 2 or 3');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.assertActive(client, input.accountId);
      // 같은 계정의 동시 열기는 여기서 직렬화되어 쿠폰이 한 장만 만들어진다. assertActive의 계정 잠금과
      // 겹치지만 상자별 직렬화를 명시하려고 설계(§5)대로 별도 잠금을 유지한다.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `badge-reward:${input.accountId}`,
      ]);
      // 잠금 없이 읽는 첫 조회는 어느 갈래(재생·거절·발급·되살리기)인지만 정한다. 되살리기 갈래는 아래에서
      // 점포 → 혜택 잠금을 잡은 뒤 쿠폰 행을 FOR UPDATE로 다시 읽어 확인한다(점포 → 혜택 → 쿠폰 순서).
      const existing = await client.query<CouponRow>(
        `${couponSelectSql} WHERE coupon.customer_account_id = $1 AND coupon.milestone = $2`,
        [input.accountId, input.milestone],
      );
      const previous = existing.rows[0];
      // 잠금을 잡은 뒤 시각을 한 번만 잰다: 되살릴지 판정한 시각과 새 만료 계산이 같은 시각을 쓴다.
      const openedAt = this.now();
      if (previous) {
        const view = customerCouponView(toFacts(previous), openedAt);
        // 관리자가 무효로 한 상자는 다시 열지 않는다. VOIDED 쿠폰을 그대로 보내지 않고 기존 앱이 아는 오류로 거절한다.
        if (view.visibility === 'UNAVAILABLE') throw new BadgeRewardError('REWARD_OFFER_UNAVAILABLE');
        if (view.visibility === 'SHOWN') {
          await client.query('COMMIT');
          return { coupon: mapCoupon(previous, view.status), replayed: true };
        }
      }
      const medalRow = await client.query<MedalValues>(medalValuesSql, [input.accountId]);
      if (earnedTiers(buildMedals(medalRow.rows[0]!)) < requiredTiers) {
        throw new BadgeRewardError('REWARD_LOCKED');
      }
      // 잠금 순서는 점포 → 혜택으로 고정한다. 관리자 숨김이 점포 행을 먼저 잠근 뒤 혜택을 갱신하므로,
      // 반대로 잠그면 교착이 생긴다. 숨긴(비활성) 점포의 혜택은 발급하지 않는다.
      await client.query(
        `SELECT 1 FROM merchants AS merchant
         WHERE merchant.status = 'ACTIVE' AND merchant.id = (
           SELECT offer.merchant_id FROM badge_reward_offers AS offer
           WHERE offer.milestone = $1 AND offer.status = 'ACTIVE'
         )
         FOR SHARE OF merchant`,
        [input.milestone],
      );
      const offerResult = await client.query<OfferRow>(
        `SELECT offer.id, offer.milestone, offer.merchant_id, merchant.name AS merchant_name,
                offer.title, offer.detail, offer.valid_days, offer.issuance_cap, offer.issued_count
         FROM badge_reward_offers AS offer
         JOIN merchants AS merchant ON merchant.id = offer.merchant_id
         WHERE offer.milestone = $1 AND offer.status = 'ACTIVE' AND merchant.status = 'ACTIVE'
         FOR UPDATE OF offer`,
        [input.milestone],
      );
      const offer = offerResult.rows[0];
      if (!offer) throw new BadgeRewardError('REWARD_OFFER_UNAVAILABLE');
      // 혜택 잠금을 기다리는 사이 관리자가 이 쿠폰을 끝 상태로 무효로 했거나 만료됐을 수 있다. 쿠폰 행을 잠근 채 다시 읽어
      // 방문 취소로 무효인 채(VISIT_CANCELED)이고 만료 전일 때만 되살린다. 그 밖에는 관리자 무효를 되돌리지 않고 거절한다.
      let originalExpiry: Date | undefined;
      if (previous) {
        const locked = (await client.query<{ status: CouponStoredStatus; void_reason: string | null; expires_at: Date }>(
          'SELECT status, void_reason, expires_at FROM badge_coupons WHERE id = $1 FOR UPDATE',
          [previous.id],
        )).rows[0];
        if (!locked || !isReissuableVoid({ status: locked.status, voidReason: locked.void_reason })
          || locked.expires_at.getTime() <= openedAt.getTime()) {
          throw new BadgeRewardError('REWARD_OFFER_UNAVAILABLE');
        }
        originalExpiry = locked.expires_at;
      }
      if (!offerHasCapacity({ issuanceCap: offer.issuance_cap, issuedCount: offer.issued_count })) {
        throw new BadgeRewardError('REWARD_CAPACITY_EXHAUSTED');
      }
      const issuedAt = openedAt;
      const couponId = previous ? previous.id : this.nextCouponId();
      if (previous && originalExpiry) {
        // 방문 취소로 무효가 됐던 쿠폰을 새 혜택 사본으로 되살린다. 같은 (계정, 상자) 행을 다시 쓰고 감사 기록을 남긴다.
        // 만료는 원래 만료를 넘기지 않는다: 새 유효 기간과 원래 만료 중 이른 쪽이다(무효·되살리기로 만료를 늘릴 수 없다).
        // 원래 만료가 지난 쿠폰은 위 view가 되살리지 않고 만료된 쿠폰으로 돌려준다.
        const newExpiry = couponExpiry(issuedAt, offer.valid_days);
        // 방문 취소로 무효인 미만료 쿠폰만 되살린다(위에서 잠근 행). 한 줄도 바뀌지 않으면 되살리지 않고 거절한다.
        const revived = await client.query(
          `UPDATE badge_coupons
           SET offer_id = $2, merchant_id = $3, title = $4, detail = $5, status = 'ISSUED',
               issued_at = $6, expires_at = $7, redeemed_at = NULL, redeemed_by_account_id = NULL,
               void_reason = NULL, void_note = NULL, voided_at = NULL, voided_by_account_id = NULL,
               void_visit_event_id = NULL
           WHERE id = $1 AND status = 'VOIDED' AND void_reason = 'VISIT_CANCELED' AND expires_at > $6`,
          [couponId, offer.id, offer.merchant_id, offer.title, offer.detail, issuedAt,
            newExpiry.getTime() < originalExpiry.getTime() ? newExpiry : originalExpiry],
        );
        if (revived.rowCount !== 1) throw new BadgeRewardError('REWARD_OFFER_UNAVAILABLE');
        await client.query(
          `INSERT INTO badge_coupon_audit (id, coupon_id, merchant_id, action, created_at)
           VALUES ($1, $2, $3, 'REISSUED_AFTER_RECOUNT', $4)`,
          [randomUUID(), couponId, offer.merchant_id, issuedAt],
        );
      } else {
        await client.query(
          `INSERT INTO badge_coupons (
             id, customer_account_id, milestone, offer_id, merchant_id, title, detail,
             status, issued_at, expires_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ISSUED', $8, $9)`,
          [couponId, input.accountId, input.milestone, offer.id, offer.merchant_id,
            offer.title, offer.detail, issuedAt, couponExpiry(issuedAt, offer.valid_days)],
        );
      }
      await client.query(
        'UPDATE badge_reward_offers SET issued_count = issued_count + 1 WHERE id = $1',
        [offer.id],
      );
      const created = await client.query<CouponRow>(`${couponSelectSql} WHERE coupon.id = $1`, [couponId]);
      await client.query('COMMIT');
      return { coupon: mapCoupon(created.rows[0]!, customerStatus(created.rows[0]!, issuedAt)), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new BadgeRewardError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }

  async lookupCoupons(input: {
    token: string;
    merchantId: string;
    staffAccountId: string;
  }): Promise<StaffCouponLookup> {
    if (!isCustomerIdentityToken(input.token)) throw new CustomerIdentityError('CUSTOMER_IDENTITY_UNAVAILABLE');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = this.now();
      const identity = await this.resolveIdentity(client, input, now);
      const coupons = await client.query<{ id: string; title: string; detail: string; expires_at: Date }>(
        `SELECT id, title, detail, expires_at FROM badge_coupons
         WHERE customer_account_id = $1 AND merchant_id = $2
           AND status = 'ISSUED' AND expires_at > $3
         ORDER BY expires_at, id`,
        [identity.customerAccountId, input.merchantId, now],
      );
      await client.query('COMMIT');
      return {
        identityExpiresAt: identity.expiresAt.toISOString(),
        coupons: coupons.rows.map((row) => ({
          couponId: row.id, title: row.title, detail: row.detail,
          expiresAt: row.expires_at.toISOString(),
        })),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new BadgeRewardError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }

  async redeemCoupon(input: {
    token: string;
    merchantId: string;
    staffAccountId: string;
    couponId: string;
  }): Promise<RedeemedBadgeCoupon> {
    if (!isCustomerIdentityToken(input.token)) throw new CustomerIdentityError('CUSTOMER_IDENTITY_UNAVAILABLE');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = this.now();
      const identity = await this.resolveIdentity(client, input, now);
      if (!uuidPattern.test(input.couponId)) throw new BadgeRewardError('COUPON_NOT_FOUND');
      // 다른 고객·다른 점포·없는 쿠폰은 조건에 맞는 행이 없어 구분 없이 같은 404가 된다.
      const found = await client.query<CouponRow>(
        `${couponSelectSql}
         WHERE coupon.id = $1 AND coupon.customer_account_id = $2 AND coupon.merchant_id = $3
         FOR UPDATE OF coupon`,
        [input.couponId, identity.customerAccountId, input.merchantId],
      );
      const coupon = found.rows[0];
      if (!coupon) throw new BadgeRewardError('COUPON_NOT_FOUND');
      // 실제 점포에서는 본인 쿠폰을 본인 점원 계정으로 사용 처리할 수 없다(조회는 목록을 그대로 돌려준다).
      if (coupon.customer_account_id === input.staffAccountId && !coupon.merchant_is_demo) {
        throw new BadgeRewardError('COUPON_SELF_REDEEM');
      }
      if (coupon.status === 'VOIDED') throw new BadgeRewardError('COUPON_VOIDED');
      if (coupon.status === 'REDEEMED') {
        await client.query('COMMIT');
        return { couponId: coupon.id, status: 'REDEEMED', redeemedAt: coupon.redeemed_at!.toISOString(), replayed: true };
      }
      if (coupon.expires_at.getTime() <= now.getTime()) throw new BadgeRewardError('COUPON_EXPIRED');
      const updated = await client.query(
        `UPDATE badge_coupons
         SET status = 'REDEEMED', redeemed_at = $2, redeemed_by_account_id = $3
         WHERE id = $1 AND status = 'ISSUED' AND expires_at > $2`,
        [coupon.id, now, input.staffAccountId],
      );
      if (updated.rowCount !== 1) throw new BadgeRewardError('COUPON_NOT_FOUND');
      await client.query('COMMIT');
      return { couponId: coupon.id, status: 'REDEEMED', redeemedAt: now.toISOString(), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new BadgeRewardError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }

  private resolveIdentity(
    client: PoolClient,
    input: { token: string; merchantId: string; staffAccountId: string },
    now: Date,
  ) {
    return resolveBoundCustomerIdentity(client, {
      ...input, now, accountLifecycle: this.accountLifecycle,
    });
  }
}

function toFacts(row: CouponRow) {
  return { status: row.status, voidReason: row.void_reason, expiresAt: row.expires_at };
}

// 발급·되살린 직후의 쿠폰은 ISSUED다(만료가 이미 지났을 수는 없다).
function customerStatus(row: CouponRow, now: Date): CouponStatus {
  const view = customerCouponView(toFacts(row), now);
  if (view.visibility !== 'SHOWN') throw new Error('a freshly issued coupon must be shown');
  return view.status;
}

function mapCoupon(row: CouponRow, status: CouponStatus): BadgeCoupon {
  return {
    couponId: row.id,
    milestone: row.milestone as RewardMilestone,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    title: row.title,
    detail: row.detail,
    status,
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    redeemedAt: row.redeemed_at ? row.redeemed_at.toISOString() : null,
  };
}
