import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  ClaimSlotError,
  type ClaimSlotPreview,
  type ClaimSlotService,
  type ExistingClaimSlot,
  type IssuedClaimSlot,
  type RedeemedClaimSlot,
} from '../claim-slot-service.js';
import { MerchantAccessError } from '../merchant-access.js';
import { isStaffAccountClaim, staffProgressExcludedReason } from '../reversal-rules.js';
import {
  SHOWCASE_MAX_BACKDATE_DAYS,
  earliestShowcaseVisitDate,
  pickShowcaseVisitDate,
} from '../showcase/all-access.js';
import { isPermittedShowcaseDatabaseName } from '../showcase/local-seed.js';
import { grantReachedGoals } from './visit-rewards.js';
import { hashCustomerIdentityToken, isCustomerIdentityToken } from './customer-identity.js';
import { requireActiveMerchantMember } from './merchant-membership.js';
import {
  AccountLifecycleError,
  type PostgresAccountLifecycle,
} from './account-lifecycle.js';

// 시연 테스트 방문 발급자(#295). FK 때문에 merchant_members 행이 필요하지만 REVOKED로 둬 점원 권한은 절대 주지 않는다
// (postgres/merchant-access.ts의 모든 권한 조회가 status='ACTIVE'만 보므로 REVOKED는 아무 권한도 못 연다).
const SHOWCASE_TEST_VISIT_ISSUER = 'showcase-test-visit-issuer';

// hosted(masscom_showcase)와 local(masscom_showcase_test·_ci_*_test) 모두에서 열리는 시연 전용 기능이다(#295, access-requests.ts·grant-staff.ts와 같은 판정).
function isShowcaseDatabaseName(name: string): boolean {
  return name === 'masscom_showcase' || isPermittedShowcaseDatabaseName(name);
}

type ClaimSlotServiceOptions = {
  now: () => Date;
  nextToken: () => string;
  nextId: () => string;
  nextVisitEventId: () => string;
  nextEntitlementId: () => string;
  ttlMs: number;
  rewardClaimTtlMs: number;
  referenceHmacSecret: string;
  accountLifecycle?: PostgresAccountLifecycle;
  // 시연 전부 체험(#333): server.ts가 showcaseDeployment일 때만 true로 넘긴다. 켜져 있어도 슬롯 발급자가
  // SHOWCASE_TEST_VISIT_ISSUER인 방문만 서로 다른 날로 옮겨 세고, 운영(기본 false)은 이 분기를 아예 타지 않는다.
  showcaseTestVisitBackdating: boolean;
};

type ClaimSlotServiceOverrides = Partial<Omit<ClaimSlotServiceOptions, 'referenceHmacSecret'>> &
  Pick<ClaimSlotServiceOptions, 'referenceHmacSecret'>;

type ClaimSlotRow = {
  id: string;
  merchant_id: string;
  status: 'ISSUED' | 'CLAIMED' | 'EXPIRED' | 'REVOKED';
  created_by_account_id: string;
};

type ClaimSlotPreviewRow = {
  id: string;
  merchant_id: string;
  merchant_name: string;
  campaign_id: string;
  campaign_title: string;
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
  title: string;
  merchant_name: string;
  merchant_is_demo: boolean;
};

type VisitEventRow = {
  id: string;
  business_date: string;
  progress_counted: boolean;
};

type ProgressCountRow = {
  progress_visit_count: number;
};

type RewardEntitlementRow = {
  id: string;
  target_visit_count: 1 | 3 | 5;
  claim_expires_at: Date;
};

type RedeemedReplayRow = {
  claim_slot_id: string;
  merchant_id: string;
  merchant_name: string;
  campaign_id: string;
  campaign_title: string;
  visit_event_id: string;
  business_date: string;
  progress_counted: boolean;
  progress_visit_count: number;
  staff_account_claim: boolean;
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
  showcaseTestVisitBackdating: false,
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
  }): Promise<IssuedClaimSlot>;
  async issue(input: {
    merchantId: string;
    customerIdentityToken: string;
    merchantReference: string;
    createdByAccountId: string;
  }): Promise<IssuedClaimSlot | ExistingClaimSlot>;
  async issue(input: {
    merchantId: string;
    customerAccountId?: string;
    customerIdentityToken?: string;
    merchantReference: string;
    createdByAccountId: string;
  }): Promise<IssuedClaimSlot | ExistingClaimSlot> {
    const referenceHash = hashMerchantReference(
      this.options.referenceHmacSecret,
      input.merchantId,
      input.merchantReference,
    );
    const issuedAt = this.options.now();
    const expiresAt = new Date(issuedAt.getTime() + this.options.ttlMs);
    let issued: IssuedClaimSlot | ExistingClaimSlot | undefined;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let customerAccountId = input.customerAccountId;
      let identityHash: Buffer | undefined;
      if (input.customerIdentityToken !== undefined) {
        if (!isCustomerIdentityToken(input.customerIdentityToken)) throw new ClaimSlotError('CUSTOMER_IDENTITY_UNAVAILABLE');
        identityHash = hashCustomerIdentityToken(input.customerIdentityToken);
        const identity = await client.query<{ customer_account_id: string }>(
          `SELECT customer_account_id FROM customer_identity_tokens WHERE token_hash = $1`,
          [identityHash],
        );
        if (!identity.rows[0]) throw new ClaimSlotError('CUSTOMER_IDENTITY_UNAVAILABLE');
        customerAccountId = identity.rows[0].customer_account_id;
      }
      if (!customerAccountId) throw new ClaimSlotError('CUSTOMER_IDENTITY_UNAVAILABLE');
      await this.options.accountLifecycle?.assertAllActive(client, [
        input.createdByAccountId,
        customerAccountId,
      ]);
      if (identityHash) {
        const identity = await client.query<{
          customer_account_id: string;
          bound_merchant_id: string | null;
          bound_staff_account_id: string | null;
          expires_at: Date;
          consumed_at: Date | null;
          revoked_at: Date | null;
        }>(
          `SELECT customer_account_id, bound_merchant_id, bound_staff_account_id,
                  expires_at, consumed_at, revoked_at
           FROM customer_identity_tokens WHERE token_hash = $1 FOR UPDATE`,
          [identityHash],
        );
        const row = identity.rows[0];
        if (!row || row.customer_account_id !== customerAccountId || row.revoked_at ||
            row.bound_merchant_id !== input.merchantId || row.bound_staff_account_id !== input.createdByAccountId) {
          throw new ClaimSlotError('CUSTOMER_IDENTITY_UNAVAILABLE');
        }
        if (row.consumed_at) {
          const membership = await client.query(
            `SELECT 1 FROM merchant_members
             WHERE merchant_id = $1 AND account_id = $2 AND status = 'ACTIVE'`,
            [input.merchantId, input.createdByAccountId],
          );
          if (!membership.rowCount) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
          const existing = await client.query<{ id: string; token_version: number; expires_at: Date }>(
            `SELECT id, token_version, expires_at FROM claim_slots
             WHERE merchant_id = $1 AND customer_account_id = $2
               AND merchant_reference_hash = $3 AND created_by_account_id = $4`,
            [input.merchantId, customerAccountId, referenceHash, input.createdByAccountId],
          );
          if (!existing.rows[0]) throw new ClaimSlotError('CUSTOMER_IDENTITY_UNAVAILABLE');
          await client.query('COMMIT');
          return { claimSlotId: existing.rows[0].id, tokenVersion: existing.rows[0].token_version,
            expiresAt: existing.rows[0].expires_at.toISOString(), replayed: true };
        }
        if (row.expires_at.getTime() <= this.options.now().getTime()) throw new ClaimSlotError('CUSTOMER_IDENTITY_EXPIRED');
      }
      await requireActiveMerchantForStaff(client, input.merchantId, input.createdByAccountId);
      const access = await client.query<AccessAndDuplicateRow>(
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
        [input.merchantId, input.createdByAccountId, customerAccountId, referenceHash],
      );
      if (!access.rows[0]?.authorized) {
        throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      }
      if (access.rows[0].duplicate) {
        throw new ClaimSlotError('CLAIM_SLOT_ALREADY_EXISTS');
      }

      const token = this.options.nextToken();
      const claimSlotId = this.options.nextId();
      const inserted = await client.query<IssuedClaimSlotRow>(
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
          customerAccountId,
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
      if (identityHash) {
        await client.query(
          `UPDATE customer_identity_tokens SET consumed_at = $2 WHERE token_hash = $1`,
          [identityHash, issuedAt],
        );
      }
      issued = {
        claimSlotId,
        token,
        tokenVersion: 1,
        expiresAt: expiresAt.toISOString(),
      };
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) {
        throw new ClaimSlotError('ACCOUNT_DELETED');
      }
      if (isPostgresConstraint(error, 'claim_slots_unique_reference')) {
        throw new ClaimSlotError('CLAIM_SLOT_ALREADY_EXISTS');
      }
      if (isPostgresConstraint(error, 'claim_slots_unique_token')) {
        throw new ClaimSlotError('CLAIM_TOKEN_UNAVAILABLE');
      }
      throw error;
    } finally {
      client.release();
    }

    if (!issued) throw new Error('claim slot issue completed without a result');
    return issued;
  }

  async reissue(input: {
    merchantId: string;
    claimSlotId: string;
    expectedTokenVersion: number;
    requestedByAccountId: string;
  }): Promise<IssuedClaimSlot> {
    const requestedAt = this.options.now();
    const expiresAt = new Date(requestedAt.getTime() + this.options.ttlMs);
    const client = await this.pool.connect();
    let issued: IssuedClaimSlot | undefined;
    try {
      await client.query('BEGIN');
      await this.options.accountLifecycle?.assertActive(client, input.requestedByAccountId);
      await requireActiveMerchantForStaff(client, input.merchantId, input.requestedByAccountId);
      const token = this.options.nextToken();
      const updated = await client.query<IssuedClaimSlotRow>(
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
      if (updated.rowCount !== 1) {
        const membership = await client.query(
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
      issued = {
        claimSlotId: input.claimSlotId,
        token,
        tokenVersion: updated.rows[0]!.token_version,
        expiresAt: expiresAt.toISOString(),
      };
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) {
        throw new ClaimSlotError('ACCOUNT_DELETED');
      }
      if (isPostgresConstraint(error, 'claim_slots_unique_token')) {
        throw new ClaimSlotError('CLAIM_TOKEN_UNAVAILABLE');
      }
      throw error;
    } finally {
      client.release();
    }

    if (!issued) throw new Error('claim slot reissue completed without a result');
    return issued;
  }

  async preview(input: {
    accountId: string;
    token: string;
  }): Promise<ClaimSlotPreview> {
    const result = await this.pool.query<ClaimSlotPreviewRow>(
      `SELECT slot.id,
              slot.merchant_id,
              merchant.name AS merchant_name,
              campaign.id AS campaign_id,
              campaign.title AS campaign_title,
              slot.expires_at
       FROM claim_slots AS slot
       JOIN merchants AS merchant ON merchant.id = slot.merchant_id
       JOIN campaigns AS campaign
         ON campaign.merchant_id = slot.merchant_id
        AND campaign.status = 'ACTIVE'
        AND campaign.is_public = true
        AND campaign.starts_at <= $3
        AND campaign.ends_at > $3
       WHERE slot.token_hash = $1
         AND slot.customer_account_id = $2
         AND slot.status = 'ISSUED'
       ORDER BY campaign.id
       LIMIT 1`,
      [hashValue(input.token), input.accountId, this.options.now()],
    );
    const slot = result.rows[0];
    if (!slot) {
      throw new ClaimSlotError('CLAIM_TOKEN_UNAVAILABLE');
    }
    return {
      claimSlotId: slot.id,
      merchantId: slot.merchant_id,
      merchantName: slot.merchant_name,
      campaignId: slot.campaign_id,
      campaignTitle: slot.campaign_title,
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
      await this.options.accountLifecycle?.assertActive(client, input.accountId);
      const result = await client.query<ClaimSlotRow>(
        `UPDATE claim_slots
         SET status = CASE WHEN expires_at <= $3 THEN 'EXPIRED' ELSE 'CLAIMED' END,
             claimed_at = CASE WHEN expires_at <= $3 THEN NULL ELSE $3 END,
             updated_at = $3
         WHERE token_hash = $1
           AND customer_account_id = $2
           AND status = 'ISSUED'
         RETURNING id, merchant_id, status, created_by_account_id`,
        [hashValue(input.token), input.accountId, redeemedAt],
      );
      const slot = result.rows[0];
      if (!slot) {
        const replayed = await findRedeemedClaim(
          client,
          hashValue(input.token),
          input.accountId,
        );
        if (replayed) {
          await client.query('COMMIT');
          transactionActive = false;
          return replayed;
        }
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

      // 시연 전부 체험(#333): 시연 서버가 옵션을 켰고, 가상(is_demo) 점포이며, 슬롯 발급자가 시연 테스트 방문 발급자일 때만
      // 방문 날짜를 이미 센 날과 겹치지 않게 뒤로 옮긴다(클라이언트 값은 쓰지 않는다). 세 조건 중 하나라도 아니면
      // 모든 슬롯은 redeemedAt 그대로다. 실제 점포는 옵션이 켜져 있어도 옮기지 않는다.
      const visitOccurredAt =
        this.options.showcaseTestVisitBackdating &&
        campaign.merchant_is_demo &&
        slot.created_by_account_id === SHOWCASE_TEST_VISIT_ISSUER
          ? await pickShowcaseOccurredAt(client, {
              accountId: input.accountId,
              merchantId: slot.merchant_id,
              campaignId: campaign.id,
              now: redeemedAt,
            })
          : redeemedAt;

      const visitEventId = this.options.nextVisitEventId();
      // 실제 점포에서 직원 계정으로 받은 방문(본인 적립, 또는 방문한 계정이 그 점포의 ACTIVE 직원)은
      // 기록만 하고 진행·보상·NFT·도감에 세지 않는다. 멤버 여부는 수령 시점 기준이다.
      const staffAccountClaim = isStaffAccountClaim({
        merchantIsDemo: campaign.merchant_is_demo,
        slotCreatedByAccountId: slot.created_by_account_id,
        customerAccountId: input.accountId,
        customerIsActiveMember: campaign.merchant_is_demo
          ? false
          : await isActiveMember(client, slot.merchant_id, input.accountId),
      });
      let visit = staffAccountClaim
        ? undefined
        : (
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
                visitOccurredAt,
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
               progress_excluded_reason,
               created_at,
               updated_at
             )
             VALUES (
               $1, $2, $3, $4, $5, $6,
               ($6::timestamptz AT TIME ZONE 'Asia/Seoul')::date,
               'MERCHANT_CONFIRMED', 'VALID', false, $7, $6, $6
             )
             RETURNING id, business_date::text, progress_counted`,
            [
              visitEventId,
              slot.id,
              slot.merchant_id,
              campaign.id,
              input.accountId,
              visitOccurredAt,
              staffAccountClaim ? staffProgressExcludedReason : null,
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
      const grantedRewards: RedeemedClaimSlot['grantedRewards'][number][] = [];
      // 세어지지 않는 방문(같은 날 두 번째, 직원 자기 적립)은 권리를 주지 않는다.
      if (visit.progress_counted) {
        const granted = await grantReachedGoals(client, {
          accountId: input.accountId,
          campaignId: campaign.id,
          progressVisitCount: progress.progress_visit_count,
          sourceVisitEventId: visit.id,
          now: redeemedAt,
          claimExpiresAt: new Date(redeemedAt.getTime() + this.options.rewardClaimTtlMs),
          nextEntitlementId: this.options.nextEntitlementId,
        });
        for (const goal of granted) {
          grantedRewards.push({
            entitlementId: goal.entitlementId,
            targetVisitCount: goal.targetVisitCount,
            status: 'GRANTED',
            claimExpiresAt: goal.claimExpiresAt.toISOString(),
          });
        }
      }

      await client.query('COMMIT');
      transactionActive = false;
      return {
        claimSlotId: slot.id,
        merchantId: slot.merchant_id,
        merchantName: campaign.merchant_name,
        campaignTitle: campaign.title,
        status: 'CLAIMED',
        replayed: false,
        visit: {
          visitEventId: visit.id,
          campaignId: campaign.id,
          businessDate: visit.business_date,
          verificationLevel: 'MERCHANT_CONFIRMED',
          progressCounted: visit.progress_counted,
          progressVisitCount: progress.progress_visit_count,
          ...(staffAccountClaim ? { progressExcludedReason: staffProgressExcludedReason } : {}),
        },
        grantedRewards,
      };
    } catch (error) {
      if (transactionActive) {
        await client.query('ROLLBACK');
      }
      if (error instanceof AccountLifecycleError) {
        throw new ClaimSlotError('ACCOUNT_DELETED');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  // 시연 전용(#295): 가상 점포에서 실제 QR 없이 방문을 만든다. 발급만 하고 확정은 안 하므로, 호출자가 반환된 token으로
  // 바로 UNCHANGED redeem()을 불러야 방문이 잡힌다. 방문·보상 규칙은 redeem()이 그대로 적용한다(여기서 손대지 않는다).
  async issueShowcaseTestSlot(input: {
    merchantId: string;
    accountId: string;
  }): Promise<IssuedClaimSlot> {
    const issuedAt = this.options.now();
    const expiresAt = new Date(issuedAt.getTime() + this.options.ttlMs);
    const client = await this.pool.connect();
    let issued: IssuedClaimSlot | undefined;
    try {
      await client.query('BEGIN');
      // 호출자가 이미 showcaseDeployment를 확인했어도(server.ts), 쓰기 트랜잭션마다 DB 이름을 다시 본다(#294 원칙).
      const target = await client.query<{ name: string }>('SELECT current_database() AS name');
      if (!target.rows[0] || !isShowcaseDatabaseName(target.rows[0].name)) {
        throw new Error('SHOWCASE_HOST_DATABASE_REQUIRED');
      }
      await this.options.accountLifecycle?.assertActive(client, input.accountId);
      const merchant = await client.query<{ is_demo: boolean; status: string }>(
        `SELECT is_demo, status FROM merchants WHERE id = $1 FOR UPDATE`,
        [input.merchantId],
      );
      const merchantRow = merchant.rows[0];
      if (!merchantRow || !merchantRow.is_demo) {
        throw new ClaimSlotError('SHOWCASE_MERCHANT_NOT_FOUND');
      }
      if (merchantRow.status !== 'ACTIVE') {
        throw new ClaimSlotError('CLAIM_MERCHANT_INACTIVE');
      }
      // merchant_members FK를 채우는 발급자 행을 늦게(필요할 때) 만든다. REVOKED로 시작하고 영원히 REVOKED여야 한다
      // (merchant-access.ts는 status='ACTIVE'만 권한을 주므로, 이 행이 ACTIVE가 됐다면 무언가 잘못됐다는 뜻이다).
      await client.query(
        `INSERT INTO merchant_members (merchant_id, account_id, role, status, revoked_at)
         VALUES ($1, $2, 'STAFF', 'REVOKED', $3)
         ON CONFLICT (merchant_id, account_id) DO NOTHING`,
        [input.merchantId, SHOWCASE_TEST_VISIT_ISSUER, issuedAt],
      );
      const issuer = await client.query<{ status: string }>(
        `SELECT status FROM merchant_members WHERE merchant_id = $1 AND account_id = $2`,
        [input.merchantId, SHOWCASE_TEST_VISIT_ISSUER],
      );
      if (issuer.rows[0]?.status !== 'REVOKED') {
        throw new Error('SHOWCASE_TEST_VISIT_ISSUER_COMPROMISED');
      }
      const reference = `showcase-test:${randomUUID()}`;
      const referenceHash = hashMerchantReference(this.options.referenceHmacSecret, input.merchantId, reference);
      const token = this.options.nextToken();
      const claimSlotId = this.options.nextId();
      await client.query(
        `INSERT INTO claim_slots (
           id, merchant_id, customer_account_id, merchant_reference_hash,
           created_by_account_id, token_hash, status, expires_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'ISSUED', $7, $8, $8)`,
        [
          claimSlotId,
          input.merchantId,
          input.accountId,
          referenceHash,
          SHOWCASE_TEST_VISIT_ISSUER,
          hashValue(token),
          expiresAt,
          issuedAt,
        ],
      );
      issued = { claimSlotId, token, tokenVersion: 1, expiresAt: expiresAt.toISOString() };
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) {
        throw new ClaimSlotError('ACCOUNT_DELETED');
      }
      if (isPostgresConstraint(error, 'claim_slots_unique_reference')) {
        throw new ClaimSlotError('CLAIM_SLOT_ALREADY_EXISTS');
      }
      if (isPostgresConstraint(error, 'claim_slots_unique_token')) {
        throw new ClaimSlotError('CLAIM_TOKEN_UNAVAILABLE');
      }
      throw error;
    } finally {
      client.release();
    }

    if (!issued) throw new Error('showcase test visit issue completed without a result');
    return issued;
  }
}

// 시연 테스트 방문 전용(#333): 이 고객이 이 점포에서 이미 센 한국 날짜(VALID·progress_counted, 일일 중복 제약과 같은 조건)를 피해
// 캠페인 시작 시각 이후·최대 SHOWCASE_MAX_BACKDATE_DAYS일 전 중 가장 최근 날의 "지금과 같은 시각"을 돌려준다.
// 고를 날이 없으면 지금 시각 그대로 돌려줘, 지금까지처럼 같은 날 두 번째 방문(세어지지 않음)이 된다.
async function pickShowcaseOccurredAt(
  client: PoolClient,
  input: { accountId: string; merchantId: string; campaignId: string; now: Date },
): Promise<Date> {
  const used = await client.query<{ business_date: string }>(
    `SELECT business_date::text AS business_date
     FROM visit_events
     WHERE customer_account_id = $1
       AND merchant_id = $2
       AND status = 'VALID'
       AND progress_counted`,
    [input.accountId, input.merchantId],
  );
  const campaign = await client.query<{ starts_at: Date }>(
    'SELECT starts_at FROM campaigns WHERE id = $1',
    [input.campaignId],
  );
  const startsAt = campaign.rows[0]?.starts_at;
  if (!startsAt) return input.now;
  const picked = pickShowcaseVisitDate({
    nowMs: input.now.getTime(),
    usedKstDates: new Set(used.rows.map((row) => row.business_date)),
    earliestKstDate: earliestShowcaseVisitDate(startsAt.getTime(), input.now.getTime()),
    maxBackDays: SHOWCASE_MAX_BACKDATE_DAYS,
  });
  return picked?.occurredAt ?? input.now;
}

async function isActiveMember(client: PoolClient, merchantId: string, accountId: string): Promise<boolean> {
  const member = await client.query(
    `SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 AND status = 'ACTIVE'`,
    [merchantId, accountId],
  );
  return member.rowCount === 1;
}

async function requireActiveMerchantForStaff(
  client: PoolClient, merchantId: string, staffAccountId: string,
): Promise<void> {
  const { merchantStatus } = await requireActiveMerchantMember(client, merchantId, staffAccountId);
  if (merchantStatus !== 'ACTIVE') throw new ClaimSlotError('CLAIM_MERCHANT_INACTIVE');
}

async function findActiveCampaign(
  client: PoolClient,
  merchantId: string,
  redeemedAt: Date,
): Promise<CampaignRow | undefined> {
  const result = await client.query<CampaignRow>(
    `SELECT campaign.id, campaign.title, merchant.name AS merchant_name,
            merchant.is_demo AS merchant_is_demo
     FROM campaigns AS campaign
     JOIN merchants AS merchant ON merchant.id = campaign.merchant_id
     WHERE campaign.merchant_id = $1
       AND campaign.status = 'ACTIVE'
       AND campaign.is_public = true
       AND campaign.starts_at <= $2
       AND campaign.ends_at > $2
     ORDER BY campaign.id
     LIMIT 1`,
    [merchantId, redeemedAt],
  );
  return result.rows[0];
}

async function findRedeemedClaim(
  client: PoolClient,
  tokenHash: Buffer,
  accountId: string,
): Promise<RedeemedClaimSlot | undefined> {
  const result = await client.query<RedeemedReplayRow>(
    `SELECT slot.id AS claim_slot_id,
            slot.merchant_id,
            merchant.name AS merchant_name,
            visit.campaign_id,
            campaign.title AS campaign_title,
            visit.id AS visit_event_id,
            visit.business_date::text,
            visit.progress_counted,
            (visit.progress_excluded_reason IS NOT NULL) AS staff_account_claim,
            (
              SELECT count(*)::integer
              FROM visit_events AS progress_visit
              WHERE progress_visit.customer_account_id = $2
                AND progress_visit.campaign_id = visit.campaign_id
                AND progress_visit.status = 'VALID'
                AND progress_visit.progress_counted
                AND progress_visit.occurred_at <= visit.occurred_at
            ) AS progress_visit_count
     FROM claim_slots AS slot
     JOIN visit_events AS visit
       ON visit.claim_slot_id = slot.id
      AND visit.customer_account_id = slot.customer_account_id
      AND visit.status = 'VALID'
     JOIN campaigns AS campaign ON campaign.id = visit.campaign_id
     JOIN merchants AS merchant ON merchant.id = slot.merchant_id
     WHERE slot.token_hash = $1
       AND slot.customer_account_id = $2
       AND slot.status = 'CLAIMED'
     LIMIT 1`,
    [tokenHash, accountId],
  );
  const replay = result.rows[0];
  if (!replay) return undefined;
  const rewards = await client.query<RewardEntitlementRow>(
    `SELECT id, target_visit_count, claim_expires_at
     FROM reward_entitlements
     WHERE customer_account_id = $1
       AND source_visit_event_id = $2
       AND status <> 'CANCELED'
     ORDER BY target_visit_count`,
    [accountId, replay.visit_event_id],
  );
  return {
    claimSlotId: replay.claim_slot_id,
    merchantId: replay.merchant_id,
    merchantName: replay.merchant_name,
    campaignTitle: replay.campaign_title,
    status: 'CLAIMED',
    replayed: true,
    visit: {
      visitEventId: replay.visit_event_id,
      campaignId: replay.campaign_id,
      businessDate: replay.business_date,
      verificationLevel: 'MERCHANT_CONFIRMED',
      progressCounted: replay.progress_counted,
      progressVisitCount: replay.progress_visit_count,
      ...(replay.staff_account_claim ? { progressExcludedReason: staffProgressExcludedReason } : {}),
    },
    grantedRewards: rewards.rows.map((reward) => ({
      entitlementId: reward.id,
      targetVisitCount: reward.target_visit_count,
      status: 'GRANTED' as const,
      claimExpiresAt: reward.claim_expires_at.toISOString(),
    })),
  };
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
