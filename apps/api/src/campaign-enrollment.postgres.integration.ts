import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { CampaignEnrollmentError } from './campaign-enrollment.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresCampaignEnrollmentService } from './postgres/campaign-enrollment.js';
import { runMigrations } from './postgres/migrate.js';

const lifecycleHmacSecret = 'test-only-account-lifecycle-secret-at-least-32-bytes';

test('R02 last campaign slot draws exactly one winner under concurrent enrollment', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await seedEnrollmentFixture(pool);

  const campaignId = 'campaign-race';
  await seedCampaign(pool, {
    merchantId: 'merchant-race',
    campaignId,
    capacity: 5,
  });
  for (let index = 1; index <= 4; index++) {
    await pool.query(
      `INSERT INTO campaign_enrollments (id, campaign_id, account_id, enrolled_at)
       VALUES ($1, $2, $3, now())`,
      [`70000000-0000-4000-8001-00000000000${index}`, campaignId, `account-pre-${index}`],
    );
  }
  await pool.query('UPDATE campaigns SET enrolled_count = 4 WHERE id = $1', [campaignId]);

  const service = new PostgresCampaignEnrollmentService(pool, {
    now: () => new Date('2026-09-20T03:00:00.000Z'),
  });

  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, index) =>
      service.enroll({ campaignId, accountId: `account-race-${index + 1}` }),
    ),
  );

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 19);
  assert.ok(
    rejected.every(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof CampaignEnrollmentError &&
        result.reason.code === 'CAMPAIGN_FULL',
    ),
  );

  const state = await pool.query<{ enrolled_count: number; enrollment_rows: number }>(
    `SELECT
       campaigns.enrolled_count,
       (SELECT count(*)::integer FROM campaign_enrollments WHERE campaign_id = $1) AS enrollment_rows
     FROM campaigns
     WHERE campaigns.id = $1`,
    [campaignId],
  );
  assert.equal(state.rows[0]?.enrolled_count, 5);
  assert.equal(state.rows[0]?.enrollment_rows, 5);
});

test('R02 concurrent duplicate requests from the same account consume only one slot', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await seedEnrollmentFixture(pool);

  const campaignId = 'campaign-dup';
  await seedCampaign(pool, {
    merchantId: 'merchant-dup',
    campaignId,
    capacity: 10,
  });

  const service = new PostgresCampaignEnrollmentService(pool, {
    now: () => new Date('2026-09-20T03:00:00.000Z'),
  });

  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => service.enroll({ campaignId, accountId: 'account-dup-1' })),
  );
  assert.ok(results.every((result) => result.status === 'fulfilled'));
  const fulfilled = results.map((result) => {
    assert.equal(result.status, 'fulfilled');
    return result.status === 'fulfilled' ? result.value : never();
  });
  assert.equal(fulfilled.filter((value) => value.created === true).length, 1);
  assert.equal(fulfilled.filter((value) => value.created === false).length, 9);
  assert.equal(new Set(fulfilled.map((value) => value.enrollmentId)).size, 1);

  const state = await pool.query<{ enrolled_count: number; enrollment_rows: number }>(
    `SELECT
       campaigns.enrolled_count,
       (SELECT count(*)::integer FROM campaign_enrollments WHERE campaign_id = $1) AS enrollment_rows
     FROM campaigns
     WHERE campaigns.id = $1`,
    [campaignId],
  );
  assert.equal(state.rows[0]?.enrolled_count, 1);
  assert.equal(state.rows[0]?.enrollment_rows, 1);
});

test('R02 the same account racing for the last slot is enrolled once and never told the campaign is full', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await seedEnrollmentFixture(pool);

  const campaignId = 'campaign-last-dup';
  await seedCampaign(pool, {
    merchantId: 'merchant-last-dup',
    campaignId,
    capacity: 1,
  });

  const service = new PostgresCampaignEnrollmentService(pool, {
    now: () => new Date('2026-09-20T03:00:00.000Z'),
  });

  // Hold the campaign row so both requests pass the "not enrolled yet" check and queue on the
  // capacity update; releasing it makes the second one re-evaluate a full campaign.
  const holder = await pool.connect();
  await holder.query('BEGIN');
  await holder.query('SELECT id FROM campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
  const racing = Promise.allSettled([
    service.enroll({ campaignId, accountId: 'account-last-dup' }),
    service.enroll({ campaignId, accountId: 'account-last-dup' }),
  ]);
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await pool.query<{ waiting: number }>(
        `SELECT count(*)::integer AS waiting
         FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE campaigns%'`,
      );
      if (waiting.rows[0]?.waiting === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.notEqual(attempt, 99, 'both enrollments must be queued on the campaign row');
    }
  } finally {
    await holder.query('COMMIT');
    holder.release();
  }

  const results = await racing;
  assert.deepEqual(
    results.filter((result) => result.status === 'rejected'),
    [],
  );
  const values = results.map((result) => (result.status === 'fulfilled' ? result.value : never()));
  assert.equal(values.filter((value) => value.created).length, 1);
  assert.equal(new Set(values.map((value) => value.enrollmentId)).size, 1);

  const state = await pool.query<{ enrolled_count: number }>(
    'SELECT enrolled_count FROM campaigns WHERE id = $1',
    [campaignId],
  );
  assert.equal(state.rows[0]?.enrolled_count, 1);
});

test('R02 a repeated enrollment request is idempotent and does not reuse a second slot', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await seedEnrollmentFixture(pool);

  const campaignId = 'campaign-idem';
  await seedCampaign(pool, {
    merchantId: 'merchant-idem',
    campaignId,
    capacity: 3,
  });
  const service = new PostgresCampaignEnrollmentService(pool, {
    now: () => new Date('2026-09-20T03:00:00.000Z'),
  });

  const first = await service.enroll({ campaignId, accountId: 'account-idem-1' });
  assert.equal(first.created, true);
  const second = await service.enroll({ campaignId, accountId: 'account-idem-1' });
  assert.equal(second.created, false);
  assert.equal(second.enrollmentId, first.enrollmentId);

  const state = await pool.query<{ enrolled_count: number }>(
    'SELECT enrolled_count FROM campaigns WHERE id = $1',
    [campaignId],
  );
  assert.equal(state.rows[0]?.enrolled_count, 1);
});

test('R02 rejects enrollment into a missing or non-public campaign', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await seedEnrollmentFixture(pool);

  await seedCampaign(pool, {
    merchantId: 'merchant-private',
    campaignId: 'campaign-private',
    capacity: 3,
    isPublic: false,
  });
  const service = new PostgresCampaignEnrollmentService(pool, {
    now: () => new Date('2026-09-20T03:00:00.000Z'),
  });

  await assert.rejects(
    service.enroll({ campaignId: 'campaign-does-not-exist', accountId: 'account-notfound' }),
    (error: unknown) =>
      error instanceof CampaignEnrollmentError && error.code === 'CAMPAIGN_NOT_FOUND',
  );
  await assert.rejects(
    service.enroll({ campaignId: 'campaign-private', accountId: 'account-notfound' }),
    (error: unknown) =>
      error instanceof CampaignEnrollmentError && error.code === 'CAMPAIGN_NOT_FOUND',
  );
});

test('R02 rejects enrollment outside the campaign window or while inactive', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await seedEnrollmentFixture(pool);

  await seedCampaign(pool, {
    merchantId: 'merchant-future',
    campaignId: 'campaign-future',
    capacity: 3,
    startsAt: '2026-12-01T00:00:00Z',
    endsAt: '2026-12-31T23:59:59Z',
  });
  await seedCampaign(pool, {
    merchantId: 'merchant-paused',
    campaignId: 'campaign-paused',
    capacity: 3,
    status: 'PAUSED',
  });
  const service = new PostgresCampaignEnrollmentService(pool, {
    now: () => new Date('2026-09-20T03:00:00.000Z'),
  });

  await assert.rejects(
    service.enroll({ campaignId: 'campaign-future', accountId: 'account-early' }),
    (error: unknown) =>
      error instanceof CampaignEnrollmentError && error.code === 'CAMPAIGN_NOT_AVAILABLE',
  );
  await assert.rejects(
    service.enroll({ campaignId: 'campaign-paused', accountId: 'account-paused' }),
    (error: unknown) =>
      error instanceof CampaignEnrollmentError && error.code === 'CAMPAIGN_NOT_AVAILABLE',
  );
});

test('R02 rejects enrollment for a deleted account tombstone', async (t) => {
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(() => pool.end());
  await runMigrations(pool);
  await seedEnrollmentFixture(pool);

  await seedCampaign(pool, {
    merchantId: 'merchant-deleted-enroller',
    campaignId: 'campaign-deleted-enroller',
    capacity: 3,
  });
  const accountLifecycle = new PostgresAccountLifecycle({ hmacSecret: lifecycleHmacSecret });
  const referenceHash = accountLifecycle.referenceHash('deleted-enroller');
  await pool.query(
    `INSERT INTO account_deletion_requests (
       id, account_reference_hash, deleted_account_alias, status, policy_version,
       cancelled_mint_jobs, pending_mint_jobs, retained_finalized_nfts, requested_at,
       completed_at, updated_at
     ) VALUES ($1, $2, $3, 'COMPLETED', 'account-deletion-v1', 0, 0, 0, now(), now(), now())`,
    [
      '90000000-0000-4000-8011-000000000001',
      referenceHash,
      `deleted:${referenceHash.toString('hex')}`,
    ],
  );

  const service = new PostgresCampaignEnrollmentService(pool, {
    now: () => new Date('2026-09-20T03:00:00.000Z'),
    accountLifecycle,
  });

  await assert.rejects(
    service.enroll({ campaignId: 'campaign-deleted-enroller', accountId: 'deleted-enroller' }),
    (error: unknown) =>
      error instanceof CampaignEnrollmentError && error.code === 'ACCOUNT_DELETED',
  );
});

async function seedCampaign(
  pool: Pool,
  options: {
    merchantId: string;
    campaignId: string;
    capacity: number;
    isPublic?: boolean;
    status?: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
    startsAt?: string;
    endsAt?: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ($1, $2, '등록 시험용입니다.', '서울 노원구 데모로 1', 10000, 'ACTIVE', true)`,
    [options.merchantId, `${options.merchantId} 데모 식당`],
  );
  await pool.query(
    `INSERT INTO campaigns (
       id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      options.campaignId,
      options.merchantId,
      `${options.campaignId} 캠페인`,
      options.startsAt ?? '2026-09-01T00:00:00Z',
      options.endsAt ?? '2026-10-31T23:59:59Z',
      options.status ?? 'ACTIVE',
      options.isPublic ?? true,
      options.capacity,
    ],
  );
}

async function seedEnrollmentFixture(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE account_deletion_requests, campaign_enrollments, campaign_goals, campaigns, merchants CASCADE',
  );
}

function never(): never {
  throw new Error('unreachable');
}

function requiredTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }
  return value;
}
