import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  MintRequestError,
  consentVersionRefusal,
  type MintJobStatus,
  type MintJobView,
  type MintRequestResult,
  type MintRequestService,
} from '../mint-request-service.js';
import {
  AccountLifecycleError,
  type PostgresAccountLifecycle,
} from './account-lifecycle.js';

type ServiceOptions = {
  now: () => Date;
  nextJobId: () => string;
  nextOutboxId: () => string;
  nextRewardKey: () => Buffer;
  supportedConsentVersion: string;
};

type ServiceOverrides = Partial<Omit<ServiceOptions, 'supportedConsentVersion'>> &
  Pick<ServiceOptions, 'supportedConsentVersion'> & {
    accountLifecycle?: PostgresAccountLifecycle;
  };

type ExistingJobRow = {
  id: string;
  status: MintJobStatus;
  chain_id: number;
  recipient_address: string;
  wallet_binding_id: string;
  binding_version: number;
  request_fingerprint: Buffer;
};

type EntitlementSeriesRow = {
  entitlement_status: 'GRANTED' | 'CANCELED' | 'MINT_REQUESTED' | 'FULFILLED';
  claim_expires_at: Date;
  nft_series_id: string;
  series_status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  chain_id: number;
  contract_address: string;
  contract_address_normalized: string;
  series_key: Buffer;
  max_ever_minted: number;
};

type BindingRow = {
  address_checksum: string;
  address_normalized: string;
  chain_id: number;
  binding_version: number;
  status: 'VERIFIED' | 'DISCONNECTED';
};

const defaultOptions: Omit<ServiceOptions, 'supportedConsentVersion'> = {
  now: () => new Date(),
  nextJobId: () => randomUUID(),
  nextOutboxId: () => randomUUID(),
  nextRewardKey: () => randomBytes(32),
};

export class PostgresMintRequestService implements MintRequestService {
  private readonly options: ServiceOptions;
  private readonly accountLifecycle: PostgresAccountLifecycle | undefined;

  constructor(
    private readonly pool: Pool,
    options: ServiceOverrides,
  ) {
    this.options = { ...defaultOptions, ...options };
    this.accountLifecycle = options.accountLifecycle;
    if (!this.options.supportedConsentVersion.trim()) {
      throw new Error('supportedConsentVersion is required');
    }
  }

  async requestMint(input: {
    accountId: string;
    entitlementId: string;
    walletBindingId: string;
    bindingVersion: number;
    consentVersion: string;
    idempotencyKey: string;
  }): Promise<MintRequestResult> {
    if (input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 200) {
      throw new MintRequestError('IDEMPOTENCY_KEY_REQUIRED');
    }
    const fingerprint = requestFingerprint(input);
    const now = this.options.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle?.assertActive(client, input.accountId);
      await lockIdempotencyKey(client, input.accountId, input.idempotencyKey);

      const existing = await findIdempotentJob(
        client,
        input.accountId,
        input.idempotencyKey,
      );
      if (existing) {
        if (!existing.request_fingerprint.equals(fingerprint)) {
          throw new MintRequestError('IDEMPOTENCY_CONFLICT');
        }
        await client.query('COMMIT');
        return requestResult(existing, true);
      }

      const consentRefusal = consentVersionRefusal(input.consentVersion, this.options.supportedConsentVersion);
      if (consentRefusal) throw new MintRequestError(consentRefusal);

      const entitlement = (
        await client.query<EntitlementSeriesRow>(
          `SELECT
             entitlement.status AS entitlement_status,
             entitlement.claim_expires_at,
             series.id AS nft_series_id,
             series.status AS series_status,
             series.chain_id,
             series.contract_address,
             series.contract_address_normalized,
             series.series_key,
             series.max_ever_minted
           FROM reward_entitlements AS entitlement
           JOIN nft_series AS series
             ON series.campaign_id = entitlement.campaign_id
            AND series.target_visit_count = entitlement.target_visit_count
           WHERE entitlement.id = $1
             AND entitlement.customer_account_id = $2
           FOR UPDATE OF entitlement, series`,
          [input.entitlementId, input.accountId],
        )
      ).rows[0];
      if (!entitlement) throw new MintRequestError('ENTITLEMENT_NOT_FOUND');
      if (entitlement.entitlement_status === 'MINT_REQUESTED') {
        throw new MintRequestError('MINT_PENDING');
      }
      if (entitlement.entitlement_status !== 'GRANTED' || entitlement.series_status !== 'ACTIVE') {
        throw new MintRequestError('ENTITLEMENT_NOT_MINTABLE');
      }
      if (entitlement.claim_expires_at.getTime() <= now.getTime()) {
        throw new MintRequestError('ENTITLEMENT_EXPIRED');
      }

      const binding = (
        await client.query<BindingRow>(
          `SELECT address_checksum, address_normalized, chain_id, binding_version, status
           FROM wallet_bindings
           WHERE id = $1 AND account_id = $2
           FOR UPDATE`,
          [input.walletBindingId, input.accountId],
        )
      ).rows[0];
      if (!binding) throw new MintRequestError('WALLET_BINDING_NOT_FOUND');
      if (binding.status !== 'VERIFIED' || binding.binding_version !== input.bindingVersion) {
        throw new MintRequestError('WALLET_BINDING_CHANGED');
      }
      if (binding.chain_id !== entitlement.chain_id) {
        throw new MintRequestError('CHAIN_MISMATCH');
      }

      // 취소된(CANCELLED) 작업은 체인에 나간 적이 없어 발행 여유를 차지하지 않는다(방문 취소·계정 삭제로 생긴다).
      const reserved = (
        await client.query<{ count: number }>(
          `SELECT count(*)::integer AS count
           FROM mint_jobs
           WHERE nft_series_id = $1 AND status <> 'CANCELLED'`,
          [entitlement.nft_series_id],
        )
      ).rows[0]!.count;
      if (reserved >= entitlement.max_ever_minted) {
        throw new MintRequestError('CAPACITY_UNAVAILABLE');
      }

      const rewardKey = this.options.nextRewardKey();
      if (rewardKey.byteLength !== 32) throw new Error('reward key must be 32 bytes');
      const jobId = this.options.nextJobId();
      const inserted = (
        await client.query<ExistingJobRow>(
          `INSERT INTO mint_jobs (
             id, entitlement_id, account_id, nft_series_id, reward_key,
             wallet_binding_id, binding_version, recipient_address,
             recipient_address_normalized, chain_id, contract_address,
             contract_address_normalized, series_key, consent_version,
             idempotency_key, request_fingerprint, status, created_at, updated_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, 'QUEUED', $17, $17
           )
           RETURNING id, status, chain_id, recipient_address, wallet_binding_id,
                     binding_version, request_fingerprint`,
          [
            jobId,
            input.entitlementId,
            input.accountId,
            entitlement.nft_series_id,
            rewardKey,
            input.walletBindingId,
            input.bindingVersion,
            binding.address_checksum,
            binding.address_normalized,
            entitlement.chain_id,
            entitlement.contract_address,
            entitlement.contract_address_normalized,
            entitlement.series_key,
            input.consentVersion,
            input.idempotencyKey,
            fingerprint,
            now,
          ],
        )
      ).rows[0]!;

      await client.query(
        `INSERT INTO outbox_events (
           id, aggregate_type, aggregate_id, event_type, payload, status,
           available_at, created_at, updated_at
         ) VALUES ($1, 'MINT_JOB', $2, 'MINT_REQUESTED', $3, 'PENDING', $4, $4, $4)`,
        [this.options.nextOutboxId(), jobId, { jobId }, now],
      );
      const updated = await client.query(
        `UPDATE reward_entitlements
         SET status = 'MINT_REQUESTED', updated_at = $1
         WHERE id = $2 AND status = 'GRANTED'`,
        [now, input.entitlementId],
      );
      if (updated.rowCount !== 1) throw new MintRequestError('MINT_PENDING');

      await client.query('COMMIT');
      return requestResult(inserted, false);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) {
        throw new MintRequestError('ACCOUNT_DELETED');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getMintJob(input: { accountId: string; jobId: string }): Promise<MintJobView> {
    const row = (
      await this.pool.query<ExistingJobRow>(
        `SELECT id, status, chain_id, recipient_address, wallet_binding_id,
                binding_version, request_fingerprint
         FROM mint_jobs
         WHERE id = $1 AND account_id = $2`,
        [input.jobId, input.accountId],
      )
    ).rows[0];
    if (!row) throw new MintRequestError('MINT_JOB_NOT_FOUND');
    return jobView(row);
  }
}

async function findIdempotentJob(
  client: PoolClient,
  accountId: string,
  idempotencyKey: string,
): Promise<ExistingJobRow | undefined> {
  return (
    await client.query<ExistingJobRow>(
      `SELECT id, status, chain_id, recipient_address, wallet_binding_id,
              binding_version, request_fingerprint
       FROM mint_jobs
       WHERE account_id = $1 AND idempotency_key = $2`,
      [accountId, idempotencyKey],
    )
  ).rows[0];
}

async function lockIdempotencyKey(
  client: PoolClient,
  accountId: string,
  idempotencyKey: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    JSON.stringify([accountId, idempotencyKey]),
  ]);
}

function requestFingerprint(input: {
  entitlementId: string;
  walletBindingId: string;
  bindingVersion: number;
  consentVersion: string;
}): Buffer {
  return createHash('sha256')
    .update(
      JSON.stringify({
        entitlementId: input.entitlementId,
        walletBindingId: input.walletBindingId,
        bindingVersion: input.bindingVersion,
        consentVersion: input.consentVersion,
      }),
    )
    .digest();
}

function requestResult(row: ExistingJobRow, replayed: boolean): MintRequestResult {
  return {
    jobId: row.id,
    status: row.status,
    chainId: row.chain_id,
    recipient: row.recipient_address,
    nft: null,
    replayed,
  };
}

function jobView(row: ExistingJobRow): MintJobView {
  return {
    jobId: row.id,
    status: row.status,
    chainId: row.chain_id,
    recipient: row.recipient_address,
    walletBindingId: row.wallet_binding_id,
    bindingVersion: row.binding_version,
    nft: null,
  };
}
