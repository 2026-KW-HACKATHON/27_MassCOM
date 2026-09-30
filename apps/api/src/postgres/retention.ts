import type { Pool } from 'pg';

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
  | 'staff_registration_requests';

export type RetentionCount = { step: RetentionStepName; count: number };
export type RetentionRun = { counts: RetentionCount[]; failed: RetentionStepName[] };

// 보관 기간(D-056). 처리·감사 기록은 1년(개인정보의 안전성 확보조치 기준 제8조의 접속기록 최소 보관 기간)이지만
// 접근권한을 부여·변경·말소한 기록은 제5조 제3항에 따라 **최소 3년**이라 3년 뒤에 지운다.
// 시각 계산은 세션 시간대에 기대지 않도록 UTC로 고정한다. $1은 명령이 시작할 때 한 번 정한 기준 시각이다.
const ago = (interval: string) => `(($1::timestamptz AT TIME ZONE 'UTC') - interval '${interval}') AT TIME ZONE 'UTC'`;
const oneYearAgo = ago('1 year');
const threeYearsAgo = ago('3 years');
const oneDayAgo = ago('1 day');
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
