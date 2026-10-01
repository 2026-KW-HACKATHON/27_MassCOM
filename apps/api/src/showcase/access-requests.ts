import { randomBytes, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { AccountLifecycleError, PostgresAccountLifecycle } from '../postgres/account-lifecycle.js';
import { grantShowcaseStaffTx } from './grant-staff.js';
import { isPermittedShowcaseDatabaseName, SHOWCASE_MERCHANT_ID } from './local-seed.js';

export class ShowcaseAccessRequestError extends Error {
  constructor(readonly code:
    | 'SHOWCASE_HOST_DATABASE_REQUIRED'
    | 'SHOWCASE_ACCESS_ALREADY_GRANTED'
    | 'SHOWCASE_APPROVER_REQUIRED'
    | 'SHOWCASE_ACCESS_SELF_DECISION'
    | 'SHOWCASE_ACCESS_REQUEST_NOT_FOUND'
    | 'SHOWCASE_ACCESS_ALREADY_DECIDED'
    | 'ACCOUNT_DELETED') {
    super(code);
    this.name = 'ShowcaseAccessRequestError';
  }
}

export type AccessRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type AccessRequestView = {
  code: string;
  status: AccessRequestStatus;
  createdAt: string;
  decidedAt: string | null;
};

export type PendingAccessRequestSummary = { id: string; code: string; createdAt: string };

// Crockford base32(I·L·O·U 뺀 32자)의 대문자 알파벳. 5비트 = 1글자라 거부 샘플링 없이 그대로 쓴다.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateAccessRequestCode(): string {
  const bits = randomBytes(5); // 40비트 = 8글자 * 5비트
  let value = 0n;
  for (const byte of bits) value = (value << 8n) | BigInt(byte);
  let code = '';
  for (let shift = 35n; shift >= 0n; shift -= 5n) {
    code += CODE_ALPHABET[Number((value >> shift) & 0b11111n)];
  }
  return code;
}

// hosted(masscom_showcase)와 local(masscom_showcase_test·_ci_*_test) 모두에서 열리는 시연 전용 기능이다(#294).
function isShowcaseDatabaseName(name: string): boolean {
  return name === 'masscom_showcase' || isPermittedShowcaseDatabaseName(name);
}

type RequestRow = {
  id: string;
  code: string;
  status: AccessRequestStatus;
  created_at: Date;
  decided_at: Date | null;
};

function mapRequest(row: Pick<RequestRow, 'code' | 'status' | 'created_at' | 'decided_at'>): AccessRequestView {
  return {
    code: row.code,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
  };
}

/**
 * 점주 체험 권한 요청(#294). 요청·조회는 계정 본인, 승인·거절은 platform_admins의 승인자만 할 수 있다.
 * 승인은 grantShowcaseStaffTx로 가상 점포 A의 STAFF 권한을 준다(운영자 명령과 같은 핵심, 허용목록·세션 검사는 건너뛴다:
 * 대기 중 요청 행 자체가 자격 증명이다). 모든 트랜잭션이 시작할 때 현재 DB 이름을 다시 확인한다.
 */
export class ShowcaseAccessRequestService {
  private readonly accountLifecycle: PostgresAccountLifecycle;

  constructor(private readonly pool: Pool, options: { accountDeletionHmacSecret: string }) {
    this.accountLifecycle = new PostgresAccountLifecycle({ hmacSecret: options.accountDeletionHmacSecret });
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query<{ name: string }>('SELECT current_database() AS name');
      if (!target.rows[0] || !isShowcaseDatabaseName(target.rows[0].name)) {
        throw new ShowcaseAccessRequestError('SHOWCASE_HOST_DATABASE_REQUIRED');
      }
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new ShowcaseAccessRequestError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }

  async mine(accountId: string): Promise<{ request: AccessRequestView | null; staff: boolean; approver: boolean }> {
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, accountId);
      const request = await client.query<RequestRow>(
        `SELECT id, code, status, created_at, decided_at FROM showcase_access_requests
         WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [accountId],
      );
      const staff = await client.query(
        `SELECT 1 FROM merchant_members WHERE account_id = $1 AND role = 'STAFF' AND status = 'ACTIVE'`,
        [accountId],
      );
      const approver = await client.query(
        `SELECT 1 FROM platform_admins WHERE account_id = $1 AND revoked_at IS NULL`,
        [accountId],
      );
      return {
        request: request.rows[0] ? mapRequest(request.rows[0]) : null,
        staff: staff.rowCount! > 0,
        approver: approver.rowCount! > 0,
      };
    });
  }

  async request(accountId: string): Promise<{ created: boolean; request: AccessRequestView }> {
    return this.transaction(async (client) => {
      // assertActive가 이 계정의 advisory lock을 잡아 같은 계정의 동시 요청을 직렬화한다(동시 이중 요청 방지).
      await this.accountLifecycle.assertActive(client, accountId);
      const staff = await client.query(
        `SELECT 1 FROM merchant_members WHERE account_id = $1 AND role = 'STAFF' AND status = 'ACTIVE'`,
        [accountId],
      );
      if (staff.rowCount) throw new ShowcaseAccessRequestError('SHOWCASE_ACCESS_ALREADY_GRANTED');
      const existing = await client.query<RequestRow>(
        `SELECT id, code, status, created_at, decided_at FROM showcase_access_requests
         WHERE account_id = $1 AND status = 'PENDING' FOR UPDATE`,
        [accountId],
      );
      if (existing.rows[0]) return { created: false, request: mapRequest(existing.rows[0]) };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const inserted = await client.query<RequestRow>(
          `INSERT INTO showcase_access_requests (id, account_id, code)
           VALUES ($1, $2, $3)
           ON CONFLICT (code) DO NOTHING
           RETURNING id, code, status, created_at, decided_at`,
          [randomUUID(), accountId, generateAccessRequestCode()],
        );
        if (inserted.rows[0]) return { created: true, request: mapRequest(inserted.rows[0]) };
      }
      throw new Error('SHOWCASE_ACCESS_CODE_EXHAUSTED');
    });
  }

  async listPending(approverId: string): Promise<PendingAccessRequestSummary[]> {
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, approverId);
      await this.assertApprover(client, approverId);
      const result = await client.query<{ id: string; code: string; created_at: Date }>(
        `SELECT id, code, created_at FROM showcase_access_requests
         WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 50`,
      );
      return result.rows.map((row) => ({ id: row.id, code: row.code, createdAt: row.created_at.toISOString() }));
    });
  }

  async decide(approverId: string, requestId: string, decision: 'APPROVED' | 'REJECTED'): Promise<void> {
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, approverId);
      await this.assertApprover(client, approverId);
      const request = await client.query<{ id: string; account_id: string; status: AccessRequestStatus }>(
        `SELECT id, account_id, status FROM showcase_access_requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      const row = request.rows[0];
      if (!row) throw new ShowcaseAccessRequestError('SHOWCASE_ACCESS_REQUEST_NOT_FOUND');
      if (row.account_id === approverId) throw new ShowcaseAccessRequestError('SHOWCASE_ACCESS_SELF_DECISION');
      if (row.status !== 'PENDING') throw new ShowcaseAccessRequestError('SHOWCASE_ACCESS_ALREADY_DECIDED');
      if (decision === 'APPROVED') {
        await grantShowcaseStaffTx(client, {
          accountId: row.account_id, merchantId: SHOWCASE_MERCHANT_ID, accountLifecycle: this.accountLifecycle,
        });
      }
      await client.query(
        `UPDATE showcase_access_requests
         SET status = $1, decided_at = now(), decided_by_account_id = $2, decided_via = 'APP'
         WHERE id = $3`,
        [decision, approverId, row.id],
      );
    });
  }

  private async assertApprover(client: PoolClient, accountId: string): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM platform_admins WHERE account_id = $1 AND revoked_at IS NULL`,
      [accountId],
    );
    if (result.rowCount !== 1) throw new ShowcaseAccessRequestError('SHOWCASE_APPROVER_REQUIRED');
  }
}
