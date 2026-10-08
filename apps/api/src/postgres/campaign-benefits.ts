import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import type { BadgeCoupon } from '../badge-rewards.js';
import { benefitCosts, benefitEligibility, composeBenefitConsentNote, type BenefitPurpose, type BenefitVisit } from '../campaign-benefit-rules.js';
import {
  CampaignBenefitError, type CampaignBenefitInput, type CampaignBenefitService,
  type CampaignBenefitStatus, type CustomerCampaignBenefit,
} from '../campaign-benefits.js';
import { normalizeTimeWindows } from '../campaign-purpose-rules.js';
import {
  isCompleteOwnerOfferConsent, normalizeDocumentReference, ownerOfferConsentChecklistVersion,
} from '../store-go-live-rules.js';
import { MerchantAccessError } from '../merchant-access.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { countedVisitFilterSql, countedVisitFromSql } from './badge-rewards.js';
import { requireActiveMerchantMember } from './merchant-membership.js';

type BenefitRow = {
  id: string; campaign_id: string; merchant_id: string; merchant_name: string; title: string; detail: string;
  valid_days: number; unit_extra_cost_won: number; max_uses: number; issued_count: number;
  status: 'ACTIVE' | 'PAUSED'; campaign_status: string; is_public: boolean; starts_at: Date; ends_at: Date;
  purpose: BenefitPurpose['purpose'] | null; revisit_min_days: number | null; revisit_window_days: number | null;
  time_windows: unknown;
};
type CouponRow = {
  id: string; benefit_id: string; campaign_id: string; merchant_id: string; merchant_name: string; title: string; detail: string;
  status: 'ISSUED' | 'REDEEMED' | 'VOIDED'; issued_at: Date; usable_from: Date; expires_at: Date;
  redeemed_at: Date | null;
};
type StatusRow = BenefitRow & {
  issued: number; redeemed: number; usable: number; expired_unused: number; additional_issuable: number;
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const benefitSelect = `SELECT benefit.*, merchant.name AS merchant_name, campaign.status AS campaign_status,
  campaign.is_public, campaign.starts_at, campaign.ends_at, purpose.purpose,
  purpose.revisit_min_days, purpose.revisit_window_days, purpose.time_windows
  FROM campaign_benefits AS benefit
  JOIN campaigns AS campaign ON campaign.id = benefit.campaign_id
  JOIN merchants AS merchant ON merchant.id = benefit.merchant_id
  LEFT JOIN campaign_purposes AS purpose ON purpose.campaign_id = campaign.id`;
const couponSelect = `SELECT coupon.*, merchant.name AS merchant_name FROM campaign_benefit_coupons AS coupon
  JOIN merchants AS merchant ON merchant.id = coupon.merchant_id`;

function asCoupon(row: CouponRow): BadgeCoupon {
  if (row.status === 'VOIDED') throw new CampaignBenefitError('BENEFIT_NOT_ELIGIBLE');
  return { couponId: row.id, milestone: 3, merchantId: row.merchant_id, merchantName: row.merchant_name,
    title: row.title, detail: row.detail, status: row.status, issuedAt: row.issued_at.toISOString(),
    usableFrom: row.usable_from.toISOString(), expiresAt: row.expires_at.toISOString(),
    redeemedAt: row.redeemed_at?.toISOString() ?? null };
}

function purposeOf(row: BenefitRow): BenefitPurpose | null {
  if (!row.purpose) return null;
  const windows = row.purpose === 'OFF_PEAK' ? normalizeTimeWindows(row.time_windows) ?? null : null;
  return { purpose: row.purpose, revisitMinDays: row.revisit_min_days ?? 1,
    revisitWindowDays: row.revisit_window_days ?? 14, timeWindows: windows };
}

function campaignAvailable(row: BenefitRow, now: Date): boolean {
  return row.campaign_status === 'ACTIVE' && row.is_public && row.starts_at <= now && row.ends_at > now;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' &&
    'constraint' in error && error.constraint === constraint;
}

export class PostgresCampaignBenefitService implements CampaignBenefitService {
  private readonly now: () => Date;
  private readonly accountLifecycle: PostgresAccountLifecycle | undefined;

  constructor(private readonly pool: Pool, options: { now?: () => Date; accountLifecycle?: PostgresAccountLifecycle } = {}) {
    this.now = options.now ?? (() => new Date());
    this.accountLifecycle = options.accountLifecycle;
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await run(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new CampaignBenefitError('ACCOUNT_DELETED');
      throw error;
    } finally { client.release(); }
  }

  private async requireAdmin(client: PoolClient, accountId: string): Promise<void> {
    await this.accountLifecycle?.assertActive(client, accountId);
    const result = await client.query(
      `SELECT 1 FROM platform_admins AS admin JOIN auth_identities AS identity ON identity.account_id = admin.account_id
       WHERE admin.account_id = $1 AND admin.revoked_at IS NULL AND identity.provider = 'google'
       FOR UPDATE OF admin`, [accountId],
    );
    if (result.rowCount !== 1) throw new CampaignBenefitError('ADMIN_FORBIDDEN');
  }

  async createBenefit(input: CampaignBenefitInput): Promise<CampaignBenefitStatus> {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const detail = typeof input.detail === 'string' ? input.detail.trim() : '';
    const validDays = input.validDays;
    const unitExtraCostWon = input.unitExtraCostWon;
    const maxUses = input.maxUses;
    if (!title || title.length > 40 || typeof input.detail !== 'string' || detail.length > 120 ||
      !Number.isInteger(validDays) || (validDays as number) < 1 || (validDays as number) > 60 ||
      !Number.isInteger(unitExtraCostWon) || (unitExtraCostWon as number) < 1 || (unitExtraCostWon as number) > 1_000_000 ||
      !Number.isInteger(maxUses) || (maxUses as number) < 1 || (maxUses as number) > 10_000 ||
      !isCompleteOwnerOfferConsent(input.consent)) throw new CampaignBenefitError('ADMIN_INVALID_INPUT');
    const reference = normalizeDocumentReference(input.consentDocumentRef);
    if (!reference) throw new CampaignBenefitError('ADMIN_DOCUMENT_REF_INVALID');
    return this.transaction(async client => {
      await this.requireAdmin(client, input.adminAccountId);
      const campaign = (await client.query<{ merchant_id: string }>(
        'SELECT merchant_id FROM campaigns WHERE id = $1', [input.campaignId],
      )).rows[0];
      if (!campaign) throw new CampaignBenefitError('CAMPAIGN_NOT_FOUND');
      const merchant = (await client.query<{ status: string; is_demo: boolean }>(
        'SELECT status, is_demo FROM merchants WHERE id = $1 FOR SHARE', [campaign.merchant_id],
      )).rows[0];
      if (!merchant || merchant.is_demo) throw new CampaignBenefitError('CAMPAIGN_NOT_FOUND');
      if (merchant.status !== 'ACTIVE') throw new CampaignBenefitError('MERCHANT_NOT_ACTIVE');
      const id = randomUUID();
      try {
        await client.query(
          `INSERT INTO campaign_benefits(id,campaign_id,merchant_id,title,detail,valid_days,unit_extra_cost_won,
             max_uses,status,consent_document_ref,consent_checklist_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',$9,$10)`,
          [id, input.campaignId, campaign.merchant_id, title, detail, validDays, unitExtraCostWon,
            maxUses, reference, ownerOfferConsentChecklistVersion],
        );
      } catch (error) {
        if (isUniqueViolation(error, 'campaign_benefits_one_active_per_campaign')) {
          throw new CampaignBenefitError('BENEFIT_ALREADY_ACTIVE');
        }
        throw error;
      }
      await client.query(
        `INSERT INTO platform_admin_audit(id,actor_account_id,merchant_id,action,before_state,after_state)
         VALUES ($1,$2,$3,'CAMPAIGN_BENEFIT_CREATED',NULL,$4::jsonb)`,
        [randomUUID(), input.adminAccountId, campaign.merchant_id,
          JSON.stringify({ benefitId: id, campaignId: input.campaignId, title, validDays,
            unitExtraCostWon, maxUses, consentDocumentRef: reference,
            consentChecklistVersion: ownerOfferConsentChecklistVersion,
            consentNote: composeBenefitConsentNote(reference, unitExtraCostWon as number, maxUses as number) })],
      );
      return (await this.statusQuery(client, input.campaignId, campaign.merchant_id, id))!;
    });
  }

  async pauseBenefit(input: { adminAccountId: string; campaignId: string }): Promise<CampaignBenefitStatus> {
    return this.transaction(async client => {
      await this.requireAdmin(client, input.adminAccountId);
      const campaign = (await client.query<{ merchant_id: string }>(
        'SELECT merchant_id FROM campaigns WHERE id = $1', [input.campaignId],
      )).rows[0];
      if (!campaign) throw new CampaignBenefitError('CAMPAIGN_NOT_FOUND');
      await client.query('SELECT 1 FROM merchants WHERE id = $1 FOR SHARE', [campaign.merchant_id]);
      const benefit = (await client.query<{ id: string; status: string }>(
        `SELECT id,status FROM campaign_benefits WHERE campaign_id = $1
         ORDER BY (status = 'ACTIVE') DESC, created_at DESC LIMIT 1 FOR UPDATE`, [input.campaignId],
      )).rows[0];
      if (!benefit) throw new CampaignBenefitError('BENEFIT_NOT_FOUND');
      if (benefit.status === 'ACTIVE') {
        await client.query(`UPDATE campaign_benefits SET status = 'PAUSED' WHERE id = $1`, [benefit.id]);
        await client.query(
          `INSERT INTO platform_admin_audit(id,actor_account_id,merchant_id,action,before_state,after_state)
           VALUES ($1,$2,$3,'CAMPAIGN_BENEFIT_PAUSED',$4::jsonb,$5::jsonb)`,
          [randomUUID(), input.adminAccountId, campaign.merchant_id,
            JSON.stringify({ benefitId: benefit.id, status: 'ACTIVE' }),
            JSON.stringify({ benefitId: benefit.id, status: 'PAUSED' })],
        );
      }
      return (await this.statusQuery(client, input.campaignId, campaign.merchant_id, benefit.id))!;
    });
  }

  async getBenefitStatus(input: { accountId: string; campaignId: string; merchantId?: string }):
    Promise<{ benefit: CampaignBenefitStatus | null; benefits: CampaignBenefitStatus[] }> {
    return this.transaction(async client => {
      if (input.merchantId) {
        await this.accountLifecycle?.assertActive(client, input.accountId);
        try {
          const member = await requireActiveMerchantMember(client, input.merchantId, input.accountId);
          if (member.role !== 'OWNER') throw new CampaignBenefitError('OWNER_FORBIDDEN');
        } catch (error) {
          if (error instanceof MerchantAccessError) throw new CampaignBenefitError('OWNER_FORBIDDEN');
          throw error;
        }
      } else await this.requireAdmin(client, input.accountId);
      const campaign = (await client.query<{ merchant_id: string }>(
        `SELECT campaign.merchant_id FROM campaigns AS campaign JOIN merchants AS merchant
         ON merchant.id = campaign.merchant_id WHERE campaign.id = $1 AND NOT merchant.is_demo`, [input.campaignId],
      )).rows[0];
      if (!campaign || (input.merchantId && campaign.merchant_id !== input.merchantId))
        throw new CampaignBenefitError('CAMPAIGN_NOT_FOUND');
      const benefits = await this.statusRowsQuery(client, input.campaignId, campaign.merchant_id);
      return { benefit: benefits[0] ?? null, benefits };
    });
  }

  private async statusQuery(client: PoolClient, campaignId: string, merchantId: string, benefitId?: string): Promise<CampaignBenefitStatus | null> {
    return (await this.statusRowsQuery(client, campaignId, merchantId, benefitId))[0] ?? null;
  }

  private async statusRowsQuery(client: PoolClient, campaignId: string, merchantId: string,
    benefitId?: string): Promise<CampaignBenefitStatus[]> {
    const rows = (await client.query<StatusRow>(
      `SELECT benefit.*, merchant.name AS merchant_name,
         count(coupon.id) FILTER (WHERE coupon.status IN ('ISSUED','REDEEMED'))::int AS issued,
         count(coupon.id) FILTER (WHERE coupon.status = 'REDEEMED')::int AS redeemed,
         count(coupon.id) FILTER (WHERE coupon.status = 'ISSUED' AND coupon.expires_at > now())::int AS usable,
         count(coupon.id) FILTER (WHERE coupon.status = 'ISSUED' AND coupon.expires_at <= now())::int AS expired_unused,
         greatest(benefit.max_uses - benefit.issued_count,0)::int AS additional_issuable
       FROM campaign_benefits AS benefit JOIN merchants AS merchant ON merchant.id = benefit.merchant_id
       LEFT JOIN campaign_benefit_coupons AS coupon ON coupon.benefit_id = benefit.id
       WHERE benefit.campaign_id = $1 AND benefit.merchant_id = $2 AND ($3::uuid IS NULL OR benefit.id = $3)
       GROUP BY benefit.id, merchant.name
       ORDER BY (benefit.status = 'ACTIVE') DESC, benefit.created_at DESC`,
      [campaignId, merchantId, benefitId ?? null],
    )).rows;
    return rows.map(row => ({ id: row.id, campaignId: row.campaign_id, merchantId: row.merchant_id, title: row.title,
      detail: row.detail, status: row.status, validDays: row.valid_days, maxUses: row.max_uses,
      issuedCount: row.issued_count, unitExtraCostWon: row.unit_extra_cost_won, issued: row.issued,
      redeemed: row.redeemed, usable: row.usable, expiredUnused: row.expired_unused,
      additionalIssuable: row.additional_issuable,
      ...benefitCosts({ redeemed: row.redeemed, usable: row.usable,
        maxUses: row.max_uses, unitExtraCostWon: row.unit_extra_cost_won }) }));
  }

  private async visits(client: PoolClient, accountId: string, merchantId: string): Promise<BenefitVisit[]> {
    const result = await client.query<{ id: string; campaign_id: string; business_date: string; slot_created_at: Date; occurred_at: Date }>(
      `SELECT visit.id, visit.campaign_id, visit.business_date::text AS business_date,
         visit.occurred_at, slot.created_at AS slot_created_at
       ${countedVisitFromSql}
       WHERE visit.customer_account_id = $1 AND visit.merchant_id = $2 AND ${countedVisitFilterSql}
       ORDER BY visit.business_date, visit.occurred_at, visit.id`, [accountId, merchantId],
    );
    return result.rows.map(row => ({ id: row.id, campaignId: row.campaign_id,
      businessDate: row.business_date, slotCreatedAt: row.slot_created_at, occurredAt: row.occurred_at }));
  }

  async listBenefits(accountId: string): Promise<{ benefits: CustomerCampaignBenefit[] }> {
    return this.transaction(async client => {
      await this.accountLifecycle?.assertActive(client, accountId);
      const now = this.now();
      const offers = await client.query<BenefitRow>(
        `${benefitSelect} WHERE merchant.status = 'ACTIVE' AND benefit.status = 'ACTIVE'
         AND campaign.status = 'ACTIVE' AND campaign.is_public AND campaign.starts_at <= $1 AND campaign.ends_at > $1
         ORDER BY benefit.created_at DESC`, [now],
      );
      const owned = await client.query<CouponRow>(
        `${couponSelect} WHERE coupon.customer_account_id = $1 AND coupon.status <> 'VOIDED'`, [accountId],
      );
      const coupons = new Map(owned.rows.map(row => [row.campaign_id, row]));
      const visitCache = new Map<string, BenefitVisit[]>();
      const benefits: CustomerCampaignBenefit[] = [];
      for (const offer of offers.rows) {
        const coupon = coupons.get(offer.campaign_id);
        let eligible = Boolean(coupon);
        if (!eligible) {
          let visits = visitCache.get(offer.merchant_id);
          if (!visits) {
            visits = await this.visits(client, accountId, offer.merchant_id);
            visitCache.set(offer.merchant_id, visits);
          }
          eligible = Boolean(benefitEligibility(offer.campaign_id, purposeOf(offer), visits,
            { startsAt: offer.starts_at, endsAt: offer.ends_at }));
        }
        if (!eligible) continue;
        benefits.push({ benefitId: coupon?.benefit_id ?? offer.id, campaignId: offer.campaign_id, merchantId: offer.merchant_id,
          merchantName: offer.merchant_name, title: coupon?.title ?? offer.title, detail: coupon?.detail ?? offer.detail,
          state: coupon ? 'OWNED' : offer.issued_count >= offer.max_uses ? 'CAP_REACHED' : 'CLAIMABLE',
          ...(coupon ? { coupon: asCoupon(coupon) as BadgeCoupon & { usableFrom: string } } : {}) });
      }
      for (const coupon of owned.rows) {
        if (benefits.some(item => item.campaignId === coupon.campaign_id)) continue;
        const offer = (await client.query<BenefitRow>(
          `${benefitSelect} WHERE benefit.id = (SELECT benefit_id FROM campaign_benefit_coupons WHERE id = $1)`,
          [coupon.id],
        )).rows[0];
        if (offer) benefits.push({ benefitId: offer.id, campaignId: offer.campaign_id,
          merchantId: offer.merchant_id, merchantName: offer.merchant_name, title: offer.title,
          detail: offer.detail, state: 'OWNED', coupon: asCoupon(coupon) as BadgeCoupon & { usableFrom: string } });
      }
      return { benefits };
    });
  }

  async claimBenefit(input: { accountId: string; benefitId: string }): Promise<{ coupon: BadgeCoupon; replayed: boolean }> {
    if (!uuidPattern.test(input.benefitId)) throw new CampaignBenefitError('BENEFIT_NOT_FOUND');
    return this.transaction(async client => {
      await this.accountLifecycle?.assertActive(client, input.accountId);
      // The first read locates the lock key only. All mutable eligibility and capacity are checked again under locks.
      const located = (await client.query<{ campaign_id: string; merchant_id: string }>(
        'SELECT campaign_id,merchant_id FROM campaign_benefits WHERE id = $1', [input.benefitId],
      )).rows[0];
      if (!located) throw new CampaignBenefitError('BENEFIT_NOT_FOUND');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`campaign-benefit:${input.accountId}:${located.campaign_id}`]);
      const existing = (await client.query<CouponRow>(
        `${couponSelect} WHERE coupon.customer_account_id = $1 AND coupon.campaign_id = $2
         AND NOT (coupon.status = 'VOIDED' AND coupon.void_reason = 'VISIT_CANCELED') LIMIT 1`,
        [input.accountId, located.campaign_id],
      )).rows[0];
      if (existing) {
        if (existing.status === 'VOIDED') throw new CampaignBenefitError('BENEFIT_NOT_ELIGIBLE');
        return { coupon: asCoupon(existing), replayed: true };
      }
      const merchant = (await client.query<{ status: string }>(
        'SELECT status FROM merchants WHERE id = $1 FOR SHARE', [located.merchant_id],
      )).rows[0];
      if (!merchant || merchant.status !== 'ACTIVE') throw new CampaignBenefitError('MERCHANT_NOT_ACTIVE');
      const benefit = (await client.query<BenefitRow>(`${benefitSelect} WHERE benefit.id = $1`, [input.benefitId])).rows[0];
      if (!benefit) throw new CampaignBenefitError('BENEFIT_NOT_FOUND');
      if (benefit.status !== 'ACTIVE') throw new CampaignBenefitError('BENEFIT_PAUSED');
      const now = this.now();
      if (!campaignAvailable(benefit, now)) throw new CampaignBenefitError('CAMPAIGN_NOT_AVAILABLE');
      const eligible = benefitEligibility(benefit.campaign_id, purposeOf(benefit),
        await this.visits(client, input.accountId, benefit.merchant_id),
        { startsAt: benefit.starts_at, endsAt: benefit.ends_at });
      if (!eligible) throw new CampaignBenefitError('BENEFIT_NOT_ELIGIBLE');
      // Cancellation locks this visit FOR UPDATE. A cancel committed first removes eligibility;
      // a cancel waiting here voids the newly inserted coupon before it can be observed.
      const source = await client.query(
        `SELECT 1 FROM visit_events WHERE id = $1 AND status = 'VALID' AND progress_counted FOR SHARE`,
        [eligible.sourceVisitId],
      );
      if (!source.rowCount) throw new CampaignBenefitError('BENEFIT_NOT_ELIGIBLE');
      const reserved = await client.query(
        `UPDATE campaign_benefits SET issued_count = issued_count + 1
         WHERE id = $1 AND status = 'ACTIVE' AND issued_count < max_uses RETURNING id`, [input.benefitId],
      );
      if (!reserved.rowCount) {
        const state = (await client.query<{ status: string }>(
          'SELECT status FROM campaign_benefits WHERE id = $1', [input.benefitId],
        )).rows[0];
        throw new CampaignBenefitError(state?.status === 'PAUSED' ? 'BENEFIT_PAUSED' : 'CAP_REACHED');
      }
      const couponId = randomUUID();
      const usableFrom = eligible.usableFrom ?? now;
      const expiresAt = new Date(Math.max(now.getTime(), usableFrom.getTime()) + benefit.valid_days * 86_400_000);
      await client.query(
        `INSERT INTO campaign_benefit_coupons(id,benefit_id,campaign_id,merchant_id,customer_account_id,title,detail,
           unit_extra_cost_won,source_visit_event_id,status,issued_at,usable_from,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ISSUED',$10,$11,$12)`,
        [couponId, benefit.id, benefit.campaign_id, benefit.merchant_id, input.accountId,
          benefit.title, benefit.detail, benefit.unit_extra_cost_won, eligible.sourceVisitId, now, usableFrom, expiresAt],
      );
      return { coupon: { couponId, milestone: 3, merchantId: benefit.merchant_id,
        merchantName: benefit.merchant_name, title: benefit.title, detail: benefit.detail,
        status: 'ISSUED', issuedAt: now.toISOString(), usableFrom: usableFrom.toISOString(),
        expiresAt: expiresAt.toISOString(), redeemedAt: null }, replayed: false };
    });
  }
}
