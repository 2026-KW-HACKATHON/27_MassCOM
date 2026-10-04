import type { Pool } from 'pg';

import { PostgresAccountLifecycle } from './account-lifecycle.js';

export type RetentionStepName =
  | 'auth_sessions'
  | 'web_sessions'
  | 'deletion_intake'
  | 'admin_audit'
  | 'admin_owner_audit'
  | 'admin_role_audit'
  | 'staff_registration_audit'
  | 'coupon_audit'
  | 'customer_identity_tokens'
  | 'wallet_challenges'
  | 'web_oauth_states'
  | 'staff_registration_requests'
  | 'showcase_access_requests'
  | 'play_runs'
  | 'deleted_play_data'
  | 'admin_audit_deleted_targets';

export type RetentionCount = { step: RetentionStepName; count: number; capHit?: boolean };
export type RetentionRun = { counts: RetentionCount[]; failed: RetentionStepName[] };

export const playRetentionLimits = { batchSize: 500, maxBatches: 10 } as const;

// 보관 기간(D-059). 처리·감사 기록은 1년(개인정보의 안전성 확보조치 기준 제8조의 접속기록 최소 보관 기간)이지만
// 접근권한을 부여·변경·말소한 기록은 제5조 제3항에 따라 **최소 3년**이라 3년 뒤에 지운다.
// 시각 계산은 세션 시간대에 기대지 않도록 UTC로 고정한다. $1은 명령이 시작할 때 한 번 정한 기준 시각이다.
const ago = (interval: string) => `(($1::timestamptz AT TIME ZONE 'UTC') - interval '${interval}') AT TIME ZONE 'UTC'`;
const oneYearAgo = ago('1 year');
const threeYearsAgo = ago('3 years');
const oneDayAgo = ago('1 day');
const thirtyDaysAgo = ago('30 days');
// 점주를 지정·해제한 감사(0032). 점포 접근권한의 부여·말소 기록이라 3년 보관 대상이다.
const ownerChangeActions = `('MERCHANT_OWNER_GRANTED', 'MERCHANT_OWNER_REVOKED')`;

type Step = { name: RetentionStepName; table: string; where: string };

// 표 이름과 조건은 모두 이 파일의 고정 문자열이다. 단계마다 조건 하나를 세기(report)와 지우기(run)가 함께 쓰므로
// 보고한 개수와 실제로 지우는 행이 같은 기준이다.
const steps: readonly Step[] = [
  // 만료됐거나 해지된 세션. 앱 세션은 로그인 때마다 100건씩 같은 조건으로 이미 정리되고, 웹 세션은 정리가 없었다.
  { name: 'auth_sessions', table: 'auth_sessions', where: 'expires_at <= $1 OR revoked_at IS NOT NULL' },
  { name: 'web_sessions', table: 'web_sessions', where: 'expires_at <= $1 OR revoked_at IS NOT NULL' },
  // 끝난(처리·취소·거절) 삭제 접수만. 끝난 행에는 계정 ID가 이미 없다. 활성(REQUESTED) 접수와 계정 삭제 원장은 건드리지 않는다.
  {
    name: 'deletion_intake',
    table: 'account_deletion_intake_requests',
    where: `status <> 'REQUESTED' AND coalesce(processed_at, cancelled_at, requested_at) < ${oneYearAgo}`,
  },
  // 쓰기만 하는 감사 표들: 이 표를 참조하는 외래 키도, 읽는 코드도 없다.
  // 처리 기록 1년: 점주 지정·해제(접근권한)를 뺀 관리자 처리 기록.
  {
    name: 'admin_audit',
    table: 'platform_admin_audit',
    where: `created_at < ${oneYearAgo} AND action NOT IN ${ownerChangeActions}`,
  },
  // 접근권한 부여·변경·말소 기록 3년(제5조 제3항): 점주 지정·해제, 관리자 권한 부여·회수, 직원 등록 승인·해제.
  {
    name: 'admin_owner_audit',
    table: 'platform_admin_audit',
    where: `created_at < ${threeYearsAgo} AND action IN ${ownerChangeActions}`,
  },
  { name: 'admin_role_audit', table: 'platform_admin_role_audit', where: `created_at < ${threeYearsAgo}` },
  { name: 'staff_registration_audit', table: 'staff_registration_audit', where: `created_at < ${threeYearsAgo}` },
  // 읽는 곳은 쿠폰 사용 되돌리기의 멱등 재시도 한 곳(10분 창)뿐이라 1년 지난 행은 필요 없다.
  { name: 'coupon_audit', table: 'badge_coupon_audit', where: `created_at < ${oneYearAgo}` },
  // 계정 식별자를 가질 수 있는 일회용 행. 모두 몇 분~15분 안에 쓰이고 만료되며, 만료 뒤에는 읽는 곳이 없다(만료 행을 쓰는 쪽은
  // 만료 여부만 보고 거절한다). 하루 여유를 두고 지운다.
  { name: 'customer_identity_tokens', table: 'customer_identity_tokens', where: `expires_at < ${oneDayAgo}` },
  { name: 'wallet_challenges', table: 'wallet_challenges', where: `expires_at < ${oneDayAgo}` },
  { name: 'web_oauth_states', table: 'web_oauth_states', where: `expires_at < ${oneDayAgo}` },
  // 사용했거나 만료된 지 하루가 지난 직원 등록 요청. 승인 조회는 미사용(consumed_at IS NULL) 요청만 보고, 감사 표는 ON DELETE SET NULL이다.
  {
    name: 'staff_registration_requests',
    table: 'staff_registration_requests',
    where: `consumed_at < ${oneDayAgo} OR expires_at < ${oneDayAgo}`,
  },
  // 점주 체험 권한 요청(#294)의 결정된(승인·거절) 행. 결정 자체가 접근권한 부여·말소 기록이라 3년 보관(제5조 제3항).
  // 대기 중(PENDING) 행은 건드리지 않는다.
  {
    name: 'showcase_access_requests',
    table: 'showcase_access_requests',
    where: `status <> 'PENDING' AND decided_at < ${threeYearsAgo}`,
  },
  // 진행 중인 판은 만료 시각부터, 끝난 판은 완료 시각부터 30일 보관한다. 최고 점수는 play_records에 따로 남는다.
  {
    name: 'play_runs',
    table: 'play_runs',
    where: `(finished_at IS NULL AND expires_at < ${thirtyDaysAgo}) OR finished_at < ${thirtyDaysAgo}`,
  },
];

// 비밀이 필요한 마지막 두 단계: 롤백 이미지가 남긴 놀이·공간 행 삭제와 감사 대상 비식별화.
const deletedTargetsStep = 'admin_audit_deleted_targets' as const;
const deletedPlayDataStep = 'deleted_play_data' as const;

export const retentionStepNames: readonly RetentionStepName[] = [...steps.map((step) => step.name), deletedPlayDataStep, deletedTargetsStep];

export class PostgresRetentionService {
  private readonly now: () => Date;
  private readonly playBatchSize: number;
  private readonly playMaxBatches: number;

  constructor(private readonly pool: Pool, options: {
    now?: () => Date; playBatchSize?: number; playMaxBatches?: number;
  } = {}) {
    this.now = options.now ?? (() => new Date());
    this.playBatchSize = options.playBatchSize ?? playRetentionLimits.batchSize;
    this.playMaxBatches = options.playMaxBatches ?? playRetentionLimits.maxBatches;
    // Tests/operators may lower the limits, but cannot turn a daily repair into an unbounded purge.
    for (const [value, maximum] of [[this.playBatchSize, playRetentionLimits.batchSize],
      [this.playMaxBatches, playRetentionLimits.maxBatches]] as const) {
      if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error('RETENTION_LIMIT_INVALID');
    }
  }

  /** 지우지 않고 지울 개수만 센다. */
  async report(): Promise<RetentionCount[]> {
    const now = this.now();
    const counts: RetentionCount[] = [];
    for (const step of steps) {
      const result = await this.pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM ${step.table} WHERE ${step.where}`,
        [now],
      );
      counts.push({ step: step.name, count: result.rows[0]!.count });
    }
    return counts;
  }

  /**
   * 기존 단계는 하나의 거래로, 놀이 단계는 한정된 행 수씩 거래를 나눠 지운다. 실패하면 현재 거래만 되돌리고
   * 나머지 단계는 계속한다. 놀이 단계의 앞선 커밋과 개수는 유지하며 실행 상한은 capHit로 보고한다.
   * `hmacSecret`(계정 삭제와 같은 `ACCOUNT_DELETION_HMAC_SECRET`)을 주면 지우기 단계 뒤에 롤백 이미지가 남긴
   * 놀이·공간 행을 지우고 감사 대상 ID도 비식별화한다. 각 단계는 독립적으로 실패를 보고한다.
   */
  async run(options: { hmacSecret?: string } = {}): Promise<RetentionRun> {
    const now = this.now();
    const counts: RetentionCount[] = [];
    const failed: RetentionStepName[] = [];
    for (const step of steps) {
      if (step.name === 'play_runs') {
        const progress: RetentionCount = { step: step.name, count: 0 };
        try {
          await this.prunePlayRuns(step, now, progress);
          counts.push(progress);
        } catch {
          if (progress.count > 0) counts.push(progress);
          failed.push(step.name);
        }
        continue;
      }
      let client;
      try {
        client = await this.pool.connect();
      } catch {
        failed.push(step.name);
        continue;
      }
      try {
        await client.query('BEGIN');
        const result = await client.query(`DELETE FROM ${step.table} WHERE ${step.where}`, [now]);
        await client.query('COMMIT');
        counts.push({ step: step.name, count: result.rowCount ?? 0 });
      } catch {
        await client.query('ROLLBACK').catch(() => undefined);
        failed.push(step.name);
      } finally {
        client.release();
      }
    }
    if (options.hmacSecret !== undefined) {
      const progress: RetentionCount = { step: deletedPlayDataStep, count: 0 };
      try {
        await this.purgeDeletedPlayData(options.hmacSecret, progress);
        counts.push(progress);
      } catch {
        if (progress.count > 0) counts.push(progress);
        failed.push(deletedPlayDataStep);
      }
      try {
        counts.push({ step: deletedTargetsStep, count: await this.pseudonymizeDeletedAuditTargets(options.hmacSecret) });
      } catch {
        failed.push(deletedTargetsStep);
      }
    }
    return { counts, failed };
  }

  private async prunePlayRuns(step: Step, now: Date, progress: RetentionCount): Promise<void> {
    for (let batch = 0; batch < this.playMaxBatches; batch++) {
      const client = await this.pool.connect();
      let deleted: number;
      try {
        await client.query('BEGIN');
        const result = await client.query(`DELETE FROM play_runs WHERE id IN (
          SELECT id FROM play_runs WHERE ${step.where} ORDER BY id LIMIT $2
        )`, [now, this.playBatchSize]);
        await client.query('COMMIT');
        deleted = result.rowCount ?? 0;
        progress.count += deleted;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally { client.release(); }
      if (deleted < this.playBatchSize) return;
    }
    // A conservative signal avoids an unbounded count of the remaining backlog.
    progress.capHit = true;
  }

  /**
   * Rollback repair for 0042: older API images still insert the deletion ledger but do not know the play tables.
   * Keyset-page candidate IDs, including live-only pages. Each deletion transaction shares one row budget across
   * all three tables; even a single account's run backlog cannot exceed the daily deletion cap. The next daily
   * invocation starts from the beginning so partially purged accounts are retried without a persisted ID cursor.
   */
  private async purgeDeletedPlayData(hmacSecret: string, progress: RetentionCount): Promise<void> {
    const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
    let cursor: string | null = null;
    let batches = 0;
    while (batches < this.playMaxBatches) {
      const accounts: string[] = (await this.pool.query<{ account_id: string }>(
        `SELECT account_id FROM (
           (SELECT DISTINCT account_id FROM play_runs WHERE ($1::text IS NULL OR account_id > $1)
            ORDER BY account_id LIMIT $2)
           UNION
           (SELECT account_id FROM play_records WHERE ($1::text IS NULL OR account_id > $1)
            GROUP BY account_id ORDER BY account_id LIMIT $2)
           UNION
           (SELECT account_id FROM studios WHERE ($1::text IS NULL OR account_id > $1)
            ORDER BY account_id LIMIT $2)
         ) candidates ORDER BY account_id LIMIT $2`,
        [cursor, this.playBatchSize],
      )).rows.map((row) => row.account_id);
      if (accounts.length === 0) return;
      const hashes = accounts.map((accountId) => lifecycle.referenceHash(accountId));
      const known = await this.pool.query<{ account_reference_hash: Buffer }>(
        `SELECT account_reference_hash FROM account_deletion_requests
         WHERE account_reference_hash = ANY($1::bytea[])`, [hashes],
      );
      const gone = new Set(known.rows.map((row) => row.account_reference_hash.toString('hex')));
      const goneAccounts = accounts.filter((_, index) => gone.has(hashes[index]!.toString('hex')));
      if (goneAccounts.length === 0) {
        cursor = accounts.at(-1)!;
        continue;
      }
      while (batches < this.playMaxBatches) {
        const client = await this.pool.connect();
        let deleted = 0;
        try {
          await client.query('BEGIN');
          // All identifiers are fixed here; every table has a primary key for the limited selection.
          for (const [table, key] of [['play_runs', 'id'], ['play_records', '(account_id, kind)'],
            ['studios', 'account_id']] as const) {
            const remaining = this.playBatchSize - deleted;
            if (remaining === 0) break;
            const result = await client.query(`DELETE FROM ${table} WHERE ${key} IN (
              SELECT ${key === '(account_id, kind)' ? 'account_id, kind' : key} FROM ${table}
              WHERE account_id = ANY($1::text[]) ORDER BY ${key} LIMIT $2
            )`, [goneAccounts, remaining]);
            deleted += result.rowCount ?? 0;
          }
          await client.query('COMMIT');
          progress.count += deleted;
          batches++;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }
        if (deleted < this.playBatchSize) {
          // A short candidate page and a short delete batch exhaust this scan naturally, even on the last batch.
          if (accounts.length < this.playBatchSize) return;
          break;
        }
      }
      cursor = accounts.at(-1)!;
    }
    progress.capHit = true;
  }

  /**
   * 롤백 복구(Issue #263): 점주 지정·해제 감사(`platform_admin_audit.target_account_id`)의 대상 계정 열은 계정 삭제가 별칭으로 바꾸지만,
   * 이 열을 모르는 이전 API가 도는 동안 삭제 처리된 계정은 원 ID가 남는다. 매일 정리에 넣어 스스로 복구한다.
   * 계정 삭제(`account-deletion.ts`의 `pseudonymizeAccount`)와 같은 일을 이미 삭제된 계정에 한다: 삭제 원장에 해시가 있는 계정의 원 ID를
   * 원장의 별칭(`deleted:<HMAC>`)으로 바꾼다. 계정 ID는 원장에 없고 HMAC 해시만 있으므로 각 행의 해시를 다시 구해 대조한다.
   * 별칭이 된 행과 살아 있는 계정의 행은 건드리지 않아 다시 실행하면 0이다. 500개 계정씩 한 거래로 처리하며 바꾼 행 수만 돌려준다.
   */
  private async pseudonymizeDeletedAuditTargets(hmacSecret: string): Promise<number> {
    const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
    const accounts = (await this.pool.query<{ target_account_id: string }>(
      `SELECT DISTINCT target_account_id FROM platform_admin_audit
       WHERE target_account_id IS NOT NULL AND target_account_id NOT LIKE 'deleted:%'`,
    )).rows.map((row) => row.target_account_id);
    let updated = 0;
    for (let start = 0; start < accounts.length; start += 500) {
      const batch = accounts.slice(start, start + 500);
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const hashes = batch.map((accountId) => lifecycle.referenceHash(accountId));
        const known = await client.query<{ account_reference_hash: Buffer; deleted_account_alias: string }>(
          `SELECT account_reference_hash, deleted_account_alias FROM account_deletion_requests
           WHERE account_reference_hash = ANY($1::bytea[])`,
          [hashes],
        );
        const aliases = new Map(known.rows.map((row) => [row.account_reference_hash.toString('hex'), row.deleted_account_alias]));
        const goneAccounts: string[] = [];
        const goneAliases: string[] = [];
        batch.forEach((accountId, index) => {
          const alias = aliases.get(hashes[index]!.toString('hex'));
          if (alias !== undefined) {
            goneAccounts.push(accountId);
            goneAliases.push(alias);
          }
        });
        if (goneAccounts.length > 0) {
          const result = await client.query(
            `UPDATE platform_admin_audit AS audit SET target_account_id = gone.alias
             FROM unnest($1::text[], $2::text[]) AS gone(account_id, alias)
             WHERE audit.target_account_id = gone.account_id`,
            [goneAccounts, goneAliases],
          );
          updated += result.rowCount ?? 0;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    return updated;
  }

  /**
   * 롤백 복구용(매일 정리에는 들어 있지 않다): 동의 기능 이전 API가 도는 동안 삭제 처리된 계정은 `account_consents`의 행을 지우지 못한다.
   * 새 API로 다시 올린 뒤 한 번 실행해, 삭제 원장에 해시가 있는 계정의 동의 행을 지운다(가명으로 남기지 않는다). 계정 ID는 원장에 없고
   * HMAC 해시만 있으므로 계정 삭제와 같은 비밀(`ACCOUNT_DELETION_HMAC_SECRET`)로 각 행의 해시를 다시 구해 대조한다. 개수만 돌려준다.
   */
  async purgeConsentsOfDeletedAccounts(hmacSecret: string): Promise<number> {
    const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
    const accounts = (await this.pool.query<{ account_id: string }>(
      'SELECT DISTINCT account_id FROM account_consents',
    )).rows.map((row) => row.account_id);
    let deleted = 0;
    for (let start = 0; start < accounts.length; start += 500) {
      const batch = accounts.slice(start, start + 500);
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const hashes = batch.map((accountId) => lifecycle.referenceHash(accountId));
        const known = await client.query<{ account_reference_hash: Buffer }>(
          'SELECT account_reference_hash FROM account_deletion_requests WHERE account_reference_hash = ANY($1::bytea[])',
          [hashes],
        );
        const gone = new Set(known.rows.map((row) => row.account_reference_hash.toString('hex')));
        const goneAccounts = batch.filter((_, index) => gone.has(hashes[index]!.toString('hex')));
        if (goneAccounts.length > 0) {
          const result = await client.query('DELETE FROM account_consents WHERE account_id = ANY($1::text[])', [goneAccounts]);
          deleted += result.rowCount ?? 0;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }
    return deleted;
  }
}
