import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { AuthSessionError, type IssuedSession } from '../auth-session.js';
import { AccountLifecycleError, PostgresAccountLifecycle } from '../postgres/account-lifecycle.js';
import { tokenHash } from '../postgres/auth-session.js';
import { isShowcaseDatabaseName } from './access-requests.js';
import { SHOWCASE_MERCHANT_ID } from './local-seed.js';

export class GuestTrialError extends Error {
  constructor(
    readonly code: 'SHOWCASE_HOST_DATABASE_REQUIRED' | 'GUEST_TRIAL_BUSY' | 'GUEST_TRIAL_UNAVAILABLE' | 'GUEST_TRIAL_IP_LIMIT',
  ) {
    super(code);
    this.name = 'GuestTrialError';
  }
}

export type GuestTrialSession = IssuedSession & { guest: true };

export const GUEST_TRIAL_TTL_MS = 24 * 60 * 60 * 1000;
const defaultMaxActive = 300;
// 한 클라이언트 IP(키)가 동시에 가질 수 있는 끝나지 않은 체험 수. 심사장처럼 여럿이 한 NAT를 나눠 써도 넉넉하고,
// 한 IP가 만료 직후 다시 시작하는 식으로 전역 상한을 혼자 채우지는 못하게 한다(300 중 30).
const defaultMaxActivePerClient = 30;
// 체험 시작 한 번이 함께 끝내는 만료 체험자 수. 시작 트랜잭션이 길어지지 않게 묶음으로 나눈다.
const sweepBatchSize = 20;
const trialMerchantName = '나의 체험 가게';

/**
 * 로그인 없는 시연 웹 체험(#309). 시작 한 번이 한 트랜잭션에서 만료 체험자 정리 → 동시 체험자 상한 확인 → Google 신원 없는
 * 계정 → 가상 점포 A를 복사한 개인 체험 가게(목록·추천에서는 빠진다) → 그 가게 STAFF → 24시간 세션 → 체험 행을 만든다.
 * 모든 트랜잭션이 시작할 때 현재 DB 이름을 다시 확인한다(access-requests.ts와 같은 규칙).
 */
export class ShowcaseGuestTrialService {
  private readonly accountLifecycle: PostgresAccountLifecycle;
  private readonly hmacSecret: string;
  private readonly maxActive: number;
  private readonly maxActivePerClient: number;
  private readonly now: () => Date;

  constructor(
    private readonly pool: Pool,
    options: {
      accountDeletionHmacSecret: string; maxActive?: number; maxActivePerClient?: number; now?: () => Date;
    },
  ) {
    this.accountLifecycle = new PostgresAccountLifecycle({ hmacSecret: options.accountDeletionHmacSecret });
    this.hmacSecret = options.accountDeletionHmacSecret;
    this.maxActive = options.maxActive ?? defaultMaxActive;
    this.maxActivePerClient = options.maxActivePerClient ?? defaultMaxActivePerClient;
    this.now = options.now ?? (() => new Date());
  }

  // 원래 IP 대신 저장하는 값. 계정 참조 해시와 같은 비밀을 쓰므로 용도 접두어로 값 공간을 나눈다.
  clientKeyHash(clientKey: string): Buffer {
    return createHmac('sha256', this.hmacSecret).update(`showcase-guest-trial-client:${clientKey}`).digest();
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query<{ name: string }>('SELECT current_database() AS name');
      if (!target.rows[0] || !isShowcaseDatabaseName(target.rows[0].name)) {
        throw new GuestTrialError('SHOWCASE_HOST_DATABASE_REQUIRED');
      }
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** `clientKey`는 서버가 IP 제한에 쓰는 것과 같은 클라이언트 키(Caddy가 덮어쓴 IP)다. 원래 값은 저장하지 않는다. */
  async start(input: { clientKey: string }): Promise<GuestTrialSession> {
    const clientKeyHash = this.clientKeyHash(input.clientKey);
    return this.transaction(async (client) => {
      const now = this.now();
      // 상한 확인과 생성을 직렬화한다: 동시에 시작해도 활성 체험자가 상한을 넘지 않는다.
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('showcase-guest-trials', 0))`);
      await this.endExpired(client, now);
      const sameClient = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM showcase_guest_trials
         WHERE client_key_hash = $1 AND ended_at IS NULL AND expires_at > $2`,
        [clientKeyHash, now],
      );
      if (sameClient.rows[0]!.count >= this.maxActivePerClient) throw new GuestTrialError('GUEST_TRIAL_IP_LIMIT');
      const active = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM showcase_guest_trials WHERE ended_at IS NULL AND expires_at > $1`,
        [now],
      );
      if (active.rows[0]!.count >= this.maxActive) throw new GuestTrialError('GUEST_TRIAL_BUSY');

      const source = await client.query<{ id: string }>(
        `SELECT campaign.id FROM campaigns campaign
         JOIN merchants merchant ON merchant.id = campaign.merchant_id
         WHERE campaign.merchant_id = $1 AND merchant.is_demo AND campaign.status = 'ACTIVE' AND campaign.is_public
           AND campaign.starts_at <= $2 AND campaign.ends_at > $2
         ORDER BY campaign.id LIMIT 1`,
        [SHOWCASE_MERCHANT_ID, now],
      );
      const sourceCampaignId = source.rows[0]?.id;
      if (!sourceCampaignId) throw new GuestTrialError('GUEST_TRIAL_UNAVAILABLE');

      const accountId = `acct_${randomUUID()}`;
      const merchantId = `trial-${randomBytes(12).toString('hex')}`;
      const campaignId = `${merchantId}-campaign`;
      const expiresAt = new Date(now.getTime() + GUEST_TRIAL_TTL_MS);
      await client.query(
        `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, menu_items, business_hours,
           neighborhood, category, status, is_demo)
         SELECT $1, $2, story, road_address, minimum_spend_won, menu_items, business_hours,
           neighborhood, category, 'ACTIVE', true
         FROM merchants WHERE id = $3`,
        [merchantId, trialMerchantName, SHOWCASE_MERCHANT_ID],
      );
      // 방문 확인·수집품 게시가 공개 캠페인만 받으므로 is_public은 A와 같다. 대신 공개 목록·추천 쿼리가 체험 가게를 뺀다(D-064).
      await client.query(
        `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
         SELECT $1, $2, title, starts_at, ends_at, 'ACTIVE', true, enrollment_capacity FROM campaigns WHERE id = $3`,
        [campaignId, merchantId, sourceCampaignId],
      );
      await client.query(
        `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
         SELECT $1, target_visit_count, display_name FROM campaign_goals WHERE campaign_id = $2`,
        [campaignId, sourceCampaignId],
      );
      await client.query(
        `INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ($1, $2, 'STAFF', 'ACTIVE')`,
        [merchantId, accountId],
      );
      const sessionToken = randomBytes(32).toString('base64url');
      // 사람이 막 확인한 로그인이 아니므로 최근 인증 시각은 비워 둔다(auth_time 없는 Google 토큰과 같다): 계정 삭제 같은 재인증 동작은 열리지 않는다.
      await client.query(
        `INSERT INTO auth_sessions (id, account_id, token_hash, created_at, expires_at, last_authenticated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), accountId, tokenHash(sessionToken), now, expiresAt, new Date(0)],
      );
      await client.query(
        `INSERT INTO showcase_guest_trials (account_id, merchant_id, created_at, expires_at, client_key_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [accountId, merchantId, now, expiresAt, clientKeyHash],
      );
      return { sessionToken, accountId, expiresAt: expiresAt.toISOString(), guest: true };
    });
  }

  /** 로컬 시연(DEMO 헤더) 배치에서만 쓴다: 체험 세션 Bearer를 체험 계정으로 푼다. hosted는 일반 세션 해석이 같은 행을 읽는다. */
  async resolve(sessionToken: string): Promise<string> {
    return this.transaction(async (client) => {
      const session = await client.query<{ account_id: string }>(
        `SELECT session.account_id FROM auth_sessions session
         JOIN showcase_guest_trials trial ON trial.account_id = session.account_id
         WHERE session.token_hash = $1 AND session.revoked_at IS NULL AND session.expires_at > $2
           AND trial.ended_at IS NULL`,
        [tokenHash(sessionToken), this.now()],
      );
      const accountId = session.rows[0]?.account_id;
      if (!accountId) throw new AuthSessionError('SESSION_INVALID');
      try {
        await this.accountLifecycle.assertActive(client, accountId);
      } catch (error) {
        if (error instanceof AccountLifecycleError) throw new AuthSessionError('SESSION_INVALID');
        throw error;
      }
      return accountId;
    });
  }

  // 만료된 체험자를 끝낸다: 세션 삭제, 멤버십 회수, 체험 가게 중지, ended_at 기록과 클라이언트 키 해시 지우기.
  // ponytail: 방문·수집 기록 행은 지우지 않는다. 지워야 하면 운영자 계정 삭제 명령이 계정 단위로 그대로 동작한다.
  private async endExpired(client: PoolClient, now: Date): Promise<void> {
    const expired = await client.query<{ account_id: string; merchant_id: string }>(
      `SELECT account_id, merchant_id FROM showcase_guest_trials
       WHERE ended_at IS NULL AND expires_at <= $1
       ORDER BY expires_at, account_id LIMIT $2`,
      [now, sweepBatchSize],
    );
    if (expired.rows.length === 0) return;
    const accountIds = expired.rows.map((row) => row.account_id);
    // 잠금 순서: 계정(advisory lock) → 행. 계정 삭제와 같은 순서라 서로 기다려도 교착하지 않는다.
    await this.accountLifecycle.lockAllForDeletion(client, accountIds);
    await client.query('DELETE FROM auth_sessions WHERE account_id = ANY($1::text[])', [accountIds]);
    await client.query(
      `UPDATE merchant_members SET status = 'REVOKED', revoked_at = $2, updated_at = $2
       WHERE account_id = ANY($1::text[]) AND status = 'ACTIVE'`,
      [accountIds, now],
    );
    await client.query(
      `UPDATE merchants SET status = 'PAUSED', updated_at = $2 WHERE id = ANY($1::text[])`,
      [expired.rows.map((row) => row.merchant_id), now],
    );
    await client.query(
      'UPDATE showcase_guest_trials SET ended_at = $2, client_key_hash = NULL WHERE account_id = ANY($1::text[])',
      [accountIds, now],
    );
  }
}
