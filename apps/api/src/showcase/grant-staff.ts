import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { PostgresAccountLifecycle } from '../postgres/account-lifecycle.js';
import { isPermittedShowcaseDatabaseName, SHOWCASE_PRACTICE_MERCHANT_ID } from './local-seed.js';

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

// hosted(masscom_showcase)와 local(masscom_showcase_test·_ci_*_test) 모두를 받는다: 이 핵심은 두 배치 모두에서 쓰인다(#294).
function isShowcaseDatabaseName(name: string): boolean {
  return name === 'masscom_showcase' || isPermittedShowcaseDatabaseName(name);
}

/**
 * 비공개 체험 점포 STAFF 권한 부여의 핵심(#294). 운영자 명령의 허용목록·세션 검사(아래 grantShowcaseStaff)와
 * 권한 요청 승인(showcase/access-requests.ts)이 함께 쓴다: 승인 쪽은 요청 행 자체가 자격 증명이라
 * 허용목록·세션 검사를 다시 하지 않는다. 호출자가 이미 연 트랜잭션의 client를 받는다.
 */
export async function grantShowcaseStaffTx(
  client: PoolClient,
  input: { accountId: string; merchantId: string; accountLifecycle: PostgresAccountLifecycle },
): Promise<void> {
  const target = await client.query<{ name: string }>('SELECT current_database() AS name');
  if (!target.rows[0] || !isShowcaseDatabaseName(target.rows[0].name)) {
    throw new Error('SHOWCASE_HOST_DATABASE_REQUIRED');
  }
  await input.accountLifecycle.assertActive(client, input.accountId);
  const merchant = await client.query<{ is_demo: boolean; status: string; published_at: Date | null }>(
    'SELECT is_demo, status, published_at FROM merchants WHERE id = $1 FOR UPDATE',
    [input.merchantId],
  );
  if (input.merchantId !== SHOWCASE_PRACTICE_MERCHANT_ID || merchant.rows[0]?.is_demo !== true ||
      merchant.rows[0].status !== 'ACTIVE' || merchant.rows[0].published_at !== null) {
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
  const accountLifecycle = new PostgresAccountLifecycle({ hmacSecret: input.accountDeletionHmacSecret });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
    if (!subjectHash || !input.allowedSubjectHashes.has(subjectHash) || session.rowCount !== 1) {
      throw new Error('SHOWCASE_STAFF_NOT_ELIGIBLE');
    }
    await grantShowcaseStaffTx(client, {
      accountId: input.accountId, merchantId: input.merchantId, accountLifecycle,
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
