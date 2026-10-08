import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { MerchantOperationError, type MerchantCampaignOption, type MerchantOperations,
  type MerchantStaffMember } from '../merchant-operations.js';
import { shiftDate } from '../merchant-overview-rules.js';
import { countedVisitFilterSql, countedVisitFromSql } from './badge-rewards.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';

type CampaignRow = { id: string; title: string; status: MerchantCampaignOption['status'];
  starts_at: Date; ends_at: Date; is_public: boolean };
type StaffRow = { account_id: string; granted_at: Date; staff_can_confirm_visit: boolean;
  staff_can_redeem_coupon: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const day = /^\d{4}-\d\d-\d\d$/;
const validDay = (value: string): boolean => day.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const hashCode = (code: string) => createHash('sha256').update(code).digest();
const campaignView = (row: CampaignRow): MerchantCampaignOption => ({ id: row.id, title: row.title,
  status: row.status, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(), isPublic: row.is_public });
const staffView = (row: StaffRow): MerchantStaffMember => ({ accountId: row.account_id,
  grantedAt: row.granted_at.toISOString(), confirmVisit: row.staff_can_confirm_visit,
  redeemCoupon: row.staff_can_redeem_coupon });

function csvCell(value: string | number): string {
  const string = String(value);
  // Excel treats leading formula characters as code, even inside quoted CSV cells.
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(string) ? `'${string}` : string;
  return `"${safe.replaceAll('"', '""')}"`;
}

export class PostgresMerchantOperations implements MerchantOperations {
  private readonly now: () => Date;
  private readonly accountLifecycle: PostgresAccountLifecycle;

  constructor(private readonly pool: Pool, options: {
    accountLifecycle: PostgresAccountLifecycle; now?: () => Date;
  }) {
    this.accountLifecycle = options.accountLifecycle;
    this.now = options.now ?? (() => new Date());
  }

  private async active(client: PoolClient, ...accountIds: string[]): Promise<void> {
    try { await this.accountLifecycle.assertAllActive(client, accountIds); }
    catch (error) {
      if (error instanceof AccountLifecycleError) throw new MerchantOperationError('MERCHANT_OPERATION_FORBIDDEN');
      throw error;
    }
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }

  private async owner(client: PoolClient, accountId: string, merchantId: string, lock = false): Promise<void> {
    const merchant = await client.query(
      `SELECT 1 FROM merchants WHERE id = $1 AND status = 'ACTIVE' AND NOT is_demo ${lock ? 'FOR UPDATE' : ''}`,
      [merchantId]);
    if (!merchant.rowCount) throw new MerchantOperationError('MERCHANT_OPERATION_NOT_FOUND');
    const member = await client.query(
      `SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = $2
       AND role = 'OWNER' AND status = 'ACTIVE' ${lock ? 'FOR UPDATE' : ''}`,
      [merchantId, accountId]);
    if (!member.rowCount) throw new MerchantOperationError('MERCHANT_OPERATION_FORBIDDEN');
  }

  async listCampaigns(accountId: string, merchantId: string): Promise<MerchantCampaignOption[]> {
    return this.transaction(async client => {
      await this.owner(client, accountId, merchantId);
      const rows = await client.query<CampaignRow>(
        `SELECT id, title, status, starts_at, ends_at, is_public FROM campaigns
         WHERE merchant_id = $1 ORDER BY starts_at DESC, id`, [merchantId]);
      return rows.rows.map(campaignView);
    }, true);
  }

  async extendCampaign(input: { accountId: string; merchantId: string; campaignId: string; days: 30 | 90;
    expectedEndsAt: string; consentAccepted: boolean; requestId: string }) {
    if (!uuid.test(input.requestId) || ![30, 90].includes(input.days)
      || !iso.test(input.expectedEndsAt) || !Number.isFinite(Date.parse(input.expectedEndsAt))
      || new Date(input.expectedEndsAt).toISOString() !== input.expectedEndsAt || input.consentAccepted !== true) {
      throw new MerchantOperationError('MERCHANT_OPERATION_INVALID');
    }
    return this.transaction(async client => {
      await this.active(client, input.accountId);
      await this.owner(client, input.accountId, input.merchantId, true);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`merchant-extension-request:${input.requestId}`]);
      const previous = await client.query<{ campaign_id: string; merchant_id: string; actor_account_id: string;
        days: number; previous_ends_at: Date; new_ends_at: Date }>(
        `SELECT campaign_id, merchant_id, actor_account_id, days, previous_ends_at, new_ends_at
         FROM merchant_campaign_extension_audit WHERE request_id = $1`, [input.requestId]);
      const current = await client.query<CampaignRow>(
        `SELECT id, title, status, starts_at, ends_at, is_public FROM campaigns
         WHERE id = $1 AND merchant_id = $2 FOR UPDATE`, [input.campaignId, input.merchantId]);
      const row = current.rows[0];
      if (!row) throw new MerchantOperationError('MERCHANT_OPERATION_NOT_FOUND');
      const replay = previous.rows[0];
      if (replay) {
        if (replay.campaign_id !== input.campaignId || replay.merchant_id !== input.merchantId
          || replay.actor_account_id !== input.accountId || replay.days !== input.days
          || replay.previous_ends_at.toISOString() !== input.expectedEndsAt) {
          throw new MerchantOperationError('MERCHANT_OPERATION_CONFLICT');
        }
        return { ...campaignView(row), replayed: true };
      }
      if (row.ends_at.toISOString() !== input.expectedEndsAt) throw new MerchantOperationError('MERCHANT_OPERATION_CONFLICT');
      const now = this.now();
      // Owner can renew an active campaign, including a recently expired one. Other status changes need operator review.
      if (row.status !== 'ACTIVE' || row.ends_at.getTime() < now.getTime() - 30 * 86_400_000) {
        throw new MerchantOperationError('MERCHANT_OPERATION_FORBIDDEN');
      }
      const next = new Date(Math.max(now.getTime(), row.ends_at.getTime()) + input.days * 86_400_000);
      if (next.getTime() > now.getTime() + 365 * 86_400_000) throw new MerchantOperationError('MERCHANT_OPERATION_LIMIT');
      await client.query(`UPDATE campaigns SET ends_at = $3, updated_at = now() WHERE id = $1 AND merchant_id = $2`,
        [input.campaignId, input.merchantId, next]);
      await client.query(`INSERT INTO merchant_campaign_extension_audit
        (id, request_id, merchant_id, campaign_id, actor_account_id, previous_ends_at, new_ends_at, days, consent_accepted_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), input.requestId, input.merchantId, input.campaignId, input.accountId, row.ends_at, next, input.days, now]);
      return { ...campaignView({ ...row, ends_at: next }), replayed: false };
    });
  }

  async listStaff(accountId: string, merchantId: string): Promise<MerchantStaffMember[]> {
    return this.transaction(async client => {
      await this.owner(client, accountId, merchantId);
      const result = await client.query<StaffRow>(`SELECT account_id, granted_at,
        staff_can_confirm_visit, staff_can_redeem_coupon FROM merchant_members
        WHERE merchant_id = $1 AND role = 'STAFF' AND status = 'ACTIVE' ORDER BY granted_at, account_id`, [merchantId]);
      return result.rows.map(staffView);
    }, true);
  }

  async approveStaff(input: { accountId: string; merchantId: string; code: string }): Promise<MerchantStaffMember> {
    if (!/^[A-Za-z0-9_-]{22}$/.test(input.code)) throw new MerchantOperationError('MERCHANT_OPERATION_INVALID');
    return this.transaction(async client => {
      await this.owner(client, input.accountId, input.merchantId);
      const candidate = await client.query<{ account_id: string }>(
        `SELECT account_id FROM staff_registration_requests
         WHERE merchant_id = $1 AND code_hash = $2 AND consumed_at IS NULL`,
        [input.merchantId, hashCode(input.code)]);
      if (!candidate.rows[0]) throw new MerchantOperationError('MERCHANT_OPERATION_NOT_FOUND');
      await this.active(client, input.accountId, candidate.rows[0].account_id);
      await this.owner(client, input.accountId, input.merchantId, true);
      const request = await client.query<{ id: string; account_id: string; expires_at: Date }>(
        `SELECT id, account_id, expires_at FROM staff_registration_requests
         WHERE merchant_id = $1 AND code_hash = $2 AND consumed_at IS NULL FOR UPDATE`,
        [input.merchantId, hashCode(input.code)]);
      const row = request.rows[0];
      if (!row || row.account_id !== candidate.rows[0].account_id || row.expires_at <= this.now()) {
        throw new MerchantOperationError('MERCHANT_OPERATION_NOT_FOUND');
      }
      const identity = await client.query(`SELECT 1 FROM auth_identities WHERE account_id = $1 AND provider = 'google'`,
        [row.account_id]);
      if (!identity.rowCount) throw new MerchantOperationError('MERCHANT_OPERATION_NOT_FOUND');
      const old = await client.query<{ role: string; status: string }>(
        `SELECT role, status FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 FOR UPDATE`,
        [input.merchantId, row.account_id]);
      if (old.rows[0]?.role === 'OWNER' || old.rows[0]?.status === 'ACTIVE') {
        throw new MerchantOperationError('MERCHANT_OPERATION_CONFLICT');
      }
      const member = await client.query<StaffRow>(`INSERT INTO merchant_members
        (merchant_id, account_id, role, status, staff_can_confirm_visit, staff_can_redeem_coupon)
        VALUES ($1, $2, 'STAFF', 'ACTIVE', true, true)
        ON CONFLICT (merchant_id, account_id) DO UPDATE SET status = 'ACTIVE', revoked_at = NULL,
        staff_can_confirm_visit = true, staff_can_redeem_coupon = true, granted_at = now(), updated_at = now()
        RETURNING account_id, granted_at, staff_can_confirm_visit, staff_can_redeem_coupon`,
        [input.merchantId, row.account_id]);
      await client.query(`UPDATE staff_registration_requests SET consumed_at = now() WHERE id = $1`, [row.id]);
      await client.query(`INSERT INTO merchant_staff_action_audit
        (id, merchant_id, actor_account_id, target_account_id, action, request_id)
        VALUES ($1, $2, $3, $4, 'APPROVED', $5)`,
        [randomUUID(), input.merchantId, input.accountId, row.account_id, row.id]);
      return staffView(member.rows[0]!);
    });
  }

  async updateStaffPermissions(input: { accountId: string; merchantId: string; targetAccountId: string;
    confirmVisit: boolean; redeemCoupon: boolean }): Promise<MerchantStaffMember> {
    if (typeof input.confirmVisit !== 'boolean' || typeof input.redeemCoupon !== 'boolean') {
      throw new MerchantOperationError('MERCHANT_OPERATION_INVALID');
    }
    return this.transaction(async client => {
      await this.active(client, input.accountId, input.targetAccountId);
      await this.owner(client, input.accountId, input.merchantId, true);
      const prior = await client.query<StaffRow>(`SELECT account_id, granted_at,
        staff_can_confirm_visit, staff_can_redeem_coupon FROM merchant_members
        WHERE merchant_id = $1 AND account_id = $2 AND role = 'STAFF' AND status = 'ACTIVE' FOR UPDATE`,
        [input.merchantId, input.targetAccountId]);
      if (!prior.rows[0]) throw new MerchantOperationError('MERCHANT_OPERATION_STAFF_NOT_FOUND');
      if (prior.rows[0].staff_can_confirm_visit === input.confirmVisit
        && prior.rows[0].staff_can_redeem_coupon === input.redeemCoupon) return staffView(prior.rows[0]);
      const next = await client.query<StaffRow>(`UPDATE merchant_members SET staff_can_confirm_visit = $3,
        staff_can_redeem_coupon = $4, updated_at = now() WHERE merchant_id = $1 AND account_id = $2
        RETURNING account_id, granted_at, staff_can_confirm_visit, staff_can_redeem_coupon`,
        [input.merchantId, input.targetAccountId, input.confirmVisit, input.redeemCoupon]);
      await client.query(`INSERT INTO merchant_staff_action_audit
        (id, merchant_id, actor_account_id, target_account_id, action, before_permissions, after_permissions)
        VALUES ($1, $2, $3, $4, 'PERMISSIONS_CHANGED', $5::jsonb, $6::jsonb)`,
        [randomUUID(), input.merchantId, input.accountId, input.targetAccountId,
          JSON.stringify(staffView(prior.rows[0])), JSON.stringify(staffView(next.rows[0]!))]);
      return staffView(next.rows[0]!);
    });
  }

  async revokeStaff(input: { accountId: string; merchantId: string; targetAccountId: string }): Promise<void> {
    await this.transaction(async client => {
      await this.active(client, input.accountId, input.targetAccountId);
      await this.owner(client, input.accountId, input.merchantId, true);
      const changed = await client.query(`UPDATE merchant_members
        SET status = 'REVOKED', revoked_at = now(), updated_at = now()
        WHERE merchant_id = $1 AND account_id = $2 AND role = 'STAFF' AND status = 'ACTIVE'`,
        [input.merchantId, input.targetAccountId]);
      if (!changed.rowCount) throw new MerchantOperationError('MERCHANT_OPERATION_STAFF_NOT_FOUND');
      await client.query(`INSERT INTO merchant_staff_action_audit
        (id, merchant_id, actor_account_id, target_account_id, action)
        VALUES ($1, $2, $3, $4, 'REVOKED')`,
        [randomUUID(), input.merchantId, input.accountId, input.targetAccountId]);
    });
  }

  async exportVisits(input: { accountId: string; merchantId: string; fromDate: string; toDate: string }) {
    const { fromDate, toDate } = input;
    if (!validDay(fromDate) || !validDay(toDate) || fromDate > toDate
      || toDate > shiftDate(fromDate, 365)) throw new MerchantOperationError('MERCHANT_OPERATION_INVALID');
    return this.transaction(async client => {
      await this.owner(client, input.accountId, input.merchantId);
      const rows = await client.query<{ business_date: string; occurred_at: Date; campaign_title: string;
        visit_kind: string; rewards: number; coupons_issued: number; coupons_redeemed: number }>(
        `WITH counted AS (
           SELECT visit.id, visit.customer_account_id, visit.business_date, visit.occurred_at,
             campaign.title AS campaign_title
           ${countedVisitFromSql}
           JOIN campaigns AS campaign ON campaign.id = visit.campaign_id
           WHERE visit.merchant_id = $1 AND ${countedVisitFilterSql}
         ), first_dates AS (
           SELECT customer_account_id, min(business_date) AS first_date
           FROM counted GROUP BY customer_account_id
         )
         SELECT visit.business_date::text, visit.occurred_at, visit.campaign_title,
           CASE WHEN visit.business_date = first_dates.first_date THEN '처음 확인된 방문' ELSE '다시 확인된 방문' END AS visit_kind,
           (SELECT count(*)::integer FROM reward_entitlements AS reward
             WHERE reward.source_visit_event_id = visit.id AND reward.status <> 'CANCELED') AS rewards,
           (SELECT count(*)::integer FROM badge_coupons AS coupon
             WHERE coupon.merchant_id = $1 AND coupon.customer_account_id = visit.customer_account_id
               AND (coupon.issued_at AT TIME ZONE 'Asia/Seoul')::date = visit.business_date) AS coupons_issued,
           (SELECT count(*)::integer FROM badge_coupons AS coupon
             WHERE coupon.merchant_id = $1 AND coupon.customer_account_id = visit.customer_account_id
               AND coupon.status = 'REDEEMED'
               AND (coupon.redeemed_at AT TIME ZONE 'Asia/Seoul')::date = visit.business_date) AS coupons_redeemed
         FROM counted AS visit
         JOIN first_dates ON first_dates.customer_account_id = visit.customer_account_id
         WHERE visit.business_date BETWEEN $2::date AND $3::date
         ORDER BY visit.business_date, visit.occurred_at, visit.id LIMIT 10001`,
        [input.merchantId, fromDate, toDate]);
      if (rows.rows.length > 10000) throw new MerchantOperationError('MERCHANT_OPERATION_LIMIT');
      // 방문구분은 MassCOM에서 이 가게 방문이 처음 확인됐는지(앱 기록 기준)일 뿐 평생 처음 온 손님이라는 뜻이 아니다(D-092).
      const header = ['방문일(KST)', '방문시각(KST)', '캠페인', '방문구분(MassCOM 확인 기준)', '수집보상 건수', '쿠폰 발급 건수', '쿠폰 사용 건수'];
      const lines = rows.rows.map(row => [row.business_date,
        new Date(row.occurred_at.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '),
        row.campaign_title, row.visit_kind, row.rewards, row.coupons_issued, row.coupons_redeemed]
        .map(csvCell).join(','));
      return { filename: `masscom-visits-${input.merchantId.replace(/[^A-Za-z0-9_-]/g, '_')}-${fromDate}-${toDate}.csv`,
        csv: `\uFEFF${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`, count: rows.rows.length };
    }, true);
  }
}
