import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresMerchantAccessControl } from '../postgres/merchant-access.js';
import { PostgresCampaignEnrollmentService } from '../postgres/campaign-enrollment.js';
import { PostgresMerchantCatalog } from '../postgres/merchant-catalog.js';
import { PostgresRealWorldService } from '../postgres/real-world.js';
import { runMigrations } from '../postgres/migrate.js';
import { WOLGYE_STORES, WOLGYE_STORE_DISCLOSURE } from './wolgye-seed.js';
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

test('local showcase seed is repeatable with 33 visible demo merchants', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const first = await seedLocalShowcase(pool);
    const second = await seedLocalShowcase(pool);
    assert.deepEqual(second, first);
    assert.deepEqual(first, {
      merchantId: SHOWCASE_MERCHANT_ID,
      campaignId: SHOWCASE_CAMPAIGN_ID,
    });

    const rows = await snapshot(pool);
    assert.equal(WOLGYE_STORES.length, 30);
    assert.equal(rows.merchants.length, 33);
    assert.equal(rows.campaigns.length, 33);
    assert.equal(rows.goals.length, 99);
    assert.equal(rows.members.length, 3);

    // 보상 상자 체험 혜택은 가상 점포 A·B·C에 milestone별 하나씩, 재실행해도 늘거나 초기화되지 않는다.
    await pool.query(`UPDATE badge_reward_offers SET issued_count = 3 WHERE milestone = 2`);
    await seedLocalShowcase(pool);
    const offers = await pool.query<{
      milestone: number; merchant_id: string; title: string; detail: string; valid_days: number;
      status: string; issued_count: number; issuance_cap: number | null; consent_note: string;
    }>('SELECT * FROM badge_reward_offers ORDER BY milestone');
    assert.deepEqual(
      offers.rows.map((offer) => [offer.milestone, offer.merchant_id, offer.title, offer.valid_days, offer.status]),
      [
        [1, SHOWCASE_MERCHANT_ID, '체험 음료 1잔', 30, 'ACTIVE'],
        [2, 'showcase-local-merchant-b', '체험 디저트 한 접시', 30, 'ACTIVE'],
        [3, 'showcase-local-merchant-c', '체험 세트 20% 할인', 30, 'ACTIVE'],
      ],
    );
    assert.deepEqual(offers.rows.map((offer) => offer.issued_count), [0, 3, 0]);
    assert.ok(offers.rows.every((offer) => offer.issuance_cap === null
      && offer.consent_note === '시연 가상 점포 체험 혜택 — 실제 매장 혜택 아님'
      && offer.detail.includes('실제 매장에서는 사용할 수 없습니다')));

    await pool.query('UPDATE campaigns SET enrolled_count = 2 WHERE id = $1', [SHOWCASE_CAMPAIGN_ID]);
    await seedLocalShowcase(pool);
    const progress = await pool.query<{ enrolled_count: number }>(
      'SELECT enrolled_count FROM campaigns WHERE id = $1', [SHOWCASE_CAMPAIGN_ID],
    );
    assert.equal(progress.rows[0]?.enrolled_count, 2);

    const catalog = new PostgresMerchantCatalog(pool);
    const listed = await catalog.listPublicMerchants();
    assert.equal(listed.length, 33);
    assert.deepEqual(listed.filter((merchant) => merchant.id.startsWith('showcase-local-')).map((merchant) => merchant.name), [
      '가상 점포 A', '가상 점포 B', '가상 점포 C',
    ]);
    assert.ok(listed.every((merchant) => merchant.demo));
    const demoDetails = new PostgresRealWorldService(pool, { includeDemo: true });
    const detail = await demoDetails.merchant(SHOWCASE_MERCHANT_ID);
    assert.equal(detail.demo, true);
    assert.equal(detail.position, null, 'virtual stores must not invent real map coordinates');
    assert.equal(detail.name, '가상 점포 A');
    await assert.rejects(new PostgresRealWorldService(pool).merchant(SHOWCASE_MERCHANT_ID),
      (error: unknown) => error instanceof Error && error.message === 'MERCHANT_NOT_FOUND');
    const publication = await pool.query('SELECT published_at FROM merchants WHERE id = $1', [SHOWCASE_MERCHANT_ID]);
    await seedLocalShowcase(pool);
    assert.deepEqual((await pool.query('SELECT published_at FROM merchants WHERE id = $1', [SHOWCASE_MERCHANT_ID])).rows, publication.rows);

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

test('Wolgye demo stores disclose their source and leave unverified business details empty', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await seedLocalShowcase(pool);
    const details = new PostgresRealWorldService(pool, { includeDemo: true });
    for (const store of WOLGYE_STORES) {
      const detail = await details.merchant(store.id);
      assert.equal(detail.demo, true);
      assert.equal(detail.story, WOLGYE_STORE_DISCLOSURE);
      assert.equal(detail.name, store.name);
      assert.equal(detail.roadAddress, store.roadAddress);
      assert.deepEqual(detail.position, { latitude: store.lat, longitude: store.lng });
      assert.equal(detail.location?.source, 'ADMIN_DOCUMENTED');
      assert.equal(detail.schedule, null);
      assert.equal(detail.business.state, 'UNKNOWN');
      assert.deepEqual(detail.menuItems, []);
      assert.deepEqual(detail.contact, { phone: null, website: null });
      assert.equal(detail.legacyBusinessHours, '');
      assert.equal(detail.campaign?.state, 'ACTIVE');
      assert.equal(detail.campaign?.enrollment, 'OPEN');
      assert.deepEqual(detail.campaign?.goals.map((goal) => goal.targetVisitCount), [1, 3, 5]);
    }
  });
});

test('Wolgye demo stores appear in showcase discovery with station distances and category filtering', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await seedLocalShowcase(pool);
    const showcase = new PostgresRealWorldService(pool, { includeDemo: true });
    const query = {
      bounds: { west: 127.0, east: 127.12, south: 37.58, north: 37.7 }, zoom: 15,
      origin: { latitude: 37.6341068, longitude: 127.0589231, basis: 'MANUAL' as const },
      campaignOnly: true,
    };
    const page = await showcase.search(query);
    assert.equal(page.merchants.length, 33);
    assert.equal(page.nextCursor, null);
    assert.equal(page.merchants.filter((merchant) => merchant.id.startsWith('showcase-wolgye-')).length, 30);
    const nearest = WOLGYE_STORES[0]!;
    assert.equal(page.merchants.find((merchant) => merchant.id === nearest.id)?.distance?.meters, nearest.distanceM);
    const categoryPage = await showcase.search({ ...query, category: nearest.category });
    assert.ok(categoryPage.merchants.some((merchant) => merchant.id === nearest.id));
    assert.ok(categoryPage.merchants.every((merchant) => merchant.category === nearest.category));
  });
});

test('production discovery and detail exclude every Wolgye demo store', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await seedLocalShowcase(pool);
    const production = new PostgresRealWorldService(pool);
    const query = { bounds: { west: 127.0, east: 127.12, south: 37.58, north: 37.7 }, zoom: 15 };
    assert.deepEqual((await production.search(query)).merchants, []);
    for (const store of WOLGYE_STORES) {
      await assert.rejects(production.merchant(store.id), { code: 'MERCHANT_NOT_FOUND' });
    }
  });
});

test('a Wolgye public-data campaign accepts customer enrollment', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await seedLocalShowcase(pool);
    const campaignId = `${WOLGYE_STORES[0]!.id}-campaign`;
    const enrolled = await new PostgresCampaignEnrollmentService(pool).enroll({
      campaignId, accountId: 'wolgye-enrollment-customer',
    });
    assert.equal(enrolled.created, true);
    const count = await pool.query<{ enrolled_count: number }>(
      'SELECT enrolled_count FROM campaigns WHERE id = $1', [campaignId],
    );
    assert.equal(count.rows[0]?.enrolled_count, 1);
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
      [33, 33, 99, 3],
    );
    // #254: 0036 전에 seed된 A도 동네·업종을 받고, 이미 값이 있는 점포는 다시 seed해도 바뀌지 않는다.
    const profiles = async () => (await pool.query<{ id: string; neighborhood: string; category: string }>(
      "SELECT id, neighborhood, category FROM merchants WHERE id LIKE 'showcase-local-%' ORDER BY id")).rows;
    assert.deepEqual(await profiles(), [
      { id: SHOWCASE_MERCHANT_ID, neighborhood: '월계동', category: '카페' },
      { id: 'showcase-local-merchant-b', neighborhood: '월계동', category: '분식' },
      { id: 'showcase-local-merchant-c', neighborhood: '월계동', category: '한식' },
    ]);
    await pool.query(`UPDATE merchants SET category = '기타' WHERE id = $1`, [SHOWCASE_MERCHANT_ID]);
    await seedLocalShowcase(pool);
    assert.equal((await profiles())[0]?.category, '기타');
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
      ['UPDATE badge_reward_offers SET title = \'wrong\' WHERE milestone = 2 AND $1::text IS NOT NULL', [SHOWCASE_MERCHANT_ID]],
      ['UPDATE badge_reward_offers SET merchant_id = \'showcase-local-merchant\' WHERE milestone = 3 AND $1::text IS NOT NULL', [SHOWCASE_MERCHANT_ID]],
    ] as const) {
      const before = await snapshot(pool);
      await pool.query(query, [...values]);
      const damaged = await snapshot(pool);
      await assert.rejects(seedLocalShowcase(pool), /SHOWCASE_FIXTURE_COLLISION/);
      assert.deepEqual(await snapshot(pool), damaged);
      // Restore only this disposable test database for the next independent corruption case.
      await pool.query('TRUNCATE merchant_members, campaign_goals, campaigns, merchants CASCADE');
      await seedLocalShowcase(pool);
      assert.equal(before.merchants.length, 33);
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

test('a pre-existing non-demo Wolgye id aborts the whole seed without touching the collision', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const store = WOLGYE_STORES[0]!;
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ($1, '기존 운영 점포', '기존 소개', '기존 주소', 0, 'ACTIVE', false)`, [store.id],
    );
    const before = await snapshot(pool);
    await assert.rejects(seedLocalShowcase(pool), /SHOWCASE_WOLGYE_FIXTURE_COLLISION/);
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
      [33, 33, 99, 3],
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
