import type { Pool, PoolClient } from 'pg';

export const SHOWCASE_MERCHANT_ID = 'showcase-local-merchant';
export const SHOWCASE_CAMPAIGN_ID = 'showcase-local-campaign';
export const SHOWCASE_STAFF_ACCOUNT_ID = 'showcase-local-staff';
export const SHOWCASE_CUSTOMER_ACCOUNT_ID = 'showcase-local-customer';

const localDatabaseError = 'SHOWCASE_LOCAL_DATABASE_REQUIRED';
const fixtureError = 'SHOWCASE_FIXTURE_COLLISION';
const showcaseSeedLockId = 2_026_092_313_7;
const merchantAddress = '시연용 가상 위치 · 실제 방문 불가';
const campaignTitle = '체험 방문 도감';
const merchants = [
  {
    merchantId: SHOWCASE_MERCHANT_ID,
    campaignId: SHOWCASE_CAMPAIGN_ID,
    name: '가상 점포 A',
    story: '체험용 가상 데이터이며 실제 영업점·방문 혜택이 아닙니다.',
  },
  {
    merchantId: 'showcase-local-merchant-b',
    campaignId: 'showcase-local-campaign-b',
    name: '가상 점포 B',
    story: '다음 가게를 찾아보는 흐름을 보여주는 가상 점포입니다. 실제 영업점·방문 혜택이 아닙니다.',
  },
  {
    merchantId: 'showcase-local-merchant-c',
    campaignId: 'showcase-local-campaign-c',
    name: '가상 점포 C',
    story: '여러 가게의 방문을 모으는 흐름을 보여주는 가상 점포입니다. 실제 영업점·방문 혜택이 아닙니다.',
  },
] as const;
type ShowcaseMerchant = (typeof merchants)[number];
const goals = [
  [1, '가상 첫 방문 수집품'],
  [3, '가상 세 번째 방문 수집품'],
  [5, '가상 다섯 번째 방문 수집품'],
] as const;

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
      name === 'masscom_showcase_test' &&
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
    `SELECT name, story, road_address, minimum_spend_won, status, is_demo
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
    merchant.status !== 'ACTIVE' || merchant.is_demo !== true ||
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
    for (const entry of merchants) {
      const existing = await readFixture(client, entry, staffAccountId);
      const hasExisting = Boolean(
        existing.merchant || existing.campaign || existing.member || existing.goals.length,
      );
      if (hasExisting) {
        assertFixtureMatches(existing, entry, now, Boolean(staffAccountId));
        continue;
      }
      await client.query(
        `INSERT INTO merchants
         (id, name, story, road_address, minimum_spend_won, status, is_demo)
         VALUES ($1, $2, $3, $4, 0, 'ACTIVE', true)
         ON CONFLICT (id) DO NOTHING`,
        [entry.merchantId, entry.name, entry.story, merchantAddress],
      );
      await client.query(
        `INSERT INTO campaigns
         (id, merchant_id, title, starts_at, ends_at, status, is_public,
          enrollment_capacity, enrolled_count)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', true, 20, 0)
         ON CONFLICT (id) DO NOTHING`,
        [
          entry.campaignId, entry.merchantId, campaignTitle,
          new Date(now.getTime() - 24 * 60 * 60 * 1000),
          new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        ],
      );
      for (const [count, name] of goals) {
        await client.query(
          `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (campaign_id, target_visit_count) DO NOTHING`,
          [entry.campaignId, count, name],
        );
      }
      if (staffAccountId) {
        await client.query(
          `INSERT INTO merchant_members (merchant_id, account_id, role, status)
           VALUES ($1, $2, 'STAFF', 'ACTIVE')
           ON CONFLICT (merchant_id, account_id) DO NOTHING`,
          [entry.merchantId, staffAccountId],
        );
      }
      assertFixtureMatches(
        await readFixture(client, entry, staffAccountId), entry, now, Boolean(staffAccountId),
      );
    }
    await client.query('COMMIT');
    transactionStarted = false;
    return { merchantId: SHOWCASE_MERCHANT_ID, campaignId: SHOWCASE_CAMPAIGN_ID };
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
