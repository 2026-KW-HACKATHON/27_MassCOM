import type { Pool } from 'pg';

export type RetentionStepName =
  | 'auth_sessions'
  | 'web_sessions'
  | 'deletion_intake'
  | 'admin_audit'
  | 'admin_role_audit'
  | 'staff_registration_audit'
  | 'coupon_audit';

export type RetentionCount = { step: RetentionStepName; count: number };
export type RetentionRun = { counts: RetentionCount[]; failed: RetentionStepName[] };

// 감사·삭제 접수 기록의 보관 기간은 1년이다(D-056, 개인정보의 안전성 확보조치 기준 제8조의 접속기록 최소 보관 기간).
// 시각 계산은 세션 시간대에 기대지 않도록 UTC로 고정한다. $1은 명령이 시작할 때 한 번 정한 기준 시각이다.
const oneYearAgo = `(($1::timestamptz AT TIME ZONE 'UTC') - interval '1 year') AT TIME ZONE 'UTC'`;

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
  { name: 'admin_audit', table: 'platform_admin_audit', where: `created_at < ${oneYearAgo}` },
  { name: 'admin_role_audit', table: 'platform_admin_role_audit', where: `created_at < ${oneYearAgo}` },
  { name: 'staff_registration_audit', table: 'staff_registration_audit', where: `created_at < ${oneYearAgo}` },
  // 읽는 곳은 쿠폰 사용 되돌리기의 멱등 재시도 한 곳(10분 창)뿐이라 1년 지난 행은 필요 없다.
  { name: 'coupon_audit', table: 'badge_coupon_audit', where: `created_at < ${oneYearAgo}` },
];

export const retentionStepNames: readonly RetentionStepName[] = steps.map((step) => step.name);

export class PostgresRetentionService {
  private readonly now: () => Date;

  constructor(private readonly pool: Pool, options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
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
   * 단계마다 하나의 거래로 지운다. 한 단계가 실패하면 그 단계만 되돌리고 나머지는 계속한다(한 표의 문제가
   * 다른 표의 정리를 매일 막지 않도록). 실패한 단계 이름은 failed에 담긴다.
   */
  async run(): Promise<RetentionRun> {
    const now = this.now();
    const counts: RetentionCount[] = [];
    const failed: RetentionStepName[] = [];
    for (const step of steps) {
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
    return { counts, failed };
  }
}
