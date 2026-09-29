import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { isCouponVoidReason, maskedCustomerLabel, normalizeReversalNote } from '../reversal-rules.js';
import {
  composeOfferConsentNote, isCompleteOwnerOfferConsent, isOwnerDemotionReason, maxActiveOwnersPerMerchant,
  missingPublishRequirements, normalizeDocumentReference, ownerOfferConsentChecklistVersion, rewardOfferIssuanceCapMax,
  type OwnerDemotionReason,
} from '../store-go-live-rules.js';
import { AccountLifecycleError, PostgresAccountLifecycle } from './account-lifecycle.js';

export type AdminMerchant = {
  id: string;
  name: string;
  story: string;
  roadAddress: string;
  minimumSpendWon: number;
  menuItems: { name: string; priceWon: number }[];
  businessHours: string;
  status: 'ACTIVE' | 'PAUSED';
  demo: false;
  version: number;
  // 공개할 때 관리자가 적은 점포 동의서(가게 이름·사진 사용) 참조 번호와 마지막 공개 시각(Issue #246).
  consentDocumentRef: string | null;
  publishedAt: string | null;
};

export type MerchantInput = Pick<AdminMerchant, 'name' | 'story' | 'roadAddress' | 'minimumSpendWon'> &
  Partial<Pick<AdminMerchant, 'menuItems' | 'businessHours'>>;

export type AdminOperationsStatus = {
  merchants: {
    id: string; name: string; status: 'ACTIVE' | 'PAUSED';
    claims: { active: number; expired: number; claimed: number };
    visits: number; rewards: number;
    mintJobs: { status: string; count: number }[];
    mintFailures: { code: string; count: number }[];
  }[];
};

export type AdminCoupon = {
  couponId: string;
  milestone: number;
  title: string;
  status: 'ISSUED' | 'REDEEMED' | 'VOIDED';
  expired: boolean;
  issuedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  voidReason: string | null;
  customerLabel: string;
};

export type AdminVoidedCoupon = {
  coupon: { couponId: string; status: 'VOIDED'; voidReason: string; voidedAt: string };
  replayed: boolean;
};

type AdminRewardGoal = { targetVisitCount: 1 | 3 | 5; displayName: string };

export type AdminCampaignDraftInput = {
  merchantId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  enrollmentCapacity: number;
  rewardGoals: AdminRewardGoal[];
};

export type AdminCampaignDraft = AdminCampaignDraftInput & {
  id: string;
  merchantName: string;
  status: 'DRAFT';
  public: false;
};

export type AdminCampaign = {
  id: string;
  merchantId: string;
  merchantName: string;
  title: string;
  startsAt: string;
  endsAt: string;
  enrollmentCapacity: number;
  enrolledCount: number;
  rewardGoals: AdminRewardGoal[];
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
  public: boolean;
};

export type AdminOwner = { accountId: string; role: 'OWNER'; grantedAt: string };

export type AdminRewardOfferInput = {
  merchantId: unknown;
  milestone: unknown;
  title: unknown;
  detail: unknown;
  validDays: unknown;
  issuanceCap: unknown;
  consentDocumentRef: unknown;
  consent: unknown;
};

export type AdminRewardOffer = {
  id: string;
  merchantId: string;
  merchantName: string;
  milestone: 1 | 2 | 3;
  title: string;
  detail: string;
  validDays: number;
  issuanceCap: number | null;
  issuedCount: number;
  status: 'ACTIVE' | 'PAUSED';
  consentDocumentRef: string | null;
  createdAt: string;
};

type MerchantRow = {
  id: string;
  name: string;
  story: string;
  road_address: string;
  minimum_spend_won: number;
  menu_items: AdminMerchant['menuItems'];
  business_hours: string;
  status: 'ACTIVE' | 'PAUSED';
  is_demo: boolean;
  version: number;
  consent_document_ref: string | null;
  published_at: Date | null;
};

type CampaignRow = {
  id: string; merchant_id: string; merchant_name: string; title: string; starts_at: Date; ends_at: Date;
  enrollment_capacity: number; enrolled_count: number; reward_goals: AdminRewardGoal[];
  status: AdminCampaign['status']; is_public: boolean;
};

type OfferRow = {
  id: string; merchant_id: string; merchant_name: string; milestone: 1 | 2 | 3; title: string; detail: string;
  valid_days: number; issuance_cap: number | null; issued_count: number; status: 'ACTIVE' | 'PAUSED';
  consent_document_ref: string | null; created_at: Date;
};

export class AdminError extends Error {
  constructor(readonly code: 'ADMIN_FORBIDDEN' | 'ADMIN_IDENTITY_NOT_FOUND' |
    'ADMIN_MERCHANT_NOT_FOUND' | 'ADMIN_VERSION_CONFLICT' | 'ADMIN_PENDING_CLAIMS' | 'ADMIN_INVALID_INPUT' |
    'ADMIN_COUPON_NOT_FOUND' | 'ADMIN_COUPON_NOT_VOIDABLE' |
    // Issue #246: 점포 공개·점주·보상 혜택·캠페인 공개
    'ADMIN_DOCUMENT_REF_INVALID' | 'ADMIN_MERCHANT_NOT_READY' | 'ADMIN_MERCHANT_ALREADY_ACTIVE' |
    'ADMIN_MERCHANT_NOT_ACTIVE' | 'ADMIN_SELF_ROLE_CHANGE' | 'ADMIN_MEMBER_NOT_FOUND' | 'ADMIN_ALREADY_OWNER' |
    'ADMIN_OWNER_LIMIT' | 'ADMIN_CONSENT_INCOMPLETE' | 'ADMIN_OFFER_NOT_FOUND' | 'ADMIN_OFFER_MILESTONE_TAKEN' |
    'ADMIN_CAMPAIGN_NOT_FOUND' | 'ADMIN_CAMPAIGN_NOT_PUBLISHABLE' | 'ADMIN_CAMPAIGN_NOT_PAUSABLE' |
    'ADMIN_CAMPAIGN_ACTIVE_EXISTS') {
    super(code);
    this.name = 'AdminError';
  }
}

const columns = 'id, name, story, road_address, minimum_spend_won, menu_items, business_hours, status, is_demo, version, ' +
  'consent_document_ref, published_at';

function merchant(row: MerchantRow): AdminMerchant {
  if (row.is_demo) throw new AdminError('ADMIN_MERCHANT_NOT_FOUND');
  return {
    id: row.id, name: row.name, story: row.story, roadAddress: row.road_address,
    minimumSpendWon: row.minimum_spend_won, menuItems: row.menu_items, businessHours: row.business_hours,
    status: row.status, demo: false, version: row.version,
    consentDocumentRef: row.consent_document_ref, publishedAt: row.published_at ? row.published_at.toISOString() : null,
  };
}

const campaignSelect = `SELECT campaign.id, campaign.merchant_id, merchant.name AS merchant_name,
    campaign.title, campaign.starts_at, campaign.ends_at, campaign.enrollment_capacity, campaign.enrolled_count,
    campaign.status, campaign.is_public,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('targetVisitCount', goal.target_visit_count,
      'displayName', goal.display_name) ORDER BY goal.target_visit_count)
      FROM campaign_goals AS goal WHERE goal.campaign_id = campaign.id), '[]'::jsonb) AS reward_goals
  FROM campaigns AS campaign JOIN merchants AS merchant ON merchant.id = campaign.merchant_id`;

function campaign(row: CampaignRow): AdminCampaign {
  return {
    id: row.id, merchantId: row.merchant_id, merchantName: row.merchant_name, title: row.title,
    startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(),
    enrollmentCapacity: row.enrollment_capacity, enrolledCount: row.enrolled_count, rewardGoals: row.reward_goals,
    status: row.status, public: row.is_public,
  };
}

const offerSelect = `SELECT offer.id, offer.merchant_id, merchant.name AS merchant_name, offer.milestone, offer.title,
    offer.detail, offer.valid_days, offer.issuance_cap, offer.issued_count, offer.status, offer.consent_document_ref,
    offer.created_at
  FROM badge_reward_offers AS offer JOIN merchants AS merchant ON merchant.id = offer.merchant_id`;

function offer(row: OfferRow): AdminRewardOffer {
  return {
    id: row.id, merchantId: row.merchant_id, merchantName: row.merchant_name, milestone: row.milestone,
    title: row.title, detail: row.detail, validDays: row.valid_days, issuanceCap: row.issuance_cap,
    issuedCount: row.issued_count, status: row.status, consentDocumentRef: row.consent_document_ref,
    createdAt: row.created_at.toISOString(),
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505' &&
    (error as { constraint?: unknown }).constraint === constraint;
}

function validAccountId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 200;
}

type ValidRewardOffer = {
  merchantId: string; milestone: 1 | 2 | 3; title: string; detail: string; validDays: number; issuanceCap: number;
  consentDocumentRef: string;
};

function validateRewardOffer(raw: AdminRewardOfferInput): ValidRewardOffer {
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const detail = typeof raw.detail === 'string' ? raw.detail.trim() : undefined;
  if (typeof raw.merchantId !== 'string' || !raw.merchantId.trim() || raw.merchantId.length > 200 ||
      (raw.milestone !== 1 && raw.milestone !== 2 && raw.milestone !== 3) ||
      Array.from(title).length < 1 || Array.from(title).length > 40 ||
      detail === undefined || Array.from(detail).length > 120 ||
      !Number.isSafeInteger(raw.validDays) || (raw.validDays as number) < 1 || (raw.validDays as number) > 365 ||
      !Number.isSafeInteger(raw.issuanceCap) || (raw.issuanceCap as number) < 1 ||
      (raw.issuanceCap as number) > rewardOfferIssuanceCapMax) {
    throw new AdminError('ADMIN_INVALID_INPUT');
  }
  if (!isCompleteOwnerOfferConsent(raw.consent)) throw new AdminError('ADMIN_CONSENT_INCOMPLETE');
  const consentDocumentRef = normalizeDocumentReference(raw.consentDocumentRef);
  if (!consentDocumentRef) throw new AdminError('ADMIN_DOCUMENT_REF_INVALID');
  return { merchantId: raw.merchantId.trim(), milestone: raw.milestone, title, detail,
    validDays: raw.validDays as number, issuanceCap: raw.issuanceCap as number, consentDocumentRef };
}

function validate(input: MerchantInput): MerchantInput {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 ||
      typeof input.story !== 'string' || input.story.length > 4000 ||
      typeof input.roadAddress !== 'string' || !input.roadAddress.trim() || input.roadAddress.length > 500 ||
      !Number.isSafeInteger(input.minimumSpendWon) || input.minimumSpendWon < 0 || input.minimumSpendWon > 1_000_000_000 ||
      (input.businessHours !== undefined && (typeof input.businessHours !== 'string' || input.businessHours.length > 1000)) ||
      (input.menuItems !== undefined && (!Array.isArray(input.menuItems) || input.menuItems.length > 30 ||
        input.menuItems.some(item => !item || typeof item.name !== 'string' || !item.name.trim() ||
          item.name.length > 200 || !Number.isSafeInteger(item.priceWon) || item.priceWon < 0 ||
          item.priceWon > 1_000_000_000)))) {
    throw new AdminError('ADMIN_INVALID_INPUT');
  }
  return { name: input.name.trim(), story: input.story.trim(),
    roadAddress: input.roadAddress.trim(), minimumSpendWon: input.minimumSpendWon,
    ...(input.menuItems === undefined ? {} : {
      menuItems: input.menuItems.map(item => ({ name: item.name.trim(), priceWon: item.priceWon })),
    }),
    ...(input.businessHours === undefined ? {} : { businessHours: input.businessHours.trim() }) };
}

function validateCampaignDraft(raw: AdminCampaignDraftInput): AdminCampaignDraftInput {
  const goals = Array.isArray(raw.rewardGoals) ? [...raw.rewardGoals] : [];
  goals.sort((a, b) => (a?.targetVisitCount ?? 0) - (b?.targetVisitCount ?? 0));
  const validUtc = (value: unknown): value is string =>
    typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
  if (typeof raw.merchantId !== 'string' || !raw.merchantId.trim() || raw.merchantId.length > 200 ||
      typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 200 ||
      !validUtc(raw.startsAt) || !validUtc(raw.endsAt) ||
      Date.parse(raw.endsAt) <= Date.parse(raw.startsAt) ||
      !Number.isSafeInteger(raw.enrollmentCapacity) || raw.enrollmentCapacity < 1 ||
      raw.enrollmentCapacity > 2_147_483_647 ||
      goals.length !== 3 || goals.some((goal, index) => !goal || goal.targetVisitCount !== [1, 3, 5][index] ||
        typeof goal.displayName !== 'string' || !goal.displayName.trim() || goal.displayName.length > 100)) {
    throw new AdminError('ADMIN_INVALID_INPUT');
  }
  return { merchantId: raw.merchantId.trim(), title: raw.title.trim(), startsAt: new Date(raw.startsAt).toISOString(),
    endsAt: new Date(raw.endsAt).toISOString(), enrollmentCapacity: raw.enrollmentCapacity,
    rewardGoals: goals.map(goal => ({ targetVisitCount: goal.targetVisitCount, displayName: goal.displayName.trim() })) };
}

// Shared with the account-deletion processing service (#194) so operator actions use the same admin check.
export async function assertPlatformAdmin(
  client: PoolClient, lifecycle: PostgresAccountLifecycle, accountId: string,
): Promise<void> {
  try { await lifecycle.assertActive(client, accountId); }
  catch (error) {
    if (error instanceof AccountLifecycleError) throw new AdminError('ADMIN_FORBIDDEN');
    throw error;
  }
  const result = await client.query(
    `SELECT 1 FROM platform_admins AS admin
     JOIN auth_identities AS identity ON identity.account_id = admin.account_id
     WHERE admin.account_id = $1 AND admin.revoked_at IS NULL AND identity.provider = 'google'
     FOR UPDATE OF admin`, [accountId],
  );
  if (result.rowCount !== 1) throw new AdminError('ADMIN_FORBIDDEN');
}

export class PostgresAdminService {
  private readonly lifecycle: PostgresAccountLifecycle;
  private readonly labelSecret: string;

  // labelHmacSecret은 점원 화면과 같은 고객 가림 표시를 만들려고 쓴다(점원 화면과 같은 비밀을 넘긴다).
  constructor(private readonly pool: Pool, hmacSecret: string, labelHmacSecret: string = hmacSecret) {
    this.lifecycle = new PostgresAccountLifecycle({ hmacSecret });
    this.labelSecret = labelHmacSecret;
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async requireAdmin(client: PoolClient, accountId: string): Promise<void> {
    await assertPlatformAdmin(client, this.lifecycle, accountId);
  }

  async isAdmin(accountId: string): Promise<boolean> {
    try { return await this.transaction(async client => { await this.requireAdmin(client, accountId); return true; }); }
    catch (error) { if (error instanceof AdminError && error.code === 'ADMIN_FORBIDDEN') return false; throw error; }
  }

  async listMerchants(accountId: string): Promise<AdminMerchant[]> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const result = await client.query<MerchantRow>(
        `SELECT ${columns} FROM merchants WHERE NOT is_demo ORDER BY name, id`,
      );
      return result.rows.map(merchant);
    });
  }

  async operationsStatus(accountId: string): Promise<AdminOperationsStatus> {
    return this.transaction(async client => {
      await client.query("SET LOCAL statement_timeout = '5s'");
      await this.requireAdmin(client, accountId);
      const result = await client.query<{
        id: string; name: string; status: 'ACTIVE' | 'PAUSED';
        active: number; expired: number; claimed: number; visits: number; rewards: number;
        mint_jobs: { status: string; count: number }[];
        mint_failures: { code: string; count: number }[];
      }>(`WITH selected AS MATERIALIZED (
          SELECT id, name, status FROM merchants WHERE NOT is_demo ORDER BY name, id LIMIT 100
        ), claims AS (
          SELECT merchant_id,
            count(*) FILTER (WHERE status = 'ISSUED' AND expires_at > statement_timestamp())::int AS active,
            count(*) FILTER (WHERE status = 'EXPIRED' OR
              (status = 'ISSUED' AND expires_at <= statement_timestamp()))::int AS expired,
            count(*) FILTER (WHERE status = 'CLAIMED')::int AS claimed
          FROM claim_slots WHERE merchant_id IN (SELECT id FROM selected) GROUP BY merchant_id
        ), visits AS (
          SELECT merchant_id, count(*)::int AS count FROM visit_events
          WHERE status = 'VALID' AND merchant_id IN (SELECT id FROM selected) GROUP BY merchant_id
        ), rewards AS (
          SELECT campaign.merchant_id, count(*)::int AS count FROM reward_entitlements AS entitlement
          JOIN campaigns AS campaign ON campaign.id = entitlement.campaign_id
          WHERE entitlement.status <> 'CANCELED' AND campaign.merchant_id IN (SELECT id FROM selected)
          GROUP BY campaign.merchant_id
        ), mint_base AS MATERIALIZED (
          SELECT campaign.merchant_id, job.status,
            CASE WHEN job.last_error_code IS NULL THEN NULL
              WHEN job.last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$' THEN job.last_error_code
              ELSE 'OTHER' END AS code
          FROM mint_jobs AS job
          JOIN reward_entitlements AS entitlement ON entitlement.id = job.entitlement_id
          JOIN campaigns AS campaign ON campaign.id = entitlement.campaign_id
          WHERE campaign.merchant_id IN (SELECT id FROM selected)
        ), mint_status_counts AS (
          SELECT merchant_id, status, count(*)::int AS count FROM mint_base GROUP BY merchant_id, status
        ), mint_status AS (
          SELECT merchant_id, jsonb_agg(jsonb_build_object('status', status, 'count', count)
            ORDER BY status) AS items FROM mint_status_counts GROUP BY merchant_id
        ), mint_failure_counts AS (
          SELECT merchant_id, code, count(*)::int AS count FROM mint_base
          WHERE code IS NOT NULL GROUP BY merchant_id, code
        ), mint_failure_ranked AS (
          SELECT merchant_id, code, count,
            row_number() OVER (PARTITION BY merchant_id ORDER BY count DESC, code) AS position
          FROM mint_failure_counts
        ), mint_failures AS (
          SELECT merchant_id, jsonb_agg(jsonb_build_object('code', code, 'count', count)
            ORDER BY count DESC, code) AS items FROM mint_failure_ranked
          WHERE position <= 10 GROUP BY merchant_id
        )
        SELECT selected.id, selected.name, selected.status,
          COALESCE(claims.active, 0) AS active, COALESCE(claims.expired, 0) AS expired,
          COALESCE(claims.claimed, 0) AS claimed, COALESCE(visits.count, 0) AS visits,
          COALESCE(rewards.count, 0) AS rewards,
          COALESCE(mint_status.items, '[]'::jsonb) AS mint_jobs,
          COALESCE(mint_failures.items, '[]'::jsonb) AS mint_failures
        FROM selected LEFT JOIN claims ON claims.merchant_id = selected.id
          LEFT JOIN visits ON visits.merchant_id = selected.id
          LEFT JOIN rewards ON rewards.merchant_id = selected.id
          LEFT JOIN mint_status ON mint_status.merchant_id = selected.id
          LEFT JOIN mint_failures ON mint_failures.merchant_id = selected.id
        ORDER BY selected.name, selected.id`);
      return { merchants: result.rows.map(row => ({
        id: row.id, name: row.name, status: row.status,
        claims: { active: row.active, expired: row.expired, claimed: row.claimed },
        visits: row.visits, rewards: row.rewards,
        mintJobs: row.mint_jobs, mintFailures: row.mint_failures,
      })) };
    });
  }

  async listCampaignDrafts(accountId: string): Promise<AdminCampaignDraft[]> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const result = await client.query<{
        id: string; merchant_id: string; merchant_name: string; title: string;
        starts_at: Date; ends_at: Date; enrollment_capacity: number; reward_goals: AdminRewardGoal[];
      }>(`SELECT campaign.id, campaign.merchant_id, merchant.name AS merchant_name,
          campaign.title, campaign.starts_at, campaign.ends_at, campaign.enrollment_capacity,
          COALESCE(jsonb_agg(jsonb_build_object('targetVisitCount', goal.target_visit_count,
            'displayName', goal.display_name) ORDER BY goal.target_visit_count)
            FILTER (WHERE goal.campaign_id IS NOT NULL), '[]'::jsonb) AS reward_goals
        FROM campaigns AS campaign
        JOIN merchants AS merchant ON merchant.id = campaign.merchant_id
        LEFT JOIN campaign_goals AS goal ON goal.campaign_id = campaign.id
        WHERE campaign.status = 'DRAFT' AND NOT campaign.is_public AND NOT merchant.is_demo
        GROUP BY campaign.id, merchant.id
        ORDER BY campaign.created_at DESC, campaign.id LIMIT 100`);
      return result.rows.map(row => ({
        id: row.id, merchantId: row.merchant_id, merchantName: row.merchant_name,
        title: row.title, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(),
        enrollmentCapacity: row.enrollment_capacity, rewardGoals: row.reward_goals,
        status: 'DRAFT', public: false,
      }));
    });
  }

  async createCampaignDraft(accountId: string, raw: AdminCampaignDraftInput): Promise<AdminCampaignDraft> {
    const input = validateCampaignDraft(raw);
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const merchantRow = await client.query<{ name: string }>(
        `SELECT name FROM merchants WHERE id = $1 AND NOT is_demo FOR UPDATE`, [input.merchantId],
      );
      if (!merchantRow.rows[0]) throw new AdminError('ADMIN_MERCHANT_NOT_FOUND');
      const id = randomUUID();
      await client.query(
        `INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
         VALUES ($1, $2, $3, $4, $5, 'DRAFT', false, $6)`,
        [id, input.merchantId, input.title, input.startsAt, input.endsAt, input.enrollmentCapacity],
      );
      await client.query(
        `INSERT INTO campaign_goals(campaign_id, target_visit_count, display_name)
         VALUES ($1, 1, $2), ($1, 3, $3), ($1, 5, $4)`,
        [id, ...input.rewardGoals.map(goal => goal.displayName)],
      );
      const draft: AdminCampaignDraft = { ...input, id, merchantName: merchantRow.rows[0].name,
        status: 'DRAFT', public: false };
      await client.query(
        `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, before_state, after_state)
         VALUES ($1, $2, $3, 'CAMPAIGN_DRAFT_CREATED', NULL, $4)`,
        [randomUUID(), accountId, input.merchantId, JSON.stringify(draft)],
      );
      return draft;
    });
  }

  async listMerchantCoupons(accountId: string, merchantId: string): Promise<AdminCoupon[]> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const merchantRow = await client.query('SELECT 1 FROM merchants WHERE id = $1 AND NOT is_demo', [merchantId]);
      if (!merchantRow.rowCount) throw new AdminError('ADMIN_MERCHANT_NOT_FOUND');
      const result = await client.query<{
        id: string; milestone: number; title: string; status: AdminCoupon['status']; customer_account_id: string;
        issued_at: Date; expires_at: Date; redeemed_at: Date | null; void_reason: string | null; expired: boolean;
      }>(
        `SELECT id, milestone, title, status, customer_account_id, issued_at, expires_at, redeemed_at, void_reason,
                expires_at <= now() AS expired
         FROM badge_coupons WHERE merchant_id = $1
         ORDER BY issued_at DESC, id LIMIT 100`, [merchantId],
      );
      return result.rows.map(row => ({
        couponId: row.id, milestone: row.milestone, title: row.title, status: row.status,
        expired: row.status === 'ISSUED' && row.expired,
        issuedAt: row.issued_at.toISOString(), expiresAt: row.expires_at.toISOString(),
        redeemedAt: row.redeemed_at ? row.redeemed_at.toISOString() : null, voidReason: row.void_reason,
        customerLabel: maskedCustomerLabel(this.labelSecret, merchantId, row.customer_account_id),
      }));
    });
  }

  // 미사용 쿠폰만 사유와 함께 무효로 한다. 사용한 쿠폰은 건드리지 않고, 이미 무효면 저장된 결과를 그대로 돌려준다.
  async voidCoupon(accountId: string, couponId: string, input: { reason: unknown; note?: unknown }): Promise<AdminVoidedCoupon> {
    if (!isCouponVoidReason(input.reason)) throw new AdminError('ADMIN_INVALID_INPUT');
    const reason = input.reason;
    const note = normalizeReversalNote(input.note);
    if (!note.ok) throw new AdminError('ADMIN_INVALID_INPUT');
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(couponId)) {
        throw new AdminError('ADMIN_COUPON_NOT_FOUND');
      }
      // 잠금 순서는 쿠폰 → 혜택이다(방문 취소의 재계산 무효화와 같다).
      const coupon = (await client.query<{
        id: string; merchant_id: string; offer_id: string; milestone: number; title: string;
        status: 'ISSUED' | 'REDEEMED' | 'VOIDED'; void_reason: string | null; voided_at: Date | null;
      }>(
        `SELECT coupon.id, coupon.merchant_id, coupon.offer_id, coupon.milestone, coupon.title, coupon.status,
                coupon.void_reason, coupon.voided_at
         FROM badge_coupons AS coupon JOIN merchants AS merchant ON merchant.id = coupon.merchant_id
         WHERE coupon.id = $1 AND NOT merchant.is_demo
         FOR UPDATE OF coupon`, [couponId],
      )).rows[0];
      if (!coupon) throw new AdminError('ADMIN_COUPON_NOT_FOUND');
      // 관리자 사유로 이미 무효인 쿠폰은 저장된 결과를 그대로 돌려준다(끝 상태).
      if (coupon.status === 'VOIDED' && coupon.void_reason !== 'VISIT_CANCELED') {
        return { coupon: { couponId: coupon.id, status: 'VOIDED', voidReason: coupon.void_reason!,
          voidedAt: coupon.voided_at!.toISOString() }, replayed: true };
      }
      // 방문 취소로 무효가 된 쿠폰(되살릴 수 있는 무효)을 관리자가 무효로 하면 끝 상태로 바꾼다: 사유·메모·처리자를 관리자 것으로
      // 덮어 되살릴 수 없게 하고 감사 기록을 남긴다. 발급 수는 방문 취소가 이미 돌려줬으므로 다시 줄이지 않는다.
      // 원래 방문 취소 연결(void_visit_event_id)은 추적을 위해 그대로 둔다.
      if (coupon.status === 'VOIDED') {
        const finalized = (await client.query<{ voided_at: Date }>(
          `UPDATE badge_coupons
           SET void_reason = $2, void_note = $3, voided_at = now(), voided_by_account_id = $4
           WHERE id = $1 AND status = 'VOIDED' AND void_reason = 'VISIT_CANCELED' RETURNING voided_at`,
          [coupon.id, reason, note.note, accountId],
        )).rows[0]!;
        const summary = { couponId: coupon.id, milestone: coupon.milestone, title: coupon.title };
        await client.query(
          `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, before_state, after_state)
           VALUES ($1, $2, $3, 'COUPON_VOIDED', $4, $5)`,
          [randomUUID(), accountId, coupon.merchant_id,
            JSON.stringify({ ...summary, status: 'VOIDED', reason: 'VISIT_CANCELED' }),
            JSON.stringify({ ...summary, status: 'VOIDED', reason, note: note.note })],
        );
        return { coupon: { couponId: coupon.id, status: 'VOIDED', voidReason: reason,
          voidedAt: finalized.voided_at.toISOString() }, replayed: false };
      }
      if (coupon.status !== 'ISSUED') throw new AdminError('ADMIN_COUPON_NOT_VOIDABLE');
      const voided = (await client.query<{ voided_at: Date }>(
        `UPDATE badge_coupons
         SET status = 'VOIDED', void_reason = $2, void_note = $3, voided_at = now(), voided_by_account_id = $4
         WHERE id = $1 AND status = 'ISSUED' RETURNING voided_at`,
        [coupon.id, reason, note.note, accountId],
      )).rows[0]!;
      // 쓰지 않은 쿠폰이 점주가 동의한 발급 상한을 계속 차지하지 않게 한다.
      await client.query(
        'UPDATE badge_reward_offers SET issued_count = issued_count - 1 WHERE id = $1 AND issued_count > 0',
        [coupon.offer_id],
      );
      // 감사 기록에는 고객 식별자를 넣지 않는다.
      const summary = { couponId: coupon.id, milestone: coupon.milestone, title: coupon.title };
      await client.query(
        `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, before_state, after_state)
         VALUES ($1, $2, $3, 'COUPON_VOIDED', $4, $5)`,
        [randomUUID(), accountId, coupon.merchant_id, JSON.stringify({ ...summary, status: 'ISSUED' }),
          JSON.stringify({ ...summary, status: 'VOIDED', reason, note: note.note })],
      );
      return { coupon: { couponId: coupon.id, status: 'VOIDED', voidReason: reason,
        voidedAt: voided.voided_at.toISOString() }, replayed: false };
    });
  }

  async createMerchant(accountId: string, raw: MerchantInput): Promise<AdminMerchant> {
    const input = validate(raw);
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const row = (await client.query<MerchantRow>(
        `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, menu_items, business_hours, status, is_demo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PAUSED', false) RETURNING ${columns}`,
        [randomUUID(), input.name, input.story, input.roadAddress, input.minimumSpendWon,
          JSON.stringify(input.menuItems ?? []), input.businessHours ?? ''],
      )).rows[0]!;
      const created = merchant(row);
      await this.audit(client, accountId, created.id, 'MERCHANT_CREATED', null, created);
      return created;
    });
  }

  async updateMerchant(accountId: string, id: string, expectedVersion: number, raw: MerchantInput): Promise<AdminMerchant> {
    const input = validate(raw);
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const before = await this.lockMerchant(client, id, expectedVersion);
      const row = (await client.query<MerchantRow>(
        `UPDATE merchants SET name = $2, story = $3, road_address = $4,
         minimum_spend_won = $5, menu_items = COALESCE($6::jsonb, menu_items),
         business_hours = COALESCE($7::text, business_hours), version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING ${columns}`,
        [id, input.name, input.story, input.roadAddress, input.minimumSpendWon,
          input.menuItems === undefined ? null : JSON.stringify(input.menuItems), input.businessHours ?? null],
      )).rows[0]!;
      const updated = merchant(row);
      await this.audit(client, accountId, id, 'MERCHANT_UPDATED', before, updated);
      return updated;
    });
  }

  async hideMerchant(accountId: string, id: string, expectedVersion: number): Promise<AdminMerchant> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const before = await this.lockMerchant(client, id, expectedVersion);
      const pending = await client.query(
        `SELECT 1 FROM claim_slots
         WHERE merchant_id = $1 AND status = 'ISSUED' AND expires_at > now()
         LIMIT 1`, [id],
      );
      if (pending.rowCount) throw new AdminError('ADMIN_PENDING_CLAIMS');
      const row = (await client.query<MerchantRow>(
        `UPDATE merchants SET status = 'PAUSED', version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING ${columns}`, [id],
      )).rows[0]!;
      await client.query(
        `UPDATE campaigns SET status = 'PAUSED', is_public = false, updated_at = now()
         WHERE merchant_id = $1 AND status = 'ACTIVE'`, [id],
      );
      // 숨긴 점포의 보상 혜택은 더 발급하지 않는다. 이미 연 쿠폰은 그대로 남는다.
      await client.query(
        `UPDATE badge_reward_offers SET status = 'PAUSED'
         WHERE merchant_id = $1 AND status = 'ACTIVE'`, [id],
      );
      const hidden = merchant(row);
      await this.audit(client, accountId, id, 'MERCHANT_HIDDEN', before, hidden);
      return hidden;
    });
  }

  // 비공개 점포를 공개한다. 메뉴·영업시간·주소가 채워져 있고 가게 이름·사진 사용 동의서 참조 번호가 있어야 한다.
  // 숨김 때 멈춘 캠페인·혜택은 되살리지 않는다(캠페인은 따로 공개하고 혜택은 새 동의로 새로 만든다).
  async publishMerchant(accountId: string, id: string, expectedVersion: number, rawReference: unknown): Promise<AdminMerchant> {
    const reference = normalizeDocumentReference(rawReference);
    if (!reference) throw new AdminError('ADMIN_DOCUMENT_REF_INVALID');
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const before = await this.lockMerchant(client, id, expectedVersion);
      if (before.status === 'ACTIVE') throw new AdminError('ADMIN_MERCHANT_ALREADY_ACTIVE');
      if (missingPublishRequirements({ menuItemCount: before.menuItems.length, businessHours: before.businessHours,
        roadAddress: before.roadAddress }).length) {
        throw new AdminError('ADMIN_MERCHANT_NOT_READY');
      }
      const row = (await client.query<MerchantRow>(
        `UPDATE merchants SET status = 'ACTIVE', consent_document_ref = $2, published_at = now(),
         version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING ${columns}`, [id, reference],
      )).rows[0]!;
      const published = merchant(row);
      await this.audit(client, accountId, id, 'MERCHANT_PUBLISHED', before, published);
      return published;
    });
  }

  async listOwners(accountId: string, merchantId: string): Promise<AdminOwner[]> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const found = await client.query('SELECT 1 FROM merchants WHERE id = $1 AND NOT is_demo', [merchantId]);
      if (!found.rowCount) throw new AdminError('ADMIN_MERCHANT_NOT_FOUND');
      const result = await client.query<{ account_id: string; granted_at: Date }>(
        `SELECT account_id, granted_at FROM merchant_members
         WHERE merchant_id = $1 AND role = 'OWNER' AND status = 'ACTIVE' ORDER BY granted_at, account_id`, [merchantId],
      );
      return result.rows.map(row => ({ accountId: row.account_id, role: 'OWNER', grantedAt: row.granted_at.toISOString() }));
    });
  }

  // 사업자등록증 원본과 점포 전화 확인을 마친 ACTIVE STAFF를 OWNER로 올린다. 확인 기록의 참조 번호만 남긴다.
  // 잠금 순서: 두 계정 advisory(정렬) → 관리자 행 → 점포 행 → 멤버 행. 점포당 OWNER 2명 상한은 점포 행 잠금 뒤에 센다.
  async promoteOwner(accountId: string, merchantId: string, targetAccountId: string,
    rawReference: unknown): Promise<{ accountId: string; role: 'OWNER' }> {
    if (targetAccountId === accountId) throw new AdminError('ADMIN_SELF_ROLE_CHANGE');
    const reference = normalizeDocumentReference(rawReference);
    if (!reference) throw new AdminError('ADMIN_DOCUMENT_REF_INVALID');
    if (!validAccountId(targetAccountId)) throw new AdminError('ADMIN_MEMBER_NOT_FOUND');
    return this.transaction(async client => {
      await this.lockMemberChange(client, accountId, targetAccountId);
      const row = await this.lockMerchantRow(client, merchantId);
      if (row.status !== 'ACTIVE') throw new AdminError('ADMIN_MERCHANT_NOT_ACTIVE');
      const member = (await client.query<{ role: 'OWNER' | 'STAFF'; status: 'ACTIVE' | 'REVOKED' }>(
        `SELECT role, status FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 FOR UPDATE`,
        [merchantId, targetAccountId],
      )).rows[0];
      if (!member || member.status !== 'ACTIVE') throw new AdminError('ADMIN_MEMBER_NOT_FOUND');
      if (member.role === 'OWNER') throw new AdminError('ADMIN_ALREADY_OWNER');
      const owners = (await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM merchant_members
         WHERE merchant_id = $1 AND role = 'OWNER' AND status = 'ACTIVE'`, [merchantId],
      )).rows[0]!.count;
      if (owners >= maxActiveOwnersPerMerchant) throw new AdminError('ADMIN_OWNER_LIMIT');
      await client.query(
        `UPDATE merchant_members SET role = 'OWNER', updated_at = now()
         WHERE merchant_id = $1 AND account_id = $2 AND role = 'STAFF' AND status = 'ACTIVE'`,
        [merchantId, targetAccountId],
      );
      // 계정 식별자는 JSON에 넣지 않고 target_account_id 열에만 둔다(계정 삭제가 열 단위로 별칭 처리한다).
      await this.auditEvent(client, { actor: accountId, merchantId, action: 'MERCHANT_OWNER_GRANTED',
        target: targetAccountId, before: { role: 'STAFF' },
        after: { role: 'OWNER', verificationDocumentRef: reference } });
      return { accountId: targetAccountId, role: 'OWNER' };
    });
  }

  // ACTIVE OWNER를 STAFF로 내린다(직원 권한은 남는다. 완전히 빼려면 기존 직원 권한 회수를 쓴다). 숨긴 점포에서도 할 수 있다.
  async demoteOwner(accountId: string, merchantId: string, targetAccountId: string,
    input: { reason: unknown; verificationDocumentRef: unknown }): Promise<{ accountId: string; role: 'STAFF' }> {
    if (targetAccountId === accountId) throw new AdminError('ADMIN_SELF_ROLE_CHANGE');
    if (!isOwnerDemotionReason(input.reason)) throw new AdminError('ADMIN_INVALID_INPUT');
    const reason: OwnerDemotionReason = input.reason;
    const reference = normalizeDocumentReference(input.verificationDocumentRef);
    if (!reference) throw new AdminError('ADMIN_DOCUMENT_REF_INVALID');
    if (!validAccountId(targetAccountId)) throw new AdminError('ADMIN_MEMBER_NOT_FOUND');
    return this.transaction(async client => {
      await this.lockMemberChange(client, accountId, targetAccountId);
      await this.lockMerchantRow(client, merchantId);
      const demoted = await client.query(
        `UPDATE merchant_members SET role = 'STAFF', updated_at = now()
         WHERE merchant_id = $1 AND account_id = $2 AND role = 'OWNER' AND status = 'ACTIVE'`,
        [merchantId, targetAccountId],
      );
      if (demoted.rowCount !== 1) throw new AdminError('ADMIN_MEMBER_NOT_FOUND');
      await this.auditEvent(client, { actor: accountId, merchantId, action: 'MERCHANT_OWNER_REVOKED',
        target: targetAccountId, before: { role: 'OWNER' },
        after: { role: 'STAFF', reason, verificationDocumentRef: reference } });
      return { accountId: targetAccountId, role: 'STAFF' };
    });
  }

  async listRewardOffers(accountId: string): Promise<AdminRewardOffer[]> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const result = await client.query<OfferRow>(
        `${offerSelect} WHERE NOT merchant.is_demo ORDER BY offer.created_at DESC, offer.id LIMIT 100`,
      );
      return result.rows.map(offer);
    });
  }

  // 점주 동의 5항목(D-043)과 동의서 참조 번호가 있어야 활성 점포에 혜택을 만든다. 발급 상한은 필수다.
  async createRewardOffer(accountId: string, raw: AdminRewardOfferInput): Promise<AdminRewardOffer> {
    const input = validateRewardOffer(raw);
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const row = await this.lockMerchantRow(client, input.merchantId);
      if (row.status !== 'ACTIVE') throw new AdminError('ADMIN_MERCHANT_NOT_ACTIVE');
      // 상자 번호당 활성 혜택은 전체에서 하나다(0027 부분 유일 색인). 동시 경쟁은 색인이 막고 같은 코드로 알린다.
      const taken = await client.query(
        `SELECT 1 FROM badge_reward_offers WHERE milestone = $1 AND status = 'ACTIVE'`, [input.milestone],
      );
      if (taken.rowCount) throw new AdminError('ADMIN_OFFER_MILESTONE_TAKEN');
      const id = randomUUID();
      try {
        await client.query(
          `INSERT INTO badge_reward_offers (id, milestone, merchant_id, title, detail, valid_days, issuance_cap, status,
             consent_note, consent_document_ref, consent_checklist_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $9, $10)`,
          [id, input.milestone, input.merchantId, input.title, input.detail, input.validDays, input.issuanceCap,
            composeOfferConsentNote(input.consentDocumentRef), input.consentDocumentRef,
            ownerOfferConsentChecklistVersion],
        );
      } catch (error) {
        if (isUniqueViolation(error, 'badge_reward_offers_one_active_per_milestone')) {
          throw new AdminError('ADMIN_OFFER_MILESTONE_TAKEN');
        }
        throw error;
      }
      const created = offer((await client.query<OfferRow>(`${offerSelect} WHERE offer.id = $1`, [id])).rows[0]!);
      await this.auditEvent(client, { actor: accountId, merchantId: input.merchantId, action: 'REWARD_OFFER_CREATED',
        before: null, after: { ...created, consentChecklistVersion: ownerOfferConsentChecklistVersion,
          consent: { benefit: true, ownerPaysCost: true, validity: true, issuanceCap: true, duplicateUse: true } } });
      return created;
    });
  }

  // 혜택 발급을 멈춘다. 이미 발급한 쿠폰은 그대로 쓸 수 있다. 이미 멈췄으면 저장된 결과를 그대로 돌려준다.
  async pauseRewardOffer(accountId: string, offerId: string): Promise<{ offer: AdminRewardOffer; replayed: boolean }> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      if (!uuidPattern.test(offerId)) throw new AdminError('ADMIN_OFFER_NOT_FOUND');
      const found = (await client.query<{ merchant_id: string }>(
        `SELECT offer.merchant_id FROM badge_reward_offers AS offer
         JOIN merchants AS merchant ON merchant.id = offer.merchant_id
         WHERE offer.id = $1 AND NOT merchant.is_demo`, [offerId],
      )).rows[0];
      if (!found) throw new AdminError('ADMIN_OFFER_NOT_FOUND');
      // 잠금 순서는 점포 → 혜택이다(숨김·상자 열기와 같다).
      await this.lockMerchantRow(client, found.merchant_id);
      const current = (await client.query<OfferRow>(
        `${offerSelect} WHERE offer.id = $1 AND offer.merchant_id = $2 FOR UPDATE OF offer`, [offerId, found.merchant_id],
      )).rows[0];
      if (!current) throw new AdminError('ADMIN_OFFER_NOT_FOUND');
      if (current.status === 'PAUSED') return { offer: offer(current), replayed: true };
      await client.query(`UPDATE badge_reward_offers SET status = 'PAUSED' WHERE id = $1`, [offerId]);
      const paused = { ...offer(current), status: 'PAUSED' as const };
      await this.auditEvent(client, { actor: accountId, merchantId: found.merchant_id, action: 'REWARD_OFFER_PAUSED',
        before: { offerId, milestone: current.milestone, title: current.title, status: 'ACTIVE' },
        after: { offerId, milestone: current.milestone, title: current.title, status: 'PAUSED' } });
      return { offer: paused, replayed: false };
    });
  }

  // 초안이 아닌 실제 점포 캠페인(공개 중·중지·종료). 초안은 listCampaignDrafts가 따로 보여 준다.
  async listCampaigns(accountId: string): Promise<AdminCampaign[]> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const result = await client.query<CampaignRow>(
        `${campaignSelect} WHERE campaign.status <> 'DRAFT' AND NOT merchant.is_demo
         ORDER BY campaign.updated_at DESC, campaign.id LIMIT 100`,
      );
      return result.rows.map(campaign);
    });
  }

  // 초안 또는 중지된 캠페인을 공개한다. 점포가 활성이고 목표가 있으며 끝나지 않았어야 한다. 점포당 공개 캠페인은 하나다.
  async publishCampaign(accountId: string, campaignId: string): Promise<{ campaign: AdminCampaign; replayed: boolean }> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const { merchantRow, current } = await this.lockCampaign(client, campaignId);
      if (merchantRow.status !== 'ACTIVE') throw new AdminError('ADMIN_MERCHANT_NOT_ACTIVE');
      if (current.status === 'ACTIVE' && current.is_public) return { campaign: campaign(current), replayed: true };
      const facts = (await client.query<{ goals: number; open: boolean }>(
        `SELECT (SELECT count(*)::int FROM campaign_goals WHERE campaign_id = $1) AS goals,
                (SELECT ends_at > now() FROM campaigns WHERE id = $1) AS open`, [campaignId],
      )).rows[0]!;
      if (!['DRAFT', 'PAUSED', 'ACTIVE'].includes(current.status) || facts.goals < 1 || !facts.open) {
        throw new AdminError('ADMIN_CAMPAIGN_NOT_PUBLISHABLE');
      }
      const other = await client.query(
        `SELECT 1 FROM campaigns WHERE merchant_id = $1 AND status = 'ACTIVE' AND is_public AND id <> $2`,
        [current.merchant_id, campaignId],
      );
      if (other.rowCount) throw new AdminError('ADMIN_CAMPAIGN_ACTIVE_EXISTS');
      try {
        await client.query(
          `UPDATE campaigns SET status = 'ACTIVE', is_public = true, updated_at = now() WHERE id = $1`, [campaignId],
        );
      } catch (error) {
        if (isUniqueViolation(error, 'campaigns_one_active_public_per_merchant')) {
          throw new AdminError('ADMIN_CAMPAIGN_ACTIVE_EXISTS');
        }
        throw error;
      }
      const published = { ...campaign(current), status: 'ACTIVE' as const, public: true };
      await this.auditEvent(client, { actor: accountId, merchantId: current.merchant_id, action: 'CAMPAIGN_PUBLISHED',
        before: { campaignId, title: current.title, status: current.status, public: current.is_public },
        after: { campaignId, title: current.title, status: 'ACTIVE', public: true } });
      return { campaign: published, replayed: false };
    });
  }

  // 공개 중인 캠페인을 멈춘다(숨김과 같이 비공개로 돌린다). 숨긴 점포에서도 할 수 있다.
  async pauseCampaign(accountId: string, campaignId: string): Promise<{ campaign: AdminCampaign; replayed: boolean }> {
    return this.transaction(async client => {
      await this.requireAdmin(client, accountId);
      const { current } = await this.lockCampaign(client, campaignId);
      if (current.status === 'PAUSED') return { campaign: campaign(current), replayed: true };
      if (current.status !== 'ACTIVE') throw new AdminError('ADMIN_CAMPAIGN_NOT_PAUSABLE');
      await client.query(
        `UPDATE campaigns SET status = 'PAUSED', is_public = false, updated_at = now() WHERE id = $1`, [campaignId],
      );
      const paused = { ...campaign(current), status: 'PAUSED' as const, public: false };
      await this.auditEvent(client, { actor: accountId, merchantId: current.merchant_id, action: 'CAMPAIGN_PAUSED',
        before: { campaignId, title: current.title, status: current.status, public: current.is_public },
        after: { campaignId, title: current.title, status: 'PAUSED', public: false } });
      return { campaign: paused, replayed: false };
    });
  }

  // 캠페인의 점포를 잠금 없이 찾은 뒤 점포 → 캠페인 순서로 잠근다.
  private async lockCampaign(client: PoolClient, campaignId: string): Promise<{
    merchantRow: { status: 'ACTIVE' | 'PAUSED' }; current: CampaignRow;
  }> {
    if (typeof campaignId !== 'string' || !campaignId || campaignId.length > 200) {
      throw new AdminError('ADMIN_CAMPAIGN_NOT_FOUND');
    }
    const found = (await client.query<{ merchant_id: string }>(
      `SELECT campaign.merchant_id FROM campaigns AS campaign
       JOIN merchants AS merchant ON merchant.id = campaign.merchant_id
       WHERE campaign.id = $1 AND NOT merchant.is_demo`, [campaignId],
    )).rows[0];
    if (!found) throw new AdminError('ADMIN_CAMPAIGN_NOT_FOUND');
    const merchantRow = await this.lockMerchantRow(client, found.merchant_id);
    const current = (await client.query<CampaignRow>(
      `${campaignSelect} WHERE campaign.id = $1 AND campaign.merchant_id = $2 FOR UPDATE OF campaign`,
      [campaignId, found.merchant_id],
    )).rows[0];
    if (!current) throw new AdminError('ADMIN_CAMPAIGN_NOT_FOUND');
    return { merchantRow, current };
  }

  // 점주 변경은 관리자와 대상 계정의 advisory 잠금을 한 정렬 순서로 먼저 잡는다(계정 삭제 처리와 같은 규칙:
  // 두 관리자가 서로를 대상으로 해도 교착하지 않는다). 그 뒤 관리자 확인과 대상 계정 삭제 여부를 본다.
  private async lockMemberChange(client: PoolClient, accountId: string, targetAccountId: string): Promise<void> {
    await this.lifecycle.lockAllForDeletion(client, [accountId, targetAccountId]);
    await this.requireAdmin(client, accountId);
    try { await this.lifecycle.assertActive(client, targetAccountId); }
    catch (error) {
      if (error instanceof AccountLifecycleError) throw new AdminError('ADMIN_MEMBER_NOT_FOUND');
      throw error;
    }
  }

  private async lockMerchantRow(client: PoolClient, merchantId: string): Promise<{ status: 'ACTIVE' | 'PAUSED' }> {
    if (typeof merchantId !== 'string' || !merchantId || merchantId.length > 200) {
      throw new AdminError('ADMIN_MERCHANT_NOT_FOUND');
    }
    const row = (await client.query<{ status: 'ACTIVE' | 'PAUSED' }>(
      `SELECT status FROM merchants WHERE id = $1 AND NOT is_demo FOR UPDATE`, [merchantId],
    )).rows[0];
    if (!row) throw new AdminError('ADMIN_MERCHANT_NOT_FOUND');
    return row;
  }

  private async auditEvent(client: PoolClient, event: {
    actor: string; merchantId: string; action: string; target?: string; before: unknown; after: unknown;
  }): Promise<void> {
    await client.query(
      `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, before_state, after_state, target_account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), event.actor, event.merchantId, event.action,
        event.before === null ? null : JSON.stringify(event.before), JSON.stringify(event.after), event.target ?? null],
    );
  }

  private async lockMerchant(client: PoolClient, id: string, expectedVersion: number): Promise<AdminMerchant> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new AdminError('ADMIN_INVALID_INPUT');
    const row = (await client.query<MerchantRow>(
      `SELECT ${columns} FROM merchants WHERE id = $1 AND NOT is_demo FOR UPDATE`, [id],
    )).rows[0];
    if (!row) throw new AdminError('ADMIN_MERCHANT_NOT_FOUND');
    if (row.version !== expectedVersion) throw new AdminError('ADMIN_VERSION_CONFLICT');
    return merchant(row);
  }

  private async audit(client: PoolClient, actor: string, id: string, action: string,
    before: AdminMerchant | null, after: AdminMerchant): Promise<void> {
    await client.query(
      `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, before_state, after_state)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), actor, id, action, before ? JSON.stringify(before) : null, JSON.stringify(after)],
    );
  }

  private async auditRole(client: PoolClient, accountId: string, action: 'GRANT' | 'REVOKE'): Promise<void> {
    await client.query(
      `INSERT INTO platform_admin_role_audit(id, target_account_id, action)
       VALUES ($1, $2, $3)`, [randomUUID(), accountId, action],
    );
  }

  async grant(subject: string): Promise<void> {
    if (!subject.trim()) throw new AdminError('ADMIN_IDENTITY_NOT_FOUND');
    await this.transaction(async client => {
      const identity = await client.query<{ account_id: string }>(
        `SELECT account_id FROM auth_identities WHERE provider = 'google' AND subject = $1`, [subject],
      );
      const accountId = identity.rows[0]?.account_id;
      if (!accountId) throw new AdminError('ADMIN_IDENTITY_NOT_FOUND');
      await this.lifecycle.assertActive(client, accountId);
      const current = await client.query(
        `SELECT 1 FROM auth_identities WHERE provider = 'google' AND subject = $1 AND account_id = $2`,
        [subject, accountId],
      );
      if (current.rowCount !== 1) throw new AdminError('ADMIN_IDENTITY_NOT_FOUND');
      await client.query(
        `INSERT INTO platform_admins(account_id) VALUES ($1)
         ON CONFLICT (account_id) DO UPDATE SET granted_at = now(), revoked_at = NULL`, [accountId],
      );
      await this.auditRole(client, accountId, 'GRANT');
    });
  }

  async revoke(subject: string): Promise<void> {
    await this.transaction(async client => {
      const identity = await client.query<{ account_id: string }>(
        `SELECT account_id FROM auth_identities WHERE provider = 'google' AND subject = $1`, [subject],
      );
      const accountId = identity.rows[0]?.account_id;
      if (!accountId) throw new AdminError('ADMIN_IDENTITY_NOT_FOUND');
      await this.lifecycle.assertActive(client, accountId);
      const revoked = await client.query(
        `UPDATE platform_admins SET revoked_at = now()
         WHERE account_id = $1 AND revoked_at IS NULL`, [accountId],
      );
      if (revoked.rowCount) await this.auditRole(client, accountId, 'REVOKE');
    });
  }
}
