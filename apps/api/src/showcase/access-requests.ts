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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  private readonly generateCode: () => string;

  constructor(
    private readonly pool: Pool,
    options: { accountDeletionHmacSecret: string; generateCode?: () => string },
  ) {
    this.accountLifecycle = new PostgresAccountLifecycle({ hmacSecret: options.accountDeletionHmacSecret });
    this.generateCode = options.generateCode ?? generateAccessRequestCode;
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
          [randomUUID(), accountId, this.generateCode()],
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
    // uuid 컬럼에 형식이 틀린 값을 보내면 Postgres가 에러를 내 500으로 샌다. 쿼리 전에 걸러 404로 보낸다.
    if (!UUID_PATTERN.test(requestId)) throw new ShowcaseAccessRequestError('SHOWCASE_ACCESS_REQUEST_NOT_FOUND');
    return this.transaction(async (client) => {
      // 잠금 순서(#304 P2): 승인자 계정을 단독으로 먼저 잠그는 선행 잠금이 있으면, 두 승인자가 서로의 요청을
      // 동시에 결정할 때 각자 자기 계정을 먼저 쥐고 상대 계정을 기다려 교착한다. 요청의 계정을 먼저 알아내
      // (잠금 없이) 승인자·요청자 두 계정을 정렬된 순서로 함께 잠그고, 요청 행을 잠근(FOR UPDATE) 뒤에야
      // 승인자 권한과 상태를 검증한다(재요청·계정 삭제도 계정 → 행 순이라 이 순서와 맞는다).
      const lookup = await client.query<{ account_id: string }>(
        `SELECT account_id FROM showcase_access_requests WHERE id = $1`,
        [requestId],
      );
      const targetAccountId = lookup.rows[0]?.account_id;
      if (targetAccountId === undefined) throw new ShowcaseAccessRequestError('SHOWCASE_ACCESS_REQUEST_NOT_FOUND');
      await this.accountLifecycle.assertAllActive(client, [approverId, targetAccountId]);
      const request = await client.query<{ id: string; account_id: string; status: AccessRequestStatus }>(
        `SELECT id, account_id, status FROM showcase_access_requests WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      const row = request.rows[0];
      // 잠금 전에 읽은 요청 계정과 잠근 뒤 다시 읽은 계정이 같아야 한다. 잠근 계정이 아닌 계정에 권한을 주지 않는다.
      if (!row || row.account_id !== targetAccountId) throw new ShowcaseAccessRequestError('SHOWCASE_ACCESS_REQUEST_NOT_FOUND');
      await this.assertApprover(client, approverId);
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
