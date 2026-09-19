import type { Pool } from 'pg';

import {
  WalletChallengeError,
  type ChallengeRecord,
  type ChallengeStore,
} from '../wallet-challenge-service.js';

type ChallengeStatus = 'pending' | 'verifying' | 'used';

type ChallengeRow = {
  id: string;
  account_id: string;
  address: string;
  chain_id: number;
  nonce: string;
  message: string;
  issued_at: Date;
  expires_at: Date;
  status: ChallengeStatus;
};

export class PostgresChallengeStore implements ChallengeStore {
  constructor(
    private readonly pool: Pool,
    private readonly options: { now?: () => Date } = {},
  ) {}

  async create(record: ChallengeRecord): Promise<void> {
    const now = this.options.now?.() ?? new Date();
    try {
      await this.pool.query('DELETE FROM wallet_challenges WHERE expires_at < $1', [now]);
      await this.pool.query(
        `INSERT INTO wallet_challenges (
           id, account_id, address, chain_id, nonce, message, issued_at, expires_at, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          record.challengeId,
          record.accountId,
          record.address,
          record.chainId,
          record.nonce,
          record.message,
          record.issuedAt,
          record.expiresAt,
          record.status,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WalletChallengeError('CHALLENGE_ID_CONFLICT');
      }
      throw error;
    }
  }

  async get(challengeId: string): Promise<ChallengeRecord | undefined> {
    const row = (
      await this.pool.query<ChallengeRow>(
        `SELECT id, account_id, address, chain_id, nonce, message, issued_at, expires_at, status
         FROM wallet_challenges
         WHERE id = $1`,
        [challengeId],
      )
    ).rows[0];
    return row ? mapRecord(row) : undefined;
  }

  async claim(challengeId: string): Promise<void> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE wallet_challenges
       SET status = 'verifying'
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [challengeId],
    );
    if (result.rowCount === 1) return;

    const status = await currentStatus(this.pool, challengeId);
    if (status === undefined) throw new WalletChallengeError('CHALLENGE_NOT_FOUND');
    if (status === 'used') throw new WalletChallengeError('NONCE_ALREADY_USED');
    throw new WalletChallengeError('NONCE_IN_PROGRESS');
  }

  // ponytail: a crashed verifier leaves the row 'verifying' until expiry; the user requests a new challenge. Add a claimed_at timeout if TTLs grow.
  async release(challengeId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE wallet_challenges
       SET status = 'pending'
       WHERE id = $1 AND status = 'verifying'`,
      [challengeId],
    );
    if (result.rowCount === 1) return;

    const status = await currentStatus(this.pool, challengeId);
    if (status === undefined) throw new WalletChallengeError('CHALLENGE_NOT_FOUND');
  }

  async consume(challengeId: string): Promise<void> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE wallet_challenges
       SET status = 'used'
       WHERE id = $1 AND status = 'verifying'
       RETURNING id`,
      [challengeId],
    );
    if (result.rowCount === 1) return;

    const status = await currentStatus(this.pool, challengeId);
    if (status === undefined) throw new WalletChallengeError('CHALLENGE_NOT_FOUND');
    throw new WalletChallengeError('NONCE_NOT_CLAIMED');
  }

  async deleteByAccount(accountId: string): Promise<void> {
    await this.pool.query('DELETE FROM wallet_challenges WHERE account_id = $1', [accountId]);
  }
}

async function currentStatus(pool: Pool, challengeId: string): Promise<ChallengeStatus | undefined> {
  const row = (
    await pool.query<{ status: ChallengeStatus }>(
      'SELECT status FROM wallet_challenges WHERE id = $1',
      [challengeId],
    )
  ).rows[0];
  return row?.status;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function mapRecord(row: ChallengeRow): ChallengeRecord {
  return {
    challengeId: row.id,
    accountId: row.account_id,
    address: row.address,
    chainId: row.chain_id,
    nonce: row.nonce,
    message: row.message,
    issuedAt: row.issued_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    status: row.status,
  };
}
