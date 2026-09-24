import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigrations } from '../postgres/migrate.js';
import { PostgresAccountLifecycle } from '../postgres/account-lifecycle.js';
import { seedHostedShowcase } from './host-seed.js';
import { grantShowcaseStaff } from './grant-staff.js';

const testUrl = process.env.TEST_SHOWCASE_HOST_DATABASE_URL;
const safeTestTarget = (() => {
  if (!testUrl) return false;
  try {
    const url = new URL(testUrl);
    return url.hostname === '127.0.0.1' && url.port === '55435' &&
      url.pathname === '/masscom_showcase' && url.username === 'masscom_showcase';
  } catch { return false; }
})();

test('hosted seed preserves A progress, converges under retries, and rejects fixture damage', {
  skip: safeTestTarget ? false : 'requires the dedicated disposable PostgreSQL container on 127.0.0.1:55435',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  try {
    await runMigrations(pool);
    await seedHostedShowcase(pool);
    await Promise.all(Array.from({ length: 8 }, () => seedHostedShowcase(pool)));
    const counts = await Promise.all([
      pool.query('SELECT count(*)::int AS total FROM merchants'),
      pool.query('SELECT count(*)::int AS total FROM campaigns'),
      pool.query('SELECT count(*)::int AS total FROM campaign_goals'),
      pool.query('SELECT count(*)::int AS total FROM merchant_members'),
    ]);
    assert.deepEqual(counts.map(({ rows }) => rows[0]?.total), [3, 3, 9, 0]);

    await pool.query('UPDATE campaigns SET enrolled_count = 2 WHERE id = $1', ['showcase-local-campaign']);
    await seedHostedShowcase(pool);
    const progress = await pool.query<{ enrolled_count: number }>(
      'SELECT enrolled_count FROM campaigns WHERE id = $1', ['showcase-local-campaign'],
    );
    assert.equal(progress.rows[0]?.enrolled_count, 2);

    const invitedSubject = 'disposable-google-subject';
    const invitedHash = createHash('sha256').update(invitedSubject).digest('hex');
    await pool.query(
      `INSERT INTO auth_identities (provider, subject, account_id, created_at)
       VALUES ('google', $1, 'disposable-staff', now())`,
      [invitedSubject],
    );
    const grant = () => grantShowcaseStaff(pool, {
      accountId: 'disposable-staff', merchantId: 'showcase-local-merchant',
      allowedSubjectHashes: new Set([invitedHash]),
      accountDeletionHmacSecret: 'disposable-deletion-secret-at-least-32-bytes',
    });
    await assert.rejects(grant(), /SHOWCASE_STAFF_NOT_ELIGIBLE/);
    await pool.query(
      `INSERT INTO auth_sessions
       (id, account_id, token_hash, created_at, expires_at, last_authenticated_at)
       VALUES ('11111111-1111-4111-8111-111111111111', 'disposable-staff', $1,
               now(), now() + interval '1 hour', now())`,
      [Buffer.alloc(32, 1)],
    );
    await assert.rejects(grantShowcaseStaff(pool, {
      accountId: 'disposable-staff', merchantId: 'showcase-local-merchant',
      allowedSubjectHashes: new Set(['b'.repeat(64)]),
      accountDeletionHmacSecret: 'disposable-deletion-secret-at-least-32-bytes',
    }), /SHOWCASE_STAFF_NOT_ELIGIBLE/);
    await grant();
    await grant();
    const members = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM merchant_members
       WHERE merchant_id = 'showcase-local-merchant' AND account_id = 'disposable-staff'`,
    );
    assert.equal(members.rows[0]?.total, 1);

    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ('not-showcase', '테스트용 일반 점포', '', '테스트 주소', 0, 'ACTIVE', false)`,
    );
    await assert.rejects(grantShowcaseStaff(pool, {
      accountId: 'disposable-staff', merchantId: 'not-showcase',
      allowedSubjectHashes: new Set([invitedHash]),
      accountDeletionHmacSecret: 'disposable-deletion-secret-at-least-32-bytes',
    }), /SHOWCASE_STAFF_NOT_ELIGIBLE/);

    await pool.query(
      `INSERT INTO claim_slots
       (id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
        token_hash, status, expires_at, claimed_at)
       VALUES ('22222222-2222-4222-8222-222222222222', 'showcase-local-merchant',
               'disposable-customer', $1, 'disposable-staff', $2, 'CLAIMED',
               now() + interval '1 hour', now())`,
      [Buffer.alloc(32, 2), Buffer.alloc(32, 3)],
    );
    await pool.query(
      `INSERT INTO visit_events
       (id, claim_slot_id, merchant_id, campaign_id, customer_account_id,
        occurred_at, business_date, verification_level, status, progress_counted)
       VALUES ('33333333-3333-4333-8333-333333333333',
               '22222222-2222-4222-8222-222222222222', 'showcase-local-merchant',
               'showcase-local-campaign', 'disposable-customer', now(), current_date,
               'MERCHANT_CONFIRMED', 'VALID', true)`,
    );
    await pool.query(
      `INSERT INTO reward_entitlements
       (id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
        status, policy_version, earned_at, claim_expires_at)
       VALUES ('44444444-4444-4444-8444-444444444444', 'disposable-customer',
               'showcase-local-campaign', 1, '33333333-3333-4333-8333-333333333333',
               'GRANTED', 'test-policy', now(), now() + interval '1 day')`,
    );
    await seedHostedShowcase(pool);
    const preserved = await Promise.all([
      pool.query('SELECT count(*)::int AS total FROM claim_slots'),
      pool.query('SELECT count(*)::int AS total FROM visit_events'),
      pool.query('SELECT count(*)::int AS total FROM reward_entitlements'),
    ]);
    assert.deepEqual(preserved.map(({ rows }) => rows[0]?.total), [1, 1, 1]);

    await pool.query(
      `UPDATE merchant_members SET status = 'REVOKED', revoked_at = now()
       WHERE merchant_id = 'showcase-local-merchant' AND account_id = 'disposable-staff'`,
    );
    await assert.rejects(grant(), /SHOWCASE_STAFF_NOT_ELIGIBLE/);
    const revoked = await pool.query<{ status: string }>(
      `SELECT status FROM merchant_members
       WHERE merchant_id = 'showcase-local-merchant' AND account_id = 'disposable-staff'`,
    );
    assert.equal(revoked.rows[0]?.status, 'REVOKED');

    const lifecycle = new PostgresAccountLifecycle({
      hmacSecret: 'disposable-deletion-secret-at-least-32-bytes',
    });
    const accountHash = lifecycle.referenceHash('disposable-staff');
    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await lifecycle.lockForDeletion(blocker, 'disposable-staff');
      let settled = false;
      const outcome = grant().then(
        () => ({ error: undefined }),
        (error: unknown) => ({ error }),
      );
      void outcome.then(() => { settled = true; });
      await new Promise((done) => setTimeout(done, 50));
      assert.equal(settled, false, 'grant waits for account deletion lock');
      await blocker.query(
        `INSERT INTO account_deletion_requests
         (id, account_reference_hash, deleted_account_alias, status, policy_version,
          cancelled_mint_jobs, pending_mint_jobs, retained_finalized_nfts,
          requested_at, completed_at, updated_at)
         VALUES ('88888888-8888-4888-8888-888888888888', $1, $2,
                 'COMPLETED', 'test-policy', 0, 0, 0, now(), now(), now())`,
        [accountHash, `deleted:${accountHash.toString('hex')}`],
      );
      await blocker.query('COMMIT');
      const result = await outcome;
      assert.match(String(result.error), /ACCOUNT_DELETED/);
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      blocker.release();
    }

    await pool.query('UPDATE merchants SET is_demo = false WHERE id = $1', ['showcase-local-merchant']);
    await assert.rejects(seedHostedShowcase(pool), /SHOWCASE_FIXTURE_COLLISION/);
    const damaged = await pool.query<{ is_demo: boolean }>(
      'SELECT is_demo FROM merchants WHERE id = $1', ['showcase-local-merchant'],
    );
    assert.equal(damaged.rows[0]?.is_demo, false);
  } finally {
    await pool.end();
  }
});
