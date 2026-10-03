import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { FriendError } from './friends.js';
import { friendCodePattern } from './friends-rules.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresBadgeRewardService } from './postgres/badge-rewards.js';
import { PostgresFriendService } from './postgres/friends.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { runMigrations } from './postgres/migrate.js';

const hmacSecret = 'test-only-account-deletion-secret-at-least-32-bytes';
// real-shop만 실제 점포(is_demo = false)이고 나머지는 시연 점포다.
const staffOf = { 'shop-a': 'staff-a', 'shop-b': 'staff-b', 'shop-c': 'staff-c', 'real-shop': 'staff-r' } as const;
type Shop = keyof typeof staffOf;

async function setup(t: TestContext) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(
    `TRUNCATE friendships, friend_blocks, friend_codes, explorer_profiles, friend_code_attempts,
              account_deletion_requests, customer_identity_tokens, merchants CASCADE`,
  );
  for (const [shop, staff] of Object.entries(staffOf)) {
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ($1, $2, 'test', 'test', 0, 'ACTIVE', $3)`,
      [shop, `가상 ${shop}`, shop !== 'real-shop'],
    );
    await pool.query(
      `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
       VALUES ($1, $2, 'test', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'ACTIVE', true, 200)`,
      [`campaign-${shop}`, shop],
    );
    await pool.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ($1, $2, 'STAFF', 'ACTIVE')`,
      [shop, staff],
    );
  }
  const state = { now: new Date('2026-09-29T00:00:00.000Z') };
  const now = () => state.now;
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  return {
    pool, state, lifecycle, now,
    friends: new PostgresFriendService(pool, { accountLifecycle: lifecycle, now }),
    badges: new PostgresBadgeRewardService(pool, { now, accountLifecycle: lifecycle }),
    deletion: new PostgresAccountDeletionService(pool, {
      hmacSecret, policyVersion: 'account-deletion-v1', now, accountLifecycle: lifecycle,
    }),
  };
}

type Db = Awaited<ReturnType<typeof setup>>;

const rejectsWith = (code: string) => (error: unknown) =>
  error instanceof FriendError && error.code === code;

async function addVisit(pool: Pool, input: {
  account: string; shop: Shop; date: string; status?: 'VALID' | 'CANCELED'; counted?: boolean;
  issuedBy?: string;
}): Promise<void> {
  const claimSlotId = randomUUID();
  const at = `${input.date}T03:00:00Z`;
  await pool.query(
    `INSERT INTO claim_slots (
       id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
       token_hash, status, expires_at, claimed_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'CLAIMED', $7::timestamptz + interval '15 minutes',
               $7, $7::timestamptz - interval '5 minutes', $7)`,
    [claimSlotId, input.shop, input.account, randomBytes(32), input.issuedBy ?? staffOf[input.shop],
      randomBytes(32), at],
  );
  const canceled = input.status === 'CANCELED';
  await pool.query(
    `INSERT INTO visit_events (
       id, claim_slot_id, merchant_id, campaign_id, customer_account_id, occurred_at, business_date,
       verification_level, status, progress_counted, cancellation_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, 'MERCHANT_CONFIRMED', $8, $9, $10)`,
    [randomUUID(), claimSlotId, input.shop, `campaign-${input.shop}`, input.account, at, input.date,
      canceled ? 'CANCELED' : 'VALID', input.counted ?? true, canceled ? '취소 시험' : null],
  );
}

const codeOf = async (db: Db, account: string) => (await db.friends.list(account)).me.code;

async function befriend(db: Db, account: string, other: string) {
  return db.friends.addByCode({ accountId: account, code: await codeOf(db, other) });
}

const blockRows = async (pool: Pool) =>
  (await pool.query('SELECT blocker, blocked FROM friend_blocks ORDER BY blocker, blocked')).rows
    .map((row) => [row.blocker, row.blocked]);

const friendshipRows = async (pool: Pool) =>
  (await pool.query('SELECT id, account_low, account_high FROM friendships ORDER BY account_low, account_high')).rows;

test('migration 0028 creates the friend tables with their constraints', async (t) => {
  const { pool } = await setup(t);
  assert.equal((await pool.query(
    `SELECT count(*)::int AS n FROM schema_migrations WHERE filename = '0028_friends.sql'`,
  )).rows[0]!.n, 1);
  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_name IN ('explorer_profiles', 'friend_codes', 'friendships', 'friend_blocks', 'friend_code_attempts')`,
  );
  assert.equal(tables.rowCount, 5);

  const insertCode = (code: string, account: string = randomUUID()) =>
    pool.query('INSERT INTO friend_codes (account_id, code) VALUES ($1, $2)', [account, code]);
  for (const bad of ['0OIL1111', 'ABCDEFG', 'ABCDEFGHJ', 'abcdefgh', 'ABCDEFG1', 'ABCDEFGI', 'ABCDEFGO', 'ABCDEFG ']) {
    await assert.rejects(insertCode(bad), /check/i, bad);
  }
  await insertCode('K7M2P9QX', 'code-owner');
  await assert.rejects(insertCode('K7M2P9QX'), /unique|duplicate/i);

  const insertNickname = (nickname: string) => pool.query(
    'INSERT INTO explorer_profiles (account_id, nickname) VALUES ($1, $2)', [randomUUID(), nickname],
  );
  await assert.rejects(insertNickname(''), /check/i);
  await assert.rejects(insertNickname('   '), /check/i);
  await assert.rejects(insertNickname('열세글자열세글자열세글자열'), /check/i);
  await insertNickname('열두글자열두글자열두글자');

  const insertPair = (low: string, high: string) => pool.query(
    'INSERT INTO friendships (id, account_low, account_high) VALUES ($1, $2, $3)', [randomUUID(), low, high],
  );
  await assert.rejects(insertPair('same', 'same'), /check/i);
  await assert.rejects(insertPair('b', 'a'), /check/i);
  // "C" 정렬(바이트 순서)이라 DB 기본 정렬 규칙과 무관하게 대문자가 소문자보다 앞선다.
  await assert.rejects(insertPair('a', 'B'), /check/i);
  await insertPair('B', 'a');
  await assert.rejects(insertPair('B', 'a'), /unique|duplicate/i);

  const insertBlock = (blocker: string, blocked: string) => pool.query(
    'INSERT INTO friend_blocks (blocker, blocked) VALUES ($1, $2)', [blocker, blocked],
  );
  await assert.rejects(insertBlock('', 'a'), /check/i);
  await assert.rejects(insertBlock('a', '  '), /check/i);
  await assert.rejects(insertBlock('same', 'same'), /check/i);
  await insertBlock('a', 'b');
  await assert.rejects(insertBlock('a', 'b'), /unique|duplicate/i);
  // 방향이 있어서 반대쪽 차단은 따로 둘 수 있다.
  await insertBlock('b', 'a');
  const indexes = await pool.query(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'friend_blocks' ORDER BY indexname`,
  );
  assert.ok(indexes.rows.some((row) => /\(blocked\)/.test(row.indexdef)), 'index on blocked');
  assert.ok(indexes.rows.some((row) => /\(blocker, blocked\)/.test(row.indexdef)), 'primary key');
});

test('the first friends read creates a stable code, a default nickname and an empty list', async (t) => {
  const db = await setup(t);
  const first = await db.friends.list('account-1');
  assert.match(first.me.code, friendCodePattern);
  assert.match(first.me.nickname, /^탐험가 [2-9A-HJ-NP-Z]{4}$/);
  assert.deepEqual(first.friends, []);
  assert.deepEqual(first.me.badges, { earned: 0, total: 9 });
  assert.deepEqual(first.me.medals, [
    { key: 'explorer', tier: 0 }, { key: 'regular', tier: 0 }, { key: 'steady', tier: 0 },
  ]);
  assert.equal(first.me.rank, 1);
  // 시험 시계는 2026-09-29 09:00 KST라 친구에게 보이는 기준은 어제(9월 28일)까지다.
  assert.equal(first.me.asOf, '2026-09-28');
  assert.equal((await db.friends.list('account-1')).me.code, first.me.code);
  const other = await db.friends.list('account-2');
  assert.notEqual(other.me.code, first.me.code);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM friend_codes')).rows[0]!.n, 2);

  // 동시에 처음 여는 요청도 코드 한 개만 만든다.
  const codes = await Promise.all(Array.from({ length: 8 }, () => codeOf(db, 'racer')));
  assert.equal(new Set(codes).size, 1);
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM friend_codes WHERE account_id = 'racer'`)).rows[0]!.n, 1);
});

test('the default nickname is stored with the first code, comes from its own random draw and survives rotation', async (t) => {
  const db = await setup(t);
  const service = new PostgresFriendService(db.pool, {
    accountLifecycle: db.lifecycle, now: db.now,
    nextCode: (() => { const codes = ['K7M2P9QX', 'ABCDEFGH']; return () => codes.shift()!; })(),
    nextDefaultNickname: () => '탐험가 WXYZ',
  });
  const first = await service.list('account-1');
  assert.equal(first.me.code, 'K7M2P9QX');
  // 코드와 같은 거래에서 저장되고, 코드의 어떤 부분에서도 만들지 않는다(코드 뒤 4자리 P9QX가 아니다).
  assert.equal(first.me.nickname, '탐험가 WXYZ');
  assert.notEqual(first.me.nickname, `탐험가 ${first.me.code.slice(-4)}`);
  const stored = await db.pool.query(`SELECT nickname FROM explorer_profiles WHERE account_id = 'account-1'`);
  assert.deepEqual(stored.rows, [{ nickname: '탐험가 WXYZ' }]);

  // 코드를 바꿔도 별명은 그대로다.
  assert.deepEqual(await service.rotateCode('account-1'), { code: 'ABCDEFGH' });
  const rotated = await service.list('account-1');
  assert.equal(rotated.me.code, 'ABCDEFGH');
  assert.equal(rotated.me.nickname, '탐험가 WXYZ');
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM explorer_profiles')).rows[0]!.n, 1);

  // 기본 난수 생성기도 코드와 무관한 값을 저장하고 회전 뒤에도 같다.
  const natural = await db.friends.list('account-2');
  const before = natural.me.nickname;
  assert.match(before, /^탐험가 [2-9A-HJ-NP-Z]{4}$/);
  await db.friends.rotateCode('account-2');
  await db.friends.rotateCode('account-2');
  assert.equal((await db.friends.list('account-2')).me.nickname, before);
});

test('the default nickname is created wherever the first code is created and never overwrites a chosen nickname', async (t) => {
  const db = await setup(t);
  const nickname = async (account: string) =>
    (await db.pool.query('SELECT nickname FROM explorer_profiles WHERE account_id = $1', [account])).rows[0]?.nickname;
  // 첫 코드를 처음 바꾸기로 만드는 경우.
  await db.friends.rotateCode('rotator');
  assert.match(await nickname('rotator'), /^탐험가 [2-9A-HJ-NP-Z]{4}$/);
  // 친구를 추가하며 내 코드가 처음 만들어지는 경우.
  const targetCode = await codeOf(db, 'target');
  await db.friends.addByCode({ accountId: 'adder', code: targetCode });
  assert.match(await nickname('adder'), /^탐험가 [2-9A-HJ-NP-Z]{4}$/);
  // 별명을 먼저 정한 계정은 코드가 만들어져도 그대로다.
  await db.friends.setNickname({ accountId: 'chooser', nickname: '내가 정한' });
  assert.equal((await db.friends.list('chooser')).me.nickname, '내가 정한');
  await db.friends.rotateCode('chooser');
  assert.equal(await nickname('chooser'), '내가 정한');
  // 코드가 있는데 별명 행이 없는 옛 데이터는 "탐험가"로 보이고 코드 뒤 글자는 쓰지 않는다.
  await db.pool.query(`DELETE FROM explorer_profiles WHERE account_id = 'target'`);
  const legacy = await db.friends.list('target');
  assert.equal(legacy.me.nickname, '탐험가');
  assert.equal((await db.friends.list('adder')).friends[0]!.nickname, '탐험가');
});

test('a list whose own code row vanished mid-read reports the account as deleted', async (t) => {
  const db = await setup(t);
  await codeOf(db, 'ghost');
  await db.pool.query(`DELETE FROM friend_codes WHERE account_id = 'ghost'`);
  // getOrCreateCode를 지나간 뒤 삭제가 끼어든 상황을 만든다.
  const racing = new PostgresFriendService(db.pool, { accountLifecycle: db.lifecycle, now: db.now });
  (racing as unknown as { getOrCreateCode: () => Promise<string> }).getOrCreateCode = async () => 'ignored';
  await assert.rejects(racing.list('ghost'), rejectsWith('ACCOUNT_DELETED'));
  // 연결은 풀에 돌아가 다음 읽기가 정상으로 동작한다.
  assert.match((await db.friends.list('ghost')).me.code, friendCodePattern);
});

test('code generation retries on a collision with another account and gives up when it never changes', async (t) => {
  const db = await setup(t);
  const taken = await codeOf(db, 'owner');
  const queue = [taken, taken, 'FRESH222'];
  const retrying = new PostgresFriendService(db.pool, {
    accountLifecycle: db.lifecycle, now: db.now, nextCode: () => queue.shift()!,
  });
  assert.equal((await retrying.list('newcomer')).me.code, 'FRESH222');
  assert.equal(queue.length, 0);
  assert.equal(await codeOf(db, 'owner'), taken);

  const stuck = new PostgresFriendService(db.pool, {
    accountLifecycle: db.lifecycle, now: db.now, nextCode: () => taken,
  });
  await assert.rejects(stuck.list('unlucky'), /friend code generation exhausted/);
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM friend_codes WHERE account_id = 'unlucky'`)).rows[0]!.n, 0);

  const rotating = new PostgresFriendService(db.pool, {
    accountLifecycle: db.lifecycle, now: db.now, nextCode: (() => {
      const sequence = [taken, 'MNPQRST2'];
      return () => sequence.shift()!;
    })(),
  });
  assert.deepEqual(await rotating.rotateCode('newcomer'), { code: 'MNPQRST2' });
});

test('nicknames are validated, trimmed, stored per account and shown to friends', async (t) => {
  const db = await setup(t);
  await befriend(db, 'a', 'b');
  assert.deepEqual(await db.friends.setNickname({ accountId: 'b', nickname: '  맛집왕  ' }), { nickname: '맛집왕' });
  assert.equal((await db.pool.query(`SELECT nickname FROM explorer_profiles WHERE account_id = 'b'`)).rows[0]!.nickname, '맛집왕');
  assert.equal((await db.friends.list('b')).me.nickname, '맛집왕');
  assert.equal((await db.friends.list('a')).friends[0]!.nickname, '맛집왕');
  await db.friends.setNickname({ accountId: 'b', nickname: '바뀐 별명' });
  assert.equal((await db.friends.list('a')).friends[0]!.nickname, '바뀐 별명');
  // 두 계정 모두 첫 코드와 함께 기본 별명 행이 생겼고, 별명을 바꿔도 행은 늘지 않는다.
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM explorer_profiles')).rows[0]!.n, 2);

  for (const invalid of ['', '   ', '열세글자열세글자열세글자열', 'me@example.com', 'https://evil.kr', 'a\nb', '맛집.com', '\u3164\u3164']) {
    await assert.rejects(db.friends.setNickname({ accountId: 'b', nickname: invalid }), rejectsWith('FRIEND_NICKNAME_INVALID'), invalid);
  }
  assert.equal((await db.friends.list('b')).me.nickname, '바뀐 별명');
  await assert.rejects(
    db.friends.setNickname({ accountId: 'b', nickname: 1 as unknown as string }), rejectsWith('FRIEND_NICKNAME_INVALID'),
  );
});

test('adding by code is mutual and idempotent, normalizes the input and rejects self and unknown codes', async (t) => {
  const db = await setup(t);
  const bobCode = await codeOf(db, 'bob');
  const added = await db.friends.addByCode({ accountId: 'alice', code: `  ${bobCode.slice(0, 4).toLowerCase()}-${bobCode.slice(4)} ` });
  assert.equal(added.created, true);
  assert.equal(added.friend.nickname, (await db.friends.list('bob')).me.nickname);
  assert.match(added.friend.nickname, /^탐험가 [2-9A-HJ-NP-Z]{4}$/);
  // 배지·도장이 같아 별명 순서가 순위를 정하고, 추가 응답의 순위는 목록의 순위와 같다.
  assert.equal(added.friend.rank, (await db.friends.list('alice')).friends[0]!.rank);
  assert.ok([1, 2].includes(added.friend.rank));
  assert.deepEqual(added.friend.stamps, []);

  const rows = await friendshipRows(db.pool);
  assert.deepEqual(rows.map((row) => [row.account_low, row.account_high]), [['alice', 'bob']]);
  assert.equal(added.friend.friendshipId, rows[0]!.id);

  // 상대 목록에도 같은 관계 id로 보이고, 내 코드가 없었어도 이때 만들어져 별명이 정해진다.
  const bobList = await db.friends.list('bob');
  assert.deepEqual(bobList.friends.map((friend) => friend.friendshipId), [rows[0]!.id]);
  const aliceCode = await codeOf(db, 'alice');
  assert.equal(bobList.friends[0]!.nickname, (await db.friends.list('alice')).me.nickname);

  const replay = await db.friends.addByCode({ accountId: 'alice', code: bobCode });
  assert.deepEqual(replay, { friend: added.friend, created: false });
  const reverse = await db.friends.addByCode({ accountId: 'bob', code: aliceCode });
  assert.equal(reverse.created, false);
  assert.equal(reverse.friend.friendshipId, rows[0]!.id);
  assert.equal((await friendshipRows(db.pool)).length, 1);

  await assert.rejects(db.friends.addByCode({ accountId: 'alice', code: aliceCode }), rejectsWith('FRIEND_SELF'));
  await assert.rejects(db.friends.addByCode({ accountId: 'alice', code: '22222222' }), rejectsWith('FRIEND_CODE_NOT_FOUND'));
  for (const malformed of ['abc', 'ZZZZZZZ0', 'K7M2-P9Q', '가나다라마바사아']) {
    await assert.rejects(db.friends.addByCode({ accountId: 'alice', code: malformed }), rejectsWith('FRIEND_CODE_NOT_FOUND'), malformed);
  }
  assert.equal((await friendshipRows(db.pool)).length, 1);
});

test('the friend limit of 100 applies to both sides but never blocks an existing friendship', async (t) => {
  const db = await setup(t);
  const popularCode = await codeOf(db, 'popular');
  for (let index = 0; index < 100; index++) {
    const { low, high } = { low: `friend-${String(index).padStart(3, '0')}`, high: 'popular' };
    await db.pool.query('INSERT INTO friendships (id, account_low, account_high) VALUES ($1, $2, $3)', [randomUUID(), low, high]);
  }
  await assert.rejects(
    db.friends.addByCode({ accountId: 'newcomer', code: popularCode }), rejectsWith('FRIEND_LIMIT'),
  );
  // 정원이 찬 쪽이 먼저 추가해도 같다.
  const newcomerCode = await codeOf(db, 'newcomer');
  await assert.rejects(
    db.friends.addByCode({ accountId: 'popular', code: newcomerCode }), rejectsWith('FRIEND_LIMIT'),
  );
  assert.equal((await friendshipRows(db.pool)).length, 100);

  // 이미 친구인 사람을 다시 추가하는 것은 정원과 상관없이 같은 결과다.
  await codeOf(db, 'friend-000');
  const again = await db.friends.addByCode({ accountId: 'friend-000', code: popularCode });
  assert.equal(again.created, false);
  assert.equal((await db.friends.list('popular')).friends.length, 100);

  // 정원 실패는 실패 횟수에 들어가지 않는다.
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM friend_code_attempts')).rows[0]!.n, 0);
  await db.friends.remove({ accountId: 'popular', friendshipId: (await friendshipRows(db.pool))[0]!.id });
  assert.equal((await db.friends.addByCode({ accountId: 'newcomer', code: popularCode })).created, true);
});

test('ten failed codes in ten minutes block further attempts, even valid ones, until the window slides', async (t) => {
  const db = await setup(t);
  const bobCode = await codeOf(db, 'bob');
  const aliceCode = await codeOf(db, 'alice');
  // 자기 코드·이미 친구·성공은 실패로 세지 않는다.
  await assert.rejects(db.friends.addByCode({ accountId: 'alice', code: aliceCode }), rejectsWith('FRIEND_SELF'));
  await db.friends.addByCode({ accountId: 'alice', code: bobCode });
  await db.friends.addByCode({ accountId: 'alice', code: bobCode });
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM friend_code_attempts')).rows[0]!.n, 0);

  const wrong = ['22222222', '33333333', '44444444', '55555555', '66666666', '77777777', '88888888', '99999999', 'AAAAAAAA', 'bad'];
  for (const [index, code] of wrong.entries()) {
    db.state.now = new Date(Date.UTC(2026, 8, 29, 0, 0, index));
    await assert.rejects(db.friends.addByCode({ accountId: 'alice', code }), rejectsWith('FRIEND_CODE_NOT_FOUND'), code);
  }
  db.state.now = new Date(Date.UTC(2026, 8, 29, 0, 1, 0));
  const carolCode = await codeOf(db, 'carol');
  await assert.rejects(db.friends.addByCode({ accountId: 'alice', code: carolCode }), (error) => {
    assert.ok(error instanceof FriendError);
    assert.equal(error.code, 'FRIEND_CODE_RATE_LIMITED');
    // 가장 오래된 실패가 00:00:00에 있었으니 00:10:00에 풀리고 지금은 00:01:00이라 540초 남는다.
    assert.equal(error.retryAfterSeconds, 540);
    return true;
  });
  await assert.rejects(db.friends.addByCode({ accountId: 'alice', code: '22222222' }), rejectsWith('FRIEND_CODE_RATE_LIMITED'));
  // 제한 중의 요청은 기록을 늘리지 않고, 다른 계정에는 영향이 없다.
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM friend_code_attempts')).rows[0]!.n, 10);
  assert.equal((await db.friends.addByCode({ accountId: 'bob', code: carolCode })).created, true);
  assert.equal((await friendshipRows(db.pool)).length, 2);

  // 10분이 지나 가장 오래된 실패가 창 밖으로 나가면 다시 시도할 수 있다.
  db.state.now = new Date(Date.UTC(2026, 8, 29, 0, 10, 1));
  assert.equal((await db.friends.addByCode({ accountId: 'alice', code: carolCode })).created, true);
  await assert.rejects(db.friends.addByCode({ accountId: 'alice', code: '22222222' }), rejectsWith('FRIEND_CODE_NOT_FOUND'));
  // 오래된 실패 기록은 다음 실패 때 정리된다.
  assert.equal((await db.pool.query(
    `SELECT count(*)::int AS n FROM friend_code_attempts WHERE attempted_at < '2026-09-29T00:00:02Z'`,
  )).rows[0]!.n, 0);
});

test('concurrent wrong codes from one account cannot exceed the failure limit', async (t) => {
  const db = await setup(t);
  await codeOf(db, 'attacker');
  const results = await Promise.allSettled(Array.from({ length: 30 }, (_, index) =>
    db.friends.addByCode({ accountId: 'attacker', code: `2222222${'23456789'[index % 8]}` })));
  const codes = results.map((result) =>
    result.status === 'rejected' && result.reason instanceof FriendError ? result.reason.code : 'OTHER');
  assert.equal(codes.filter((code) => code === 'FRIEND_CODE_NOT_FOUND').length, 10);
  assert.equal(codes.filter((code) => code === 'FRIEND_CODE_RATE_LIMITED').length, 20);
  assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM friend_code_attempts')).rows[0]!.n, 10);
});

test('reciprocal and crossing adds at the same time make one row per pair and never deadlock', async (t) => {
  const db = await setup(t);
  const codeA = await codeOf(db, 'a');
  const codeB = await codeOf(db, 'b');
  const results = await Promise.all(Array.from({ length: 24 }, (_, index) => index % 2 === 0
    ? db.friends.addByCode({ accountId: 'a', code: codeB })
    : db.friends.addByCode({ accountId: 'b', code: codeA })));
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(new Set(results.map((result) => result.friend.friendshipId)).size, 1);
  assert.equal((await friendshipRows(db.pool)).length, 1);

  // 여러 계정이 서로를 동시에 추가해도 쌍마다 한 행이다.
  const accounts = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
  const codes = new Map<string, string>();
  for (const account of accounts) codes.set(account, await codeOf(db, account));
  const operations = accounts.flatMap((from) => accounts.filter((to) => to !== from)
    .map((to) => db.friends.addByCode({ accountId: from, code: codes.get(to)! })));
  const settled = await Promise.all(operations);
  assert.equal(settled.filter((result) => result.created).length, 15);
  assert.equal((await friendshipRows(db.pool)).length, 1 + 15);
  for (const account of accounts) assert.equal((await db.friends.list(account)).friends.length, 5);
});

test('removing needs membership: outsiders and malformed ids get the same 404 and the row survives', async (t) => {
  const db = await setup(t);
  const { friend } = await befriend(db, 'a', 'b');
  await assert.rejects(db.friends.remove({ accountId: 'outsider', friendshipId: friend.friendshipId }), rejectsWith('FRIEND_NOT_FOUND'));
  await assert.rejects(db.friends.remove({ accountId: 'a', friendshipId: randomUUID() }), rejectsWith('FRIEND_NOT_FOUND'));
  for (const malformed of ['', 'x', "1' OR '1'='1", friend.friendshipId.slice(1)]) {
    await assert.rejects(db.friends.remove({ accountId: 'a', friendshipId: malformed }), rejectsWith('FRIEND_NOT_FOUND'), malformed);
  }
  assert.equal((await friendshipRows(db.pool)).length, 1);

  // 한쪽이 끊으면 양쪽에서 사라지고 같은 요청을 다시 보내면 404다.
  await db.friends.remove({ accountId: 'b', friendshipId: friend.friendshipId.toUpperCase() });
  assert.deepEqual((await db.friends.list('a')).friends, []);
  assert.deepEqual((await db.friends.list('b')).friends, []);
  await assert.rejects(db.friends.remove({ accountId: 'a', friendshipId: friend.friendshipId }), rejectsWith('FRIEND_NOT_FOUND'));

  // 끊은 쪽(b)이 상대(a)를 막았고 그 밖에는 아무 차단도 없다. 실패한 끊기는 차단을 만들지 않는다.
  assert.deepEqual(await blockRows(db.pool), [['b', 'a']]);

  // 끊은 쪽이 다시 추가하면 새 관계가 생기고 자기 차단이 풀린다.
  const again = await befriend(db, 'b', 'a');
  assert.equal(again.created, true);
  assert.notEqual(again.friend.friendshipId, friend.friendshipId);
  assert.deepEqual(await blockRows(db.pool), []);
});

test('failed removals leave no block and removing twice at once records one block', async (t) => {
  const db = await setup(t);
  const { friend } = await befriend(db, 'a', 'b');
  await assert.rejects(db.friends.remove({ accountId: 'outsider', friendshipId: friend.friendshipId }), rejectsWith('FRIEND_NOT_FOUND'));
  await assert.rejects(db.friends.remove({ accountId: 'a', friendshipId: 'not-a-uuid' }), rejectsWith('FRIEND_NOT_FOUND'));
  assert.deepEqual(await blockRows(db.pool), []);
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
    db.friends.remove({ accountId: index % 2 === 0 ? 'a' : 'b', friendshipId: friend.friendshipId })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  for (const result of results) {
    if (result.status === 'rejected') assert.ok(rejectsWith('FRIEND_NOT_FOUND')(result.reason), String(result.reason));
  }
  assert.equal((await blockRows(db.pool)).length, 1);
  assert.equal((await friendshipRows(db.pool)).length, 0);
});

test('a removed friend cannot add the remover back: same 404 as an unknown code, counted as a failed attempt', async (t) => {
  const db = await setup(t);
  const { friend } = await befriend(db, 'remover', 'removed');
  const removerCode = await codeOf(db, 'remover');
  await db.friends.remove({ accountId: 'remover', friendshipId: friend.friendshipId });
  assert.deepEqual(await blockRows(db.pool), [['remover', 'removed']]);

  const attempts = async (account: string) => (await db.pool.query(
    'SELECT count(*)::int AS n FROM friend_code_attempts WHERE account_id = $1', [account],
  )).rows[0]!.n;
  const blocked = await db.friends.addByCode({ accountId: 'removed', code: removerCode }).then(
    () => assert.fail('a blocked add must fail'), (error: unknown) => error);
  const unknown = await db.friends.addByCode({ accountId: 'removed', code: '22222222' }).then(
    () => assert.fail('an unknown code must fail'), (error: unknown) => error);
  // 막힌 코드와 없는 코드는 오류 종류·재시도 시각까지 구분되지 않는다.
  for (const error of [blocked, unknown]) {
    assert.ok(error instanceof FriendError);
    assert.equal(error.code, 'FRIEND_CODE_NOT_FOUND');
    assert.equal(error.retryAfterSeconds, undefined);
  }
  assert.equal(await attempts('removed'), 2);
  assert.equal((await friendshipRows(db.pool)).length, 0);

  // 코드를 바꿔도 계정 기준이라 여전히 막혀 있다.
  const { code: rotated } = await db.friends.rotateCode('remover');
  await assert.rejects(db.friends.addByCode({ accountId: 'removed', code: rotated }), rejectsWith('FRIEND_CODE_NOT_FOUND'));
  assert.equal(await attempts('removed'), 3);
  assert.equal((await friendshipRows(db.pool)).length, 0);

  // 열 번을 넘겨 시도하면 다른 실패와 똑같이 제한이 걸린다.
  for (let index = 0; index < 7; index++) {
    await assert.rejects(db.friends.addByCode({ accountId: 'removed', code: rotated }), rejectsWith('FRIEND_CODE_NOT_FOUND'));
  }
  assert.equal(await attempts('removed'), 10);
  await assert.rejects(db.friends.addByCode({ accountId: 'removed', code: rotated }), rejectsWith('FRIEND_CODE_RATE_LIMITED'));
  // 막힌 쪽이 차단을 만들지는 않고, 다른 계정의 추가에는 영향이 없다.
  assert.deepEqual(await blockRows(db.pool), [['remover', 'removed']]);
  assert.equal((await db.friends.addByCode({ accountId: 'other', code: rotated })).created, true);
});

test('the remover adding the removed friend back lifts the block in the same transaction', async (t) => {
  const db = await setup(t);
  const { friend } = await befriend(db, 'x', 'f');
  await db.friends.remove({ accountId: 'x', friendshipId: friend.friendshipId });
  assert.deepEqual(await blockRows(db.pool), [['x', 'f']]);

  // x가 f의 코드로 다시 추가하면 새 관계가 생기고 x의 f에 대한 차단이 풀린다.
  const readded = await db.friends.addByCode({ accountId: 'x', code: await codeOf(db, 'f') });
  assert.equal(readded.created, true);
  assert.deepEqual(await blockRows(db.pool), []);
  // 이제 f도 x를 다시 추가하는 요청이 같은 관계를 돌려준다(막히지 않는다).
  const replay = await db.friends.addByCode({ accountId: 'f', code: await codeOf(db, 'x') });
  assert.deepEqual([replay.created, replay.friend.friendshipId], [false, readded.friend.friendshipId]);

  // 반대로 f가 끊었다면 x는 막히고, f가 x를 추가해야 풀린다.
  await db.friends.remove({ accountId: 'f', friendshipId: readded.friend.friendshipId });
  assert.deepEqual(await blockRows(db.pool), [['f', 'x']]);
  await assert.rejects(db.friends.addByCode({ accountId: 'x', code: await codeOf(db, 'f') }), rejectsWith('FRIEND_CODE_NOT_FOUND'));
  assert.equal((await friendshipRows(db.pool)).length, 0);
  assert.equal((await db.friends.addByCode({ accountId: 'f', code: await codeOf(db, 'x') })).created, true);
  assert.deepEqual(await blockRows(db.pool), []);
});

test('a friend limit failure rolls back and keeps the block, and blocked accounts cannot refill a full friend list', async (t) => {
  const db = await setup(t);
  const { friend } = await befriend(db, 'full', 'ex');
  await db.friends.remove({ accountId: 'full', friendshipId: friend.friendshipId });
  for (let index = 0; index < 100; index++) {
    await db.pool.query(
      'INSERT INTO friendships (id, account_low, account_high) VALUES ($1, $2, $3)',
      [randomUUID(), `friend-${String(index).padStart(3, '0')}`, 'full'],
    );
  }
  // full은 정원이 차서 ex를 다시 추가할 수 없고, 이때 차단은 풀리지 않는다.
  await assert.rejects(db.friends.addByCode({ accountId: 'full', code: await codeOf(db, 'ex') }), rejectsWith('FRIEND_LIMIT'));
  assert.deepEqual(await blockRows(db.pool), [['full', 'ex']]);
  // 자리가 나도 ex는 full을 추가할 수 없어서 정원을 다시 채울 수 없다.
  await db.friends.remove({ accountId: 'full', friendshipId: (await friendshipRows(db.pool))[0]!.id });
  await assert.rejects(db.friends.addByCode({ accountId: 'ex', code: await codeOf(db, 'full') }), rejectsWith('FRIEND_CODE_NOT_FOUND'));
  assert.equal((await db.friends.list('full')).friends.length, 99);
});

test('removing waits for the two-account lock that adding holds, so a re-add cannot slip past the block', async (t) => {
  const db = await setup(t);
  const { friend } = await befriend(db, 'x', 'f');
  const holder = await db.pool.connect();
  let removal: Promise<void> | undefined;
  try {
    await holder.query('BEGIN');
    await db.lifecycle.assertAllActive(holder, ['x', 'f']);
    let finished = false;
    removal = db.friends.remove({ accountId: 'x', friendshipId: friend.friendshipId }).then(() => { finished = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(finished, false, 'remove must wait for the account locks');
    assert.equal((await friendshipRows(db.pool)).length, 1);
    await holder.query('COMMIT');
  } finally {
    holder.release();
  }
  await removal;
  assert.equal((await friendshipRows(db.pool)).length, 0);
  assert.deepEqual(await blockRows(db.pool), [['x', 'f']]);
});

test('removing while the friend re-adds at the same time never leaves a friendship next to the block', async (t) => {
  const db = await setup(t);
  for (let round = 0; round < 12; round++) {
    const remover = `remover-${round}`;
    const friend = `friend-${round}`;
    const { friend: pair } = await befriend(db, remover, friend);
    const removerCode = await codeOf(db, remover);
    const results = await Promise.allSettled([
      db.friends.remove({ accountId: remover, friendshipId: pair.friendshipId }),
      db.friends.addByCode({ accountId: friend, code: removerCode }),
      db.friends.addByCode({ accountId: friend, code: removerCode }),
    ]);
    assert.equal(results[0]!.status, 'fulfilled', String(round));
    for (const result of results.slice(1)) {
      if (result.status === 'rejected') assert.ok(rejectsWith('FRIEND_CODE_NOT_FOUND')(result.reason), String(result.reason));
    }
    assert.deepEqual((await db.pool.query(
      'SELECT id FROM friendships WHERE account_low = ANY($1) AND account_high = ANY($1)', [[remover, friend]],
    )).rows, [], `round ${round}`);
    assert.deepEqual((await db.pool.query(
      'SELECT blocker, blocked FROM friend_blocks WHERE blocker = $1', [remover],
    )).rows, [{ blocker: remover, blocked: friend }], `round ${round}`);
  }
});

test('removing while the friend account is being deleted leaves no orphan block', async (t) => {
  const db = await setup(t);
  for (let round = 0; round < 8; round++) {
    const remover = `keeper-${round}`;
    const leaver = `leaver-${round}`;
    const { friend } = await befriend(db, remover, leaver);
    const [removed, deleted] = await Promise.allSettled([
      db.friends.remove({ accountId: remover, friendshipId: friend.friendshipId }),
      db.deletion.requestDeletion({ accountId: leaver, confirmation: 'DELETE MY ACCOUNT' }),
    ]);
    assert.equal(deleted.status, 'fulfilled', String(round));
    if (removed.status === 'rejected') assert.ok(rejectsWith('FRIEND_NOT_FOUND')(removed.reason), String(removed.reason));
    assert.equal((await db.pool.query(
      'SELECT count(*)::int AS n FROM friend_blocks WHERE blocker = $1 OR blocked = $1', [leaver],
    )).rows[0]!.n, 0, `round ${round}`);
  }
});

test('rotating a code invalidates the old one, keeps friendships and preserves the creation time', async (t) => {
  const db = await setup(t);
  const oldCode = await codeOf(db, 'bob');
  const created = (await db.pool.query(`SELECT created_at FROM friend_codes WHERE account_id = 'bob'`)).rows[0]!.created_at as Date;
  await befriend(db, 'alice', 'bob');

  db.state.now = new Date('2026-09-30T00:00:00.000Z');
  const { code: newCode } = await db.friends.rotateCode('bob');
  assert.match(newCode, friendCodePattern);
  assert.notEqual(newCode, oldCode);
  assert.equal(await codeOf(db, 'bob'), newCode);
  const stored = (await db.pool.query(`SELECT code, created_at, rotated_at FROM friend_codes WHERE account_id = 'bob'`)).rows[0]!;
  assert.equal(stored.code, newCode);
  assert.equal(stored.created_at.toISOString(), created.toISOString());
  assert.equal(stored.rotated_at.toISOString(), '2026-09-30T00:00:00.000Z');

  await assert.rejects(db.friends.addByCode({ accountId: 'carol', code: oldCode }), rejectsWith('FRIEND_CODE_NOT_FOUND'));
  assert.equal((await db.friends.addByCode({ accountId: 'carol', code: newCode })).created, true);
  // 기존 친구 관계는 그대로다.
  assert.equal((await db.friends.list('alice')).friends.length, 1);
  assert.equal((await db.friends.addByCode({ accountId: 'alice', code: newCode })).created, false);

  // 코드가 없던 계정이 바꾸면 새로 만들어지고, 동시에 여러 번 바꿔도 행은 하나다.
  const first = await db.friends.rotateCode('dave');
  assert.match(first.code, friendCodePattern);
  const spun = await Promise.all(Array.from({ length: 6 }, () => db.friends.rotateCode('dave')));
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM friend_codes WHERE account_id = 'dave'`)).rows[0]!.n, 1);
  assert.equal(await codeOf(db, 'dave'), (await db.pool.query(`SELECT code FROM friend_codes WHERE account_id = 'dave'`)).rows[0]!.code);
  assert.equal(new Set(spun.map((entry) => entry.code)).size, 6);
});

test('a friend list computes medals, badges and stamps with the same rules as /me/badges and exposes only allowed fields', async (t) => {
  const db = await setup(t);
  // rich: 시연 점포 3곳 + 한 점포 여러 날, 취소·미반영 방문, 실제 점포의 본인 발급 방문(세지 않음).
  await db.pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ('real-shop', 'rich', 'STAFF', 'ACTIVE')`,
  );
  for (const date of ['2026-09-01', '2026-09-02', '2026-09-03']) await addVisit(db.pool, { account: 'rich', shop: 'shop-a', date });
  await addVisit(db.pool, { account: 'rich', shop: 'shop-b', date: '2026-09-02' });
  await addVisit(db.pool, { account: 'rich', shop: 'shop-c', date: '2026-09-04', status: 'CANCELED', counted: false });
  await addVisit(db.pool, { account: 'rich', shop: 'shop-c', date: '2026-09-05', counted: false });
  await addVisit(db.pool, { account: 'rich', shop: 'real-shop', date: '2026-09-06', issuedBy: 'rich' });
  await addVisit(db.pool, { account: 'rich', shop: 'real-shop', date: '2026-09-07', issuedBy: 'staff-r' });
  // poor: 시연 점포 1곳 한 번, 다른 고객의 방문은 섞이지 않는다.
  await addVisit(db.pool, { account: 'poor', shop: 'shop-c', date: '2026-09-08' });
  await addVisit(db.pool, { account: 'stranger', shop: 'shop-a', date: '2026-09-09' });

  await befriend(db, 'viewer', 'rich');
  await befriend(db, 'viewer', 'poor');
  await db.friends.setNickname({ accountId: 'rich', nickname: '부자' });
  await db.friends.setNickname({ accountId: 'poor', nickname: '뚜벅이' });
  await addVisit(db.pool, { account: 'viewer', shop: 'shop-a', date: '2026-09-10' });

  // 시험 시계는 9월 29일(KST)이고 위의 방문은 모두 그 전날 이전이라 친구 목록과 실시간 /me/badges가 같은 값을 센다.
  const snapshot = await db.friends.list('viewer');
  assert.equal(snapshot.me.asOf, '2026-09-28');
  for (const account of ['rich', 'poor', 'viewer']) {
    const truth = await db.badges.getBadges(account);
    const view = account === 'viewer' ? snapshot.me : snapshot.friends.find((friend) =>
      friend.nickname === (account === 'rich' ? '부자' : '뚜벅이'))!;
    assert.deepEqual(view.medals, truth.medals.map((medal) => ({ key: medal.kind, tier: medal.tier })), account);
    assert.deepEqual(view.badges, { earned: truth.earnedTiers, total: 9 }, account);
  }
  const rich = snapshot.friends.find((friend) => friend.nickname === '부자')!;
  const poor = snapshot.friends.find((friend) => friend.nickname === '뚜벅이')!;
  // 센 방문은 shop-a 3번(9/1·2·3), shop-b 1번(9/2), 직원이 발급한 real-shop 1번(9/7)이다. 취소·미반영 방문과 본인이 발급한
  // 실제 점포 방문은 세지 않으므로 탐험가 3곳(3) · 단골 최다 3번(2) · 꾸준한 걸음 4일(2)이다.
  assert.deepEqual(rich.medals, [{ key: 'explorer', tier: 3 }, { key: 'regular', tier: 2 }, { key: 'steady', tier: 2 }]);
  assert.deepEqual(rich.badges, { earned: 7, total: 9 });
  // 도장은 센 방문의 점포 이름과 공개 목록 ID만 있고 이름순("C" 정렬)이다. 목표가 없는 점포의 ID는 숨긴다.
  assert.deepEqual(rich.stamps, [
    { merchantName: '가상 real-shop', merchantId: null },
    { merchantName: '가상 shop-a', merchantId: null },
    { merchantName: '가상 shop-b', merchantId: null },
  ]);
  assert.deepEqual(poor.stamps, [{ merchantName: '가상 shop-c', merchantId: null }]);
  // 순위: 부자(배지 7) → 배지·도장이 같은 뚜벅이와 나는 별명순("뚜벅이" < "탐험가 xxxx").
  assert.equal(rich.rank, 1);
  assert.equal(poor.rank, 2);
  assert.equal(snapshot.me.rank, 3);

  // 응답에는 허용된 키만 있고 계정 ID·방문 날짜·시각·쿠폰·지갑·이메일 흔적이 없다.
  assert.deepEqual(Object.keys(snapshot).sort(), ['friends', 'me']);
  assert.deepEqual(Object.keys(snapshot.me).sort(), ['asOf', 'badges', 'code', 'medals', 'nickname', 'rank']);
  for (const friend of snapshot.friends) {
    assert.deepEqual(Object.keys(friend).sort(), ['badges', 'friendshipId', 'medals', 'nickname', 'rank', 'stamps']);
    assert.deepEqual(Object.keys(friend.badges).sort(), ['earned', 'total']);
    for (const medal of friend.medals) assert.deepEqual(Object.keys(medal).sort(), ['key', 'tier']);
    for (const stamp of friend.stamps) assert.deepEqual(Object.keys(stamp), ['merchantName', 'merchantId']);
  }
  const text = JSON.stringify(snapshot);
  // asOf(어제 날짜)는 응답에 있어야 하는 값이라 방문 날짜(9월 1~10일)만 흔적 검사 대상이다.
  const visitDates = Array.from({ length: 10 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`);
  for (const leaked of ['rich"', 'poor"', 'stranger', 'staff-', ...visitDates, 'T03:', 'coupon', 'wallet', 'email', 'accountId']) {
    assert.equal(text.includes(leaked), false, leaked);
  }
});

test('친구 도장 ID는 현재 공개 카탈로그와 일치하고 비공개 전환 뒤에도 이름은 남는다', async (t) => {
  const db = await setup(t);
  const catalog = new PostgresMerchantCatalog(db.pool, db.now);
  for (const shop of ['shop-a', 'real-shop'] as const) {
    await db.pool.query(
      `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
       SELECT $1, goal, goal::text FROM unnest(ARRAY[1, 3, 5]) goal`, [`campaign-${shop}`],
    );
    await addVisit(db.pool, { account: 'friend', shop, date: '2026-09-01' });
  }
  await befriend(db, 'viewer', 'friend');

  const check = async (expectedId: string | null) => {
    const listed = (await catalog.listPublicMerchants()).some((merchant) => merchant.id === 'shop-a');
    assert.equal(listed, expectedId !== null);
    assert.deepEqual((await db.friends.list('viewer')).friends[0]!.stamps, [
      { merchantName: '가상 real-shop', merchantId: 'real-shop' },
      { merchantName: '가상 shop-a', merchantId: expectedId },
    ]);
  };
  await check('shop-a'); // 시연 여부는 공개 목록의 숨김 조건이 아니다.
  await db.pool.query(`UPDATE campaigns SET enrolled_count = enrollment_capacity WHERE id = 'campaign-shop-a'`);
  await check('shop-a'); // 모집이 마감돼도 공개 가게다.

  const cases = [
    [`UPDATE merchants SET status = 'PAUSED' WHERE id = 'shop-a'`,
      `UPDATE merchants SET status = 'ACTIVE' WHERE id = 'shop-a'`],
    [`UPDATE campaigns SET is_public = false WHERE id = 'campaign-shop-a'`,
      `UPDATE campaigns SET is_public = true WHERE id = 'campaign-shop-a'`],
    ...['DRAFT', 'PAUSED', 'ENDED'].map((status) => [
      `UPDATE campaigns SET status = '${status}' WHERE id = 'campaign-shop-a'`,
      `UPDATE campaigns SET status = 'ACTIVE' WHERE id = 'campaign-shop-a'`,
    ]),
    [`UPDATE campaigns SET starts_at = '2026-10-01T00:00:00Z' WHERE id = 'campaign-shop-a'`,
      `UPDATE campaigns SET starts_at = '2026-01-01T00:00:00Z' WHERE id = 'campaign-shop-a'`],
    [`UPDATE campaigns SET ends_at = '2026-09-29T00:00:00Z' WHERE id = 'campaign-shop-a'`,
      `UPDATE campaigns SET ends_at = '2027-01-01T00:00:00Z' WHERE id = 'campaign-shop-a'`],
    [`DELETE FROM campaign_goals WHERE campaign_id = 'campaign-shop-a' AND target_visit_count = 5`,
      `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name) VALUES ('campaign-shop-a', 5, '5회')`],
  ];
  for (const [hide, restore] of cases) {
    await db.pool.query(hide!);
    await check(null);
    await db.pool.query(restore!);
    await check('shop-a');
  }
  // 시작 시각은 포함, 종료 시각은 제외한다. 방문 집계 기준(어제)과 별개로 요청 시각을 쓴다.
  await db.pool.query(`UPDATE campaigns SET starts_at = '2026-09-29T00:00:00Z',
    ends_at = '2026-09-29T00:00:01Z' WHERE id = 'campaign-shop-a'`);
  await check('shop-a');
  db.state.now = new Date('2026-09-29T00:00:01Z');
  await check(null);
});

test('friends see stamps and medals only through yesterday; today counts for /me/badges but not for the friends list', async (t) => {
  const db = await setup(t);
  await db.friends.setNickname({ accountId: 'viewer', nickname: '나' });
  await db.friends.setNickname({ accountId: 'pal', nickname: '친구' });
  await befriend(db, 'viewer', 'pal');
  // pal: 어제(9월 28일) shop-a, 오늘(9월 29일) shop-b. viewer: 오늘 세 점포.
  await addVisit(db.pool, { account: 'pal', shop: 'shop-a', date: '2026-09-28' });
  await addVisit(db.pool, { account: 'pal', shop: 'shop-b', date: '2026-09-29' });
  for (const shop of ['shop-a', 'shop-b', 'shop-c'] as const) await addVisit(db.pool, { account: 'viewer', shop, date: '2026-09-29' });

  // 시계는 2026-09-29 09:00 KST. 오늘 방문은 친구 목록에서 나에게도 친구에게도 아직 없고, 순위도 어제까지로 정해진다.
  const today = await db.friends.list('viewer');
  assert.equal(today.me.asOf, '2026-09-28');
  assert.deepEqual(today.me.badges, { earned: 0, total: 9 });
  assert.deepEqual(today.me.medals.map((medal) => medal.tier), [0, 0, 0]);
  assert.deepEqual(today.friends[0]!.stamps, [{ merchantName: '가상 shop-a', merchantId: null }]);
  assert.deepEqual(today.friends[0]!.badges, { earned: 1, total: 9 });
  assert.deepEqual(today.friends.map((friend) => friend.rank), [1]);
  assert.equal(today.me.rank, 2);
  // 실시간 /me/badges는 오늘 방문까지 센다.
  assert.deepEqual((await db.badges.getBadges('viewer')).medals.map((medal) => medal.value), [3, 1, 1]);
  assert.equal((await db.badges.getBadges('viewer')).earnedTiers, 3 + 0 + 0);
  // 친구 쪽에서 나를 볼 때도 오늘 방문은 없다.
  const seenByPal = await db.friends.list('pal');
  assert.deepEqual(seenByPal.friends[0]!.stamps, []);
  assert.deepEqual(seenByPal.friends[0]!.badges, { earned: 0, total: 9 });
  assert.equal(seenByPal.me.asOf, '2026-09-28');

  // KST 하루가 지나면 9월 29일 방문이 보이고 기준이 9월 29일로 바뀐다.
  db.state.now = new Date('2026-09-30T00:00:00.000Z');
  const next = await db.friends.list('viewer');
  assert.equal(next.me.asOf, '2026-09-29');
  assert.deepEqual(next.me.badges, { earned: 3 + 0 + 0, total: 9 });
  assert.deepEqual(next.friends[0]!.stamps, [
    { merchantName: '가상 shop-a', merchantId: null }, { merchantName: '가상 shop-b', merchantId: null },
  ]);
  // 친구는 탐험가 2곳(2) + 꾸준한 걸음 이틀(1)이라 배지 3개로 나와 같고, 도장이 3대 2라 내가 앞선다.
  assert.deepEqual(next.friends[0]!.badges, { earned: 3, total: 9 });
  assert.equal(next.me.rank, 1);
  assert.equal(next.friends[0]!.rank, 2);
});

test('the friends cutoff flips exactly at KST midnight, not at UTC midnight', async (t) => {
  const db = await setup(t);
  await befriend(db, 'viewer', 'pal');
  await addVisit(db.pool, { account: 'pal', shop: 'shop-a', date: '2026-09-28' });
  const stampsSeenAt = async (iso: string) => {
    db.state.now = new Date(iso);
    const list = await db.friends.list('viewer');
    return [list.me.asOf, list.friends[0]!.stamps.length] as const;
  };
  // 9월 28일 23:59:59.999 KST(= 14:59:59.999 UTC)까지는 9월 28일이 "오늘"이라 숨긴다. UTC로는 이미 다음 날이 아니다.
  assert.deepEqual(await stampsSeenAt('2026-09-28T14:59:59.999Z'), ['2026-09-27', 0]);
  assert.deepEqual(await stampsSeenAt('2026-09-28T15:00:00.000Z'), ['2026-09-28', 1]);
  // UTC 날짜는 아직 28일이지만 KST는 29일 새벽이다.
  assert.deepEqual(await stampsSeenAt('2026-09-28T20:00:00.000Z'), ['2026-09-28', 1]);
});

test('the ranking uses the delayed data for me too, so a visit made today cannot jump the ranking', async (t) => {
  const db = await setup(t);
  await db.friends.setNickname({ accountId: 'viewer', nickname: 'ㅋ나' });
  await db.friends.setNickname({ accountId: 'rival', nickname: 'ㅋ라이벌' });
  await befriend(db, 'viewer', 'rival');
  await addVisit(db.pool, { account: 'rival', shop: 'shop-a', date: '2026-09-27' });
  await addVisit(db.pool, { account: 'rival', shop: 'shop-b', date: '2026-09-28' });
  // viewer는 오늘 세 점포를 돌아 실시간으로는 앞서지만 친구 순위에는 아직 반영되지 않는다.
  for (const shop of ['shop-a', 'shop-b', 'shop-c'] as const) await addVisit(db.pool, { account: 'viewer', shop, date: '2026-09-29' });
  const before = await db.friends.list('viewer');
  assert.equal(before.friends[0]!.rank, 1);
  assert.equal(before.me.rank, 2);
  db.state.now = new Date('2026-09-30T00:00:00.000Z');
  const after = await db.friends.list('viewer');
  assert.equal(after.me.rank, 1);
  assert.equal(after.friends[0]!.rank, 2);
});

test('the friend ranking follows badges, then stamps, then nickname', async (t) => {
  const db = await setup(t);
  // gold: 서로 다른 점포 3곳(탐험가 골드 = 배지 3, 도장 3). silver: 2곳(배지 2). copper: 1곳(배지 1).
  for (const shop of ['shop-a', 'shop-b', 'shop-c'] as const) await addVisit(db.pool, { account: 'gold', shop, date: '2026-09-01' });
  for (const shop of ['shop-a', 'shop-b'] as const) await addVisit(db.pool, { account: 'silver', shop, date: '2026-09-01' });
  await addVisit(db.pool, { account: 'copper', shop: 'shop-a', date: '2026-09-01' });
  for (const [account, name] of [['gold', '금'], ['silver', '은'], ['copper', '동'], ['viewer', '나']] as const) {
    await db.friends.setNickname({ accountId: account, nickname: name });
  }
  for (const other of ['copper', 'gold', 'silver']) await befriend(db, 'viewer', other);
  const snapshot = await db.friends.list('viewer');
  assert.deepEqual(snapshot.friends.map((friend) => [friend.nickname, friend.rank]), [['금', 1], ['은', 2], ['동', 3]]);
  assert.equal(snapshot.me.rank, 4);
  assert.deepEqual(snapshot.friends.map((friend) => friend.stamps.length), [3, 2, 1]);
});

test('account deletion removes code, profile, attempts and both sides of every friendship', async (t) => {
  const db = await setup(t);
  await befriend(db, 'leaver', 'b');
  await befriend(db, 'c', 'leaver');
  await befriend(db, 'b', 'c');
  await db.friends.setNickname({ accountId: 'leaver', nickname: '떠날 사람' });
  await db.friends.setNickname({ accountId: 'b', nickname: '남는 사람' });
  // 차단은 떠나는 계정이 끊은 것과 떠나는 계정을 끊은 것, 남는 계정끼리의 것이 섞여 있다.
  await db.pool.query(
    `INSERT INTO friend_blocks (blocker, blocked) VALUES ('leaver', 'z1'), ('z2', 'leaver'), ('z1', 'z2')`,
  );
  await assert.rejects(db.friends.addByCode({ accountId: 'leaver', code: '22222222' }), rejectsWith('FRIEND_CODE_NOT_FOUND'));
  const leaverCode = await codeOf(db, 'leaver');
  assert.equal((await friendshipRows(db.pool)).length, 3);
  assert.equal((await db.friends.list('b')).friends.length, 2);

  await db.deletion.requestDeletion({ accountId: 'leaver', confirmation: 'DELETE MY ACCOUNT' });

  for (const table of ['friend_codes', 'explorer_profiles', 'friend_code_attempts']) {
    assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE account_id = 'leaver'`)).rows[0]!.n, 0, table);
  }
  assert.equal((await db.pool.query(
    `SELECT count(*)::int AS n FROM friendships WHERE account_low = 'leaver' OR account_high = 'leaver'`,
  )).rows[0]!.n, 0);
  // 남은 친구 관계와 다른 계정의 자료는 그대로다.
  assert.deepEqual((await friendshipRows(db.pool)).map((row) => [row.account_low, row.account_high]), [['b', 'c']]);
  // 양쪽 칸 어디에 있든 삭제된 계정의 차단은 사라지고 다른 계정끼리의 차단은 남는다.
  assert.deepEqual(await blockRows(db.pool), [['z1', 'z2']]);
  assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM explorer_profiles WHERE account_id = 'b'`)).rows[0]!.n, 1);
  for (const account of ['b', 'c']) {
    const list = await db.friends.list(account);
    assert.equal(list.friends.length, 1);
    assert.equal(JSON.stringify(list).includes('떠날 사람'), false);
  }

  // 삭제된 코드로는 더 이상 추가할 수 없고, 삭제된 계정은 친구 기능을 쓸 수 없다.
  await assert.rejects(db.friends.addByCode({ accountId: 'newcomer', code: leaverCode }), rejectsWith('FRIEND_CODE_NOT_FOUND'));
  await assert.rejects(db.friends.list('leaver'), rejectsWith('ACCOUNT_DELETED'));
  await assert.rejects(db.friends.rotateCode('leaver'), rejectsWith('ACCOUNT_DELETED'));
  await assert.rejects(db.friends.setNickname({ accountId: 'leaver', nickname: '유령' }), rejectsWith('ACCOUNT_DELETED'));
  const newcomerCode = await codeOf(db, 'newcomer');
  await assert.rejects(db.friends.addByCode({ accountId: 'leaver', code: newcomerCode }), rejectsWith('ACCOUNT_DELETED'));
  await assert.rejects(db.friends.addByCode({ accountId: 'leaver', code: '22222222' }), rejectsWith('ACCOUNT_DELETED'));
  for (const table of ['friend_codes', 'explorer_profiles', 'friend_code_attempts']) {
    assert.equal((await db.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE account_id = 'leaver'`)).rows[0]!.n, 0, table);
  }
  assert.equal((await friendshipRows(db.pool)).length, 1);

  // 친구가 없거나 기록이 없는 계정의 삭제도 문제없이 끝난다.
  await db.deletion.requestDeletion({ accountId: 'never-used-friends', confirmation: 'DELETE MY ACCOUNT' });
});

test('adding a friend while the other account is being deleted never leaves a friendship behind', async (t) => {
  const db = await setup(t);
  for (let round = 0; round < 6; round++) {
    const target = `target-${round}`;
    const adder = `adder-${round}`;
    const code = await codeOf(db, target);
    await codeOf(db, adder);
    const [added, deleted] = await Promise.allSettled([
      db.friends.addByCode({ accountId: adder, code }),
      db.deletion.requestDeletion({ accountId: target, confirmation: 'DELETE MY ACCOUNT' }),
    ]);
    assert.equal(deleted.status, 'fulfilled', String(round));
    if (added.status === 'rejected') assert.ok(rejectsWith('FRIEND_CODE_NOT_FOUND')(added.reason), String(added.reason));
    assert.equal((await db.pool.query(
      'SELECT count(*)::int AS n FROM friendships WHERE account_low = $1 OR account_high = $1', [target],
    )).rows[0]!.n, 0, `round ${round}`);
    assert.equal((await db.pool.query('SELECT count(*)::int AS n FROM friend_codes WHERE account_id = $1', [target])).rows[0]!.n, 0);
    assert.deepEqual((await db.friends.list(adder)).friends, []);
  }
});
