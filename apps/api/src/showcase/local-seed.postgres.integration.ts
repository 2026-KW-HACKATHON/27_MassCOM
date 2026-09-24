import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresMerchantAccessControl } from '../postgres/merchant-access.js';
import { PostgresMerchantCatalog } from '../postgres/merchant-catalog.js';
import { runMigrations } from '../postgres/migrate.js';
import {
  seedLocalShowcase,
  SHOWCASE_CAMPAIGN_ID,
  SHOWCASE_CUSTOMER_ACCOUNT_ID,
  SHOWCASE_MERCHANT_ID,
  SHOWCASE_STAFF_ACCOUNT_ID,
} from './local-seed.js';

type Snapshot = {
  merchants: unknown[];
  campaigns: unknown[];
  goals: unknown[];
  members: unknown[];
};

async function snapshot(pool: Pool): Promise<Snapshot> {
  const [merchants, campaigns, goals, members] = await Promise.all([
    pool.query('SELECT * FROM merchants ORDER BY id'),
    pool.query('SELECT * FROM campaigns ORDER BY id'),
    pool.query('SELECT * FROM campaign_goals ORDER BY campaign_id, target_visit_count'),
    pool.query('SELECT * FROM merchant_members ORDER BY merchant_id, account_id'),
  ]);
  return {
    merchants: merchants.rows,
    campaigns: campaigns.rows,
    goals: goals.rows,
    members: members.rows,
  };
}

async function withFreshShowcaseDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const url = new URL(connectionString);
  if (!decodeURIComponent(url.pathname.slice(1)).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must end in _test');
  }

  const admin = new Pool({ connectionString });
  const databaseName = `masscom_showcase_ci_${randomUUID().replaceAll('-', '')}_test`;
  let created = false;
  try {
    await assert.rejects(seedLocalShowcase(admin), /SHOWCASE_LOCAL_DATABASE_REQUIRED/);
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    const pool = new Pool({ connectionString: url.toString() });
    try {
      await runMigrations(pool);
      await run(pool);
    } finally {
      await pool.end();
    }
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
}

test('local showcase seed is repeatable with three visible demo merchants', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const first = await seedLocalShowcase(pool);
    const second = await seedLocalShowcase(pool);
    assert.deepEqual(second, first);
    assert.deepEqual(first, {
      merchantId: SHOWCASE_MERCHANT_ID,
      campaignId: SHOWCASE_CAMPAIGN_ID,
    });

    const rows = await snapshot(pool);
    assert.equal(rows.merchants.length, 3);
    assert.equal(rows.campaigns.length, 3);
    assert.equal(rows.goals.length, 9);
    assert.equal(rows.members.length, 3);

    await pool.query('UPDATE campaigns SET enrolled_count = 2 WHERE id = $1', [SHOWCASE_CAMPAIGN_ID]);
    await seedLocalShowcase(pool);
    const progress = await pool.query<{ enrolled_count: number }>(
      'SELECT enrolled_count FROM campaigns WHERE id = $1', [SHOWCASE_CAMPAIGN_ID],
    );
    assert.equal(progress.rows[0]?.enrolled_count, 2);

    const catalog = new PostgresMerchantCatalog(pool);
    const listed = await catalog.listPublicMerchants();
    assert.deepEqual(listed.map((merchant) => merchant.name), [
      '가상 점포 A', '가상 점포 B', '가상 점포 C',
    ]);
    assert.ok(listed.every((merchant) => merchant.demo));

    const access = new PostgresMerchantAccessControl(pool);
    const staff = await access.requirePermission({
      accountId: SHOWCASE_STAFF_ACCOUNT_ID,
      merchantId: SHOWCASE_MERCHANT_ID,
      permission: 'CONFIRM_VISIT',
    });
    assert.equal(staff.role, 'STAFF');
    await assert.rejects(access.requirePermission({
      accountId: SHOWCASE_CUSTOMER_ACCOUNT_ID,
      merchantId: SHOWCASE_MERCHANT_ID,
      permission: 'CONFIRM_VISIT',
    }), /MERCHANT_ACCESS_DENIED/);
  });
});

test('existing one-store showcase data grows to three stores without changing visit progress', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await pool.query(
      `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ($1, '가상 점포 A',
               '체험용 가상 데이터이며 실제 영업점·방문 혜택이 아닙니다.',
               '시연용 가상 위치 · 실제 방문 불가', 0, 'ACTIVE', true)`,
      [SHOWCASE_MERCHANT_ID],
    );
    await pool.query(
      `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public,
        enrollment_capacity, enrolled_count)
       VALUES ($1, $2, '체험 방문 도감', now() - interval '1 day',
               now() + interval '30 days', 'ACTIVE', true, 20, 2)`,
      [SHOWCASE_CAMPAIGN_ID, SHOWCASE_MERCHANT_ID],
    );
    for (const [count, name] of [
      [1, '가상 첫 방문 수집품'],
      [3, '가상 세 번째 방문 수집품'],
      [5, '가상 다섯 번째 방문 수집품'],
    ] as const) {
      await pool.query(
        `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
         VALUES ($1, $2, $3)`,
        [SHOWCASE_CAMPAIGN_ID, count, name],
      );
    }
    await pool.query(
      `INSERT INTO merchant_members (merchant_id, account_id, role, status)
       VALUES ($1, $2, 'STAFF', 'ACTIVE')`,
      [SHOWCASE_MERCHANT_ID, SHOWCASE_STAFF_ACCOUNT_ID],
    );
    await seedLocalShowcase(pool);
    const rows = await snapshot(pool);
    assert.deepEqual(
      [rows.merchants.length, rows.campaigns.length, rows.goals.length, rows.members.length],
      [3, 3, 9, 3],
    );
    const progress = await pool.query<{ enrolled_count: number }>(
      'SELECT enrolled_count FROM campaigns WHERE id = $1', [SHOWCASE_CAMPAIGN_ID],
    );
    assert.equal(progress.rows[0]?.enrolled_count, 2);
  });
});

test('damaged existing fixture is refused without changing any of its four tables', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await seedLocalShowcase(pool);
    for (const [query, values] of [
      ['UPDATE merchants SET is_demo = false WHERE id = $1', [SHOWCASE_MERCHANT_ID]],
      ['UPDATE merchants SET is_demo = false WHERE id = $1', ['showcase-local-merchant-b']],
      ['UPDATE campaigns SET is_public = false WHERE id = $1', [SHOWCASE_CAMPAIGN_ID]],
      ['UPDATE campaigns SET ends_at = now() - interval \'1 day\' WHERE id = $1', [SHOWCASE_CAMPAIGN_ID]],
      ['UPDATE campaign_goals SET display_name = \'wrong\' WHERE campaign_id = $1 AND target_visit_count = 3', [SHOWCASE_CAMPAIGN_ID]],
      ['DELETE FROM campaign_goals WHERE campaign_id = $1 AND target_visit_count = 5', [SHOWCASE_CAMPAIGN_ID]],
      ['UPDATE merchant_members SET role = \'OWNER\' WHERE merchant_id = $1', [SHOWCASE_MERCHANT_ID]],
    ] as const) {
      const before = await snapshot(pool);
      await pool.query(query, [...values]);
      const damaged = await snapshot(pool);
      await assert.rejects(seedLocalShowcase(pool), /SHOWCASE_FIXTURE_COLLISION/);
      assert.deepEqual(await snapshot(pool), damaged);
      // Restore only this disposable test database for the next independent corruption case.
      await pool.query('TRUNCATE merchant_members, campaign_goals, campaigns, merchants CASCADE');
      await seedLocalShowcase(pool);
      assert.equal(before.merchants.length, 3);
    }
  });
});

test('existing active public campaign with another id stays unchanged', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ($1, '가상 점포 A', '기존 행', '가상 주소', 0, 'ACTIVE', true)`,
      [SHOWCASE_MERCHANT_ID],
    );
    await pool.query(
      `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
       VALUES ('other-campaign', $1, '기존 캠페인', now() - interval '1 day',
               now() + interval '30 days', 'ACTIVE', true, 20)`,
      [SHOWCASE_MERCHANT_ID],
    );
    const before = await snapshot(pool);
    await assert.rejects(seedLocalShowcase(pool));
    assert.deepEqual(await snapshot(pool), before);
  });
});

test('concurrent first seeds converge on one complete fixture', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const results = await Promise.all(Array.from({ length: 8 }, () => seedLocalShowcase(pool)));
    for (const result of results) {
      assert.deepEqual(result, {
        merchantId: SHOWCASE_MERCHANT_ID,
        campaignId: SHOWCASE_CAMPAIGN_ID,
      });
    }
    const rows = await snapshot(pool);
    assert.deepEqual(
      [rows.merchants.length, rows.campaigns.length, rows.goals.length, rows.members.length],
      [3, 3, 9, 3],
    );
  });
});

test('a failure after merchant insertion rolls back every fixture table', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await pool.query(
      `ALTER TABLE campaigns ADD CONSTRAINT showcase_test_reject_insert
       CHECK (id <> 'showcase-local-campaign')`,
    );
    const before = await snapshot(pool);
    await assert.rejects(seedLocalShowcase(pool));
    assert.deepEqual(await snapshot(pool), before);
  });
});
