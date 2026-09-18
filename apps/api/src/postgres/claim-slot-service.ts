import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  ClaimSlotError,
  type ClaimSlotPreview,
  type ClaimSlotService,
  type IssuedClaimSlot,
  type RedeemedClaimSlot,
} from '../claim-slot-service.js';
import { MerchantAccessError } from '../merchant-access.js';

type ClaimSlotServiceOptions = {
  now: () => Date;
  nextToken: () => string;
  nextId: () => string;
  nextVisitEventId: () => string;
  nextEntitlementId: () => string;
  ttlMs: number;
  rewardClaimTtlMs: number;
  referenceHmacSecret: string;
};

type ClaimSlotServiceOverrides = Partial<Omit<ClaimSlotServiceOptions, 'referenceHmacSecret'>> &
  Pick<ClaimSlotServiceOptions, 'referenceHmacSecret'>;

type ClaimSlotRow = {
  id: string;
  merchant_id: string;
  status: 'ISSUED' | 'CLAIMED' | 'EXPIRED' | 'REVOKED';
};

type ClaimSlotPreviewRow = {
  id: string;
  merchant_id: string;
  expires_at: Date;
};

type AccessAndDuplicateRow = {
  authorized: boolean;
  duplicate: boolean;
};

type IssuedClaimSlotRow = {
  id: string;
  token_version: number;
};

type CampaignRow = {
  id: string;
};

type VisitEventRow = {
  id: string;
  business_date: string;
  progress_counted: boolean;
};

type ProgressCountRow = {
  progress_visit_count: number;
};

type RewardGoalRow = {
  target_visit_count: 1 | 3 | 5;
};

type RewardEntitlementRow = {
  id: string;
  target_visit_count: 1 | 3 | 5;
  claim_expires_at: Date;
};

const defaultOptions: ClaimSlotServiceOptions = {
  now: () => new Date(),
  nextToken: () => randomBytes(32).toString('base64url'),
  nextId: () => randomUUID(),
  nextVisitEventId: () => randomUUID(),
  nextEntitlementId: () => randomUUID(),
  ttlMs: 15 * 60 * 1000,
  rewardClaimTtlMs: 90 * 24 * 60 * 60 * 1000,
  referenceHmacSecret: '',
};

export class PostgresClaimSlotService implements ClaimSlotService {
  constructor(
    private readonly pool: Pool,
    options: ClaimSlotServiceOverrides,
  ) {
    this.options = { ...defaultOptions, ...options };
    if (!Number.isSafeInteger(this.options.ttlMs) || this.options.ttlMs <= 0) {
      throw new Error('claim slot ttlMs must be a positive safe integer');
    }
    if (
      !Number.isSafeInteger(this.options.rewardClaimTtlMs) ||
      this.options.rewardClaimTtlMs <= 0
    ) {
      throw new Error('claim slot rewardClaimTtlMs must be a positive safe integer');
    }
    if (Buffer.byteLength(this.options.referenceHmacSecret, 'utf8') < 32) {
      throw new Error('claim slot referenceHmacSecret must be at least 32 bytes');
    }
  }

  private readonly options: ClaimSlotServiceOptions;

  async issue(input: {
    merchantId: string;
    customerAccountId: string;
    merchantReference: string;
    createdByAccountId: string;
  }): Promise<IssuedClaimSlot> {
    const referenceHash = hashMerchantReference(
      this.options.referenceHmacSecret,
      input.merchantId,
      input.merchantReference,
    );
    const access = await this.pool.query<AccessAndDuplicateRow>(
      `SELECT
         EXISTS (
           SELECT 1
           FROM merchant_members
           WHERE merchant_id = $1
             AND account_id = $2
             AND status = 'ACTIVE'
         ) AS authorized,
         EXISTS (
           SELECT 1
           FROM claim_slots
           WHERE merchant_id = $1
             AND customer_account_id = $3
             AND merchant_reference_hash = $4
         ) AS duplicate`,
      [input.merchantId, input.createdByAccountId, input.customerAccountId, referenceHash],
    );
    if (!access.rows[0]?.authorized) {
      throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
    }
    if (access.rows[0].duplicate) {
      throw new ClaimSlotError('CLAIM_SLOT_ALREADY_EXISTS');
    }

    const issuedAt = this.options.now();
    const expiresAt = new Date(issuedAt.getTime() + this.options.ttlMs);
    const token = this.options.nextToken();
    const claimSlotId = this.options.nextId();
    try {
      const inserted = await this.pool.query<IssuedClaimSlotRow>(
        `INSERT INTO claim_slots (
           id,
           merchant_id,
           customer_account_id,
           merchant_reference_hash,
           created_by_account_id,
           token_hash,
           status,
           expires_at,
           created_at,
           updated_at
         )
         SELECT $1, $2, $3, $4, $5, $6, 'ISSUED', $7, $8, $8
         FROM merchant_members
         WHERE merchant_id = $2
           AND account_id = $5
           AND status = 'ACTIVE'
         RETURNING id, token_version`,
        [
          claimSlotId,
          input.merchantId,
          input.customerAccountId,
          referenceHash,
          input.createdByAccountId,
          hashValue(token),
          expiresAt,
          issuedAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      }
    } catch (error) {
      if (isPostgresConstraint(error, 'claim_slots_unique_reference')) {
        throw new ClaimSlotError('CLAIM_SLOT_ALREADY_EXISTS');
      }
      if (isPostgresConstraint(error, 'claim_slots_unique_token')) {
        throw new ClaimSlotError('CLAIM_TOKEN_UNAVAILABLE');
      }
      throw error;
    }

    return {
      claimSlotId,
      token,
      tokenVersion: 1,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async reissue(input: {
    merchantId: string;
    claimSlotId: string;
    expectedTokenVersion: number;
    requestedByAccountId: string;
  }): Promise<IssuedClaimSlot> {
    const requestedAt = this.options.now();
    const expiresAt = new Date(requestedAt.getTime() + this.options.ttlMs);
    const token = this.options.nextToken();
    let updated;
    try {
      updated = await this.pool.query<IssuedClaimSlotRow>(
        `UPDATE claim_slots AS slot
         SET token_hash = $1,
             token_version = token_version + 1,
             expires_at = $2,
             updated_at = $3
         WHERE slot.id = $4
           AND slot.merchant_id = $5
           AND slot.status = 'ISSUED'
           AND slot.token_version = $7
           AND EXISTS (
             SELECT 1
             FROM merchant_members AS member
             WHERE member.merchant_id = slot.merchant_id
               AND member.account_id = $6
               AND member.status = 'ACTIVE'
           )
         RETURNING slot.id, slot.token_version`,
        [
          hashValue(token),
          expiresAt,
          requestedAt,
          input.claimSlotId,
          input.merchantId,
          input.requestedByAccountId,
          input.expectedTokenVersion,
        ],
      );
    } catch (error) {
      if (isPostgresConstraint(error, 'claim_slots_unique_token')) {
        throw new ClaimSlotError('CLAIM_TOKEN_UNAVAILABLE');
      }
      throw error;
    }
    if (updated.rowCount !== 1) {
      const membership = await this.pool.query(
        `SELECT 1
         FROM merchant_members
         WHERE merchant_id = $1
           AND account_id = $2
           AND status = 'ACTIVE'`,
        [input.merchantId, input.requestedByAccountId],
      );
      if (membership.rowCount !== 1) {
        throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      }
      throw new ClaimSlotError('CLAIM_SLOT_NOT_REISSUABLE');
    }

    return {
      claimSlotId: input.claimSlotId,
      token,
      tokenVersion: updated.rows[0]!.token_version,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async preview(input: {
    accountId: string;
    token: string;
  }): Promise<ClaimSlotPreview> {
    const result = await this.pool.query<ClaimSlotPreviewRow>(
      `SELECT id, merchant_id, expires_at
       FROM claim_slots
       WHERE token_hash = $1
         AND customer_account_id = $2
         AND status = 'ISSUED'`,
      [hashValue(input.token), input.accountId],
    );
    const slot = result.rows[0];
    if (!slot) {
      throw new ClaimSlotError('CLAIM_TOKEN_UNAVAILABLE');
    }
    return {
      claimSlotId: slot.id,
      merchantId: slot.merchant_id,
      expiresAt: slot.expires_at.toISOString(),
      status: slot.expires_at.getTime() <= this.options.now().getTime() ? 'EXPIRED' : 'AVAILABLE',
    };
  }

  async redeem(input: {
    accountId: string;
    token: string;
  }): Promise<RedeemedClaimSlot> {
    const redeemedAt = this.options.now();
    const client = await this.pool.connect();
    let transactionActive = false;
    try {
      await client.query('BEGIN');
      transactionActive = true;
      const result = await client.query<ClaimSlotRow>(
        `UPDATE claim_slots
         SET status = CASE WHEN expires_at <= $3 THEN 'EXPIRED' ELSE 'CLAIMED' END,
             claimed_at = CASE WHEN expires_at <= $3 THEN NULL ELSE $3 END,
             updated_at = $3
         WHERE token_hash = $1
           AND customer_account_id = $2
           AND status = 'ISSUED'
         RETURNING id, merchant_id, status`,
        [hashValue(input.token), input.accountId, redeemedAt],
      );
      const slot = result.rows[0];
      if (!slot) {
        throw new ClaimSlotError('CLAIM_TOKEN_UNAVAILABLE');
      }
      if (slot.status === 'EXPIRED') {
        await client.query('COMMIT');
        transactionActive = false;
        throw new ClaimSlotError('CLAIM_TOKEN_EXPIRED');
      }
      if (slot.status !== 'CLAIMED') {
        throw new ClaimSlotError('CLAIM_TOKEN_UNAVAILABLE');
      }

      const campaign = await findActiveCampaign(client, slot.merchant_id, redeemedAt);
      if (!campaign) {
        throw new ClaimSlotError('CLAIM_CAMPAIGN_UNAVAILABLE');
      }

      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify([input.accountId, campaign.id]),
      ]);

      const visitEventId = this.options.nextVisitEventId();
      let visit = (
        await client.query<VisitEventRow>(
          `INSERT INTO visit_events (
             id,
             claim_slot_id,
             merchant_id,
             campaign_id,
             customer_account_id,
             occurred_at,
             business_date,
             verification_level,
             status,
             progress_counted,
             created_at,
             updated_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6,
             ($6::timestamptz AT TIME ZONE 'Asia/Seoul')::date,
             'MERCHANT_CONFIRMED', 'VALID', true, $6, $6
           )
           ON CONFLICT (customer_account_id, merchant_id, business_date)
             WHERE status = 'VALID' AND progress_counted
           DO NOTHING
           RETURNING id, business_date::text, progress_counted`,
          [
            visitEventId,
            slot.id,
            slot.merchant_id,
            campaign.id,
            input.accountId,
            redeemedAt,
          ],
        )
      ).rows[0];

      if (!visit) {
        visit = (
          await client.query<VisitEventRow>(
            `INSERT INTO visit_events (
               id,
               claim_slot_id,
               merchant_id,
               campaign_id,
               customer_account_id,
               occurred_at,
               business_date,
               verification_level,
               status,
               progress_counted,
               created_at,
               updated_at
             )
             VALUES (
               $1, $2, $3, $4, $5, $6,
               ($6::timestamptz AT TIME ZONE 'Asia/Seoul')::date,
               'MERCHANT_CONFIRMED', 'VALID', false, $6, $6
             )
             RETURNING id, business_date::text, progress_counted`,
            [
              visitEventId,
              slot.id,
              slot.merchant_id,
              campaign.id,
              input.accountId,
              redeemedAt,
            ],
          )
        ).rows[0]!;
      }

      const progress = (
        await client.query<ProgressCountRow>(
          `SELECT count(*)::integer AS progress_visit_count
           FROM visit_events
           WHERE customer_account_id = $1
             AND campaign_id = $2
             AND status = 'VALID'
             AND progress_counted`,
          [input.accountId, campaign.id],
        )
      ).rows[0]!;
      const rewardGoals = await client.query<RewardGoalRow>(
        `SELECT goal.target_visit_count
         FROM campaign_goals AS goal
         LEFT JOIN reward_entitlements AS entitlement
           ON entitlement.customer_account_id = $1
          AND entitlement.campaign_id = goal.campaign_id
          AND entitlement.target_visit_count = goal.target_visit_count
         WHERE goal.campaign_id = $2
           AND goal.target_visit_count <= $3
           AND entitlement.id IS NULL
         ORDER BY goal.target_visit_count`,
        [input.accountId, campaign.id, progress.progress_visit_count],
      );
      const claimExpiresAt = new Date(redeemedAt.getTime() + this.options.rewardClaimTtlMs);
      const grantedRewards: RedeemedClaimSlot['grantedRewards'][number][] = [];
      for (const goal of rewardGoals.rows) {
        const entitlement = (
          await client.query<RewardEntitlementRow>(
            `INSERT INTO reward_entitlements (
               id,
               customer_account_id,
               campaign_id,
               target_visit_count,
               source_visit_event_id,
               status,
               policy_version,
               earned_at,
               claim_expires_at,
               created_at,
               updated_at
             )
             VALUES ($1, $2, $3, $4, $5, 'GRANTED', 'VISIT_1_3_5_KST_DAILY_V1', $6, $7, $6, $6)
             ON CONFLICT ON CONSTRAINT reward_entitlements_unique_goal DO NOTHING
             RETURNING id, target_visit_count, claim_expires_at`,
            [
              this.options.nextEntitlementId(),
              input.accountId,
              campaign.id,
              goal.target_visit_count,
              visit.id,
              redeemedAt,
              claimExpiresAt,
            ],
          )
        ).rows[0];
        if (entitlement) {
          grantedRewards.push({
            entitlementId: entitlement.id,
            targetVisitCount: entitlement.target_visit_count,
            status: 'GRANTED',
            claimExpiresAt: entitlement.claim_expires_at.toISOString(),
          });
        }
      }

      await client.query('COMMIT');
      transactionActive = false;
      return {
        claimSlotId: slot.id,
        merchantId: slot.merchant_id,
        status: 'CLAIMED',
        visit: {
          visitEventId: visit.id,
          campaignId: campaign.id,
          businessDate: visit.business_date,
          verificationLevel: 'MERCHANT_CONFIRMED',
          progressCounted: visit.progress_counted,
          progressVisitCount: progress.progress_visit_count,
        },
        grantedRewards,
      };
    } catch (error) {
      if (transactionActive) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

async function findActiveCampaign(
  client: PoolClient,
  merchantId: string,
  redeemedAt: Date,
): Promise<CampaignRow | undefined> {
  const result = await client.query<CampaignRow>(
    `SELECT id
     FROM campaigns
     WHERE merchant_id = $1
       AND status = 'ACTIVE'
       AND is_public = true
       AND starts_at <= $2
       AND ends_at > $2
     ORDER BY id
     LIMIT 1`,
    [merchantId, redeemedAt],
  );
  return result.rows[0];
}

function hashValue(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function hashMerchantReference(
  secret: string,
  merchantId: string,
  merchantReference: string,
): Buffer {
  return createHmac('sha256', secret)
    .update(merchantId, 'utf8')
    .update('\0')
    .update(merchantReference, 'utf8')
    .digest();
}

function isPostgresConstraint(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === constraint
  );
}
