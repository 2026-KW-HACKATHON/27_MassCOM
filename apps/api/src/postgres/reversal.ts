import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { buildMedals, earnedTiers, type MedalValues, type RewardMilestone } from '../badge-rules.js';
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
  // outbox 대여(lease)가 DB 시계로 지금 유효한지: 워커가 전송을 준비 중일 수 있다.
  leased: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// lock_not_available(NOWAIT가 잠금에 막힘)와 deadlock_detected는 워커가 같은 작업을 잡고 있다는 뜻이라 같은 안내로 돌려준다.
const lockNotAvailable = '55P03';
const deadlockDetected = '40P01';

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
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 잠금 순서: 계정 → 점포 멤버 → [고객, 캠페인] → 배지 상자 → 방문 → 권리 → 발행 작업·outbox → 쿠폰.
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
      // 잠금을 다 잡은 뒤에 시각을 잰다: 기다린 시간이 영업일 창 판정에 들어가지 않게 한다.
      const now = this.now();

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
           SET progress_counted = true, promoted_by_visit_event_id = $5, updated_at = $6
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
               AND candidate.progress_excluded_reason IS NULL
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
      if (isPostgresCode(error, lockNotAvailable) || isPostgresCode(error, deadlockDetected)) {
        throw new ReversalError('VISIT_REWARD_MINT_IN_PROGRESS');
      }
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
      merchant_is_demo: boolean;
    }>(
      `SELECT coupon.id, coupon.title, coupon.customer_account_id, coupon.redeemed_at, coupon.redeemed_by_account_id,
              merchant.is_demo AS merchant_is_demo
       FROM badge_coupons AS coupon
       JOIN merchants AS merchant ON merchant.id = coupon.merchant_id
       WHERE coupon.merchant_id = $1 AND coupon.status = 'REDEEMED' AND coupon.redeemed_at > $2
       ORDER BY coupon.redeemed_at DESC, coupon.id
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
        // 실제 점포에서 본인 쿠폰은 되돌리기 요청이 403 COUPON_SELF_UNDO로 끝나므로 버튼을 보이지 않는다.
        canUndo: isWithinCouponUndoWindow(row.redeemed_at, now)
          && (row.merchant_is_demo || row.customer_account_id !== input.staffAccountId),
      })),
    };
  }

  async undoCouponRedemption(input: {
    merchantId: string;
    staffAccountId: string;
    couponId: string;
  }): Promise<UndoneCouponRedemption> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.assertActive(client, input.staffAccountId);
      await requireActiveMember(client, input.merchantId, input.staffAccountId);
      if (!uuidPattern.test(input.couponId)) throw new ReversalError('COUPON_NOT_FOUND');
      // 다른 점포·없는 쿠폰은 조건에 맞는 행이 없어 구분 없이 같은 404가 된다.
      const peek = (
        await client.query<{ customer_account_id: string }>(
          'SELECT customer_account_id FROM badge_coupons WHERE id = $1 AND merchant_id = $2',
          [input.couponId, input.merchantId],
        )
      ).rows[0];
      if (!peek) throw new ReversalError('COUPON_NOT_FOUND');
      // 방문 취소와 같은 순서(배지 상자 잠금 → 쿠폰 행)로 잡아 서로 교착하지 않고, 아래 다시 세기가 취소 결과를 본다.
      await advisoryLock(client, `badge-reward:${peek.customer_account_id}`);
      const coupon = (
        await client.query<{
          id: string;
          customer_account_id: string;
          milestone: number;
          status: 'ISSUED' | 'REDEEMED' | 'VOIDED';
          redeemed_at: Date | null;
          redeemed_by_account_id: string | null;
          merchant_is_demo: boolean;
        }>(
          `SELECT coupon.id, coupon.customer_account_id, coupon.milestone, coupon.status, coupon.redeemed_at,
                  coupon.redeemed_by_account_id, merchant.is_demo AS merchant_is_demo
           FROM badge_coupons AS coupon
           JOIN merchants AS merchant ON merchant.id = coupon.merchant_id
           WHERE coupon.id = $1 AND coupon.merchant_id = $2
           FOR UPDATE OF coupon`,
          [input.couponId, input.merchantId],
        )
      ).rows[0];
      if (!coupon) throw new ReversalError('COUPON_NOT_FOUND');
      // 잠금을 기다리는 사이 계정 삭제가 고객 열을 가명으로 바꿨다면 잠근 상자(peek한 고객 기준)와 쿠폰의 주인이 어긋난다.
      // 방문 취소가 방문 행으로 확인하는 것과 같이 어긋나면 되돌리지 않고 ACCOUNT_DELETED로 끝낸다.
      if (coupon.customer_account_id !== peek.customer_account_id) throw new ReversalError('ACCOUNT_DELETED');
      // 잠금을 다 잡은 뒤에 시각을 잰다: 기다린 시간이 10분 창 판정에 들어가지 않게 한다.
      const now = this.now();
      // 실제 점포에서는 본인 쿠폰을 본인 점원 계정으로 사용 처리할 수 없듯이 되돌릴 수도 없다
      // (동료가 대신 사용 처리한 쿠폰을 본인이 되돌려 같은 쿠폰을 되풀이해 쓰는 길을 막는다). 시연 점포는 그대로 허용한다.
      if (coupon.customer_account_id === input.staffAccountId && !coupon.merchant_is_demo) {
        throw new ReversalError('COUPON_SELF_UNDO');
      }

      if (coupon.status === 'REDEEMED') {
        if (!isWithinCouponUndoWindow(coupon.redeemed_at!, now)) throw new ReversalError('COUPON_UNDO_WINDOW_CLOSED');
        // 사용 뒤에 방문 취소로 배지 조건이 사라졌다면 쿠폰을 사용 가능 상태로 되살리지 않는다(되살리면 조건 없는 쿠폰이 다시 쓰인다).
        // 무효로 바꾸는 대신 되돌리기를 거절하고 쿠폰은 사용 완료로 남긴다: 이미 내준 혜택 기록을 바꾸지 않는다.
        const medalRow = await client.query<MedalValues>(medalValuesSql, [coupon.customer_account_id]);
        if (milestonesToVoid(earnedTiers(buildMedals(medalRow.rows[0]!))).includes(coupon.milestone as RewardMilestone)) {
          throw new ReversalError('COUPON_REQUIREMENT_LOST');
        }
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
    // 작업 행과 outbox 행을 한 문장으로 NOWAIT 잠근다(워커의 대여 조회와 같은 조합). 워커는 잠근 채로 전송을 준비하므로
    // 여기서 기다리면 교착할 수 있어 잠겨 있으면 55P03으로 끝내고 호출부가 VISIT_REWARD_MINT_IN_PROGRESS로 바꾼다.
    // 작업마다 outbox 행이 하나뿐이고 같은 거래에서 만들어진다(mint_jobs·outbox_events 삽입, UNIQUE(aggregate)).
    // 대여 만료는 API 시계가 아니라 DB 시계(clock_timestamp)로 비교한다. 워커는 lease_expires_at을 자기 프로세스 시계
    // (지금 + 대여 시간, 기본 30초)로 쓰므로 워커와 DB 시계가 어긋나면 그만큼 판정도 어긋난다. DB 시계 하나로 고정하면
    // API 서버 시계의 편차만 빠질 뿐 어긋남이 없어지지는 않는다. 그래서 대여가 없다는 판정만 믿지 않고 위의 NOWAIT 잠금을 함께 쓴다.
    const jobs = (
      await client.query<MintJobRow>(
        `SELECT job.id, job.entitlement_id, job.status, job.transaction_hash, job.last_error_code,
                (outbox.status = 'LEASED' AND outbox.lease_expires_at > clock_timestamp()) AS leased
         FROM mint_jobs AS job
         JOIN outbox_events AS outbox ON outbox.aggregate_id = job.id
         WHERE job.entitlement_id = ANY($1::uuid[])
         FOR UPDATE OF job, outbox NOWAIT`,
        [entitlementIds],
      )
    ).rows;
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
         SET status = 'CANCELLED', last_error_code = 'VISIT_CANCELED', canceled_by_visit_event_id = $3, updated_at = $1
         WHERE id = ANY($2::uuid[])`,
        [now, cancelable, visitEventId],
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

  // 다시 센 배지 수로 더는 열 수 없는 상자의 미사용 쿠폰을 무효로 한다. 사용한 쿠폰과 이미 만료된 쿠폰은 건드리지 않는다
  // (만료된 쿠폰을 무효로 바꿨다가 되살리면 만료 날짜가 늘어날 수 있다).
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
         AND expires_at > $3
       ORDER BY milestone
       FOR UPDATE`,
      [input.customerAccountId, milestones, input.now],
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
