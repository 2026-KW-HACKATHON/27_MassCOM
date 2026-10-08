import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

import { PostgresAccountLifecycle } from '../postgres/account-lifecycle.js';
import { assertHostedShowcaseDatabaseUrl } from './host-seed.js';
import { assertLocalShowcaseDatabaseUrl, SHOWCASE_PRACTICE_MERCHANT_ID } from './local-seed.js';
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
      // 잠금 순서(#304 P2): 재요청·계정 삭제는 계정(advisory lock) → 요청 행 순이다. 이 명령이 행 → 계정 순으로
      // 잠그면 반대 순서끼리 서로 기다려 교착할 수 있다. 계정을 먼저 알아내 잠근 뒤에야 요청 행을 잠그고(FOR
      // UPDATE) 다시 검증한다.
      const lookup = await client.query<{ id: string; account_id: string }>(
        `SELECT id, account_id FROM showcase_access_requests WHERE code = $1`,
        [code],
      );
      const lookupRow = lookup.rows[0];
      if (!lookupRow) throw new Error('SHOWCASE_ACCESS_REQUEST_NOT_FOUND');
      await accountLifecycle.assertActive(client, lookupRow.account_id);
      // 로그인 없는 체험 계정(#309)은 신원이 없어 승인자가 될 수 없다(끝난 체험 계정도 마찬가지).
      const guest = await client.query('SELECT 1 FROM showcase_guest_trials WHERE account_id = $1', [lookupRow.account_id]);
      if (guest.rowCount) throw new Error('SHOWCASE_GUEST_NOT_ELIGIBLE');
      const request = await client.query<{ id: string; account_id: string; status: string }>(
        `SELECT id, account_id, status FROM showcase_access_requests WHERE id = $1 FOR UPDATE`,
        [lookupRow.id],
      );
      const row = request.rows[0];
      // 잠근 계정과 잠근 뒤 다시 읽은 요청 계정이 같아야 한다(관리자 등록·감사 기록 전에 확인).
      if (!row || row.status !== 'PENDING' || row.account_id !== lookupRow.account_id) throw new Error('SHOWCASE_ACCESS_REQUEST_NOT_FOUND');
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
      // 승인자는 비공개 체험 점포 직원 권한도 함께 받는다(일반 승인과 같은 핵심, #294).
      await grantShowcaseStaffTx(client, {
        accountId: row.account_id, merchantId: SHOWCASE_PRACTICE_MERCHANT_ID, accountLifecycle,
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
