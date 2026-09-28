import type { Pool } from 'pg';

import type {
  MerchantCatalog,
  PublicMerchant,
  PublicRewardGoal,
} from '../merchant-catalog.js';

type MerchantCatalogRow = {
  merchant_id: string;
  merchant_name: string;
  merchant_story: string;
  road_address: string;
  minimum_spend_won: number;
  menu_items: PublicMerchant['menuItems'];
  business_hours: string;
  is_demo: boolean;
  campaign_id: string;
  campaign_title: string;
  starts_at: Date;
  ends_at: Date;
  enrollment_open: boolean;
  reward_goals: unknown;
};

export class PostgresMerchantCatalog implements MerchantCatalog {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listPublicMerchants(): Promise<readonly PublicMerchant[]> {
    const result = await this.pool.query<MerchantCatalogRow>(
      `SELECT
         m.id AS merchant_id,
         m.name AS merchant_name,
         m.story AS merchant_story,
         m.road_address,
         m.minimum_spend_won,
         m.menu_items,
         m.business_hours,
         m.is_demo,
         c.id AS campaign_id,
         c.title AS campaign_title,
         c.starts_at,
         c.ends_at,
         c.enrolled_count < c.enrollment_capacity AS enrollment_open,
         jsonb_agg(
           jsonb_build_object(
             'targetVisitCount', g.target_visit_count,
             'displayName', g.display_name
           ) ORDER BY g.target_visit_count
         ) AS reward_goals
       FROM merchants m
       JOIN campaigns c ON c.merchant_id = m.id
       JOIN campaign_goals g ON g.campaign_id = c.id
       WHERE m.status = 'ACTIVE'
         AND c.status = 'ACTIVE'
         AND c.is_public = true
         AND c.starts_at <= $1
         AND c.ends_at > $1
       GROUP BY m.id, c.id
       HAVING array_agg(g.target_visit_count ORDER BY g.target_visit_count) = ARRAY[1, 3, 5]::integer[]
       ORDER BY m.name, m.id`,
      [this.now()],
    );

    return result.rows.map((row) => ({
      id: row.merchant_id,
      name: row.merchant_name,
      story: row.merchant_story,
      roadAddress: row.road_address,
      minimumSpendWon: row.minimum_spend_won,
      menuItems: row.menu_items,
      businessHours: row.business_hours,
      campaign: {
        id: row.campaign_id,
        title: row.campaign_title,
        startsAt: row.starts_at.toISOString(),
        endsAt: row.ends_at.toISOString(),
        enrollmentStatus: row.enrollment_open ? 'OPEN' : 'FULL',
        rewardGoals: parseRewardGoals(row.reward_goals),
      },
      demo: row.is_demo,
    }));
  }
}

export function parseRewardGoals(value: unknown): readonly PublicRewardGoal[] {
  if (!Array.isArray(value)) {
    throw new Error('invalid campaign reward goals');
  }

  return value.map((goal) => {
    if (!goal || typeof goal !== 'object') {
      throw new Error('invalid campaign reward goal');
    }
    const targetVisitCount = Reflect.get(goal, 'targetVisitCount');
    const displayName = Reflect.get(goal, 'displayName');
    if (
      (targetVisitCount !== 1 && targetVisitCount !== 3 && targetVisitCount !== 5) ||
      typeof displayName !== 'string'
    ) {
      throw new Error('invalid campaign reward goal');
    }
    return { targetVisitCount, displayName };
  });
}
