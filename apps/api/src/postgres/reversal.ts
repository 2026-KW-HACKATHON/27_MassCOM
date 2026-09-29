import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { buildMedals, earnedTiers, type MedalValues } from '../badge-rules.js';
import { MerchantAccessError } from '../merchant-access.js';
import {
  ReversalError,
  type CancelVisitResult,
  type RecentCouponRedemption,
  type RecentVisits,
  type ReversalService,
  type UndoneCouponRedemption,
} from '../reversal.js';
import {
  canCancelVisitOn,
  classifyMintJob,
  couponUndoDeadline,
  isVisitCancelReason,
  isWithinCouponUndoWindow,
  kstBusinessDate,
  maskedCustomerLabel,
  milestonesToVoid,
  normalizeReversalNote,
  recentCouponRedemptionLimit,
  recentCouponRedemptionWindowMs,
  recentVisitLimit,
  selectEntitlementsToRevoke,
} from '../reversal-rules.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { medalValuesSql } from './badge-rewards.js';
import { grantReachedGoals } from './visit-rewards.js';

type Options = {
  now?: () => Date;
  nextAuditId?: () => string;
  nextEntitlementId?: () => string;
  rewardClaimTtlMs?: number;
  // 점원 화면의 고객 가림 표시를 만드는 HMAC 비밀(32바이트 이상).
  labelHmacSecret: string;
  accountLifecycle: PostgresAccountLifecycle;
};

type VisitRow = {
  id: string;
  customer_account_id: string;
  campaign_id: string;
  business_date: string;
  status: 'VALID' | 'CANCELED';
  progress_counted: boolean;
  cancellation_reason: string | null;
  cancellation_note: string | null;
  canceled_at: Date | null;
  updated_at: Date;
};

type EntitlementRow = {
  id: string;
  target_visit_count: number;
  source_visit_event_id: string;
  status: 'GRANTED' | 'MINT_REQUESTED' | 'FULFILLED';
};

type MintJobRow = {
  id: string;
  entitlement_id: string;
  status: string;
  transaction_hash: string | null;
  last_error_code: string | null;
  leased: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lockNotAvailable = '55P03';

export class PostgresReversalService implements ReversalService {
  private readonly now: () => Date;
  private readonly nextAuditId: () => string;
  private readonly nextEntitlementId: () => string;
  private readonly rewardClaimTtlMs: number;
  private readonly labelHmacSecret: string;
  private readonly accountLifecycle: PostgresAccountLifecycle;

  constructor(private readonly pool: Pool, options: Options) {
    if (Buffer.byteLength(options.labelHmacSecret, 'utf8') < 32) {
      throw new Error('reversal labelHmacSecret must be at least 32 bytes');
    }
    this.now = options.now ?? (() => new Date());
    this.nextAuditId = options.nextAuditId ?? randomUUID;
    this.nextEntitlementId = options.nextEntitlementId ?? randomUUID;
    this.rewardClaimTtlMs = options.rewardClaimTtlMs ?? 90 * 24 * 60 * 60 * 1000;
    this.labelHmacSecret = options.labelHmacSecret;
    this.accountLifecycle = options.accountLifecycle;
  }

  async listRecentVisits(input: { merchantId: string; staffAccountId: string }): Promise<RecentVisits> {
    await this.requireMemberOnce(input.merchantId, input.staffAccountId);
    const businessDate = kstBusinessDate(this.now());
    const result = await this.pool.query<{
      id: string;
      occurred_at: Date;
      customer_account_id: string;
      status: 'VALID' | 'CANCELED';
      progress_counted: boolean;
      cancellation_reason: string | null;
    }>(
      `SELECT id, occurred_at, customer_account_id, status, progress_counted, cancellation_reason
       FROM visit_events
       WHERE merchant_id = $1 AND business_date = $2::date
       ORDER BY occurred_at DESC, id
       LIMIT $3`,
      [input.merchantId, businessDate, recentVisitLimit],
    );
    return {
      businessDate,
      visits: result.rows.map((row) => ({
        visitEventId: row.id,
        occurredAt: row.occurred_at.toISOString(),
        customerLabel: maskedCustomerLabel(this.labelHmacSecret, input.merchantId, row.customer_account_id),
        status: row.status,
        progressCounted: row.progress_counted,
        cancellationReason: row.cancellation_reason,
        canCancel: row.status === 'VALID',
      })),
    };
  }

  async cancelVisit(input: {
    merchantId: string;
    staffAccountId: string;
    visitEventId: string;
    reason: unknown;
    note?: unknown;
  }): Promise<CancelVisitResult> {
    if (!isVisitCancelReason(input.reason)) throw new ReversalError('INVALID_REVERSAL_REASON');
    const reason = input.reason;
    const normalized = normalizeReversalNote(input.note);
    if (!normalized.ok) throw new ReversalError('INVALID_REVERSAL_NOTE');
    const note = normalized.note;
    const now = this.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 잠금 순서: 계정 → 점포 멤버 → [고객, 캠페인] → 배지 상자 → 방문 → 권리 → 발행 작업 → 쿠폰.
      // 앞의 셋은 방문 수령·상자 열기·계정 삭제와 같은 순서라 서로 교착하지 않는다.
      const peek = uuidPattern.test(input.visitEventId)
        ? (
            await client.query<{ customer_account_id: string; campaign_id: string }>(
              'SELECT customer_account_id, campaign_id FROM visit_events WHERE id = $1 AND merchant_id = $2',
              [input.visitEventId, input.merchantId],
            )
          ).rows[0]
        : undefined;
      await this.accountLifecycle.assertAllActive(
        client,
        peek ? [input.staffAccountId, peek.customer_account_id] : [input.staffAccountId],
      );
      await requireActiveMember(client, input.merchantId, input.staffAccountId);
      if (!peek) throw new ReversalError('VISIT_NOT_FOUND');
      await advisoryLock(client, JSON.stringify([peek.customer_account_id, peek.campaign_id]));
      await advisoryLock(client, `badge-reward:${peek.customer_account_id}`);

      const visit = (
        await client.query<VisitRow>(
          `SELECT id, customer_account_id, campaign_id, business_date::text, status, progress_counted,
                  cancellation_reason, cancellation_note, canceled_at, updated_at
           FROM visit_events
           WHERE id = $1 AND merchant_id = $2
           FOR UPDATE`,
          [input.visitEventId, input.merchantId],
        )
      ).rows[0];
      if (!visit) throw new ReversalError('VISIT_NOT_FOUND');
      if (visit.customer_account_id !== peek.customer_account_id) throw new ReversalError('ACCOUNT_DELETED');

      if (visit.status === 'CANCELED') {
        const counts = await client.query<{ revoked: number; voided: number }>(
          `SELECT
             (SELECT count(*)::integer FROM reward_entitlements WHERE revoked_by_visit_event_id = $1) AS revoked,
             (SELECT count(*)::integer FROM badge_coupons WHERE void_visit_event_id = $1) AS voided`,
          [visit.id],
        );
        await client.query('COMMIT');
        return {
          visitEventId: visit.id,
          status: 'CANCELED',
          reason: visit.cancellation_reason ?? reason,
          note: visit.cancellation_note,
          canceledAt: (visit.canceled_at ?? visit.updated_at).toISOString(),
          revokedRewardCount: counts.rows[0]!.revoked,
          voidedCouponCount: counts.rows[0]!.voided,
          replayed: true,
        };
      }
      if (!canCancelVisitOn(visit.business_date, now)) throw new ReversalError('VISIT_CANCEL_WINDOW_CLOSED');

      await client.query(
        `UPDATE visit_events
         SET status = 'CANCELED', cancellation_reason = $2, cancellation_note = $3,
             canceled_at = $4, canceled_by_account_id = $5, updated_at = $4
         WHERE id = $1`,
        [visit.id, reason, note, now, input.staffAccountId],
      );

      // 세어지던 방문이 취소되면 같은 날 가려져 있던 정당한 방문(직원 자기 적립 제외)을 세어 준다.
      let promotedVisitId: string | undefined;
      if (visit.progress_counted) {
        const promoted = await client.query<{ id: string }>(
          `UPDATE visit_events
           SET progress_counted = true, updated_at = $6
           WHERE id = (
             SELECT candidate.id
             FROM visit_events AS candidate
             JOIN claim_slots AS slot ON slot.id = candidate.claim_slot_id
             JOIN merchants AS merchant ON merchant.id = candidate.merchant_id
             WHERE candidate.customer_account_id = $1
               AND candidate.merchant_id = $2
               AND candidate.business_date = $3::date
               AND candidate.campaign_id = $4
               AND candidate.status = 'VALID'
               AND NOT candidate.progress_counted
               AND candidate.id <> $5
               AND (merchant.is_demo OR slot.created_by_account_id <> candidate.customer_account_id)
             ORDER BY candidate.occurred_at, candidate.id
             LIMIT 1
             FOR UPDATE OF candidate
           )
           RETURNING id`,
          [visit.customer_account_id, input.merchantId, visit.business_date, visit.campaign_id, visit.id, now],
        );
        promotedVisitId = promoted.rows[0]?.id;
      }

      const progressAfter = (
        await client.query<{ count: number }>(
          `SELECT count(*)::integer AS count
           FROM visit_events
           WHERE customer_account_id = $1 AND campaign_id = $2 AND status = 'VALID' AND progress_counted`,
          [visit.customer_account_id, visit.campaign_id],
        )
      ).rows[0]!.count;

      const entitlements = await client.query<EntitlementRow>(
        `SELECT id, target_visit_count, source_visit_event_id, status
         FROM reward_entitlements
         WHERE customer_account_id = $1 AND campaign_id = $2 AND status <> 'CANCELED'
         ORDER BY target_visit_count
         FOR UPDATE`,
        [visit.customer_account_id, visit.campaign_id],
      );
      const revoke = selectEntitlementsToRevoke(
        entitlements.rows.map((row) => ({
          id: row.id,
          targetVisitCount: row.target_visit_count,
          sourceVisitEventId: row.source_visit_event_id,
          status: row.status,
        })),
        { visitEventId: visit.id, progressAfter },
      );
      if (revoke.length > 0) await this.revokeEntitlements(client, revoke, visit.id, now);

      if (promotedVisitId) {
        await grantReachedGoals(client, {
          accountId: visit.customer_account_id,
          campaignId: visit.campaign_id,
          progressVisitCount: progressAfter,
          sourceVisitEventId: promotedVisitId,
          now,
          claimExpiresAt: new Date(now.getTime() + this.rewardClaimTtlMs),
          nextEntitlementId: this.nextEntitlementId,
        });
      }

      const voidedCouponCount = await this.voidCouponsWithLostRequirement(client, {
        customerAccountId: visit.customer_account_id,
        staffAccountId: input.staffAccountId,
        visitEventId: visit.id,
        now,
      });

      await client.query('COMMIT');
      return {
        visitEventId: visit.id,
        status: 'CANCELED',
        reason,
        note,
        canceledAt: now.toISOString(),
        revokedRewardCount: revoke.length,
        voidedCouponCount,
        replayed: false,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new ReversalError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }

  async listRecentCouponRedemptions(input: {
    merchantId: string;
    staffAccountId: string;
  }): Promise<{ coupons: RecentCouponRedemption[] }> {
    await this.requireMemberOnce(input.merchantId, input.staffAccountId);
    const now = this.now();
    const result = await this.pool.query<{
      id: string;
      title: string;
      customer_account_id: string;
      redeemed_at: Date;
      redeemed_by_account_id: string;
    }>(
      `SELECT id, title, customer_account_id, redeemed_at, redeemed_by_account_id
       FROM badge_coupons
       WHERE merchant_id = $1 AND status = 'REDEEMED' AND redeemed_at > $2
       ORDER BY redeemed_at DESC, id
       LIMIT $3`,
      [input.merchantId, new Date(now.getTime() - recentCouponRedemptionWindowMs), recentCouponRedemptionLimit],
    );
    return {
      coupons: result.rows.map((row) => ({
        couponId: row.id,
        title: row.title,
        redeemedAt: row.redeemed_at.toISOString(),
        customerLabel: maskedCustomerLabel(this.labelHmacSecret, input.merchantId, row.customer_account_id),
        redeemedByMe: row.redeemed_by_account_id === input.staffAccountId,
        undoUntil: couponUndoDeadline(row.redeemed_at).toISOString(),
        canUndo: isWithinCouponUndoWindow(row.redeemed_at, now),
      })),
    };
  }

  async undoCouponRedemption(input: {
    merchantId: string;
    staffAccountId: string;
    couponId: string;
  }): Promise<UndoneCouponRedemption> {
    const now = this.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.assertActive(client, input.staffAccountId);
      await requireActiveMember(client, input.merchantId, input.staffAccountId);
      if (!uuidPattern.test(input.couponId)) throw new ReversalError('COUPON_NOT_FOUND');
      // 다른 점포·없는 쿠폰은 조건에 맞는 행이 없어 구분 없이 같은 404가 된다.
      const coupon = (
        await client.query<{
          id: string;
          status: 'ISSUED' | 'REDEEMED' | 'VOIDED';
          redeemed_at: Date | null;
          redeemed_by_account_id: string | null;
        }>(
          `SELECT id, status, redeemed_at, redeemed_by_account_id
           FROM badge_coupons
           WHERE id = $1 AND merchant_id = $2
           FOR UPDATE`,
          [input.couponId, input.merchantId],
        )
      ).rows[0];
      if (!coupon) throw new ReversalError('COUPON_NOT_FOUND');

      if (coupon.status === 'REDEEMED') {
        if (!isWithinCouponUndoWindow(coupon.redeemed_at!, now)) throw new ReversalError('COUPON_UNDO_WINDOW_CLOSED');
        await client.query(
          `UPDATE badge_coupons
           SET status = 'ISSUED', redeemed_at = NULL, redeemed_by_account_id = NULL
           WHERE id = $1 AND status = 'REDEEMED'`,
          [coupon.id],
        );
        await client.query(
          `INSERT INTO badge_coupon_audit (
             id, coupon_id, merchant_id, action, actor_account_id,
             previous_redeemed_at, previous_redeemed_by_account_id, created_at
           ) VALUES ($1, $2, $3, 'REDEMPTION_UNDONE', $4, $5, $6, $7)`,
          [this.nextAuditId(), coupon.id, input.merchantId, input.staffAccountId,
            coupon.redeemed_at, coupon.redeemed_by_account_id, now],
        );
        await client.query('COMMIT');
        return { couponId: coupon.id, status: 'ISSUED', replayed: false };
      }
      if (coupon.status === 'ISSUED') {
        const undone = await client.query(
          `SELECT 1 FROM badge_coupon_audit WHERE coupon_id = $1 AND action = 'REDEMPTION_UNDONE' LIMIT 1`,
          [coupon.id],
        );
        if (undone.rowCount) {
          await client.query('COMMIT');
          return { couponId: coupon.id, status: 'ISSUED', replayed: true };
        }
      }
      throw new ReversalError('COUPON_NOT_REDEEMED');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new ReversalError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }

  // 되돌릴 권리 중 하나라도 체인에 보냈거나 보내는 중이면 던져서 취소 전체를 롤백한다.
  private async revokeEntitlements(
    client: PoolClient,
    revoke: readonly { id: string; status: EntitlementRow['status'] }[],
    visitEventId: string,
    now: Date,
  ): Promise<void> {
    if (revoke.some((entitlement) => entitlement.status === 'FULFILLED')) {
      throw new ReversalError('VISIT_REWARD_ALREADY_MINTED');
    }
    const entitlementIds = revoke.map((entitlement) => entitlement.id);
    let jobs: MintJobRow[];
    try {
      // NOWAIT: 워커는 작업→권리 순서로 잠그므로 여기서 기다리면 교착할 수 있다. 잠겨 있으면 전송 중일 수 있어 거절한다.
      jobs = (
        await client.query<MintJobRow>(
          `SELECT job.id, job.entitlement_id, job.status, job.transaction_hash, job.last_error_code,
                  EXISTS (
                    SELECT 1 FROM outbox_events AS outbox
                    WHERE outbox.aggregate_id = job.id
                      AND outbox.status = 'LEASED'
                      AND outbox.lease_expires_at > $2
                  ) AS leased
           FROM mint_jobs AS job
           WHERE job.entitlement_id = ANY($1::uuid[])
           FOR UPDATE OF job NOWAIT`,
          [entitlementIds, now],
        )
      ).rows;
    } catch (error) {
      if (isPostgresCode(error, lockNotAvailable)) throw new ReversalError('VISIT_REWARD_MINT_IN_PROGRESS');
      throw error;
    }
    const cancelable: string[] = [];
    for (const job of jobs) {
      const disposition = classifyMintJob({
        status: job.status,
        transactionHash: job.transaction_hash,
        lastErrorCode: job.last_error_code,
        leased: job.leased,
      });
      if (disposition === 'MINTED') throw new ReversalError('VISIT_REWARD_ALREADY_MINTED');
      if (disposition === 'IN_PROGRESS') throw new ReversalError('VISIT_REWARD_MINT_IN_PROGRESS');
      if (disposition === 'CANCELABLE') cancelable.push(job.id);
    }
    if (cancelable.length > 0) {
      await client.query(
        `UPDATE mint_jobs
         SET status = 'CANCELLED', last_error_code = 'VISIT_CANCELED', updated_at = $1
         WHERE id = ANY($2::uuid[])`,
        [now, cancelable],
      );
      await client.query(
        `UPDATE outbox_events
         SET status = 'PUBLISHED', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
         WHERE aggregate_id = ANY($2::uuid[])`,
        [now, cancelable],
      );
    }
    await client.query(
      `UPDATE reward_entitlements
       SET status = 'CANCELED', canceled_at = $1, revoked_by_visit_event_id = $2, updated_at = $1
       WHERE id = ANY($3::uuid[])`,
      [now, visitEventId, entitlementIds],
    );
  }

  // 다시 센 배지 수로 더는 열 수 없는 상자의 미사용 쿠폰을 무효로 한다. 사용한 쿠폰은 건드리지 않는다.
  private async voidCouponsWithLostRequirement(
    client: PoolClient,
    input: { customerAccountId: string; staffAccountId: string; visitEventId: string; now: Date },
  ): Promise<number> {
    const medalRow = await client.query<MedalValues>(medalValuesSql, [input.customerAccountId]);
    const milestones = milestonesToVoid(earnedTiers(buildMedals(medalRow.rows[0]!)));
    if (milestones.length === 0) return 0;
    const coupons = await client.query<{ id: string; offer_id: string; merchant_id: string }>(
      `SELECT id, offer_id, merchant_id
       FROM badge_coupons
       WHERE customer_account_id = $1 AND status = 'ISSUED' AND milestone = ANY($2::smallint[])
       ORDER BY milestone
       FOR UPDATE`,
      [input.customerAccountId, milestones],
    );
    for (const coupon of coupons.rows) {
      await client.query(
        `UPDATE badge_coupons
         SET status = 'VOIDED', void_reason = 'VISIT_CANCELED', voided_at = $2,
             voided_by_account_id = $3, void_visit_event_id = $4
         WHERE id = $1 AND status = 'ISSUED'`,
        [coupon.id, input.now, input.staffAccountId, input.visitEventId],
      );
      // 쓰지 않은 쿠폰이 점주가 동의한 발급 상한을 계속 차지하지 않게 한다.
      await client.query(
        'UPDATE badge_reward_offers SET issued_count = issued_count - 1 WHERE id = $1 AND issued_count > 0',
        [coupon.offer_id],
      );
      await client.query(
        `INSERT INTO badge_coupon_audit (
           id, coupon_id, merchant_id, action, actor_account_id, visit_event_id, created_at
         ) VALUES ($1, $2, $3, 'VOIDED_ON_RECOUNT', $4, $5, $6)`,
        [this.nextAuditId(), coupon.id, coupon.merchant_id, input.staffAccountId, input.visitEventId, input.now],
      );
    }
    return coupons.rows.length;
  }

  private async requireMemberOnce(merchantId: string, staffAccountId: string): Promise<void> {
    const member = await this.pool.query(
      `SELECT 1 FROM merchant_members
       WHERE merchant_id = $1 AND account_id = $2 AND status = 'ACTIVE'`,
      [merchantId, staffAccountId],
    );
    if (!member.rowCount) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
  }
}

// 점포 행을 FOR SHARE로 잡아 직원 회수(점포 행 FOR UPDATE)와 직렬화한다. 숨긴 점포여도 되돌리기는 허용한다.
async function requireActiveMember(client: PoolClient, merchantId: string, staffAccountId: string): Promise<void> {
  const member = await client.query(
    `SELECT 1
     FROM merchant_members AS member
     JOIN merchants AS merchant ON merchant.id = member.merchant_id
     WHERE member.merchant_id = $1 AND member.account_id = $2 AND member.status = 'ACTIVE'
     FOR SHARE OF merchant`,
    [merchantId, staffAccountId],
  );
  if (!member.rowCount) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
}

async function advisoryLock(client: PoolClient, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

function isPostgresCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
