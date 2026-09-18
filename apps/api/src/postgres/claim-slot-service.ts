import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

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
  ttlMs: number;
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

const defaultOptions: ClaimSlotServiceOptions = {
  now: () => new Date(),
  nextToken: () => randomBytes(32).toString('base64url'),
  nextId: () => randomUUID(),
  ttlMs: 15 * 60 * 1000,
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
    const result = await this.pool.query<ClaimSlotRow>(
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
      throw new ClaimSlotError('CLAIM_TOKEN_EXPIRED');
    }
    if (slot.status !== 'CLAIMED') {
      throw new ClaimSlotError('CLAIM_TOKEN_UNAVAILABLE');
    }
    return { claimSlotId: slot.id, merchantId: slot.merchant_id, status: 'CLAIMED' };
  }
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
