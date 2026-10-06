import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresRetentionService, type RetentionCount } from './postgres/retention.js';
import { generateAccessRequestCode } from './showcase/access-requests.js';

const now = new Date('2026-09-30T12:00:00.000Z');
const cutoffMs = Date.parse('2025-09-30T12:00:00.000Z'); // exactly one year before `now`
const threeYearMs = Date.parse('2023-09-30T12:00:00.000Z'); // exactly three years before `now`
const dayMs = Date.parse('2026-09-29T12:00:00.000Z'); // exactly one day before `now`
const thirtyDayMs = now.getTime() - 30 * 86_400_000;
const at = (ms: number) => new Date(ms);
// Each period has the same three rows: one millisecond older is deleted, exactly at the boundary and younger are kept.
const around = (boundary: number) => ({ before: at(boundary - 1), exactly: at(boundary), after: at(boundary + 1) });
const oneYear = around(cutoffMs);
const threeYears = around(threeYearMs);
const oneDay = around(dayMs);
const twentyThreeHours = around(now.getTime() - 23 * 3_600_000);
const ninetyDays = around(now.getTime() - 90 * 86_400_000);
const { before, exactly, after } = oneYear;

async function setup(t: TestContext) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(
    `TRUNCATE auth_sessions, web_sessions, account_deletion_intake_requests, account_deletion_requests,
              platform_admin_audit, platform_admin_role_audit, staff_registration_audit, staff_registration_requests,
              badge_coupon_audit, badge_coupons, badge_reward_offers, platform_admins, customer_identity_tokens,
              wallet_challenges, web_oauth_states, showcase_access_requests,
              merchant_real_world_media, merchant_real_world_photos, merchant_real_world_reports,
              discovery_event_dedupe, merchants,
              play_runs, play_records, studios, retention_scan_progress CASCADE`,
  );
  await pool.query(
    `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ('shop-1', '보관 시험 식당', 'test', 'test', 0, 'ACTIVE', true)`,
  );
  return { pool, service: new PostgresRetentionService(pool, { now: () => now }) };
}

const counts = (rows: RetentionCount[]) => Object.fromEntries(rows.map(({ step, count }) => [step, count]));
const idsOf = async (pool: Pool, sql: string) =>
  (await pool.query<{ id: string }>(sql)).rows.map((row) => row.id).sort();
const deletedPlayPosition = async (pool: Pool) => {
  const result = await pool.query<{ position: string }>(
    `SELECT position FROM retention_scan_progress WHERE step = 'deleted_play_data'`,
  );
  assert.equal(result.rows.length, 1);
  return Number(result.rows[0]!.position);
};

test('discovery event dedupe keeps the exact 23-hour boundary', async (t) => {
  const { pool, service } = await setup(t);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, createdAt] of [twentyThreeHours.before, twentyThreeHours.exactly, twentyThreeHours.after].entries()) {
    await pool.query('INSERT INTO discovery_event_dedupe (event_id, merchant_id, created_at) VALUES ($1, $2, $3)',
      [ids[index], 'shop-1', createdAt]);
  }
  assert.equal(counts(await service.report()).discovery_event_dedupe, 1);
  const result = await service.run();
  assert.deepEqual(result.failed, []);
  assert.equal(counts(result.counts).discovery_event_dedupe, 1);
  assert.deepEqual(await idsOf(pool, 'SELECT event_id AS id FROM discovery_event_dedupe'), ids.slice(1).sort());
});

test('private merchant reports keep the exact 90-day boundary', async (t) => {
  const { pool, service } = await setup(t);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, createdAt] of [ninetyDays.before, ninetyDays.exactly, ninetyDays.after].entries()) {
    await pool.query(`INSERT INTO merchant_real_world_reports
      (id, merchant_id, reporter_account_id, kind, note, created_at, updated_at)
      VALUES ($1, 'shop-1', 'acct_reporter', 'HOURS', 'private report', $2, $2)`, [ids[index], createdAt]);
  }
  assert.equal(counts(await service.report()).merchant_real_world_reports, 1);
  const result = await service.run();
  assert.deepEqual(result.failed, []);
  assert.equal(counts(result.counts).merchant_real_world_reports, 1);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM merchant_real_world_reports'), ids.slice(1).sort());
});

test('retention drops old soft-deleted photos before orphan media but keeps shared and boundary media', async (t) => {
  const { pool, service } = await setup(t);
  const digests = ['a', 'b', 'c', 'd', 'e'].map((letter) => letter.repeat(64));
  for (const [index, digest] of digests.entries()) {
    const createdAt = index === 4 ? oneDay.exactly : oneDay.before;
    await pool.query(`INSERT INTO merchant_real_world_media (digest, width, height, image_bytes, created_at)
      VALUES ($1, 1, 1, $2, $3)`, [digest, Buffer.from([1]), createdAt]);
  }
  const insertPhoto = async (digest: string, deletedAt: Date | null) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO merchant_real_world_photos
      (id, merchant_id, digest, width, height, kind, deleted_at, created_at, updated_at)
      VALUES ($1, 'shop-1', $2, 1, 1, 'STORE', $3, $4, $4)`, [id, digest, deletedAt, oneDay.before]);
    return id;
  };
  await insertPhoto(digests[0]!, oneDay.before); // becomes an orphan
  await insertPhoto(digests[1]!, oneDay.before); // shares media with an active photo
  const active = await insertPhoto(digests[1]!, null);
  const boundary = await insertPhoto(digests[2]!, oneDay.exactly);
  // d is already orphaned; e is unreferenced but exactly at the media age boundary.
  const reported = counts(await service.report());
  assert.equal(reported.merchant_real_world_photos, 2);
  assert.equal(reported.merchant_real_world_media, 1, 'report sees only pre-run orphans');
  const result = await service.run();
  assert.deepEqual(result.failed, [], 'photo FK must be released before media deletion');
  assert.equal(counts(result.counts).merchant_real_world_photos, 2);
  assert.equal(counts(result.counts).merchant_real_world_media, 2);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM merchant_real_world_photos'), [active, boundary].sort());
  assert.deepEqual((await pool.query<{ digest: string }>('SELECT digest FROM merchant_real_world_media ORDER BY digest')).rows.map((row) => row.digest),
    [digests[1], digests[2], digests[4]]);
});

test('scan progress stores no account identifier and enforces its nonnegative position', async (t) => {
  const { pool, service } = await setup(t);
  const columns = await pool.query<{ column_name: string; data_type: string; is_nullable: string }>(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'retention_scan_progress'
     ORDER BY ordinal_position`,
  );
  assert.deepEqual(columns.rows, [
    { column_name: 'step', data_type: 'text', is_nullable: 'NO' },
    { column_name: 'position', data_type: 'bigint', is_nullable: 'NO' },
    { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
  ]);
  const primaryKey = await pool.query<{ column_name: string }>(
    `SELECT key_column_usage.column_name FROM information_schema.table_constraints AS constraints
     JOIN information_schema.key_column_usage AS key_column_usage
       ON key_column_usage.constraint_catalog = constraints.constraint_catalog
      AND key_column_usage.constraint_schema = constraints.constraint_schema
      AND key_column_usage.constraint_name = constraints.constraint_name
     WHERE constraints.table_schema = current_schema()
       AND constraints.table_name = 'retention_scan_progress' AND constraints.constraint_type = 'PRIMARY KEY'`,
  );
  assert.deepEqual(primaryKey.rows, [{ column_name: 'step' }]);
  await assert.rejects(
    pool.query(`INSERT INTO retention_scan_progress (step, position, updated_at) VALUES ($1, -1, $2)`,
      ['deleted_play_data', now]),
    (error: { code?: string }) => error.code === '23514',
  );

  const result = await service.run({ hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes' });
  assert.deepEqual(result.failed, []);
  assert.equal(counts(result.counts).deleted_play_data, 0);
  const progress = await pool.query<{ position: string; updated_at: Date }>(
    `SELECT position, updated_at FROM retention_scan_progress WHERE step = 'deleted_play_data'`,
  );
  assert.deepEqual(progress.rows, [{ position: '0', updated_at: now }]);
  assert.equal((await pool.query('SELECT 1 FROM play_runs UNION SELECT 1 FROM play_records UNION SELECT 1 FROM studios')).rowCount, 0);
});

function observeCandidatePages(pool: Pool) {
  const pages: string[][] = [];
  const observed = {
    connect: () => pool.connect(),
    query: async (sql: string, values?: unknown[]) => {
      const result = await pool.query(sql, values);
      if (sql.includes(') candidates ORDER BY account_id')) pages.push(result.rows.map((row) => row.account_id));
      return result;
    },
  } as unknown as Pool;
  return { observed, pages };
}

// ---------------------------------------------------------------------------------------------------------------------
// seeds: each returns the ids that must be gone after the run and the ids that must stay.
// ---------------------------------------------------------------------------------------------------------------------

async function seedAuthSessions(pool: Pool) {
  const gone: string[] = [];
  const kept: string[] = [];
  const insert = async (bucket: string[], expiresMs: number, revokedAt: Date | null) => {
    const id = randomUUID();
    bucket.push(id);
    await pool.query(
      `INSERT INTO auth_sessions (id, account_id, token_hash, created_at, expires_at, last_authenticated_at, revoked_at)
       VALUES ($1, 'acct_session', $2, $3, $4, $3, $5)`,
      [id, randomBytes(32), at(now.getTime() - 86_400_000 * 40), at(expiresMs), revokedAt],
    );
  };
  await insert(gone, now.getTime(), null); // expired exactly now
  await insert(gone, now.getTime() - 86_400_000, null); // long expired
  await insert(gone, now.getTime() + 86_400_000 * 20, at(now.getTime() - 1000)); // revoked, not yet expired
  await insert(kept, now.getTime() + 1, null); // expires one millisecond later
  await insert(kept, now.getTime() + 86_400_000 * 20, null); // active
  return { gone: gone.sort(), kept: kept.sort() };
}

async function seedWebSessions(pool: Pool) {
  const gone: string[] = [];
  const kept: string[] = [];
  const insert = async (bucket: string[], expiresMs: number, revokedAt: Date | null) => {
    const id = randomUUID();
    bucket.push(id);
    await pool.query(
      `INSERT INTO web_sessions (id, account_id, token_hash, created_at, expires_at, revoked_at)
       VALUES ($1, 'acct_web', $2, $3, $4, $5)`,
      [id, randomBytes(32), at(now.getTime() - 86_400_000 * 3), at(expiresMs), revokedAt],
    );
  };
  await insert(gone, now.getTime(), null);
  await insert(gone, now.getTime() + 3_600_000, at(now.getTime() - 5000)); // logged out, not yet expired
  await insert(kept, now.getTime() + 1, null);
  await insert(kept, now.getTime() + 3_600_000, null);
  return { gone: gone.sort(), kept: kept.sort() };
}

async function seedDeletionIntake(pool: Pool) {
  const ledgerId = randomUUID();
  await pool.query(
    `INSERT INTO account_deletion_requests (
       id, account_reference_hash, deleted_account_alias, status, policy_version, cancelled_mint_jobs,
       pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at
     ) VALUES ($1, $2, $3, 'COMPLETED', 'account-deletion-v1', 0, 0, 0, $4, $4, $4)`,
    [ledgerId, randomBytes(32), `deleted:${randomBytes(32).toString('hex')}`, at(cutoffMs - 86_400_000 * 400)],
  );
  const gone: string[] = [];
  const kept: string[] = [];
  const insert = async (
    bucket: string[],
    status: 'PROCESSED' | 'CANCELLED' | 'REJECTED' | 'REQUESTED',
    finishedAt: Date | null,
  ) => {
    const id = randomUUID();
    bucket.push(id);
    const requestedAt = at((finishedAt?.getTime() ?? cutoffMs - 86_400_000 * 900) - 8 * 86_400_000);
    await pool.query(
      `INSERT INTO account_deletion_intake_requests (
         id, account_id, requested_at, status, source, cancel_until, due_at,
         cancelled_at, processed_at, processed_by, reject_reason, deletion_request_id
       ) VALUES ($1, $2, $3, $4, 'WEB', $3::timestamptz + interval '24 hours', $3::timestamptz + interval '7 days',
                 $5, $6, $7, $8, $9)`,
      [
        id, status === 'REQUESTED' ? `acct_${id}` : null, requestedAt, status,
        status === 'CANCELLED' ? finishedAt : null,
        status === 'PROCESSED' || status === 'REJECTED' ? finishedAt : null,
        status === 'PROCESSED' || status === 'REJECTED' ? 'cli:tester' : null,
        status === 'REJECTED' ? '시험 사유' : null,
        status === 'PROCESSED' ? ledgerId : null,
      ],
    );
  };
  for (const status of ['PROCESSED', 'CANCELLED', 'REJECTED'] as const) {
    await insert(gone, status, before);
    await insert(kept, status, exactly);
    await insert(kept, status, after);
  }
  // An active filing is never retention material, however old it is; the deletion ledger is never touched either.
  await insert(kept, 'REQUESTED', null);
  return { gone: gone.sort(), kept: kept.sort(), ledgerId };
}

type AuditSeed = {
  table: string;
  boundary: ReturnType<typeof around>;
  insert: (pool: Pool, id: string, createdAt: Date) => Promise<void>;
};

const ownerAction = (action: 'MERCHANT_OWNER_GRANTED' | 'MERCHANT_OWNER_REVOKED') =>
  async (pool: Pool, id: string, createdAt: Date) => {
    await pool.query(
      `INSERT INTO platform_admin_audit (id, actor_account_id, merchant_id, action, target_account_id, after_state, created_at)
       VALUES ($1, 'acct_admin', 'shop-1', $2, 'acct_owner', '{}'::jsonb, $3)`,
      [id, action, createdAt],
    );
  };

const auditSeeds: Record<string, AuditSeed> = {
  // Handling records other than owner changes: one year.
  admin_audit: {
    table: 'platform_admin_audit',
    boundary: oneYear,
    insert: async (pool, id, createdAt) => {
      await pool.query(
        `INSERT INTO platform_admin_audit (id, actor_account_id, merchant_id, action, after_state, created_at)
         VALUES ($1, 'cli:tester', NULL, 'ACCOUNT_DELETION_PROCESSED', '{}'::jsonb, $2)`,
        [id, createdAt],
      );
    },
  },
  // Owner grant/revoke records are access-right records: three years.
  admin_owner_granted: { table: 'platform_admin_audit', boundary: threeYears, insert: ownerAction('MERCHANT_OWNER_GRANTED') },
  admin_owner_revoked: { table: 'platform_admin_audit', boundary: threeYears, insert: ownerAction('MERCHANT_OWNER_REVOKED') },
  admin_role_audit: {
    table: 'platform_admin_role_audit',
    boundary: threeYears,
    insert: async (pool, id, createdAt) => {
      await pool.query(
        `INSERT INTO platform_admin_role_audit (id, target_account_id, action, created_at)
         VALUES ($1, 'acct_admin', 'GRANT', $2)`,
        [id, createdAt],
      );
    },
  },
  staff_registration_audit: {
    table: 'staff_registration_audit',
    boundary: threeYears,
    insert: async (pool, id, createdAt) => {
      await pool.query(
        `INSERT INTO staff_registration_audit (id, actor_account_id, target_account_id, merchant_id, action, created_at)
         VALUES ($1, 'acct_owner', 'acct_staff', 'shop-1', 'APPROVED', $2)`,
        [id, createdAt],
      );
    },
  },
  coupon_audit: {
    table: 'badge_coupon_audit',
    boundary: oneYear,
    insert: async (pool, id, createdAt) => {
      await pool.query(
        `INSERT INTO badge_coupon_audit (id, coupon_id, merchant_id, action, actor_account_id, created_at)
         VALUES ($1, '10000000-0000-4000-8000-000000000001', 'shop-1', 'REDEMPTION_UNDONE', 'acct_staff', $2)`,
        [id, createdAt],
      );
    },
  },
  // 점주 체험 권한 요청(#294)의 결정된 행. 여기서 걸리는 시각은 created_at이 아니라 decided_at이다.
  showcase_access_requests: {
    table: 'showcase_access_requests',
    boundary: threeYears,
    insert: async (pool, id, decidedAt) => {
      await pool.query(
        `INSERT INTO showcase_access_requests (id, account_id, code, status, decided_at, decided_by_account_id, decided_via)
         VALUES ($1, $2, $3, 'APPROVED', $4, 'acct_admin', 'APP')`,
        [id, `acct_req_${id}`, generateAccessRequestCode(), decidedAt],
      );
    },
  },
};

async function seedCoupon(pool: Pool) {
  await pool.query(
    `INSERT INTO badge_reward_offers (id, milestone, merchant_id, title, detail, valid_days, status, consent_note)
     VALUES ('20000000-0000-4000-8000-000000000001', 1, 'shop-1', '시험 혜택', '', 30, 'ACTIVE', '시험 동의')`,
  );
  await pool.query(
    `INSERT INTO badge_coupons (id, customer_account_id, milestone, offer_id, merchant_id, title, detail, status, issued_at, expires_at)
     VALUES ('10000000-0000-4000-8000-000000000001', 'acct_customer', 1, '20000000-0000-4000-8000-000000000001',
             'shop-1', '시험 혜택', '', 'ISSUED', $1, $2)`,
    [at(cutoffMs - 86_400_000 * 500), at(cutoffMs - 86_400_000 * 400)],
  );
}

/** Three rows per table around that table's own boundary, plus the ids that must be gone and stay. */
async function seedAudit(pool: Pool, name: keyof typeof auditSeeds) {
  const seed = auditSeeds[name]!;
  const gone: string[] = [];
  const kept: string[] = [];
  for (const [bucket, createdAt] of [[gone, seed.boundary.before], [kept, seed.boundary.exactly], [kept, seed.boundary.after]] as const) {
    const id = randomUUID();
    bucket.push(id);
    await seed.insert(pool, id, createdAt);
  }
  return { gone: gone.sort(), kept: kept.sort(), table: seed.table };
}

async function seedOneTimeRows(pool: Pool) {
  const insert = async (table: string, sql: string, id: string, expiresAt: Date) => {
    await pool.query(sql, [id, expiresAt]);
    return { table, id };
  };
  const rows = { gone: [] as { table: string; id: string }[], kept: [] as { table: string; id: string }[] };
  for (const [bucket, expiresAt] of [[rows.gone, oneDay.before], [rows.kept, oneDay.exactly], [rows.kept, oneDay.after]] as const) {
    const hex = randomBytes(32).toString('hex');
    bucket.push(await insert('customer_identity_tokens',
      `INSERT INTO customer_identity_tokens (token_hash, customer_account_id, expires_at, created_at)
       VALUES (decode($1, 'hex'), 'acct_token', $2, $2::timestamptz - interval '5 minutes')`, hex, expiresAt));
    const challenge = randomUUID();
    bucket.push(await insert('wallet_challenges',
      `INSERT INTO wallet_challenges (id, account_id, address, chain_id, nonce, message, issued_at, expires_at, status)
       VALUES ($1, 'acct_wallet', '0x7000000000000000000000000000000000000007', 84532, 'abc12345def67890', 'm',
               $2::timestamptz - interval '5 minutes', $2, 'pending')`, challenge, expiresAt));
    const state = randomBytes(32).toString('hex');
    bucket.push(await insert('web_oauth_states',
      `INSERT INTO web_oauth_states (state_hash, code_verifier, nonce, expires_at)
       VALUES (decode($1, 'hex'), repeat('v', 43), repeat('n', 43), $2)`, state, expiresAt));
  }
  return rows;
}

async function seedStaffRequests(pool: Pool) {
  const gone: string[] = [];
  const kept: string[] = [];
  const insert = async (bucket: string[], expiresAt: Date, consumedAt: Date | null) => {
    const id = randomUUID();
    bucket.push(id);
    await pool.query(
      `INSERT INTO staff_registration_requests (id, merchant_id, account_id, code_hash, created_at, expires_at, consumed_at)
       VALUES ($1, 'shop-1', 'acct_staff', $2, $3::timestamptz - interval '15 minutes', $3, $4)`,
      [id, randomBytes(32), expiresAt, consumedAt],
    );
  };
  await insert(gone, oneDay.before, null); // expired more than a day ago, never used
  await insert(kept, oneDay.exactly, null);
  await insert(kept, oneDay.after, null);
  await insert(gone, at(now.getTime() + 60_000), oneDay.before); // used more than a day ago, code not expired yet
  await insert(kept, at(now.getTime() + 60_000), oneDay.exactly);
  await insert(kept, at(now.getTime() + 60_000), oneDay.after);
  await insert(kept, at(now.getTime() + 60_000), null); // still pending
  return { gone: gone.sort(), kept: kept.sort() };
}

test('run deletes exactly the rows older than each period in every table and nothing else', async (t) => {
  const { pool, service } = await setup(t);
  await seedCoupon(pool);
  const authSessions = await seedAuthSessions(pool);
  const webSessions = await seedWebSessions(pool);
  const intake = await seedDeletionIntake(pool);
  const audits = {
    admin_audit: await seedAudit(pool, 'admin_audit'),
    admin_role_audit: await seedAudit(pool, 'admin_role_audit'),
    staff_registration_audit: await seedAudit(pool, 'staff_registration_audit'),
    coupon_audit: await seedAudit(pool, 'coupon_audit'),
  };
  // Owner changes share the table of the one-year records but live three years.
  const ownerGranted = await seedAudit(pool, 'admin_owner_granted');
  const ownerRevoked = await seedAudit(pool, 'admin_owner_revoked');
  const oneTime = await seedOneTimeRows(pool);
  const staffRequests = await seedStaffRequests(pool);
  const showcaseAccessRequests = await seedAudit(pool, 'showcase_access_requests');
  await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('acct_admin')`);

  const reported = counts(await service.report());
  assert.deepEqual(reported, {
    discovery_event_dedupe: 0, merchant_real_world_reports: 0,
    merchant_real_world_photos: 0, merchant_real_world_media: 0,
    auth_sessions: 3, web_sessions: 2, deletion_intake: 3, admin_audit: 1, admin_owner_audit: 2,
    admin_role_audit: 1, staff_registration_audit: 1, merchant_campaign_extension_audit: 0, merchant_staff_action_audit: 0,
    coupon_audit: 1, customer_identity_tokens: 1,
    wallet_challenges: 1, web_oauth_states: 1, staff_registration_requests: 2, showcase_access_requests: 1,
    play_runs: 0,
  });
  // A report is read-only.
  assert.equal((await idsOf(pool, 'SELECT id FROM auth_sessions')).length, 5);
  assert.equal((await idsOf(pool, 'SELECT id FROM platform_admin_audit')).length, 9);

  const result = await service.run();
  assert.deepEqual(result.failed, []);
  assert.deepEqual(counts(result.counts), reported);

  assert.deepEqual(await idsOf(pool, 'SELECT id FROM auth_sessions'), authSessions.kept);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM web_sessions'), webSessions.kept);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM account_deletion_intake_requests'), intake.kept);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM platform_admin_role_audit'), audits.admin_role_audit.kept);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM staff_registration_audit'), audits.staff_registration_audit.kept);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM badge_coupon_audit'), audits.coupon_audit.kept);
  assert.deepEqual(
    await idsOf(pool, 'SELECT id FROM platform_admin_audit'),
    [...audits.admin_audit.kept, ...ownerGranted.kept, ...ownerRevoked.kept].sort(),
  );
  for (const audit of [...Object.values(audits), ownerGranted, ownerRevoked, showcaseAccessRequests]) {
    assert.equal(audit.gone.length, 1);
  }
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM staff_registration_requests'), staffRequests.kept);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM showcase_access_requests'), showcaseAccessRequests.kept);
  for (const [table, column] of [['customer_identity_tokens', 'encode(token_hash, \'hex\')'], ['wallet_challenges', 'id'],
    ['web_oauth_states', 'encode(state_hash, \'hex\')']] as const) {
    const remaining = (await pool.query<{ id: string }>(`SELECT ${column} AS id FROM ${table}`)).rows.map((row) => row.id).sort();
    assert.deepEqual(remaining, oneTime.kept.filter((row) => row.table === table).map((row) => row.id).sort(), table);
  }

  // What retention must never touch: the deletion ledger, the coupon the audit rows describe, admin grants, merchants.
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM account_deletion_requests'), [intake.ledgerId]);
  assert.equal((await pool.query('SELECT 1 FROM badge_coupons')).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM platform_admins')).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM merchants')).rowCount, 1);
  assert.equal(
    (await pool.query(`SELECT 1 FROM account_deletion_intake_requests WHERE status = 'REQUESTED' AND account_id IS NOT NULL`)).rowCount,
    1,
  );

  // A second run has nothing left to delete.
  assert.deepEqual(Object.values(counts((await service.run()).counts)), Array(Object.keys(reported).length).fill(0));
});

test('play run retention removes old expired and finished runs but preserves boundary runs and best records', async (t) => {
  const { pool, service } = await setup(t);
  const gone: string[] = [];
  const kept: string[] = [];
  const insert = async (bucket: string[], expiresAt: Date, finishedAt: Date | null) => {
    const id = randomUUID();
    bucket.push(id);
    await pool.query(
      `INSERT INTO play_runs (id, account_id, kind, seed, started_at, expires_at, rules_version, finished_at, result)
       VALUES ($1, 'acct_play_retention', 'stack', 1, $2, $3, 1, $4, $5)`,
      [id, at((finishedAt ?? expiresAt).getTime() - 300_000), expiresAt, finishedAt, finishedAt === null ? null : '{}'],
    );
  };
  await insert(gone, at(thirtyDayMs - 1), null);
  await insert(kept, at(thirtyDayMs), null);
  await insert(kept, at(thirtyDayMs + 1), null);
  await insert(kept, at(now.getTime() + 60_000), null);
  await insert(gone, at(thirtyDayMs + 299_999), at(thirtyDayMs - 1));
  await insert(kept, at(thirtyDayMs + 300_000), at(thirtyDayMs));
  await insert(kept, at(thirtyDayMs + 300_001), at(thirtyDayMs + 1));
  await pool.query(
    `INSERT INTO play_records (account_id, kind, best_score, plays)
     VALUES ('acct_play_retention', 'stack', 42, 7)`,
  );

  assert.equal(counts(await service.report()).play_runs, gone.length);
  assert.equal((await pool.query('SELECT 1 FROM play_runs')).rowCount, gone.length + kept.length);
  const first = await service.run();
  assert.deepEqual(first.failed, []);
  assert.equal(counts(first.counts).play_runs, gone.length);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM play_runs'), kept.sort());
  assert.deepEqual((await pool.query('SELECT best_score, plays FROM play_records')).rows, [{ best_score: 42, plays: 7 }]);
  assert.equal(counts((await service.run()).counts).play_runs, 0);
});

test('old play runs stop at the per-run cap and finish over repeated runs without deleting best records', async (t) => {
  const { pool } = await setup(t);
  const service = new PostgresRetentionService(pool, { now: () => now, playBatchSize: 2, playMaxBatches: 2 });
  const oldIds = Array.from({ length: 5 }, () => randomUUID());
  const recentId = randomUUID();
  await pool.query(
    `INSERT INTO play_runs (id, account_id, kind, seed, started_at, expires_at, rules_version)
     SELECT id, 'acct_play_batches', 'stack', 1, $2::timestamptz, $3::timestamptz, 1
     FROM unnest($1::uuid[]) AS runs(id)`,
    [oldIds, at(thirtyDayMs - 600_000), at(thirtyDayMs - 1)],
  );
  await pool.query(
    `INSERT INTO play_runs (id, account_id, kind, seed, started_at, expires_at, rules_version)
     VALUES ($1, 'acct_play_batches', 'stack', 1, $2, $3, 1)`,
    [recentId, now, at(now.getTime() + 300_000)],
  );
  await pool.query(
    `INSERT INTO play_records (account_id, kind, best_score, plays)
     VALUES ('acct_play_batches', 'stack', 42, 7)`,
  );

  const first = await service.run();
  assert.deepEqual(first.failed, []);
  assert.equal(counts(first.counts).play_runs, 4);
  assert.equal(first.counts.find(({ step }) => step === 'play_runs')?.capHit, true);
  assert.equal((await pool.query('SELECT 1 FROM play_runs WHERE id = ANY($1::uuid[])', [oldIds])).rowCount, 1);

  const second = await service.run();
  assert.deepEqual(second.failed, []);
  assert.equal(counts(second.counts).play_runs, 1);
  assert.notEqual(second.counts.find(({ step }) => step === 'play_runs')?.capHit, true);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM play_runs'), [recentId]);
  assert.deepEqual((await pool.query('SELECT best_score, plays FROM play_records')).rows, [{ best_score: 42, plays: 7 }]);
  assert.equal(counts((await service.run()).counts).play_runs, 0);
});

test('deleted play data pages past live accounts and obeys the row cap across all three tables', async (t) => {
  const { pool } = await setup(t);
  const service = new PostgresRetentionService(pool, { now: () => now, playBatchSize: 2, playMaxBatches: 2 });
  const secret = 'test-only-account-deletion-secret-at-least-32-bytes';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const goneAccount = 'acct_10_deleted';
  const liveAccounts = ['acct_00_live', 'acct_01_live'];
  const goneIds = Array.from({ length: 5 }, () => randomUUID());
  const liveIds = liveAccounts.map(() => randomUUID());
  await pool.query(
    `INSERT INTO account_deletion_requests (
       id, account_reference_hash, deleted_account_alias, status, policy_version, cancelled_mint_jobs,
       pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at
     ) VALUES ($1, $2, $3, 'COMPLETED', 'account-deletion-v1', 0, 0, 0, $4, $4, $4)`,
    [randomUUID(), lifecycle.referenceHash(goneAccount), `deleted:${lifecycle.referenceHash(goneAccount).toString('hex')}`, now],
  );
  await pool.query(
    `INSERT INTO play_runs (id, account_id, kind, seed, started_at, expires_at, rules_version)
     SELECT id, $2, 'stack', 1, $3::timestamptz, $4::timestamptz, 1
     FROM unnest($1::uuid[]) AS runs(id)`,
    [goneIds, goneAccount, now, at(now.getTime() + 300_000)],
  );
  await pool.query(
    `INSERT INTO play_runs (id, account_id, kind, seed, started_at, expires_at, rules_version)
     SELECT id, account_id, 'stack', 1, $3::timestamptz, $4::timestamptz, 1
     FROM unnest($1::uuid[], $2::text[]) AS live(id, account_id)`,
    [liveIds, liveAccounts, now, at(now.getTime() + 300_000)],
  );
  await pool.query(
    `INSERT INTO play_records (account_id, kind, best_score, plays)
     VALUES ($1, 'stack', 12, 3), ($2, 'stack', 20, 4)`,
    [goneAccount, liveAccounts[0]],
  );
  await pool.query(
    `INSERT INTO studios (account_id, studio, updated_at)
     VALUES ($1, '{}'::jsonb, $3), ($2, '{}'::jsonb, $3)`,
    [goneAccount, liveAccounts[1], now],
  );

  const first = await service.run({ hmacSecret: secret });
  assert.deepEqual(first.failed, []);
  assert.equal(counts(first.counts).deleted_play_data, 4);
  assert.equal(first.counts.find(({ step }) => step === 'deleted_play_data')?.capHit, true);
  assert.equal((await pool.query('SELECT 1 FROM play_runs WHERE account_id = $1', [goneAccount])).rowCount!
    + (await pool.query('SELECT 1 FROM play_records WHERE account_id = $1', [goneAccount])).rowCount!
    + (await pool.query('SELECT 1 FROM studios WHERE account_id = $1', [goneAccount])).rowCount!, 3);
  assert.equal(await deletedPlayPosition(pool), 2, 'the partially purged page must be retried');

  const second = await service.run({ hmacSecret: secret });
  assert.deepEqual(second.failed, []);
  assert.equal(counts(second.counts).deleted_play_data, 3);
  assert.notEqual(second.counts.find(({ step }) => step === 'deleted_play_data')?.capHit, true);
  for (const table of ['play_runs', 'play_records', 'studios'] as const) {
    assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE account_id = $1`, [goneAccount])).rowCount, 0, table);
  }
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM play_runs'), liveIds.sort());
  assert.deepEqual((await pool.query('SELECT account_id, best_score, plays FROM play_records')).rows,
    [{ account_id: liveAccounts[0], best_score: 20, plays: 4 }]);
  assert.deepEqual((await pool.query('SELECT account_id FROM studios')).rows, [{ account_id: liveAccounts[1] }]);
  assert.equal(await deletedPlayPosition(pool), 0, 'the completed sweep starts over');
  assert.equal(counts((await service.run({ hmacSecret: secret })).counts).deleted_play_data, 0);
});

test('a partial page retries the account still holding rows after another deleted account disappears', async (t) => {
  const { pool } = await setup(t);
  const service = new PostgresRetentionService(pool, { now: () => now, playBatchSize: 2, playMaxBatches: 1 });
  const secret = 'test-only-account-deletion-secret-at-least-32-bytes';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const live = ['acct_00_live', 'acct_01_live'];
  const firstGone = 'acct_02_deleted';
  const secondGone = 'acct_03_deleted';
  await pool.query(
    `INSERT INTO play_records (account_id, kind, best_score, plays)
     SELECT account_id, 'stack', 42, 7 FROM unnest($1::text[]) AS accounts(account_id)`, [live],
  );
  for (const gone of [firstGone, secondGone]) {
    await pool.query(
      `INSERT INTO account_deletion_requests (
         id, account_reference_hash, deleted_account_alias, status, policy_version, cancelled_mint_jobs,
         pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at
       ) VALUES ($1, $2, $3, 'COMPLETED', 'account-deletion-v1', 0, 0, 0, $4, $4, $4)`,
      [randomUUID(), lifecycle.referenceHash(gone), `deleted:${lifecycle.referenceHash(gone).toString('hex')}`, now],
    );
  }
  const runIds = [1, 2, 3, 4].map((index) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
  await pool.query(
    `INSERT INTO play_runs (id, account_id, kind, seed, started_at, expires_at, rules_version)
     SELECT id, account_id, 'stack', 1, $3::timestamptz, $4::timestamptz, 1
     FROM unnest($1::uuid[], $2::text[]) AS runs(id, account_id)`,
    [runIds, [firstGone, secondGone, secondGone, secondGone], now, at(now.getTime() + 300_000)],
  );

  const first = await service.run({ hmacSecret: secret });
  assert.deepEqual(first.failed, []);
  assert.equal(counts(first.counts).deleted_play_data, 2);
  assert.equal(first.counts.find(({ step }) => step === 'deleted_play_data')?.capHit, true);
  assert.equal((await pool.query('SELECT 1 FROM play_runs WHERE account_id = $1', [firstGone])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM play_runs WHERE account_id = $1', [secondGone])).rowCount, 2);
  assert.equal(await deletedPlayPosition(pool), 2, 'the page starts again despite one account disappearing');

  const second = await service.run({ hmacSecret: secret });
  assert.deepEqual(second.failed, []);
  assert.equal(counts(second.counts).deleted_play_data, 2);
  assert.equal((await pool.query('SELECT 1 FROM play_runs WHERE account_id = $1', [secondGone])).rowCount, 0);
  assert.equal(await deletedPlayPosition(pool), 0);
  assert.deepEqual((await pool.query('SELECT account_id FROM play_records ORDER BY account_id')).rows,
    live.map((account_id) => ({ account_id })));
});

test('dense live-only pages resume at the scan budget and reach a deleted account at the end', async (t) => {
  const { pool } = await setup(t);
  const { observed, pages } = observeCandidatePages(pool);
  const service = new PostgresRetentionService(observed, { now: () => now, playBatchSize: 2, playMaxBatches: 2 });
  const secret = 'test-only-account-deletion-secret-at-least-32-bytes';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const live = Array.from({ length: 240 }, (_, i) => `acct_6b86b273-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const gone = 'acct_6b86b273-0000-4000-8000-000000000240';
  await pool.query(
    `INSERT INTO play_records (account_id, kind, best_score, plays)
     SELECT account_id, 'stack', 42, 7 FROM unnest($1::text[]) AS accounts(account_id)`, [[...live, gone]],
  );
  await pool.query(
    `INSERT INTO account_deletion_requests (
       id, account_reference_hash, deleted_account_alias, status, policy_version, cancelled_mint_jobs,
       pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at
     ) VALUES ($1, $2, $3, 'COMPLETED', 'account-deletion-v1', 0, 0, 0, $4, $4, $4)`,
    [randomUUID(), lifecycle.referenceHash(gone), `deleted:${lifecycle.referenceHash(gone).toString('hex')}`, now],
  );

  const first = await service.run({ hmacSecret: secret });
  assert.deepEqual(first.failed, []);
  assert.deepEqual(first.counts.find(({ step }) => step === 'deleted_play_data'),
    { step: 'deleted_play_data', count: 0, scanCapHit: true });
  assert.equal(pages.length, 100);
  assert.equal(pages.flat().includes(gone), false);
  assert.equal((await pool.query('SELECT 1 FROM play_records WHERE account_id = $1', [gone])).rowCount, 1);
  assert.equal(await deletedPlayPosition(pool), 200);

  pages.length = 0;
  const maxRuns = Math.ceil((live.length + 1) / (2 * 100)) + 1;
  let runCount = 1;
  let deleted = 0;
  while (runCount < maxRuns && deleted === 0) {
    const resumed = await service.run({ hmacSecret: secret });
    assert.deepEqual(resumed.failed, []);
    deleted += counts(resumed.counts).deleted_play_data ?? 0;
    runCount += 1;
  }
  assert.equal(deleted, 1);
  assert.ok(runCount <= maxRuns);
  assert.equal((await pool.query('SELECT 1 FROM play_records WHERE account_id = $1', [gone])).rowCount, 0);
  assert.ok(pages.length <= 100);
  assert.equal(pages[0]?.[0], live[200], 'the next run resumes after the first 200 accounts');
  assert.equal(new Set(pages.flat()).size, pages.flat().length, 'a run does not revisit a candidate');
  assert.equal(await deletedPlayPosition(pool), 0, 'a completed sweep resets progress');
  assert.deepEqual((await pool.query('SELECT account_id, best_score, plays FROM play_records ORDER BY account_id')).rows,
    live.map((account_id) => ({ account_id, best_score: 42, plays: 7 })));
});

test('removing an early candidate adjusts the saved offset so the next run reaches a later deletion', async (t) => {
  const { pool } = await setup(t);
  const service = new PostgresRetentionService(pool, { now: () => now, playBatchSize: 2, playMaxBatches: 2 });
  const secret = 'test-only-account-deletion-secret-at-least-32-bytes';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const account = (index: number) => `acct_6b86b273-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const firstGone = account(0);
  const laterGone = account(200);
  const live = Array.from({ length: 240 }, (_, index) => account(index + 1)).filter((id) => id !== laterGone);
  await pool.query(
    `INSERT INTO play_records (account_id, kind, best_score, plays)
     SELECT account_id, 'stack', 42, 7 FROM unnest($1::text[]) AS accounts(account_id)`,
    [[firstGone, ...live, laterGone]],
  );
  for (const gone of [firstGone, laterGone]) {
    await pool.query(
      `INSERT INTO account_deletion_requests (
         id, account_reference_hash, deleted_account_alias, status, policy_version, cancelled_mint_jobs,
         pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at
       ) VALUES ($1, $2, $3, 'COMPLETED', 'account-deletion-v1', 0, 0, 0, $4, $4, $4)`,
      [randomUUID(), lifecycle.referenceHash(gone), `deleted:${lifecycle.referenceHash(gone).toString('hex')}`, now],
    );
  }

  const first = await service.run({ hmacSecret: secret });
  assert.deepEqual(first.failed, []);
  assert.deepEqual(first.counts.find(({ step }) => step === 'deleted_play_data'),
    { step: 'deleted_play_data', count: 1, scanCapHit: true });
  assert.equal(await deletedPlayPosition(pool), 199, 'one removed account shifted later offsets down');
  assert.equal((await pool.query('SELECT 1 FROM play_records WHERE account_id = $1', [laterGone])).rowCount, 1);

  const second = await service.run({ hmacSecret: secret });
  assert.deepEqual(second.failed, []);
  assert.equal(counts(second.counts).deleted_play_data, 1);
  assert.equal((await pool.query('SELECT 1 FROM play_records WHERE account_id = $1', [laterGone])).rowCount, 0);
  assert.equal(await deletedPlayPosition(pool), 0);
  assert.deepEqual((await pool.query('SELECT account_id FROM play_records ORDER BY account_id')).rows,
    live.map((account_id) => ({ account_id })));
});

test('a complete sweep visits every candidate once and restarts from position zero', async (t) => {
  const { pool } = await setup(t);
  const { observed, pages } = observeCandidatePages(pool);
  const live = ['acct_10000000-live', 'acct_6b86b273-ff34-fce1-9d6b-804eff5a3f57', 'acct_90000000-live', 'acct_f0000000-live'];
  await pool.query(
    `INSERT INTO play_records (account_id, kind, best_score, plays)
     SELECT account_id, 'stack', 42, 7 FROM unnest($1::text[]) AS accounts(account_id)`, [live],
  );
  const service = new PostgresRetentionService(observed, {
    now: () => new Date('1970-01-02T12:00:00.000Z'), playBatchSize: 2, playMaxBatches: 2,
  });
  const result = await service.run({ hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes' });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.counts.find(({ step }) => step === 'deleted_play_data'),
    { step: 'deleted_play_data', count: 0 });
  assert.deepEqual(pages[0], live.slice(0, 2));
  assert.deepEqual(pages.flat().sort(), live);
  assert.equal(new Set(pages.flat()).size, live.length);
  assert.equal((await pool.query('SELECT 1 FROM play_records')).rowCount, live.length);
  assert.equal(await deletedPlayPosition(pool), 0);
  pages.length = 0;
  assert.equal(counts((await service.run({ hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes' })).counts)
    .deleted_play_data, 0);
  assert.deepEqual(pages[0], live.slice(0, 2), 'the next run begins a new sweep');
});

test('access-right records live three years while other handling records live one year', async (t) => {
  const { pool, service } = await setup(t);
  await seedCoupon(pool);
  // Two years old: past the one-year period, inside the three-year period.
  const twoYearsAgo = at(now.getTime() - 2 * 365 * 86_400_000);
  const twoYearIds: Record<string, string> = {};
  for (const name of ['admin_audit', 'admin_owner_granted', 'admin_owner_revoked', 'admin_role_audit',
    'staff_registration_audit', 'coupon_audit', 'showcase_access_requests'] as const) {
    twoYearIds[name] = randomUUID();
    await auditSeeds[name]!.insert(pool, twoYearIds[name]!, twoYearsAgo);
  }
  // Four years old: past every period.
  for (const name of ['admin_owner_granted', 'admin_owner_revoked', 'admin_role_audit', 'staff_registration_audit',
    'showcase_access_requests'] as const) {
    await auditSeeds[name]!.insert(pool, randomUUID(), at(now.getTime() - 4 * 365 * 86_400_000));
  }
  const result = counts(await service.run().then((run) => run.counts));
  assert.deepEqual(
    { admin_audit: result.admin_audit, admin_owner_audit: result.admin_owner_audit, admin_role_audit: result.admin_role_audit,
      staff_registration_audit: result.staff_registration_audit, coupon_audit: result.coupon_audit,
      showcase_access_requests: result.showcase_access_requests },
    { admin_audit: 1, admin_owner_audit: 2, admin_role_audit: 1, staff_registration_audit: 1, coupon_audit: 1,
      showcase_access_requests: 1 },
    'only the one-year kinds lose their two-year-old rows; the four-year-old access-right rows go too',
  );
  for (const name of ['admin_owner_granted', 'admin_owner_revoked']) {
    const alive = await pool.query('SELECT 1 FROM platform_admin_audit WHERE id = $1', [twoYearIds[name]]);
    assert.equal(alive.rowCount, 1, `${name} two years old must stay`);
  }
  for (const [name, table] of [['admin_role_audit', 'platform_admin_role_audit'], ['staff_registration_audit', 'staff_registration_audit'],
    ['showcase_access_requests', 'showcase_access_requests']] as const) {
    assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [twoYearIds[name]])).rowCount, 1, name);
  }
  assert.equal((await pool.query('SELECT 1 FROM platform_admin_audit WHERE id = $1', [twoYearIds.admin_audit])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM badge_coupon_audit WHERE id = $1', [twoYearIds.coupon_audit])).rowCount, 0);
});

test('the boundary is strict: one millisecond decides between deleted and kept, in both directions', async (t) => {
  const { pool } = await setup(t);
  await seedCoupon(pool);
  await seedAudit(pool, 'coupon_audit');
  await seedAudit(pool, 'admin_role_audit');
  const shifted = (ms: number) => new PostgresRetentionService(pool, { now: () => new Date(now.getTime() + ms) });
  // At the real instant: one row per table is older than its period.
  assert.deepEqual(
    [counts(await shifted(0).report()).coupon_audit, counts(await shifted(0).report()).admin_role_audit], [1, 1]);
  // One millisecond earlier "now" moves every cutoff back, so the row that was 1 ms too old is exactly at the boundary and stays.
  assert.deepEqual(
    [counts(await shifted(-1).report()).coupon_audit, counts(await shifted(-1).report()).admin_role_audit], [0, 0]);
  // One millisecond later the boundary row goes too, and the younger row still stays.
  assert.deepEqual(
    [counts(await shifted(1).report()).coupon_audit, counts(await shifted(1).report()).admin_role_audit], [2, 2]);
});

test('a step that fails is rolled back alone while the other steps still finish', async (t) => {
  const { pool } = await setup(t);
  await seedAuthSessions(pool);
  const web = await seedWebSessions(pool);
  await seedCoupon(pool);
  const audit = await seedAudit(pool, 'admin_role_audit');
  const flaky = {
    query: pool.query.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
      (client as unknown as { query: unknown }).query = async (...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].startsWith('DELETE FROM web_sessions')) throw new Error('simulated failure');
        return query(...args);
      };
      return client;
    },
  } as unknown as Pool;
  const result = await new PostgresRetentionService(flaky, { now: () => now }).run();
  assert.deepEqual(result.failed, ['web_sessions']);
  assert.equal(counts(result.counts).auth_sessions, 3);
  assert.equal(counts(result.counts).admin_role_audit, 1);
  assert.equal(counts(result.counts).web_sessions, undefined);
  // The failed step deleted nothing (its transaction was rolled back); the neighbours did their work.
  assert.equal((await idsOf(pool, 'SELECT id FROM web_sessions')).length, web.gone.length + web.kept.length);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM platform_admin_role_audit'), audit.kept);
});

test('the command prints counts only and leaves the exit code at zero when every step succeeds', async (t) => {
  const { pool } = await setup(t);
  // The child process gets the same fixed clock as the in-process retention tests.
  const ledgerId = randomUUID();
  await pool.query(
    `INSERT INTO account_deletion_requests (
       id, account_reference_hash, deleted_account_alias, status, policy_version, cancelled_mint_jobs,
       pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at
     ) VALUES ($1, $2, $3, 'COMPLETED', 'account-deletion-v1', 0, 0, 0, '2020-01-01Z', '2020-01-08Z', '2020-01-08Z')`,
    [ledgerId, randomBytes(32), `deleted:${randomBytes(32).toString('hex')}`],
  );
  await pool.query(
    `INSERT INTO account_deletion_intake_requests (
       id, account_id, requested_at, status, source, cancel_until, due_at, processed_at, processed_by, deletion_request_id
     ) VALUES ($1, NULL, '2020-01-01Z', 'PROCESSED', 'WEB', '2020-01-02Z', '2020-01-08Z', '2020-01-08Z', 'cli:tester', $2)`,
    [randomUUID(), ledgerId],
  );
  for (const [expiresAt, count] of [['2020-01-01Z', 2], ['2099-01-01Z', 1]] as const) {
    for (let index = 0; index < count; index += 1) {
      await pool.query(
        `INSERT INTO auth_sessions (id, account_id, token_hash, created_at, expires_at, last_authenticated_at)
         VALUES ($1, 'acct_session', $2, '2019-12-01Z', $3, '2019-12-01Z')`,
        [randomUUID(), randomBytes(32), expiresAt],
      );
    }
  }
  await auditSeeds.admin_role_audit!.insert(pool, randomUUID(), new Date('2019-01-01T00:00:00Z'));
  const command = fileURLToPath(new URL('./postgres/retention-command.ts', import.meta.url));
  const fixedDatePreload = `data:text/javascript,${encodeURIComponent(
    `const ActualDate = globalThis.Date;
     const fixedTime = ${now.getTime()};
     globalThis.Date = class extends ActualDate {
       constructor(...args) { super(...(args.length ? args : [fixedTime])); }
       static now() { return fixedTime; }
     };`,
  )}`;
  // The container of the host job has the deletion secret; `run` uses it for the audit target step (Issue #263).
  const secret = 'test-only-account-deletion-secret-at-least-32-bytes';
  const run = (args: string[], env: Record<string, string> = { ACCOUNT_DELETION_HMAC_SECRET: secret }) =>
    execFileSync(process.execPath, ['--import', fixedDatePreload, '--import', 'tsx', command, ...args], {
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL!, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const report = run(['report']).trim().split('\n');
  assert.match(report[0]!, /^RETENTION_REPORT/);
  assert.equal((await idsOf(pool, 'SELECT id FROM auth_sessions')).length, 3, 'report deleted nothing');

  const output = run(['run']);
  const lines = output.trim().split('\n');
  assert.equal(lines[0], 'RETENTION_RUN');
  assert.deepEqual(lines.slice(1), [
    'discovery_event_dedupe\t0', 'merchant_real_world_reports\t0',
    'merchant_real_world_photos\t0', 'merchant_real_world_media\t0',
    'auth_sessions\t2', 'web_sessions\t0', 'deletion_intake\t1', 'admin_audit\t0', 'admin_owner_audit\t0',
    'admin_role_audit\t1', 'staff_registration_audit\t0', 'merchant_campaign_extension_audit\t0', 'merchant_staff_action_audit\t0',
    'coupon_audit\t0', 'customer_identity_tokens\t0',
    'wallet_challenges\t0', 'web_oauth_states\t0', 'staff_registration_requests\t0', 'showcase_access_requests\t0',
    'play_runs\t0',
    'deleted_play_data\t0', 'admin_audit_deleted_targets\t0',
  ]);
  assert.equal((await idsOf(pool, 'SELECT id FROM auth_sessions')).length, 1);
  // No identifier of any kind reaches the terminal: not a row id, not an account id, not the ledger id.
  assert.doesNotMatch(output, /[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.doesNotMatch(output, /acct_|deleted:|cli:tester/);
  assert.equal(output.includes(ledgerId), false);
  assert.throws(() => run(['delete']), (error: { status?: number; stderr?: string }) =>
    error.status === 1 && /RETENTION_USAGE/.test(String(error.stderr)));
  // Without the secret both HMAC repair steps fail by name; ordinary delete steps still run.
  assert.throws(() => run(['run'], { ACCOUNT_DELETION_HMAC_SECRET: '' }), (error: { status?: number; stdout?: string; stderr?: string }) =>
    error.status === 1 && String(error.stderr).trim() ===
      'RETENTION_STEP_FAILED\tdeleted_play_data\nRETENTION_STEP_FAILED\tadmin_audit_deleted_targets'
      && /^auth_sessions\t0$/m.test(String(error.stdout))
      && !/deleted_play_data|admin_audit_deleted_targets/.test(String(error.stdout)));
});

test('after a rollback to an API without consent cleanup, purge-deleted-consents removes only deleted accounts consent rows', async (t) => {
  const { pool, service } = await setup(t);
  const secret = 'test-only-account-deletion-secret-at-least-32-bytes';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  await pool.query('TRUNCATE account_consents');
  for (const account of ['acct_gone', 'acct_gone_too', 'acct_staying']) {
    await pool.query(
      `INSERT INTO account_consents (account_id, terms_version, privacy_version, age_confirmed, source)
       VALUES ($1, 'terms-2026-09-30', 'privacy-2026-09-30', true, 'ANDROID'), ($1, 'terms-old', 'privacy-old', true, 'WEB')`,
      [account],
    );
  }
  // Two accounts were deleted while an older API (which does not touch consent rows) was running: only the ledger knows them.
  for (const account of ['acct_gone', 'acct_gone_too']) {
    await pool.query(
      `INSERT INTO account_deletion_requests (
         id, account_reference_hash, deleted_account_alias, status, policy_version, cancelled_mint_jobs,
         pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at
       ) VALUES ($1, $2, $3, 'COMPLETED', 'account-deletion-v1', 0, 0, 0, $4, $4, $4)`,
      [randomUUID(), lifecycle.referenceHash(account), `deleted:${lifecycle.referenceHash(account).toString('hex')}`, now],
    );
  }
  // A wrong secret hashes every account to a value the ledger does not know, so it deletes nothing: the deleted accounts' rows survive it
  // (they are only found by the right secret) and so, of course, do the living account's. Run it first, before the real purge.
  const consentRows = async (account: string) =>
    (await pool.query('SELECT 1 FROM account_consents WHERE account_id = $1', [account])).rowCount;
  assert.equal(await service.purgeConsentsOfDeletedAccounts('another-secret-of-at-least-32-bytes-long!'), 0);
  assert.equal(await consentRows('acct_gone'), 2, 'the deleted account row survives a wrong secret');
  assert.equal(await consentRows('acct_gone_too'), 2);
  assert.equal(await consentRows('acct_staying'), 2);

  assert.equal(await service.purgeConsentsOfDeletedAccounts(secret), 4);
  const left = (await pool.query<{ account_id: string }>('SELECT DISTINCT account_id FROM account_consents')).rows;
  assert.deepEqual(left.map((row) => row.account_id), ['acct_staying']);
  assert.equal(await consentRows('acct_staying'), 2, 'the living account keeps both rows');
  assert.equal(await service.purgeConsentsOfDeletedAccounts(secret), 0, 'a second run has nothing left');
});

test('after a rollback to an API that does not de-identify audit targets, the daily run replaces deleted accounts raw ids and only theirs (Issue #263)', async (t) => {
  const { pool, service } = await setup(t);
  const secret = 'test-only-account-deletion-secret-at-least-32-bytes';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const aliasOf = (account: string) => `deleted:${lifecycle.referenceHash(account).toString('hex')}`;
  const createdAt = at(now.getTime() - 86_400_000);
  const insertAudit = async (target: string) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO platform_admin_audit (id, actor_account_id, merchant_id, action, target_account_id, after_state, created_at)
       VALUES ($1, 'acct_admin', 'shop-1', 'MERCHANT_OWNER_GRANTED', $2, '{"role":"OWNER"}'::jsonb, $3)`,
      [id, target, createdAt],
    );
    return id;
  };
  const insertLedger = async (account: string) => {
    await pool.query(
      `INSERT INTO account_deletion_requests (
         id, account_reference_hash, deleted_account_alias, status, policy_version, cancelled_mint_jobs,
         pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at
       ) VALUES ($1, $2, $3, 'COMPLETED', 'account-deletion-v1', 0, 0, 0, $4, $4, $4)`,
      [randomUUID(), lifecycle.referenceHash(account), aliasOf(account), now],
    );
  };
  const targetsOf = async () => (await pool.query<{ id: string; target_account_id: string }>(
    'SELECT id, target_account_id FROM platform_admin_audit',
  )).rows.reduce<Record<string, string>>((acc, row) => ({ ...acc, [row.id]: row.target_account_id }), {});

  // acct_gone was deleted while the older API ran: the ledger has it but the audit rows still carry the raw target id (two rows, one per grant).
  // acct_alive is a live owner. acct_earlier was deleted by the current API: its audit row already holds the alias.
  await insertLedger('acct_gone');
  await insertLedger('acct_earlier');
  const goneA = await insertAudit('acct_gone');
  const goneB = await insertAudit('acct_gone');
  const alive = await insertAudit('acct_alive');
  const earlier = await insertAudit(aliasOf('acct_earlier'));

  // Not part of report(): it only counts what the delete steps would remove.
  assert.equal('admin_audit_deleted_targets' in counts(await service.report()), false);
  // Without a secret HMAC repair does not run; with an unusable one both repair steps report failure.
  assert.equal('admin_audit_deleted_targets' in counts((await service.run()).counts), false);
  assert.deepEqual((await service.run({ hmacSecret: 'too-short' })).failed, ['deleted_play_data', 'admin_audit_deleted_targets']);
  assert.equal((await targetsOf())[goneA], 'acct_gone', 'a step that could not run changed nothing');
  // A secret that is not the deletion secret hashes every account to a value the ledger does not know: nothing changes.
  const wrong = await service.run({ hmacSecret: 'another-secret-of-at-least-32-bytes-long!' });
  assert.equal(counts(wrong.counts).admin_audit_deleted_targets, 0);
  assert.equal((await targetsOf())[goneA], 'acct_gone');

  const result = await service.run({ hmacSecret: secret });
  assert.deepEqual(result.failed, []);
  assert.equal(counts(result.counts).admin_audit_deleted_targets, 2);
  assert.equal(result.counts.at(-1)!.step, 'admin_audit_deleted_targets', 'reported after the delete steps, like the other steps');
  assert.deepEqual(await targetsOf(), {
    [goneA]: aliasOf('acct_gone'),
    [goneB]: aliasOf('acct_gone'),
    [alive]: 'acct_alive',
    [earlier]: aliasOf('acct_earlier'),
  });
  // Only the target column changes: the rest of the row stays as it was.
  const untouched = (await pool.query<{ actor_account_id: string; action: string; after_state: unknown; created_at: Date }>(
    'SELECT actor_account_id, action, after_state, created_at FROM platform_admin_audit WHERE id = $1', [goneB],
  )).rows[0]!;
  assert.deepEqual(
    { ...untouched, created_at: untouched.created_at.getTime() },
    { actor_account_id: 'acct_admin', action: 'MERCHANT_OWNER_GRANTED', after_state: { role: 'OWNER' }, created_at: createdAt.getTime() },
  );
  assert.equal((await pool.query(`SELECT 1 FROM platform_admin_audit WHERE target_account_id = 'acct_gone'`)).rowCount, 0);
  assert.equal(counts((await service.run({ hmacSecret: secret })).counts).admin_audit_deleted_targets, 0, 'a second run has nothing left');
});

test('the audit target step works through many deleted accounts in bounded batches', async (t) => {
  const { pool, service } = await setup(t);
  const secret = 'test-only-account-deletion-secret-at-least-32-bytes';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  // 1,100 deleted owners (three batches of 500, 500 and 100 accounts) plus 5 live ones.
  const gone = Array.from({ length: 1100 }, (_, index) => `acct_bulk_gone_${index}`);
  const alive = Array.from({ length: 5 }, (_, index) => `acct_bulk_alive_${index}`);
  const hashes = gone.map((account) => lifecycle.referenceHash(account));
  await pool.query(
    `INSERT INTO account_deletion_requests (
       id, account_reference_hash, deleted_account_alias, status, policy_version, cancelled_mint_jobs,
       pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at
     ) SELECT gen_random_uuid(), hash, 'deleted:' || encode(hash, 'hex'), 'COMPLETED', 'account-deletion-v1', 0, 0, 0, $2, $2, $2
       FROM unnest($1::bytea[]) AS hash`,
    [hashes, now],
  );
  await pool.query(
    `INSERT INTO platform_admin_audit (id, actor_account_id, merchant_id, action, target_account_id, after_state, created_at)
     SELECT gen_random_uuid(), 'acct_admin', 'shop-1', 'MERCHANT_OWNER_REVOKED', target, '{}'::jsonb, $2
     FROM unnest($1::text[]) AS target`,
    [[...gone, ...alive], at(now.getTime() - 86_400_000)],
  );
  const result = await service.run({ hmacSecret: secret });
  assert.deepEqual(result.failed, []);
  assert.equal(counts(result.counts).admin_audit_deleted_targets, 1100);
  const left = (await pool.query<{ target_account_id: string }>(
    `SELECT target_account_id FROM platform_admin_audit WHERE target_account_id NOT LIKE 'deleted:%' ORDER BY target_account_id`,
  )).rows.map((row) => row.target_account_id);
  assert.deepEqual(left, [...alive].sort());
  assert.equal((await pool.query(`SELECT 1 FROM platform_admin_audit WHERE target_account_id LIKE 'deleted:%'`)).rowCount, 1100);
});
