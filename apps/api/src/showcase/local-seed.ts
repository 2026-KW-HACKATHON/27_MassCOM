import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { SHOWCASE_SEED_CAMPAIGN_BACKDATE_DAYS } from './all-access.js';
import { seedWolgyeStores, WOLGYE_COURSE_STORES, WOLGYE_STORES } from './wolgye-seed.js';

export const SHOWCASE_MERCHANT_ID = 'showcase-local-merchant';
export const SHOWCASE_CAMPAIGN_ID = 'showcase-local-campaign';
export const SHOWCASE_PRACTICE_MERCHANT_ID = 'trial-showcase-practice';
export const SHOWCASE_PRACTICE_CAMPAIGN_ID = 'trial-showcase-practice-campaign';
export const SHOWCASE_STAFF_ACCOUNT_ID = 'showcase-local-staff';
export const SHOWCASE_CUSTOMER_ACCOUNT_ID = 'showcase-local-customer';
const legacyCourseId = '4b66a421-522a-4966-98cb-e359413cf412';
export const SHOWCASE_COURSE_ID = 'f81f04e0-bca8-4e36-a4e6-a812de5a7b80';

const localDatabaseError = 'SHOWCASE_LOCAL_DATABASE_REQUIRED';
const fixtureError = 'SHOWCASE_FIXTURE_COLLISION';
const showcaseSeedLockId = 2_026_092_313_7;
const merchantAddress = '시연용 가상 위치 · 실제 방문 불가';
// 시연 NFT 메타데이터의 동네·업종(Issue #254). 가상 점포라 동네는 서비스 무대인 월계동으로 둔다. 운영 DB에는 넣지 않는다.
const merchantNeighborhood = '월계동';
const campaignTitle = '체험 방문 도감';
const legacyMerchants = [
  {
    merchantId: SHOWCASE_MERCHANT_ID,
    campaignId: SHOWCASE_CAMPAIGN_ID,
    art: 'a',
    name: '가상 점포 A',
    story: '체험용 가상 데이터이며 실제 영업점·방문 혜택이 아닙니다.',
    category: '카페',
  },
  {
    merchantId: 'showcase-local-merchant-b',
    campaignId: 'showcase-local-campaign-b',
    art: 'b',
    name: '가상 점포 B',
    story: '다음 가게를 찾아보는 흐름을 보여주는 가상 점포입니다. 실제 영업점·방문 혜택이 아닙니다.',
    category: '분식',
  },
  {
    merchantId: 'showcase-local-merchant-c',
    campaignId: 'showcase-local-campaign-c',
    art: 'c',
    topGrade: 'prism',
    name: '가상 점포 C',
    story: '여러 가게의 방문을 모으는 흐름을 보여주는 가상 점포입니다. 실제 영업점·방문 혜택이 아닙니다.',
    category: '한식',
  },
] as const;
type ShowcaseMerchant = (typeof legacyMerchants)[number] | typeof practiceMerchant;
const practiceMerchant = {
  merchantId: SHOWCASE_PRACTICE_MERCHANT_ID,
  campaignId: SHOWCASE_PRACTICE_CAMPAIGN_ID,
  name: '체험 점주 가게',
  story: '점주 기능을 연습하는 비공개 체험 가게입니다. 실제 매장이 아닙니다.',
  category: '카페',
} as const;
const goals = [
  [1, '가상 첫 방문 수집품'],
  [3, '가상 세 번째 방문 수집품'],
  [5, '가상 다섯 번째 방문 수집품'],
] as const;

// 시연 DB 전용 체험 혜택. 운영 DB에는 점주 동의 뒤 수동 등록 전까지 넣지 않는다(D-043).
const offerDetail = '시연용 가상 방문 체험 혜택입니다. 실제 매장에서는 사용할 수 없습니다.';
const offerConsentNote = '시연 가상 방문 체험 혜택 — 실제 매장 혜택 아님';
const offerValidDays = 30;
const rewardOffers = [
  { milestone: 1, merchantId: SHOWCASE_PRACTICE_MERCHANT_ID, title: '체험 음료 1잔' },
  { milestone: 2, merchantId: SHOWCASE_PRACTICE_MERCHANT_ID, title: '체험 디저트 한 접시' },
  { milestone: 3, merchantId: SHOWCASE_PRACTICE_MERCHANT_ID, title: '체험 세트 20% 할인' },
] as const;

// 시연 전부 체험(#333): 테스트 방문을 서로 다른 날로 옮겨 세려면 캠페인이 충분히 일찍 시작해 있어야 한다(오늘 포함 30일).
const campaignStartsAt = (now: Date): Date => new Date(now.getTime() - SHOWCASE_SEED_CAMPAIGN_BACKDATE_DAYS * 24 * 60 * 60 * 1000);
const campaignEndsAt = (now: Date): Date => new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

export function isPermittedShowcaseDatabaseName(name: string): boolean {
  return name === 'masscom_showcase_test' || /^masscom_showcase_ci_[0-9a-f]+_test$/.test(name);
}

export function assertLocalShowcaseDatabaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const name = decodeURIComponent(url.pathname.slice(1));
    if (
      url.protocol === 'postgresql:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      isPermittedShowcaseDatabaseName(name) &&
      !url.search &&
      !url.hash
    ) {
      return raw;
    }
  } catch {
    // URL parser errors can contain credentials, so expose one fixed error below.
  }
  throw new Error(localDatabaseError);
}

export async function assertShowcaseDatabaseTarget(
  pool: Pool,
  expectedName?: string,
): Promise<void> {
  const result = await pool.query<{ name: string }>('SELECT current_database() AS name');
  const name = result.rows[0]?.name;
  if (!name || !isPermittedShowcaseDatabaseName(name) || (expectedName && name !== expectedName)) {
    throw new Error(localDatabaseError);
  }
}

type MerchantRow = {
  name: string;
  story: string;
  road_address: string;
  minimum_spend_won: number;
  status: string;
  is_demo: boolean;
  published_at: Date | null;
};

type CampaignRow = {
  merchant_id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
  is_public: boolean;
  enrollment_capacity: number;
  enrolled_count: number;
};

type GoalRow = { target_visit_count: number; display_name: string };
type MemberRow = { role: string; status: string; revoked_at: Date | null };

async function readFixture(client: PoolClient, entry: ShowcaseMerchant, staffAccountId?: string): Promise<{
  merchant?: MerchantRow;
  campaign?: CampaignRow;
  goals: GoalRow[];
  member?: MemberRow;
}> {
  const merchant = await client.query<MerchantRow>(
    `SELECT name, story, road_address, minimum_spend_won, status, is_demo, published_at
     FROM merchants WHERE id = $1`,
    [entry.merchantId],
  );
  const campaign = await client.query<CampaignRow>(
    `SELECT merchant_id, title, starts_at, ends_at, status, is_public,
            enrollment_capacity, enrolled_count
     FROM campaigns WHERE id = $1`,
    [entry.campaignId],
  );
  const rewardGoals = await client.query<GoalRow>(
    `SELECT target_visit_count, display_name FROM campaign_goals
     WHERE campaign_id = $1 ORDER BY target_visit_count`,
    [entry.campaignId],
  );
  const member = staffAccountId ? await client.query<MemberRow>(
    `SELECT role, status, revoked_at FROM merchant_members
     WHERE merchant_id = $1 AND account_id = $2`,
    [entry.merchantId, staffAccountId],
  ) : undefined;
  return {
    ...(merchant.rows[0] ? { merchant: merchant.rows[0] } : {}),
    ...(campaign.rows[0] ? { campaign: campaign.rows[0] } : {}),
    goals: rewardGoals.rows,
    ...(member?.rows[0] ? { member: member.rows[0] } : {}),
  };
}

function assertFixtureMatches(
  fixture: Awaited<ReturnType<typeof readFixture>>,
  entry: ShowcaseMerchant,
  now: Date,
  expectStaff: boolean,
): void {
  const { merchant, campaign, member } = fixture;
  if (
    !merchant || merchant.name !== entry.name || merchant.story !== entry.story ||
    merchant.road_address !== merchantAddress || merchant.minimum_spend_won !== 0 ||
    merchant.status !== 'ACTIVE' || merchant.is_demo !== true || merchant.published_at !== null ||
    !campaign || campaign.merchant_id !== entry.merchantId ||
    campaign.title !== campaignTitle || campaign.status !== 'ACTIVE' ||
    campaign.is_public !== true || campaign.enrollment_capacity !== 20 ||
    campaign.enrolled_count < 0 || campaign.enrolled_count > 20 ||
    campaign.starts_at.getTime() > now.getTime() ||
    campaign.ends_at.getTime() <= now.getTime() ||
    fixture.goals.length !== goals.length ||
    goals.some(([count, name], index) =>
      fixture.goals[index]?.target_visit_count !== count ||
      fixture.goals[index]?.display_name !== name) ||
    (expectStaff && (!member || member.role !== 'STAFF' || member.status !== 'ACTIVE' ||
    member.revoked_at !== null))
  ) {
    throw new Error(fixtureError);
  }
}

export async function seedLocalShowcase(
  pool: Pool,
  now: Date = new Date(),
): Promise<{ merchantId: string; campaignId: string }> {
  return seedShowcaseFixtureData(pool, 'local', now);
}

export async function seedShowcaseFixtureData(
  pool: Pool,
  mode: 'local' | 'hosted',
  now: Date = new Date(),
): Promise<{ merchantId: string; campaignId: string }> {
  if (mode === 'local') {
    await assertShowcaseDatabaseTarget(pool);
  } else if (mode === 'hosted') {
    const result = await pool.query<{ name: string }>('SELECT current_database() AS name');
    if (result.rows[0]?.name !== 'masscom_showcase') {
      throw new Error('SHOWCASE_HOST_DATABASE_REQUIRED');
    }
  } else {
    throw new Error('SHOWCASE_SEED_MODE_REQUIRED');
  }
  const staffAccountId = mode === 'local' ? SHOWCASE_STAFF_ACCOUNT_ID : undefined;
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [showcaseSeedLockId]);
    // 게시·미디어 제거와 같은 순서: 원본 잠금 → 모든 점포 갱신 → 캠페인 갱신.
    for (const entry of legacyMerchants) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`collectible-sources:${entry.merchantId}`]);
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`collectible-sources:${practiceMerchant.merchantId}`]);
    for (const store of WOLGYE_STORES) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`collectible-sources:${store.id}`]);
    }
    // Retire only recognizable legacy fixtures. Their visit, coin, and coupon foreign keys stay intact.
    for (const entry of legacyMerchants) {
      const old = await readFixture(client, entry);
      if (!old.merchant && !old.campaign && !old.goals.length) continue;
      if (!old.merchant || !old.merchant.is_demo ||
          (old.campaign && old.campaign.merchant_id !== entry.merchantId)) {
        throw new Error(fixtureError);
      }
      await client.query("UPDATE merchants SET status = 'PAUSED', published_at = NULL WHERE id = $1 AND is_demo", [entry.merchantId]);
      await client.query("UPDATE campaigns SET status = 'ENDED', is_public = false WHERE merchant_id = $1 AND (status <> 'ENDED' OR is_public)", [entry.merchantId]);
      await client.query("UPDATE merchant_members SET status = 'REVOKED', revoked_at = COALESCE(revoked_at, $2) WHERE merchant_id = $1 AND status = 'ACTIVE'", [entry.merchantId, now]);
      await client.query("UPDATE badge_reward_offers SET status = 'PAUSED' WHERE merchant_id = $1 AND status = 'ACTIVE'", [entry.merchantId]);
    }
    await client.query("UPDATE courses SET status = 'ENDED' WHERE id = $1 AND status IN ('ACTIVE', 'PAUSED')", [legacyCourseId]);
    const entry = practiceMerchant;
    const existingPractice = await readFixture(client, entry, staffAccountId);
    const practiceExists = Boolean(existingPractice.merchant || existingPractice.campaign ||
      existingPractice.goals.length || existingPractice.member);
    if (practiceExists) assertFixtureMatches(existingPractice, entry, now, Boolean(staffAccountId));
    if (!practiceExists) {
      await client.query(
        `INSERT INTO merchants
         (id, name, story, road_address, minimum_spend_won, status, is_demo, neighborhood, category)
         VALUES ($1, $2, $3, $4, 0, 'ACTIVE', true, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [entry.merchantId, entry.name, entry.story, merchantAddress, merchantNeighborhood, entry.category],
      );
      if (staffAccountId) {
        await client.query(
          `INSERT INTO merchant_members (merchant_id, account_id, role, status)
           VALUES ($1, $2, 'STAFF', 'ACTIVE') ON CONFLICT (merchant_id, account_id) DO NOTHING`,
          [entry.merchantId, staffAccountId],
        );
      }
      await client.query(
        `INSERT INTO campaigns
         (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity, enrolled_count)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', true, 20, 0) ON CONFLICT (id) DO NOTHING`,
        [entry.campaignId, entry.merchantId, campaignTitle, campaignStartsAt(now), campaignEndsAt(now)],
      );
      for (const [count, name] of goals) {
        await client.query(
          `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
           VALUES ($1, $2, $3) ON CONFLICT (campaign_id, target_visit_count) DO NOTHING`,
          [entry.campaignId, count, name],
        );
      }
    }
    assertFixtureMatches(await readFixture(client, entry, staffAccountId), entry, now, Boolean(staffAccountId));
    await client.query(
      `UPDATE campaigns SET starts_at = LEAST(starts_at, $2), ends_at = GREATEST(ends_at, $3)
       WHERE id = $1 AND (starts_at > $2 OR ends_at < $3)`,
      [entry.campaignId, campaignStartsAt(now), campaignEndsAt(now)],
    );
    await seedRewardOffers(client);
    await seedWolgyeStores(client, now);
    // Published steps are immutable, so T9 ends the old course and uses a fresh ID.
    await client.query(
      `INSERT INTO courses(id, title, situation, scene_key, status, curated_by_account_id, checked_at,
        check_summary) VALUES ($1, '월계역 산책', 'AFTER_MEAL', 'showcase-picnic', 'DRAFT',
        'showcase-fixture', $2, $3) ON CONFLICT (id) DO NOTHING`,
      [SHOWCASE_COURSE_ID, now, JSON.stringify({ schemaVersion: 1, snapshot: true, label: '월계역 인근 시연 코스' })],
    );
    for (const [index, store] of WOLGYE_COURSE_STORES.entries()) {
      await client.query(
        `INSERT INTO course_steps(course_id, position, merchant_id, target_visit_count, piece_key,
          piece_label, owner_optin_ref, owner_optin_at)
          SELECT $1,$2,$3,1,$4,$5,'SHOWCASE-DEMO-ONLY',$6
          WHERE EXISTS (SELECT 1 FROM courses WHERE id = $1 AND status = 'DRAFT')
          ON CONFLICT (course_id, position) DO NOTHING`,
        [SHOWCASE_COURSE_ID, index + 1, store.id, `piece-${index + 1}`, ['그릇', '컵', '봉투'][index], now],
      );
    }
    await client.query("UPDATE courses SET status = 'ACTIVE' WHERE id = $1 AND status = 'DRAFT'", [SHOWCASE_COURSE_ID]);
    const course = await client.query<{ title: string; status: string; merchant_ids: string[] }>(
      `SELECT course.title, course.status,
         array_agg(step.merchant_id ORDER BY step.position) AS merchant_ids
       FROM courses course JOIN course_steps step ON step.course_id = course.id
       WHERE course.id = $1 GROUP BY course.id`, [SHOWCASE_COURSE_ID]);
    if (course.rows[0]?.title !== '월계역 산책' || course.rows[0]?.status !== 'ACTIVE' ||
        JSON.stringify(course.rows[0].merchant_ids) !== JSON.stringify(WOLGYE_COURSE_STORES.map((store) => store.id))) {
      throw new Error(fixtureError);
    }
    await client.query('COMMIT');
    transactionStarted = false;
    return { merchantId: SHOWCASE_PRACTICE_MERCHANT_ID, campaignId: SHOWCASE_PRACTICE_CAMPAIGN_ID };
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedRewardOffers(client: PoolClient): Promise<void> {
  for (const offer of rewardOffers) {
    const existing = await client.query<{
      merchant_id: string; title: string; detail: string; valid_days: number; consent_note: string;
    }>(
      `SELECT merchant_id, title, detail, valid_days, consent_note
       FROM badge_reward_offers WHERE milestone = $1 AND status = 'ACTIVE'`,
      [offer.milestone],
    );
    const row = existing.rows[0];
    if (row) {
      if (
        row.merchant_id !== offer.merchantId || row.title !== offer.title ||
        row.detail !== offerDetail || row.valid_days !== offerValidDays ||
        row.consent_note !== offerConsentNote
      ) {
        throw new Error(fixtureError);
      }
      continue;
    }
    await client.query(
      `INSERT INTO badge_reward_offers
       (id, milestone, merchant_id, title, detail, valid_days, status, consent_note)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7)`,
      [randomUUID(), offer.milestone, offer.merchantId, offer.title, offerDetail,
        offerValidDays, offerConsentNote],
    );
  }
}
