import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { buildMedals, type MedalValues } from '../badge-rules.js';
import {
  FriendError,
  type AddedFriend,
  type FriendService,
} from '../friends.js';
import {
  buildFriendsSnapshot,
  defaultNicknamePrefix,
  generateDefaultNickname,
  generateFriendCode,
  isFriendCode,
  maxFriends,
  normalizeFriendCode,
  orderAccountPair,
  parseNickname,
  type FriendSource,
  type FriendsSnapshot,
} from '../friends-rules.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { countedVisitFilterSql, countedVisitFromSql } from './badge-rewards.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 코드 충돌은 32^8분의 1 확률이라 몇 번만 다시 뽑는다.
const codeGenerationAttempts = 8;

// /me/badges와 같은 "센 방문" 규칙(countedVisit*Sql)을 여러 계정에 한 번에 적용한다. 계정마다 값이 같아야 하므로
// friends.postgres.integration.ts가 getBadges와 값을 직접 비교한다.
const medalValuesForAccountsSql = `
  WITH counted AS (
    SELECT visit.customer_account_id AS account_id, visit.merchant_id, visit.business_date
    ${countedVisitFromSql}
    WHERE visit.customer_account_id = ANY($1::text[]) AND ${countedVisitFilterSql}
  ), per_merchant AS (
    SELECT account_id, merchant_id, count(*)::integer AS visits FROM counted GROUP BY account_id, merchant_id
  )
  SELECT per_merchant.account_id,
         count(*)::integer AS explorer,
         max(per_merchant.visits)::integer AS regular,
         (SELECT count(DISTINCT counted.business_date) FROM counted
          WHERE counted.account_id = per_merchant.account_id)::integer AS steady
  FROM per_merchant
  GROUP BY per_merchant.account_id`;

// 도장은 가본 점포 이름뿐이다. 방문 날짜·횟수는 고르지 않고, 순서는 이름순이라 방문 순서도 드러나지 않는다.
const stampsForAccountsSql = `
  SELECT visit.customer_account_id AS account_id, merchant.name AS merchant_name
  ${countedVisitFromSql}
  WHERE visit.customer_account_id = ANY($1::text[]) AND ${countedVisitFilterSql}
  GROUP BY visit.customer_account_id, visit.merchant_id, merchant.name
  ORDER BY visit.customer_account_id, merchant.name COLLATE "C", visit.merchant_id`;

type Options = {
  accountLifecycle: PostgresAccountLifecycle;
  now?: () => Date;
  nextFriendshipId?: () => string;
  nextCode?: () => string;
  nextDefaultNickname?: () => string;
  maxFailedAttempts?: number;
  attemptWindowMs?: number;
};

type AddOutcome =
  | { kind: 'added'; friendshipId: string; created: boolean }
  | { kind: 'failed'; error: FriendError };

export class PostgresFriendService implements FriendService {
  private readonly accountLifecycle: PostgresAccountLifecycle;
  private readonly now: () => Date;
  private readonly nextFriendshipId: () => string;
  private readonly nextCode: () => string;
  private readonly nextDefaultNickname: () => string;
  private readonly maxFailedAttempts: number;
  private readonly attemptWindowMs: number;

  constructor(private readonly pool: Pool, options: Options) {
    this.accountLifecycle = options.accountLifecycle;
    this.now = options.now ?? (() => new Date());
    this.nextFriendshipId = options.nextFriendshipId ?? randomUUID;
    this.nextCode = options.nextCode ?? (() => generateFriendCode());
    this.nextDefaultNickname = options.nextDefaultNickname ?? (() => generateDefaultNickname());
    this.maxFailedAttempts = options.maxFailedAttempts ?? 10;
    this.attemptWindowMs = options.attemptWindowMs ?? 10 * 60 * 1000;
  }

  async list(accountId: string): Promise<FriendsSnapshot> {
    await this.getOrCreateCode(accountId);
    // 한 스냅샷에서 읽어 친구 관계·별명·메달이 서로 어긋나지 않게 한다.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const rows = await client.query<{ friendship_id: string; friend_account_id: string }>(
        `SELECT id AS friendship_id,
                CASE WHEN account_low = $1 THEN account_high ELSE account_low END AS friend_account_id
         FROM friendships
         WHERE account_low = $1 OR account_high = $1`,
        [accountId],
      );
      const accountIds = [accountId, ...rows.rows.map((row) => row.friend_account_id)];
      const profiles = await client.query<{ account_id: string; nickname: string }>(
        'SELECT account_id, nickname FROM explorer_profiles WHERE account_id = ANY($1::text[])',
        [accountIds],
      );
      const codes = await client.query<{ account_id: string; code: string }>(
        'SELECT account_id, code FROM friend_codes WHERE account_id = ANY($1::text[])',
        [accountIds],
      );
      const values = await client.query<MedalValues & { account_id: string }>(
        medalValuesForAccountsSql, [accountIds],
      );
      const stamps = await client.query<{ account_id: string; merchant_name: string }>(
        stampsForAccountsSql, [accountIds],
      );
      await client.query('COMMIT');

      const nicknames = new Map(profiles.rows.map((row) => [row.account_id, row.nickname]));
      const codeOf = new Map(codes.rows.map((row) => [row.account_id, row.code]));
      const medalsOf = (id: string) => {
        const row = values.rows.find((candidate) => candidate.account_id === id);
        return buildMedals({
          explorer: row?.explorer ?? 0, regular: row?.regular ?? 0, steady: row?.steady ?? 0,
        });
      };
      const stampsOf = (id: string) => stamps.rows
        .filter((row) => row.account_id === id)
        .map((row) => ({ merchantName: row.merchant_name }));
      // 기본 별명은 첫 코드와 함께 저장된다. 행이 없는 옛 계정은 코드에서 별명을 만들지 않고 "탐험가"로 보인다.
      const nicknameOf = (id: string) => nicknames.get(id) ?? defaultNicknamePrefix;

      const friends: FriendSource[] = rows.rows.map((row) => ({
        friendshipId: row.friendship_id,
        nickname: nicknameOf(row.friend_account_id),
        medals: medalsOf(row.friend_account_id),
        stamps: stampsOf(row.friend_account_id),
      }));
      // 내 코드가 스냅샷에 없으면 getOrCreateCode 뒤에 계정 삭제가 끼어든 것이다.
      const myCode = codeOf.get(accountId);
      if (!myCode) throw new FriendError('ACCOUNT_DELETED');
      return buildFriendsSnapshot({
        nickname: nicknameOf(accountId),
        code: myCode,
        medals: medalsOf(accountId),
        stampCount: stampsOf(accountId).length,
      }, friends);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async addByCode(input: { accountId: string; code: string }): Promise<AddedFriend> {
    const me = input.accountId;
    const code = normalizeFriendCode(input.code);
    const outcome = await this.transaction<AddOutcome>(async (client) => {
      // 같은 계정의 코드 입력은 여기서 직렬화한다. 그래야 동시에 여러 번 넣어도 실패 횟수 제한을 넘지 못한다.
      // 계정 잠금과 다른 키이고 항상 계정 잠금보다 먼저 잡으므로 교착이 생기지 않는다.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `friend-code-attempts:${me}`,
      ]);
      const now = this.now();
      const limited = await client.query<{ attempted_at: Date }>(
        `SELECT attempted_at FROM friend_code_attempts
         WHERE account_id = $1 AND attempted_at > $2
         ORDER BY attempted_at DESC OFFSET $3 LIMIT 1`,
        [me, new Date(now.getTime() - this.attemptWindowMs), this.maxFailedAttempts - 1],
      );
      if (limited.rows[0]) {
        const retryAfterMs = limited.rows[0].attempted_at.getTime() + this.attemptWindowMs - now.getTime();
        throw new FriendError('FRIEND_CODE_RATE_LIMITED', Math.max(1, Math.ceil(retryAfterMs / 1000)));
      }

      const found = isFriendCode(code)
        ? (await client.query<{ account_id: string }>(
          'SELECT account_id FROM friend_codes WHERE code = $1', [code],
        )).rows[0]
        : undefined;
      if (!found) {
        // 실패 기록은 계정 삭제 뒤에 남지 않도록 살아 있는 계정만 남긴다(아직 다른 계정 잠금은 없다).
        await this.accountLifecycle.assertActive(client, me);
        return this.recordFailure(client, me, now);
      }
      const target = found.account_id;
      if (target === me) throw new FriendError('FRIEND_SELF');

      // 두 계정을 정렬된 순서로 함께 잠근다. 그래서 A→B와 B→A가 동시에 와도 교착 없이 한 줄만 만들어지고
      // 계정 삭제와도 직렬화된다.
      try {
        await this.accountLifecycle.assertAllActive(client, [me, target]);
      } catch (error) {
        if (!(error instanceof AccountLifecycleError)) throw error;
        // 잠금 순서는 이미 정렬 순서다. 내 계정이 삭제된 것이면 여기서 다시 던지고, 아니면 상대가 방금 삭제된 것이다.
        await this.accountLifecycle.assertActive(client, me);
        return this.recordFailure(client, me, now);
      }
      // 잠금을 기다리는 사이 상대가 코드를 바꿨다면 옛 코드는 이미 무효다.
      const owner = await client.query<{ account_id: string }>(
        'SELECT account_id FROM friend_codes WHERE code = $1', [code],
      );
      if (owner.rows[0]?.account_id !== target) return this.recordFailure(client, me, now);

      const { low, high } = orderAccountPair(me, target);
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM friendships WHERE account_low = $1 AND account_high = $2', [low, high],
      );
      if (existing.rows[0]) {
        return { kind: 'added', friendshipId: existing.rows[0].id, created: false };
      }
      const counts = await client.query<{ mine: number; theirs: number }>(
        `SELECT
           (SELECT count(*) FROM friendships WHERE account_low = $1 OR account_high = $1)::integer AS mine,
           (SELECT count(*) FROM friendships WHERE account_low = $2 OR account_high = $2)::integer AS theirs`,
        [me, target],
      );
      if (counts.rows[0]!.mine >= maxFriends || counts.rows[0]!.theirs >= maxFriends) {
        throw new FriendError('FRIEND_LIMIT');
      }
      // 내 코드가 아직 없어도 상대가 나를 다시 추가하고 별명이 보이도록 이때 만들어 둔다.
      await this.ensureCode(client, me, now);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO friendships (id, account_low, account_high, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (account_low, account_high) DO NOTHING
         RETURNING id`,
        [this.nextFriendshipId(), low, high, now],
      );
      if (inserted.rows[0]) return { kind: 'added', friendshipId: inserted.rows[0].id, created: true };
      const raced = await client.query<{ id: string }>(
        'SELECT id FROM friendships WHERE account_low = $1 AND account_high = $2', [low, high],
      );
      return { kind: 'added', friendshipId: raced.rows[0]!.id, created: false };
    });
    if (outcome.kind === 'failed') throw outcome.error;

    const snapshot = await this.list(me);
    const friend = snapshot.friends.find((candidate) => candidate.friendshipId === outcome.friendshipId);
    // 거래가 끝난 직후 상대가 계정을 삭제했거나 관계를 끊었다면 방금 추가한 관계가 이미 없다. 코드가 사라진 것과 같다.
    if (!friend) throw new FriendError('FRIEND_CODE_NOT_FOUND');
    return { friend, created: outcome.created };
  }

  async remove(input: { accountId: string; friendshipId: string }): Promise<void> {
    // 내가 속한 관계만 지운다. 남의 관계·없는 관계·UUID가 아닌 값은 구분 없이 같은 404다.
    if (!uuidPattern.test(input.friendshipId)) throw new FriendError('FRIEND_NOT_FOUND');
    const removed = await this.pool.query(
      `DELETE FROM friendships
       WHERE id = $1 AND (account_low = $2 OR account_high = $2)`,
      [input.friendshipId, input.accountId],
    );
    if (removed.rowCount !== 1) throw new FriendError('FRIEND_NOT_FOUND');
  }

  async rotateCode(accountId: string): Promise<{ code: string }> {
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, accountId);
      const now = this.now();
      const existing = (await client.query<{ code: string; created_at: Date }>(
        'SELECT code, created_at FROM friend_codes WHERE account_id = $1 FOR UPDATE', [accountId],
      )).rows[0];
      if (!existing) return { code: await this.createFirstCode(client, accountId, now) };
      // 행을 지우고 새 코드로 다시 넣는다. 옛 코드는 이 거래가 끝나는 순간 조회되지 않고, 친구 관계는 그대로다.
      await client.query('DELETE FROM friend_codes WHERE account_id = $1', [accountId]);
      return {
        code: await this.insertCode(client, accountId, {
          createdAt: existing.created_at, rotatedAt: now, avoid: existing.code,
        }),
      };
    });
  }

  async setNickname(input: { accountId: string; nickname: string }): Promise<{ nickname: string }> {
    const nickname = parseNickname(input.nickname);
    if (nickname === null) throw new FriendError('FRIEND_NICKNAME_INVALID');
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, input.accountId);
      await client.query(
        `INSERT INTO explorer_profiles (account_id, nickname, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = EXCLUDED.updated_at`,
        [input.accountId, nickname, this.now()],
      );
      return { nickname };
    });
  }

  private async getOrCreateCode(accountId: string): Promise<string> {
    const found = await this.pool.query<{ code: string }>(
      'SELECT code FROM friend_codes WHERE account_id = $1', [accountId],
    );
    if (found.rows[0]) return found.rows[0].code;
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, accountId);
      return this.ensureCode(client, accountId, this.now());
    });
  }

  // 호출하는 거래가 이미 이 계정의 생명주기 잠금을 잡고 있어야 한다(계정당 코드 행을 쓰는 곳은 모두 그렇다).
  private async ensureCode(client: PoolClient, accountId: string, now: Date): Promise<string> {
    const existing = await client.query<{ code: string }>(
      'SELECT code FROM friend_codes WHERE account_id = $1', [accountId],
    );
    if (existing.rows[0]) return existing.rows[0].code;
    return this.createFirstCode(client, accountId, now);
  }

  // 계정의 첫 코드는 기본 별명과 같은 거래에서 만든다. 이미 정한 별명이 있으면 건드리지 않는다.
  private async createFirstCode(client: PoolClient, accountId: string, now: Date): Promise<string> {
    const code = await this.insertCode(client, accountId, { createdAt: now });
    await client.query(
      `INSERT INTO explorer_profiles (account_id, nickname, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id) DO NOTHING`,
      [accountId, this.nextDefaultNickname(), now],
    );
    return code;
  }

  private async insertCode(client: PoolClient, accountId: string, input: {
    createdAt: Date; rotatedAt?: Date; avoid?: string;
  }): Promise<string> {
    for (let attempt = 0; attempt < codeGenerationAttempts; attempt++) {
      const code = this.nextCode();
      if (code === input.avoid) continue;
      // 다른 계정의 코드와 겹치면 아무 행도 돌려받지 못하므로 다시 뽑는다.
      const inserted = await client.query(
        `INSERT INTO friend_codes (account_id, code, created_at, rotated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING code`,
        [accountId, code, input.createdAt, input.rotatedAt ?? null],
      );
      if (inserted.rowCount === 1) return code;
    }
    throw new Error('friend code generation exhausted');
  }

  private async recordFailure(client: PoolClient, accountId: string, now: Date): Promise<AddOutcome> {
    await client.query(
      'DELETE FROM friend_code_attempts WHERE account_id = $1 AND attempted_at <= $2',
      [accountId, new Date(now.getTime() - this.attemptWindowMs)],
    );
    await client.query(
      'INSERT INTO friend_code_attempts (account_id, attempted_at) VALUES ($1, $2)', [accountId, now],
    );
    return { kind: 'failed', error: new FriendError('FRIEND_CODE_NOT_FOUND') };
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new FriendError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }
}
