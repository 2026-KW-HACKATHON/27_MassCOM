import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

import { PostgresAccountLifecycle } from '../postgres/account-lifecycle.js';

type GrantInput = {
  accountId: string;
  merchantId: string;
  allowedSubjectHashes: ReadonlySet<string>;
  accountDeletionHmacSecret: string;
};

export function staffAccountIdForHash(
  identities: readonly { account_id: string; subject: string }[],
  wantedHash: string,
): string {
  if (!/^[0-9a-f]{64}$/.test(wantedHash)) throw new Error('SHOWCASE_STAFF_NOT_ELIGIBLE');
  const matches = identities.filter(({ subject }) =>
    createHash('sha256').update(subject).digest('hex') === wantedHash);
  if (matches.length !== 1 || !matches[0]?.account_id.trim()) {
    throw new Error('SHOWCASE_STAFF_NOT_ELIGIBLE');
  }
  return matches[0].account_id;
}

export async function grantShowcaseStaff(
  pool: Pool,
  input: GrantInput,
): Promise<void> {
  if (!input.accountId.trim() || !input.merchantId.trim() ||
      input.allowedSubjectHashes.size === 0 ||
      [...input.allowedSubjectHashes].some((hash) => !/^[0-9a-f]{64}$/.test(hash))) {
    throw new Error('SHOWCASE_STAFF_NOT_ELIGIBLE');
  }
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: input.accountDeletionHmacSecret });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await client.query<{ name: string }>('SELECT current_database() AS name');
    if (target.rows[0]?.name !== 'masscom_showcase') {
      throw new Error('SHOWCASE_HOST_DATABASE_REQUIRED');
    }
    await lifecycle.assertActive(client, input.accountId);
    const identity = await client.query<{ subject: string }>(
      `SELECT subject FROM auth_identities
       WHERE provider = 'google' AND account_id = $1`,
      [input.accountId],
    );
    const subject = identity.rows[0]?.subject;
    const subjectHash = subject ? createHash('sha256').update(subject).digest('hex') : undefined;
    const session = await client.query(
      `SELECT 1 FROM auth_sessions
       WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > now()
       LIMIT 1`,
      [input.accountId],
    );
    const merchant = await client.query<{ is_demo: boolean }>(
      'SELECT is_demo FROM merchants WHERE id = $1 FOR UPDATE',
      [input.merchantId],
    );
    if (!subjectHash || !input.allowedSubjectHashes.has(subjectHash) ||
        session.rowCount !== 1 || merchant.rows[0]?.is_demo !== true) {
      throw new Error('SHOWCASE_STAFF_NOT_ELIGIBLE');
    }
    await client.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status)
       VALUES ($1, $2, 'STAFF', 'ACTIVE')
       ON CONFLICT (merchant_id, account_id) DO NOTHING`,
      [input.merchantId, input.accountId],
    );
    const membership = await client.query<{ role: string; status: string; revoked_at: Date | null }>(
      `SELECT role, status, revoked_at FROM merchant_members
       WHERE merchant_id = $1 AND account_id = $2`,
      [input.merchantId, input.accountId],
    );
    if (membership.rows[0]?.role !== 'STAFF' ||
        membership.rows[0]?.status !== 'ACTIVE' || membership.rows[0]?.revoked_at !== null) {
      throw new Error('SHOWCASE_STAFF_NOT_ELIGIBLE');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
