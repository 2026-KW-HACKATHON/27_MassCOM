import type { Pool, PoolClient } from 'pg';

export const SHOWCASE_MERCHANT_ID = 'showcase-local-merchant';
export const SHOWCASE_CAMPAIGN_ID = 'showcase-local-campaign';
export const SHOWCASE_STAFF_ACCOUNT_ID = 'showcase-local-staff';
export const SHOWCASE_CUSTOMER_ACCOUNT_ID = 'showcase-local-customer';

const localDatabaseError = 'SHOWCASE_LOCAL_DATABASE_REQUIRED';
const fixtureError = 'SHOWCASE_FIXTURE_COLLISION';
const showcaseSeedLockId = 2_026_092_313_7;
const merchantName = '가상 점포 A';
const merchantStory = '체험용 가상 데이터이며 실제 영업점·방문 혜택이 아닙니다.';
const merchantAddress = '시연용 가상 위치 · 실제 방문 불가';
const campaignTitle = '체험 방문 도감';
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

async function readFixture(client: PoolClient): Promise<{
  merchant?: MerchantRow;
  campaign?: CampaignRow;
  goals: GoalRow[];
  member?: MemberRow;
}> {
  const merchant = await client.query<MerchantRow>(
    `SELECT name, story, road_address, minimum_spend_won, status, is_demo
     FROM merchants WHERE id = $1`,
    [SHOWCASE_MERCHANT_ID],
  );
  const campaign = await client.query<CampaignRow>(
    `SELECT merchant_id, title, starts_at, ends_at, status, is_public,
            enrollment_capacity, enrolled_count
     FROM campaigns WHERE id = $1`,
    [SHOWCASE_CAMPAIGN_ID],
  );
  const rewardGoals = await client.query<GoalRow>(
    `SELECT target_visit_count, display_name FROM campaign_goals
     WHERE campaign_id = $1 ORDER BY target_visit_count`,
    [SHOWCASE_CAMPAIGN_ID],
  );
  const member = await client.query<MemberRow>(
    `SELECT role, status, revoked_at FROM merchant_members
     WHERE merchant_id = $1 AND account_id = $2`,
    [SHOWCASE_MERCHANT_ID, SHOWCASE_STAFF_ACCOUNT_ID],
  );
  return {
    ...(merchant.rows[0] ? { merchant: merchant.rows[0] } : {}),
    ...(campaign.rows[0] ? { campaign: campaign.rows[0] } : {}),
    goals: rewardGoals.rows,
    ...(member.rows[0] ? { member: member.rows[0] } : {}),
  };
}

function assertFixtureMatches(fixture: Awaited<ReturnType<typeof readFixture>>, now: Date): void {
  const { merchant, campaign, member } = fixture;
  if (
    !merchant || merchant.name !== merchantName || merchant.story !== merchantStory ||
    merchant.road_address !== merchantAddress || merchant.minimum_spend_won !== 0 ||
    merchant.status !== 'ACTIVE' || merchant.is_demo !== true ||
    !campaign || campaign.merchant_id !== SHOWCASE_MERCHANT_ID ||
    campaign.title !== campaignTitle || campaign.status !== 'ACTIVE' ||
    campaign.is_public !== true || campaign.enrollment_capacity !== 20 ||
    campaign.enrolled_count < 0 || campaign.enrolled_count > 20 ||
    campaign.starts_at.getTime() > now.getTime() ||
    campaign.ends_at.getTime() <= now.getTime() ||
    fixture.goals.length !== goals.length ||
    goals.some(([count, name], index) =>
      fixture.goals[index]?.target_visit_count !== count ||
      fixture.goals[index]?.display_name !== name) ||
    !member || member.role !== 'STAFF' || member.status !== 'ACTIVE' ||
    member.revoked_at !== null
  ) {
    throw new Error(fixtureError);
  }
}

export async function seedLocalShowcase(
  pool: Pool,
  now: Date = new Date(),
): Promise<{ merchantId: string; campaignId: string }> {
  await assertShowcaseDatabaseTarget(pool);
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [showcaseSeedLockId]);
    const existing = await readFixture(client);
    const hasExisting = Boolean(
      existing.merchant || existing.campaign || existing.member || existing.goals.length,
    );
    if (hasExisting) {
      assertFixtureMatches(existing, now);
    } else {
      await client.query(
        `INSERT INTO merchants
         (id, name, story, road_address, minimum_spend_won, status, is_demo)
         VALUES ($1, $2, $3, $4, 0, 'ACTIVE', true)
         ON CONFLICT (id) DO NOTHING`,
        [SHOWCASE_MERCHANT_ID, merchantName, merchantStory, merchantAddress],
      );
      await client.query(
        `INSERT INTO campaigns
         (id, merchant_id, title, starts_at, ends_at, status, is_public,
          enrollment_capacity, enrolled_count)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', true, 20, 0)
         ON CONFLICT (id) DO NOTHING`,
        [
          SHOWCASE_CAMPAIGN_ID, SHOWCASE_MERCHANT_ID, campaignTitle,
          new Date(now.getTime() - 24 * 60 * 60 * 1000),
          new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        ],
      );
      for (const [count, name] of goals) {
        await client.query(
          `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
           VALUES ($1, $2, $3)
           ON CONFLICT (campaign_id, target_visit_count) DO NOTHING`,
          [SHOWCASE_CAMPAIGN_ID, count, name],
        );
      }
      await client.query(
        `INSERT INTO merchant_members (merchant_id, account_id, role, status)
         VALUES ($1, $2, 'STAFF', 'ACTIVE')
         ON CONFLICT (merchant_id, account_id) DO NOTHING`,
        [SHOWCASE_MERCHANT_ID, SHOWCASE_STAFF_ACCOUNT_ID],
      );
      assertFixtureMatches(await readFixture(client), now);
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
