import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresMerchantAccessControl } from '../postgres/merchant-access.js';
import { PostgresCampaignEnrollmentService } from '../postgres/campaign-enrollment.js';
import { PostgresCourseService } from '../postgres/courses.js';
import { CourseError } from '../course-rules.js';
import { PostgresMerchantCatalog } from '../postgres/merchant-catalog.js';
import { PostgresRealWorldService } from '../postgres/real-world.js';
import { runMigrations } from '../postgres/migrate.js';
import { WOLGYE_COURSE_STORES, WOLGYE_PRISM_STORE, WOLGYE_STORES, WOLGYE_STORE_DISCLOSURE } from './wolgye-seed.js';
import {
  seedLocalShowcase,
  SHOWCASE_COURSE_ID,
  SHOWCASE_CAMPAIGN_ID,
  SHOWCASE_CUSTOMER_ACCOUNT_ID,
  SHOWCASE_MERCHANT_ID,
  SHOWCASE_PRACTICE_CAMPAIGN_ID,
  SHOWCASE_PRACTICE_MERCHANT_ID,
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

test('local showcase seed is repeatable with public-data stores and one hidden practice store', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const first = await seedLocalShowcase(pool);
    const second = await seedLocalShowcase(pool);
    assert.deepEqual(second, first);
    assert.deepEqual(first, {
      merchantId: SHOWCASE_PRACTICE_MERCHANT_ID,
      campaignId: SHOWCASE_PRACTICE_CAMPAIGN_ID,
    });

    const rows = await snapshot(pool);
    assert.ok(WOLGYE_STORES.length >= 300);
    assert.equal(rows.merchants.length, WOLGYE_STORES.length + 1);
    assert.equal(rows.campaigns.length, WOLGYE_STORES.length + 1);
    assert.equal(rows.goals.length, 3 * (WOLGYE_STORES.length + 1));
    assert.equal(rows.members.length, 1);
    const course = await pool.query<{ merchant_id: string }>(
      'SELECT merchant_id FROM course_steps WHERE course_id = $1 ORDER BY position', [SHOWCASE_COURSE_ID]);
    assert.deepEqual(course.rows.map((row) => row.merchant_id), WOLGYE_COURSE_STORES.map((store) => store.id));
    const prism = await pool.query<{ reward_grades: Record<string, string> }>(
      'SELECT reward_grades FROM collectible_publications WHERE campaign_id = $1 ORDER BY published_at DESC LIMIT 1',
      [`${WOLGYE_PRISM_STORE.id}-campaign`]);
    assert.deepEqual(prism.rows[0]?.reward_grades, { 1: 'bronze', 3: 'silver', 5: 'prism' });
    const grades = await pool.query<{ top_grade: string; total: number }>(
      `SELECT reward_grades ->> '5' AS top_grade, count(*)::int AS total
       FROM collectible_publications WHERE campaign_id LIKE 'showcase-wolgye-%-campaign'
       GROUP BY reward_grades ->> '5' ORDER BY top_grade`);
    assert.deepEqual(grades.rows, [
      { top_grade: 'gold', total: WOLGYE_STORES.length - 1 }, { top_grade: 'prism', total: 1 },
    ]);

    // 연습 점포의 가상 혜택은 재실행해도 늘거나 초기화되지 않는다.
    await pool.query(`UPDATE badge_reward_offers SET issued_count = 3 WHERE milestone = 2`);
    await seedLocalShowcase(pool);
    const offers = await pool.query<{
      milestone: number; merchant_id: string; title: string; detail: string; valid_days: number;
      status: string; issued_count: number; issuance_cap: number | null; consent_note: string;
    }>('SELECT * FROM badge_reward_offers ORDER BY milestone');
    assert.deepEqual(
      offers.rows.map((offer) => [offer.milestone, offer.merchant_id, offer.title, offer.valid_days, offer.status]),
      [
        [1, SHOWCASE_PRACTICE_MERCHANT_ID, '체험 음료 1잔', 30, 'ACTIVE'],
        [2, SHOWCASE_PRACTICE_MERCHANT_ID, '체험 디저트 한 접시', 30, 'ACTIVE'],
        [3, SHOWCASE_PRACTICE_MERCHANT_ID, '체험 세트 20% 할인', 30, 'ACTIVE'],
      ],
    );
    assert.deepEqual(offers.rows.map((offer) => offer.issued_count), [0, 3, 0]);
    assert.ok(offers.rows.every((offer) => offer.issuance_cap === null
      && offer.consent_note === '시연 가상 방문 체험 혜택 — 실제 매장 혜택 아님'
      && offer.detail.includes('실제 매장에서는 사용할 수 없습니다')));

    await pool.query('UPDATE campaigns SET enrolled_count = 2 WHERE id = $1', [SHOWCASE_PRACTICE_CAMPAIGN_ID]);
    await seedLocalShowcase(pool);
    const progress = await pool.query<{ enrolled_count: number }>(
      'SELECT enrolled_count FROM campaigns WHERE id = $1', [SHOWCASE_PRACTICE_CAMPAIGN_ID],
    );
    assert.equal(progress.rows[0]?.enrolled_count, 2);

    const catalog = new PostgresMerchantCatalog(pool);
    const listed = await catalog.listPublicMerchants();
    assert.equal(listed.length, WOLGYE_STORES.length);
    assert.deepEqual(listed.map((merchant) => merchant.id).sort(), WOLGYE_STORES.map((store) => store.id).sort());
    assert.ok(listed.every((merchant) => merchant.id.startsWith('showcase-wolgye-')));
    assert.ok(listed.every((merchant) => merchant.demo));
    const demoDetails = new PostgresRealWorldService(pool, { includeDemo: true });
    const detail = await demoDetails.merchant(WOLGYE_STORES[0]!.id);
    assert.equal(detail.demo, true);
    assert.deepEqual(detail.position, { latitude: WOLGYE_STORES[0]!.lat, longitude: WOLGYE_STORES[0]!.lng });
    assert.equal(detail.name, WOLGYE_STORES[0]!.name);
    await assert.rejects(demoDetails.merchant(SHOWCASE_PRACTICE_MERCHANT_ID),
      (error: unknown) => error instanceof Error && error.message === 'MERCHANT_NOT_FOUND');
    await assert.rejects(new PostgresRealWorldService(pool).merchant(WOLGYE_STORES[0]!.id),
      (error: unknown) => error instanceof Error && error.message === 'MERCHANT_NOT_FOUND');
    const publication = await pool.query('SELECT published_at FROM merchants WHERE id = $1', [WOLGYE_STORES[0]!.id]);
    await seedLocalShowcase(pool);
    assert.deepEqual((await pool.query('SELECT published_at FROM merchants WHERE id = $1', [WOLGYE_STORES[0]!.id])).rows, publication.rows);

    const access = new PostgresMerchantAccessControl(pool);
    const staff = await access.requirePermission({
      accountId: SHOWCASE_STAFF_ACCOUNT_ID,
      merchantId: SHOWCASE_PRACTICE_MERCHANT_ID,
      permission: 'CONFIRM_VISIT',
    });
    assert.equal(staff.role, 'STAFF');
    await assert.rejects(access.requirePermission({
      accountId: SHOWCASE_CUSTOMER_ACCOUNT_ID,
      merchantId: SHOWCASE_PRACTICE_MERCHANT_ID,
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
    const pages = [] as Awaited<ReturnType<typeof showcase.search>>[];
    let cursor: string | null = null;
    do {
      const page = await showcase.search({ ...query, limit: 100, ...(cursor ? { cursor } : {}) });
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor);
    const pageMerchants = pages.flatMap((page) => page.merchants);
    assert.equal(pageMerchants.length, WOLGYE_STORES.length);
    assert.deepEqual(pageMerchants.map((merchant) => merchant.id).sort(), WOLGYE_STORES.map((store) => store.id).sort());
    const nearest = WOLGYE_STORES[0]!;
    assert.equal(pageMerchants.find((merchant) => merchant.id === nearest.id)?.distance?.meters, nearest.distanceM);
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

test('existing A showcase data becomes hidden without changing visit progress', async () => {
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
      [32, 32, 96, 2],
    );
    const retired = await pool.query<{ status: string; published_at: Date | null }>(
      'SELECT status, published_at FROM merchants WHERE id = $1', [SHOWCASE_MERCHANT_ID]);
    assert.deepEqual(retired.rows, [{ status: 'PAUSED', published_at: null }]);
    const campaign = await pool.query<{ status: string; is_public: boolean }>(
      'SELECT status, is_public FROM campaigns WHERE id = $1', [SHOWCASE_CAMPAIGN_ID]);
    assert.deepEqual(campaign.rows, [{ status: 'ENDED', is_public: false }]);
    assert.ok((await new PostgresMerchantCatalog(pool).listPublicMerchants())
      .every((merchant) => merchant.id !== SHOWCASE_MERCHANT_ID));
    const legacyCourseId = '4b66a421-522a-4966-98cb-e359413cf412';
    await pool.query(
      `INSERT INTO courses (id, title, situation, scene_key, status, curated_by_account_id, checked_at, check_summary)
       VALUES ($1, '기존 코스', 'AFTER_MEAL', 'old-scene', 'DRAFT', 'legacy-curator', now(), '{}'::jsonb)`, [legacyCourseId]);
    for (const [position, merchantId] of [SHOWCASE_MERCHANT_ID, WOLGYE_STORES[0]!.id].entries()) {
      await pool.query(
        `INSERT INTO course_steps (course_id, position, merchant_id, piece_key, piece_label,
          owner_optin_ref, owner_optin_at) VALUES ($1, $2, $3, $4, '조각', 'TEST-OPTIN', now())`,
        [legacyCourseId, position + 1, merchantId, `piece-${position + 1}`]);
    }
    await pool.query("UPDATE courses SET status = 'ACTIVE' WHERE id = $1", [legacyCourseId]);
    const evidence: { position: number; entitlementId: string }[] = [];
    for (const [position, merchantId] of [SHOWCASE_MERCHANT_ID, WOLGYE_STORES[0]!.id].entries()) {
      const slotId = randomUUID(), visitId = randomUUID(), entitlementId = randomUUID();
      const campaignId = merchantId === SHOWCASE_MERCHANT_ID ? SHOWCASE_CAMPAIGN_ID : `${merchantId}-campaign`;
      await pool.query(
        `INSERT INTO merchant_members (merchant_id, account_id, role, status, revoked_at)
         VALUES ($1, 'legacy-staff', 'STAFF', 'REVOKED', now())`, [merchantId]);
      await pool.query(
        `INSERT INTO claim_slots (id, merchant_id, customer_account_id, merchant_reference_hash,
          created_by_account_id, token_hash, status, expires_at, claimed_at)
         VALUES ($1, $2, 'legacy-customer', $3, 'legacy-staff', $4, 'CLAIMED', now() + interval '1 hour', now())`,
        [slotId, merchantId, Buffer.alloc(32, position + 1), Buffer.alloc(32, position + 3)]);
      await pool.query(
        `INSERT INTO visit_events (id, claim_slot_id, merchant_id, campaign_id, customer_account_id,
          occurred_at, business_date, verification_level, status, progress_counted)
         VALUES ($1, $2, $3, $4, 'legacy-customer', now(), current_date,
           'MERCHANT_CONFIRMED', 'VALID', true)`, [visitId, slotId, merchantId, campaignId]);
      await pool.query(
        `INSERT INTO reward_entitlements (id, customer_account_id, campaign_id, target_visit_count,
          source_visit_event_id, status, policy_version, earned_at, claim_expires_at)
         VALUES ($1, 'legacy-customer', $2, 1, $3, 'GRANTED', 'test-policy', now(), now() + interval '1 day')`,
        [entitlementId, campaignId, visitId]);
      evidence.push({ position: position + 1, entitlementId });
    }
    await pool.query("INSERT INTO course_unlocks (account_id, course_id, evidence) VALUES ('legacy-customer', $1, $2)",
      [legacyCourseId, JSON.stringify({ steps: evidence })]);
    const courses = new PostgresCourseService(pool, { includeDemo: true });
    const before = await courses.get('legacy-customer', legacyCourseId);
    assert.equal(before.state, 'UNLOCKED');
    assert.ok(before.steps.every(step => step.earnedAt));
    assert.ok(before.steps[1]?.artwork);
    await seedLocalShowcase(pool);
    const after = await courses.get('legacy-customer', legacyCourseId);
    assert.equal(after.status, 'ENDED');
    assert.equal(after.state, 'UNLOCKED');
    assert.equal(after.unlockedAt, before.unlockedAt);
    assert.deepEqual(after.steps.map(step => [step.earnedAt, step.artwork]),
      before.steps.map(step => [step.earnedAt, step.artwork]));
    assert.deepEqual((await courses.list('legacy-customer')).find(course => course.id === legacyCourseId), after);
    assert.equal((await courses.list('new-customer')).some(course => course.id === legacyCourseId), false);
    assert.ok((await courses.listHints('legacy-customer')).every(hint => hint.id !== legacyCourseId));
    await assert.rejects(courses.get('new-customer', legacyCourseId),
      (error: unknown) => error instanceof CourseError && error.code === 'COURSE_NOT_FOUND');
    await assert.rejects(courses.unlock('legacy-customer', legacyCourseId),
      (error: unknown) => error instanceof CourseError && error.code === 'COURSE_UNAVAILABLE');
    const progress = await pool.query<{ enrolled_count: number }>(
      'SELECT enrolled_count FROM campaigns WHERE id = $1', [SHOWCASE_CAMPAIGN_ID],
    );
    assert.equal(progress.rows[0]?.enrolled_count, 2);
  });
});

test('damaged practice fixture is refused without changing its seeded rows', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await seedLocalShowcase(pool);
    for (const [query, values] of [
      ['UPDATE merchants SET is_demo = false WHERE id = $1', [SHOWCASE_PRACTICE_MERCHANT_ID]],
      ['UPDATE merchants SET status = \'PAUSED\' WHERE id = $1', [SHOWCASE_PRACTICE_MERCHANT_ID]],
      ['UPDATE merchants SET published_at = now() WHERE id = $1', [SHOWCASE_PRACTICE_MERCHANT_ID]],
      ['UPDATE campaigns SET is_public = false WHERE id = $1', [SHOWCASE_PRACTICE_CAMPAIGN_ID]],
      ['UPDATE campaigns SET ends_at = now() - interval \'1 day\' WHERE id = $1', [SHOWCASE_PRACTICE_CAMPAIGN_ID]],
      ['UPDATE campaign_goals SET display_name = \'wrong\' WHERE campaign_id = $1 AND target_visit_count = 3', [SHOWCASE_PRACTICE_CAMPAIGN_ID]],
      ['DELETE FROM campaign_goals WHERE campaign_id = $1 AND target_visit_count = 5', [SHOWCASE_PRACTICE_CAMPAIGN_ID]],
      ['UPDATE merchant_members SET role = \'OWNER\' WHERE merchant_id = $1', [SHOWCASE_PRACTICE_MERCHANT_ID]],
      ['UPDATE badge_reward_offers SET title = \'wrong\' WHERE milestone = 2 AND $1::text IS NOT NULL', [SHOWCASE_PRACTICE_MERCHANT_ID]],
      ['UPDATE badge_reward_offers SET merchant_id = $1 WHERE milestone = 3', [WOLGYE_STORES[0]!.id]],
    ] as const) {
      const before = await snapshot(pool);
      await pool.query(query, [...values]);
      const damaged = await snapshot(pool);
      await assert.rejects(seedLocalShowcase(pool), /SHOWCASE_FIXTURE_COLLISION/, query);
      assert.deepEqual(await snapshot(pool), damaged);
      // Restore only this disposable test database for the next independent corruption case.
      await pool.query('TRUNCATE courses, merchant_members, campaign_goals, campaigns, merchants CASCADE');
      await seedLocalShowcase(pool);
      assert.equal(before.merchants.length, WOLGYE_STORES.length + 1);
    }
  });
});

test('existing A with another public campaign is fully hidden without row deletion', async () => {
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
    await seedLocalShowcase(pool);
    const campaign = await pool.query<{ status: string; is_public: boolean }>(
      "SELECT status, is_public FROM campaigns WHERE id = 'other-campaign'");
    assert.deepEqual(campaign.rows, [{ status: 'ENDED', is_public: false }]);
    assert.ok((await new PostgresMerchantCatalog(pool).listPublicMerchants())
      .every((merchant) => merchant.id !== SHOWCASE_MERCHANT_ID));
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
        merchantId: SHOWCASE_PRACTICE_MERCHANT_ID,
        campaignId: SHOWCASE_PRACTICE_CAMPAIGN_ID,
      });
    }
    const rows = await snapshot(pool);
    assert.deepEqual(
      [rows.merchants.length, rows.campaigns.length, rows.goals.length, rows.members.length],
      [31, 31, 93, 1],
    );
  });
});

test('a failure after merchant insertion rolls back every fixture table', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await pool.query(
      `ALTER TABLE campaigns ADD CONSTRAINT showcase_test_reject_insert
       CHECK (id <> 'trial-showcase-practice-campaign')`,
    );
    const before = await snapshot(pool);
    await assert.rejects(seedLocalShowcase(pool));
    assert.deepEqual(await snapshot(pool), before);
  });
});
