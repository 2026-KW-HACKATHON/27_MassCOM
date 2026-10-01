import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { PostgresAccountLifecycle } from '../postgres/account-lifecycle.js';
import { assertHostedShowcaseDatabaseUrl } from './host-seed.js';
import { assertLocalShowcaseDatabaseUrl, SHOWCASE_MERCHANT_ID } from './local-seed.js';
import { grantShowcaseStaffTx } from './grant-staff.js';

// 부트스트랩(#294): 승인자 후보가 앱에서 보낸 요청 코드를 사람이 메일로 받아 운영자에게 전달한 뒤 이 명령을 돌린다.
// hosted(masscom_showcase)·local(masscom_showcase_test·_ci_*_test) 어느 DB_URL이든 받는다.
function assertShowcaseDatabaseUrl(raw: string): string {
  try {
    return assertHostedShowcaseDatabaseUrl(raw);
  } catch {
    return assertLocalShowcaseDatabaseUrl(raw);
  }
}

async function main() {
  const databaseUrl = assertShowcaseDatabaseUrl(process.env.DATABASE_URL ?? '');
  const deletionSecret = process.env.ACCOUNT_DELETION_HMAC_SECRET ?? '';
  const code = (process.argv[2] ?? '').trim().toUpperCase().replace(/-/g, '');
  if (Buffer.byteLength(deletionSecret) < 32 || !/^[0-9A-HJKMNP-TV-Z]{8}$/.test(code)) {
    throw new Error('SHOWCASE_APPROVER_GRANT_INVALID_INPUT');
  }
  const accountLifecycle = new PostgresAccountLifecycle({ hmacSecret: deletionSecret });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const request = await client.query<{ id: string; account_id: string; status: string }>(
        `SELECT id, account_id, status FROM showcase_access_requests WHERE code = $1 FOR UPDATE`,
        [code],
      );
      const row = request.rows[0];
      if (!row || row.status !== 'PENDING') throw new Error('SHOWCASE_ACCESS_REQUEST_NOT_FOUND');
      await accountLifecycle.assertActive(client, row.account_id);
      // 승인자 역할(platform_admins)과 감사 행. db_user는 이 명령을 돌린 DB 세션 역할이다(승인자의 계정 ID가 아니다).
      await client.query(
        `INSERT INTO platform_admins(account_id) VALUES ($1)
         ON CONFLICT (account_id) DO UPDATE SET granted_at = now(), revoked_at = NULL`,
        [row.account_id],
      );
      await client.query(
        `INSERT INTO platform_admin_role_audit(id, target_account_id, action, db_user)
         VALUES ($1, $2, 'GRANT', session_user)`,
        [randomUUID(), row.account_id],
      );
      // 승인자는 가상 점포 A 직원 권한도 함께 받는다(일반 승인과 같은 핵심, #294).
      await grantShowcaseStaffTx(client, {
        accountId: row.account_id, merchantId: SHOWCASE_MERCHANT_ID, accountLifecycle,
      });
      await client.query(
        `UPDATE showcase_access_requests
         SET status = 'APPROVED', decided_at = now(), decided_by_account_id = NULL,
             decided_via = 'OPS', decided_db_user = session_user
         WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    console.log('SHOWCASE_APPROVER_GRANTED');
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  console.error('SHOWCASE_APPROVER_GRANT_FAILED');
  process.exitCode = 1;
});
