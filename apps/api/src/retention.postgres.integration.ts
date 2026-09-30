import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import { runMigrations } from './postgres/migrate.js';
import { PostgresRetentionService, type RetentionCount } from './postgres/retention.js';

const now = new Date('2026-09-30T12:00:00.000Z');
const cutoffMs = Date.parse('2025-09-30T12:00:00.000Z'); // exactly one year before `now`
const at = (ms: number) => new Date(ms);
const before = at(cutoffMs - 1); // older than one year: deleted
const exactly = at(cutoffMs); // exactly one year: kept (only strictly older rows go)
const after = at(cutoffMs + 1); // younger: kept

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
              badge_coupon_audit, badge_coupons, badge_reward_offers, platform_admins, merchants CASCADE`,
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

type AuditSeed = { table: string; insert: (pool: Pool, id: string, createdAt: Date) => Promise<void> };

const auditSeeds: Record<string, AuditSeed> = {
  admin_audit: {
    table: 'platform_admin_audit',
    insert: async (pool, id, createdAt) => {
      await pool.query(
        `INSERT INTO platform_admin_audit (id, actor_account_id, merchant_id, action, after_state, created_at)
         VALUES ($1, 'cli:tester', NULL, 'ACCOUNT_DELETION_PROCESSED', '{}'::jsonb, $2)`,
        [id, createdAt],
      );
    },
  },
  admin_role_audit: {
    table: 'platform_admin_role_audit',
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
    insert: async (pool, id, createdAt) => {
      await pool.query(
        `INSERT INTO badge_coupon_audit (id, coupon_id, merchant_id, action, actor_account_id, created_at)
         VALUES ($1, '10000000-0000-4000-8000-000000000001', 'shop-1', 'REDEMPTION_UNDONE', 'acct_staff', $2)`,
        [id, createdAt],
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

async function seedAudit(pool: Pool, name: keyof typeof auditSeeds) {
  const seed = auditSeeds[name]!;
  const gone: string[] = [];
  const kept: string[] = [];
  for (const [bucket, createdAt] of [[gone, before], [kept, exactly], [kept, after]] as const) {
    const id = randomUUID();
    bucket.push(id);
    await seed.insert(pool, id, createdAt);
  }
  return { gone: gone.sort(), kept: kept.sort(), table: seed.table };
}

test('run deletes exactly the rows older than the boundary in every table and nothing else', async (t) => {
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
  await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('acct_admin')`);

  const reported = counts(await service.report());
  assert.deepEqual(reported, {
    auth_sessions: 3, web_sessions: 2, deletion_intake: 3, admin_audit: 1, admin_role_audit: 1,
    staff_registration_audit: 1, coupon_audit: 1,
  });
  // A report is read-only.
  assert.equal((await idsOf(pool, 'SELECT id FROM auth_sessions')).length, 5);
  assert.equal((await idsOf(pool, 'SELECT id FROM platform_admin_audit')).length, 3);

  const result = await service.run();
  assert.deepEqual(result.failed, []);
  assert.deepEqual(counts(result.counts), reported);

  assert.deepEqual(await idsOf(pool, 'SELECT id FROM auth_sessions'), authSessions.kept);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM web_sessions'), webSessions.kept);
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM account_deletion_intake_requests'), intake.kept);
  for (const audit of Object.values(audits)) {
    assert.deepEqual(await idsOf(pool, `SELECT id FROM ${audit.table}`), audit.kept, audit.table);
    assert.equal(audit.gone.length, 1);
  }

  // What retention must never touch: the deletion ledger, the coupon the audit rows describe, admin grants, merchants.
  assert.deepEqual(await idsOf(pool, 'SELECT id FROM account_deletion_requests'), [intake.ledgerId]);
  assert.equal((await pool.query('SELECT 1 FROM badge_coupons')).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM platform_admins')).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM merchants')).rowCount, 1);
  // The active filing survived and is still linked to its (raw) account id; finished ones never had one.
  assert.equal(
    (await pool.query(`SELECT 1 FROM account_deletion_intake_requests WHERE status = 'REQUESTED' AND account_id IS NOT NULL`)).rowCount,
    1,
  );

  // A second run has nothing left to delete.
  assert.deepEqual(Object.values(counts((await service.run()).counts)), Array(7).fill(0));
});

test('the boundary is strict: one millisecond decides between deleted and kept, in both directions', async (t) => {
  const { pool } = await setup(t);
  await seedCoupon(pool);
  const audit = await seedAudit(pool, 'coupon_audit');
  const cutoff = new Date(cutoffMs);
  const rows = await pool.query<{ id: string; created_at: Date }>('SELECT id, created_at FROM badge_coupon_audit ORDER BY created_at');
  assert.deepEqual(rows.rows.map((row) => row.created_at.getTime() - cutoff.getTime()), [-1, 0, 1]);
  // One millisecond earlier "now" moves the cutoff back, so the row that was 1 ms too old is now exactly at the boundary.
  const earlier = new PostgresRetentionService(pool, { now: () => new Date(now.getTime() - 1) });
  assert.equal(counts(await earlier.report()).coupon_audit, 0);
  const later = new PostgresRetentionService(pool, { now: () => new Date(now.getTime() + 1) });
  assert.equal(counts(await later.report()).coupon_audit, 2);
  assert.equal(audit.gone.length, 1);
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
  // The command reads the real clock, so this test uses rows that are old or new whatever today's date is.
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
  await auditSeeds.admin_role_audit!.insert(pool, randomUUID(), new Date('2020-01-01T00:00:00Z'));
  const command = fileURLToPath(new URL('./postgres/retention-command.ts', import.meta.url));
  const run = (args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', command, ...args], {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL! },
    encoding: 'utf8',
  });
  const report = run(['report']).trim().split('\n');
  assert.match(report[0]!, /^RETENTION_REPORT/);
  assert.equal((await idsOf(pool, 'SELECT id FROM auth_sessions')).length, 3, 'report deleted nothing');

  const output = run(['run']);
  const lines = output.trim().split('\n');
  assert.equal(lines[0], 'RETENTION_RUN');
  assert.deepEqual(lines.slice(1), [
    'auth_sessions\t2', 'web_sessions\t0', 'deletion_intake\t1', 'admin_audit\t0', 'admin_role_audit\t1',
    'staff_registration_audit\t0', 'coupon_audit\t0',
  ]);
  assert.equal((await idsOf(pool, 'SELECT id FROM auth_sessions')).length, 1);
  // No identifier of any kind reaches the terminal: not a row id, not an account id, not the ledger id.
  assert.doesNotMatch(output, /[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.doesNotMatch(output, /acct_|deleted:|cli:tester/);
  assert.equal(output.includes(ledgerId), false);
  assert.throws(() => run(['delete']), (error: { status?: number; stderr?: string }) =>
    error.status === 1 && /RETENTION_USAGE/.test(String(error.stderr)));
});
