import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { AuthSessionError } from '../auth-session.js';
import {
  AccountDeletionError,
  type AccountDeletionResult,
  type AccountDeletionService,
  type AccountDeletionStatus,
} from '../account-deletion.js';
import { PostgresAccountLifecycle } from './account-lifecycle.js';

type Options = {
  hmacSecret: string;
  policyVersion: string;
  requireRecentSession: boolean;
  nextRequestId: () => string;
  now: () => Date;
};

type ServiceOptions = Pick<Options, 'hmacSecret' | 'policyVersion'> &
  Partial<typeof defaultOptions> & {
    accountLifecycle?: PostgresAccountLifecycle;
  };

export type RequestRow = {
  id: string;
  deleted_account_alias: string;
  status: AccountDeletionStatus;
  cancelled_mint_jobs: number;
  pending_mint_jobs: number;
  retained_finalized_nfts: number;
  requested_at: Date;
  completed_at: Date | null;
};

const defaultOptions = {
  nextRequestId: (): string => randomUUID(),
  now: () => new Date(),
  requireRecentSession: false,
};

export class PostgresAccountDeletionService implements AccountDeletionService {
  private readonly options: Options;
  private readonly accountLifecycle: PostgresAccountLifecycle;

  constructor(
    private readonly pool: Pool,
    options: ServiceOptions,
  ) {
    this.options = { ...defaultOptions, ...options };
    if (Buffer.byteLength(this.options.hmacSecret) < 32) {
      throw new Error('account deletion HMAC secret must be at least 32 bytes');
    }
    if (!this.options.policyVersion.trim()) {
      throw new Error('account deletion policy version is required');
    }
    this.accountLifecycle =
      options.accountLifecycle ??
      new PostgresAccountLifecycle({ hmacSecret: this.options.hmacSecret });
  }

  async requestDeletion(input: {
    accountId: string;
    confirmation: string;
    sessionToken?: string;
  }): Promise<AccountDeletionResult> {
    if (!input.accountId.trim()) throw new AccountDeletionError('ACCOUNT_REQUIRED');
    if (input.confirmation !== 'DELETE MY ACCOUNT') {
      throw new AccountDeletionError('DELETION_CONFIRMATION_REQUIRED');
    }
    if (this.options.requireRecentSession && !input.sessionToken?.trim()) {
      throw new AuthSessionError('SESSION_REQUIRED');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.lockForDeletion(client, input.accountId);
      const now = input.sessionToken
        ? await assertRecentSession(client, input.accountId, input.sessionToken, this.options.now)
        : this.options.now();
      const { row, replayed } = await this.forgetInTransaction(client, input.accountId, now);
      // A filing made through the web page is closed by the deletion itself, so no raw account ID stays behind (#194).
      await markIntakeProcessed(client, input.accountId, row.id, now, 'self-service');
      await client.query('COMMIT');
      return mapResult(row, replayed);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The forget core, shared by the D-026 self-service path above and the operator path (#194, D-052).
   * The caller owns the transaction and already holds `lockForDeletion` for this account; the recent-session
   * check is the self-service path's concern only.
   */
  async forgetInTransaction(
    client: PoolClient,
    accountId: string,
    now: Date,
  ): Promise<{ row: RequestRow; replayed: boolean }> {
    const referenceHash = this.accountLifecycle.referenceHash(accountId);
    const deletedAlias = `deleted:${referenceHash.toString('hex')}`;

    const existing = await findRequest(client, referenceHash);
    if (existing) return { row: await reconcileExistingRequest(client, existing, now), replayed: true };

    // 취소 UPDATE를 먼저 하고 그 RETURNING 수를 cancelled로 쓴다. 잠금 없는 집계를 먼저 하면 집계와 취소 사이에 워커가
    // lease를 잡은 작업이 cancelled로 세어진 채 취소되지 않고 COMPLETED로 굳는다(원장은 COMPLETED를 다시 보지 않는다, #264).
    // 취소한 행은 이 트랜잭션이 잠갔고 이미 종결 상태라, 그 뒤에 센 남은 비종결 작업이 곧 pending이다.
    const cancelledMintJobs = await cancelUnsentMintJobs(client, accountId, now);
    const counts = await mintCounts(client, accountId);
    await pseudonymizeAccount(client, accountId, deletedAlias, now);

    const status: AccountDeletionStatus =
      counts.pendingMintJobs > 0 ? 'WAITING_FOR_MINT_FINALITY' : 'COMPLETED';
    const inserted = (
      await client.query<RequestRow>(
        `INSERT INTO account_deletion_requests (
           id, account_reference_hash, deleted_account_alias, status, policy_version,
           cancelled_mint_jobs, pending_mint_jobs, retained_finalized_nfts,
           requested_at, completed_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9)
         RETURNING id, deleted_account_alias, status, cancelled_mint_jobs,
                   pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at`,
        [
          this.options.nextRequestId(),
          referenceHash,
          deletedAlias,
          status,
          this.options.policyVersion,
          cancelledMintJobs,
          counts.pendingMintJobs,
          counts.retainedFinalizedNfts,
          now,
          status === 'COMPLETED' ? now : null,
        ],
      )
    ).rows[0]!;
    return { row: inserted, replayed: false };
  }
}

async function assertRecentSession(
  client: PoolClient,
  accountId: string,
  sessionToken: string,
  now: () => Date,
): Promise<Date> {
  const session = (
    await client.query<{
      account_id: string;
      last_authenticated_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT account_id, last_authenticated_at, expires_at, revoked_at
       FROM auth_sessions
       WHERE token_hash = $1
       FOR UPDATE`,
      [createHash('sha256').update(sessionToken).digest()],
    )
  ).rows[0];
  const checkedAt = now();
  if (!session || session.revoked_at || session.expires_at <= checkedAt) {
    throw new AuthSessionError('SESSION_INVALID');
  }
  if (session.account_id !== accountId) throw new AuthSessionError('IDENTITY_MISMATCH');
  const authenticatedAt = session.last_authenticated_at.getTime();
  if (
    authenticatedAt > checkedAt.getTime() ||
    authenticatedAt < checkedAt.getTime() - 5 * 60 * 1000
  ) {
    throw new AuthSessionError('REAUTHENTICATION_REQUIRED');
  }
  return checkedAt;
}

// 취소 UPDATE 뒤에 부른다: 남은 비종결 작업(전송했거나 응답이 유실됐거나 유효한 lease가 있는 것)이 pending이다.
// 이 기준은 reconcileExistingRequest와 같다.
async function mintCounts(
  client: PoolClient,
  accountId: string,
): Promise<{
  pendingMintJobs: number;
  retainedFinalizedNfts: number;
}> {
  const row = (
    await client.query<{
      pending_mint_jobs: number;
      retained_finalized_nfts: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE status NOT IN ('FINALIZED', 'CANCELLED'))::integer AS pending_mint_jobs,
         count(*) FILTER (WHERE status = 'FINALIZED')::integer AS retained_finalized_nfts
       FROM mint_jobs
       WHERE account_id = $1`,
      [accountId],
    )
  ).rows[0]!;
  return {
    pendingMintJobs: row.pending_mint_jobs,
    retainedFinalizedNfts: row.retained_finalized_nfts,
  };
}

async function cancelUnsentMintJobs(
  client: PoolClient,
  accountId: string,
  now: Date,
): Promise<number> {
  // 워커는 작업 행을 잠근 채 lease를 커밋한다. 이 UPDATE만 보내면 그 잠금이 풀릴 때 문장 시작 시점의 낡은 스냅샷으로 lease를
  // 검사해 방금 커밋된 lease를 못 보고 취소해 버린다. 후보 행을 먼저 잠가 기다린 뒤 새 문장으로 취소해야 lease를 본다.
  await client.query(
    `SELECT 1 FROM mint_jobs
     WHERE account_id = $1
       AND status IN ('QUEUED', 'PREPARED', 'RETRYABLE', 'PAUSED', 'MANUAL_REVIEW')
       AND transaction_hash IS NULL
     FOR UPDATE`,
    [accountId],
  );
  const cancelled = await client.query<{ entitlement_id: string }>(
    `UPDATE mint_jobs
     SET status = 'CANCELLED', last_error_code = 'ACCOUNT_DELETION', updated_at = $1
     WHERE account_id = $2
       AND status IN ('QUEUED', 'PREPARED', 'RETRYABLE', 'PAUSED', 'MANUAL_REVIEW')
       AND transaction_hash IS NULL
       AND last_error_code IS DISTINCT FROM 'MINT_SUBMISSION_RESPONSE_LOST'
       AND NOT EXISTS (
         SELECT 1 FROM outbox_events AS outbox
         WHERE outbox.aggregate_id = mint_jobs.id
           AND outbox.status = 'LEASED'
           AND outbox.lease_expires_at > $1
       )
     RETURNING entitlement_id`,
    [now, accountId],
  );
  const entitlementIds = cancelled.rows.map((row) => row.entitlement_id);
  if (entitlementIds.length === 0) return 0;
  await client.query(
    `UPDATE reward_entitlements
     SET status = 'CANCELED', updated_at = $1
     WHERE id = ANY($2::uuid[])`,
    [now, entitlementIds],
  );
  await client.query(
    `UPDATE outbox_events
     SET status = 'PUBLISHED', lease_owner = NULL, lease_expires_at = NULL, updated_at = $1
     WHERE aggregate_id IN (
       SELECT id FROM mint_jobs WHERE entitlement_id = ANY($2::uuid[])
     )`,
    [now, entitlementIds],
  );
  return entitlementIds.length;
}

async function pseudonymizeAccount(
  client: PoolClient,
  accountId: string,
  deletedAlias: string,
  now: Date,
): Promise<void> {
  // 공개 방과 코인 소비권은 계정 삭제와 같은 lifecycle 잠금으로 직렬화한다.
  await client.query('DELETE FROM coin_reroll_consumptions WHERE account_id=$1', [accountId]);
  await client.query('DELETE FROM coin_rerolls WHERE account_id=$1', [accountId]);
  await client.query('DELETE FROM coin_reroll_tickets WHERE account_id=$1', [accountId]);
  await client.query('UPDATE coin_reroll_tickets SET granted_by_account_id=$2 WHERE granted_by_account_id=$1',
    [accountId, deletedAlias]);
  await client.query('DELETE FROM grade_draws WHERE account_id=$1', [accountId]);
  await client.query(`DELETE FROM room_guestbook_reports WHERE reporter_account_id=$1 OR entry_id IN
    (SELECT id FROM room_guestbook_entries WHERE author_account_id=$1 OR room_id IN (SELECT id FROM public_rooms WHERE account_id=$1))`, [accountId]);
  await client.query('UPDATE room_guestbook_reports SET moderated_by_account_id=$2 WHERE moderated_by_account_id=$1', [accountId, deletedAlias]);
  await client.query(`DELETE FROM room_guestbook_entries WHERE author_account_id=$1 OR room_id IN
    (SELECT id FROM public_rooms WHERE account_id=$1)`, [accountId]);
  await client.query(`DELETE FROM room_stamp_reports WHERE reporter_account_id=$1 OR stamp_id IN
    (SELECT id FROM room_stamps WHERE author_account_id=$1 OR room_id IN (SELECT id FROM public_rooms WHERE account_id=$1))`, [accountId]);
  await client.query('UPDATE room_stamp_reports SET moderated_by_account_id=$2 WHERE moderated_by_account_id=$1', [accountId, deletedAlias]);
  await client.query(`DELETE FROM room_stamps WHERE author_account_id=$1 OR room_id IN
    (SELECT id FROM public_rooms WHERE account_id=$1)`, [accountId]);
  await client.query(`DELETE FROM room_visits WHERE visitor_account_id=$1 OR room_id IN
    (SELECT id FROM public_rooms WHERE account_id=$1)`, [accountId]);
  await client.query('DELETE FROM room_blocks WHERE blocker_account_id=$1 OR blocked_account_id=$1', [accountId]);
  await client.query('DELETE FROM public_rooms WHERE account_id=$1', [accountId]);
  await client.query('DELETE FROM coin_series_coupons WHERE account_id=$1', [accountId]);
  await client.query('UPDATE coin_series_coupons SET redeemed_by_account_id=$2 WHERE redeemed_by_account_id=$1', [accountId, deletedAlias]);
  await client.query('DELETE FROM coin_draws WHERE ticket_id IN (SELECT id FROM coin_tickets WHERE account_id=$1)', [accountId]);
  await client.query('DELETE FROM coin_tickets WHERE account_id=$1', [accountId]);
  await client.query('DELETE FROM play_runs WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM play_records WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM studios WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM course_unlocks WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM furniture_purchases WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM furniture_inventory WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM collection_experience_profiles WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM notification_items WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM notification_devices WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM notification_preferences WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM wallet_challenges WHERE account_id = $1', [accountId]);
  // Sessions are deleted, not just revoked: a revoked row would keep the raw account id. A leaked token then finds no
  // row and fails as SESSION_INVALID / WEB_SESSION_INVALID, and the account tombstone still refuses anything that
  // reaches the account by another route.
  // Identities go first: a mobile sign-in that races this deletion upserts the identity row, so it waits on that row lock
  // (or finds no identity) instead of inserting a session after the session rows below were already removed.
  await client.query('DELETE FROM auth_identities WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM web_sessions WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM auth_sessions WHERE account_id = $1', [accountId]);
  // The web/app filing row for this account is closed by markIntakeProcessed once the ledger row exists (#194).
  await client.query('DELETE FROM platform_admins WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM staff_registration_requests WHERE account_id = $1', [accountId]);
  await client.query(`UPDATE staff_registration_audit SET actor_account_id = $1
    WHERE actor_account_id = $2`, [deletedAlias, accountId]);
  await client.query(`UPDATE staff_registration_audit SET target_account_id = $1
    WHERE target_account_id = $2`, [deletedAlias, accountId]);
  // Keep the merchant action trail, but remove the deleted identity from both scalar fields and JSON snapshots.
  await client.query(`UPDATE merchant_campaign_extension_audit SET actor_account_id = $1
    WHERE actor_account_id = $2`, [deletedAlias, accountId]);
  await client.query(`UPDATE merchant_staff_action_audit SET actor_account_id = $1
    WHERE actor_account_id = $2`, [deletedAlias, accountId]);
  await client.query(`UPDATE merchant_staff_action_audit SET target_account_id = $1,
    before_permissions = before_permissions - 'accountId',
    after_permissions = after_permissions - 'accountId'
    WHERE target_account_id = $2`, [deletedAlias, accountId]);
  await client.query(
    'UPDATE platform_admin_role_audit SET target_account_id = $1 WHERE target_account_id = $2',
    [deletedAlias, accountId],
  );
  // 점주 체험 권한 요청(#294): 대기 중 요청은 그대로 두면 계정이 지워진 뒤에도 승인 가능한 자격 증명으로 남는다
  // (APP 승인·OPS 명령 모두 요청 행 자체를 자격 증명으로 본다). 삭제해 더는 결정할 수 없게 한다.
  // 이미 결정된(감사) 행만 요청자 열을 별칭으로 바꿔 남긴다.
  await client.query(
    `DELETE FROM showcase_access_requests WHERE account_id = $1 AND status = 'PENDING'`,
    [accountId],
  );
  await client.query(
    'UPDATE showcase_access_requests SET account_id = $1 WHERE account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query(
    'UPDATE showcase_access_requests SET decided_by_account_id = $1 WHERE decided_by_account_id = $2',
    [deletedAlias, accountId],
  );
  // 로그인 없는 체험(#309): 체험 행은 지우지 않고 별칭으로 남긴다. 지우면 체험 가게가 공개 목록·추천 제외(이 표로 거른다)에서
  // 빠지고 만료 정리도 그 가게를 멈추지 못한다. 클라이언트 IP의 HMAC은 더 둘 이유가 없어 지운다.
  await client.query(
    'UPDATE showcase_guest_trials SET account_id = $1, client_key_hash = NULL WHERE account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query(
    'UPDATE platform_admin_audit SET actor_account_id = $1 WHERE actor_account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query('UPDATE courses SET curated_by_account_id = $1 WHERE curated_by_account_id = $2',
    [deletedAlias, accountId]);
  // 점주 올리기·내리기 감사의 대상 계정(#246). JSON 상태에는 계정 식별자를 넣지 않으므로 이 열만 바꾸면 된다.
  await client.query(
    'UPDATE platform_admin_audit SET target_account_id = $1 WHERE target_account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query(
    `DELETE FROM customer_identity_tokens
     WHERE customer_account_id = $1 OR bound_staff_account_id = $1`,
    [accountId],
  );
  await client.query(
    `INSERT INTO merchant_members (
       merchant_id, account_id, role, status, granted_at, revoked_at, updated_at
     )
     SELECT merchant_id, $1, role, 'REVOKED', granted_at, $2, $2
     FROM merchant_members
     WHERE account_id = $3
     ON CONFLICT (merchant_id, account_id)
     DO UPDATE SET status = 'REVOKED', revoked_at = $2, updated_at = $2`,
    [deletedAlias, now, accountId],
  );
  await client.query(
    `UPDATE claim_slots SET created_by_account_id = $1, updated_at = $2
     WHERE created_by_account_id = $3`,
    [deletedAlias, now, accountId],
  );
  await client.query('DELETE FROM merchant_members WHERE account_id = $1', [accountId]);
  await client.query(
    `UPDATE claim_slots SET customer_account_id = $1, updated_at = $2
     WHERE customer_account_id = $3`,
    [deletedAlias, now, accountId],
  );
  await client.query(
    `UPDATE visit_events SET customer_account_id = $1, updated_at = $2
     WHERE customer_account_id = $3`,
    [deletedAlias, now, accountId],
  );
  await client.query(
    `UPDATE reward_entitlements SET customer_account_id = $1, updated_at = $2
     WHERE customer_account_id = $3`,
    [deletedAlias, now, accountId],
  );
  // 보상 쿠폰은 지우지 않고 계정 열만 가명으로 바꾼다. 발급 수(issued_count)와 사용 감사 기록을 유지한다.
  await client.query(
    'UPDATE badge_coupons SET customer_account_id = $1 WHERE customer_account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query(
    'UPDATE badge_coupons SET redeemed_by_account_id = $1 WHERE redeemed_by_account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query('UPDATE campaign_benefit_coupons SET customer_account_id = $1 WHERE customer_account_id = $2', [deletedAlias, accountId]);
  await client.query('UPDATE campaign_benefit_coupons SET redeemed_by_account_id = $1 WHERE redeemed_by_account_id = $2', [deletedAlias, accountId]);
  await client.query('UPDATE campaign_benefit_coupons SET voided_by_account_id = $1 WHERE voided_by_account_id = $2', [deletedAlias, accountId]);
  // 되돌리기(Issue #243)의 처리자 열: 방문을 취소한 점원, 쿠폰을 무효로 한 점원, 사용을 되돌린 점원과 원래 사용 처리자.
  await client.query(
    'UPDATE visit_events SET canceled_by_account_id = $1 WHERE canceled_by_account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query(
    'UPDATE badge_coupons SET voided_by_account_id = $1 WHERE voided_by_account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query(
    'UPDATE badge_coupon_audit SET actor_account_id = $1 WHERE actor_account_id = $2',
    [deletedAlias, accountId],
  );
  await client.query(
    `UPDATE badge_coupon_audit SET previous_redeemed_by_account_id = $1
     WHERE previous_redeemed_by_account_id = $2`,
    [deletedAlias, accountId],
  );
  // 친구 데이터는 가명으로 남기지 않고 지운다: 이 계정의 코드·별명·코드 입력 실패 기록과 양쪽 친구 관계·차단.
  // 친구 추가는 같은 계정 잠금을 잡으므로(assertAllActive) 이 거래와 직렬화되어 삭제 뒤에 관계가 생기지 않는다.
  // 우편 상대방의 복사본과 발송 대기도 함께 지운다. 본문·정확한 식사 시각·토큰을 삭제 계정에 남기지 않는다.
  await client.query('DELETE FROM social_notification_deliveries WHERE account_id = $1', [accountId]);
  await client.query(`DELETE FROM notification_outbox WHERE account_id = $1 OR mail_id IN
    (SELECT id FROM social_mail WHERE sender_account_id = $1 OR receiver_account_id = $1)`, [accountId]);
  await client.query('DELETE FROM social_mail WHERE sender_account_id = $1 OR receiver_account_id = $1', [accountId]);
  await client.query('DELETE FROM meal_invitations WHERE sender_account_id = $1 OR receiver_account_id = $1', [accountId]);
  await client.query('DELETE FROM friendship_gifts WHERE sender_account_id = $1 OR receiver_account_id = $1', [accountId]);
  await client.query('DELETE FROM push_tokens WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM mileage_credits WHERE account_id = $1', [accountId]);
  await client.query(
    'DELETE FROM friendships WHERE account_low = $1 OR account_high = $1',
    [accountId],
  );
  // 끊기가 만든 차단은 양쪽 칸 어디에 있든 지운다. 끊기(remove)는 같은 계정 잠금을 잡으므로 이 거래보다 뒤에 차단이 생기지 않는다.
  await client.query(
    'DELETE FROM friend_blocks WHERE blocker = $1 OR blocked = $1',
    [accountId],
  );
  await client.query('DELETE FROM friend_codes WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM explorer_profiles WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM friend_code_attempts WHERE account_id = $1', [accountId]);
  // 동의 기록(Issue #253)은 가명으로 남기지 않고 지운다: 삭제된 계정이 무엇에 언제 동의했는지 남길 이유가 없다.
  // 동의 기록은 같은 계정 잠금을 잡으므로(assertActive) 이 거래와 직렬화되어 삭제 뒤에 행이 생기지 않는다.
  await client.query('DELETE FROM account_consents WHERE account_id = $1', [accountId]);
  // 마일리지 상점(Issue #298)도 가명으로 남기지 않고 지운다: 보존 기간이 없다. 재뽑기·소유 캐릭터·대표 캐릭터는
  // 같은 계정 잠금(assertActive, postgres/mileage-shop.ts)을 잡으므로 이 거래와 직렬화되어 삭제 뒤에 생기지 않는다.
  // account_profile은 FK ON DELETE SET NULL로 account_characters보다 먼저 지워도 대표만 비워지지만,
  // 어차피 계정 자체를 지우는 거래라 순서를 가릴 필요 없이 둘 다 지운다.
  await client.query('DELETE FROM account_profile WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM account_clothing WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM account_characters WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM mileage_spends WHERE account_id = $1', [accountId]);
  await client.query('DELETE FROM store_ticket_openings WHERE account_id = $1', [accountId]);
  // 방문 후 가게 특징·바라는 점·의견(Issue #334)도 가명으로 남기지 않고 지운다: 보존 기간이 없고 계정 수명만큼만 둔다.
  // 저장은 같은 계정 잠금(assertActive, postgres/visitor-feedback.ts)을 잡으므로 이 거래와 직렬화되어 삭제 뒤에 행이 생기지 않는다.
  await client.query('DELETE FROM merchant_visitor_feedback WHERE customer_account_id = $1', [accountId]);
  await client.query('DELETE FROM merchant_real_world_reports WHERE reporter_account_id = $1', [accountId]);
  // AI 가게 그림 라운드는 가게의 자산이라 지우지 않고 요청자 열만 비운다(가게 그림·비용 기록에는 계정 ID가 없다).
  await client.query(
    'UPDATE merchant_art_rounds SET requested_by_account_id = NULL WHERE requested_by_account_id = $1',
    [accountId],
  );
  // 사진 원본·편집 좌표와 작성자 식별자는 지우고, 이 계정이 작성·편집에 참여한 발행본은 캠페인 배포 연결을 끊어
  // 새 방문 고객에게 더 나가지 않게 한다. 이미 획득한 고객의 불변 발행본 등급 자료는 가게 자산으로 유지한다.
  // 원본만 비운 게시 프로젝트(project IS NULL)도 작성자 열·기여자 행이 남아 있으면 여기서 찾는다.
  const authored = `collectible_projects.created_by_account_id = $1 OR collectible_projects.edited_by_account_id = $1 OR EXISTS (
    SELECT 1 FROM collectible_project_contributors contributor
    WHERE contributor.project_id = collectible_projects.id AND contributor.account_id = $1)`;
  const sourceMerchants = await client.query<{merchant_id:string}>(`SELECT DISTINCT merchant_id
    FROM collectible_projects WHERE ${authored} ORDER BY merchant_id`,[accountId]);
  for(const sourceMerchant of sourceMerchants.rows) {
    // 게시·게시 중지·복사·삭제와 같은 가게별 잠금이다(그 거래들도 시작할 때 이 잠금을 잡는다).
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`collectible-sources:${sourceMerchant.merchant_id}`]);
  }
  // 게시 중지와 같이 연결된 캠페인 행을 id 순서로 FOR UPDATE 잠근다: 진행 중인 보상권 트리거(FOR KEY SHARE)가 끝난 뒤
  // 연결을 지우므로, 이 거래가 끝난 뒤에는 삭제한 점주의 발행본을 새로 잡는 획득이 없다.
  await client.query(
    `SELECT campaign.id FROM campaigns campaign WHERE campaign.id IN (
       SELECT link.campaign_id FROM campaign_collectible_publications link
       JOIN collectible_projects ON collectible_projects.publication_id = link.publication_id WHERE ${authored})
     ORDER BY campaign.id FOR UPDATE OF campaign`,
    [accountId],
  );
  await client.query(
    `DELETE FROM campaign_collectible_publications link USING collectible_projects
     WHERE link.publication_id = collectible_projects.publication_id AND (${authored})`,
    [accountId],
  );
  const clearedSources = await client.query<{ id: string }>(
    `UPDATE collectible_projects SET project = NULL, name = NULL, created_by_account_id = NULL, edited_by_account_id = NULL,
       updated_at = now()
     WHERE ${authored} RETURNING id`,
    [accountId],
  );
  await client.query('DELETE FROM collectible_project_contributors WHERE project_id = ANY($1::uuid[])',
    [clearedSources.rows.map(row => row.id)]);
  // Enrollment rows are re-aliased, not deleted; the campaign slot they reserved is not
  // returned so enrolled_count never exceeds the promised enrollment_capacity.
  await client.query(
    `UPDATE campaign_enrollments SET account_id = $1
     WHERE account_id = $2`,
    [deletedAlias, accountId],
  );
  await client.query(
    `UPDATE wallet_bindings
     SET account_id = $1, status = 'DISCONNECTED', disconnected_at = coalesce(disconnected_at, $2),
         updated_at = $2
     WHERE account_id = $3`,
    [deletedAlias, now, accountId],
  );
  await client.query(
    `UPDATE mint_jobs SET account_id = $1, updated_at = $2
     WHERE account_id = $3`,
    [deletedAlias, now, accountId],
  );
}

async function findRequest(
  client: PoolClient,
  referenceHash: Buffer,
): Promise<RequestRow | undefined> {
  return (
    await client.query<RequestRow>(
      `SELECT id, deleted_account_alias, status, cancelled_mint_jobs,
              pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at
       FROM account_deletion_requests
       WHERE account_reference_hash = $1
       FOR UPDATE`,
      [referenceHash],
    )
  ).rows[0];
}

/** Closes the account's active filing (if any) as processed and drops its raw account ID; returns whether one existed. */
export async function markIntakeProcessed(
  client: PoolClient,
  accountId: string,
  ledgerId: string,
  now: Date,
  processedBy: string,
): Promise<boolean> {
  const closed = await client.query(
    `UPDATE account_deletion_intake_requests
     SET status = 'PROCESSED', account_id = NULL, processed_at = $3, processed_by = $4, deletion_request_id = $2
     WHERE account_id = $1`,
    [accountId, ledgerId, now, processedBy],
  );
  return closed.rowCount === 1;
}

/**
 * Advances ledgers that were left at WAITING_FOR_MINT_FINALITY. Before #194 this only ran when the deleted account
 * itself replayed its request, which cannot happen once its sessions are revoked, so a ledger never completed.
 */
export async function reconcileWaitingRequests(
  client: PoolClient,
  now: Date,
  limit = 100,
): Promise<{ checked: number; completed: number; waiting: number }> {
  const rows = (
    await client.query<RequestRow>(
      `SELECT id, deleted_account_alias, status, cancelled_mint_jobs,
              pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at
       FROM account_deletion_requests
       WHERE status = 'WAITING_FOR_MINT_FINALITY'
       ORDER BY updated_at, id
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    )
  ).rows;
  let completed = 0;
  for (const row of rows) {
    if ((await reconcileExistingRequest(client, row, now)).status === 'COMPLETED') completed += 1;
  }
  return { checked: rows.length, completed, waiting: rows.length - completed };
}

async function reconcileExistingRequest(
  client: PoolClient,
  request: RequestRow,
  now: Date,
): Promise<RequestRow> {
  if (request.status === 'COMPLETED') return request;
  const counts = (
    await client.query<{ pending: number; finalized: number }>(
      `SELECT
         count(*) FILTER (WHERE status NOT IN ('FINALIZED', 'CANCELLED'))::integer AS pending,
         count(*) FILTER (WHERE status = 'FINALIZED')::integer AS finalized
       FROM mint_jobs
       WHERE account_id = $1`,
      [request.deleted_account_alias],
    )
  ).rows[0]!;
  const status: AccountDeletionStatus = counts.pending > 0
    ? 'WAITING_FOR_MINT_FINALITY'
    : 'COMPLETED';
  return (
    await client.query<RequestRow>(
      `UPDATE account_deletion_requests
       SET status = $1, pending_mint_jobs = $2, retained_finalized_nfts = $3,
           completed_at = CASE WHEN $1 = 'COMPLETED' THEN $4::timestamptz ELSE NULL END,
           updated_at = $4
       WHERE id = $5
       RETURNING id, deleted_account_alias, status, cancelled_mint_jobs,
                 pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at`,
      [status, counts.pending, counts.finalized, now, request.id],
    )
  ).rows[0]!;
}

function mapResult(row: RequestRow, replayed: boolean): AccountDeletionResult {
  return {
    requestId: row.id,
    status: row.status,
    requestedAt: row.requested_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    cancelledMintJobs: row.cancelled_mint_jobs,
    pendingMintJobs: row.pending_mint_jobs,
    retainedFinalizedNfts: row.retained_finalized_nfts,
    replayed,
  };
}
