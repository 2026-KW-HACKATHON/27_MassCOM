import type { Pool } from 'pg';

import { artUrlFor } from '../ai-art-rules.js';
import type {
  MerchantCatalog,
  PublicCampaign,
  PublicMerchant,
  PublicRewardGoal,
} from '../merchant-catalog.js';
import { publicVisitorTags } from '../visitor-feedback-rules.js';
import { parsePurposeSummary, purposeSummarySql } from './campaign-purpose.js';

type MerchantCatalogRow = {
  merchant_id: string;
  merchant_name: string;
  merchant_story: string;
  road_address: string;
  minimum_spend_won: number;
  menu_items: PublicMerchant['menuItems'];
  business_hours: string;
  category: string | null;
  is_demo: boolean;
  art_sha256: string | null;
  visitor_tag_counts: unknown;
  campaign_id: string;
  campaign_title: string;
  starts_at: Date;
  ends_at: Date;
  enrollment_open: boolean;
  reward_goals: unknown;
  purpose: unknown;
};

// 공개 목록과 상세 미리보기·열람 집계가 같은 점포만 다루도록 조건을 공유한다.
export function publicCampaignPredicate(nowParameter: number): string {
  return `m.status = 'ACTIVE'
         AND c.status = 'ACTIVE'
         AND c.is_public = true
         AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials trial WHERE trial.merchant_id = m.id)
         AND c.starts_at <= $${nowParameter}
         AND c.ends_at > $${nowParameter}`;
}

export const publicCampaignGoalsHaving =
  'array_agg(g.target_visit_count ORDER BY g.target_visit_count) = ARRAY[1, 3, 5]::integer[]';

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
         m.category,
         m.is_demo,
         (SELECT art.sha256 FROM merchant_art art WHERE art.merchant_id = m.id) AS art_sha256,
         -- 가게 특징 태그별 표 수(Issue #334). 공개 기준(3표, 시연 1표)은 아래에서 코드로 적용한다. 피드백이 없어도 목록에는 나온다.
         (SELECT coalesce(jsonb_agg(jsonb_build_object('code', vote.code, 'count', vote.votes)), '[]'::jsonb)
          FROM (
            SELECT tag.code, count(*)::integer AS votes
            FROM merchant_visitor_feedback feedback, unnest(feedback.tags) AS tag(code)
            WHERE feedback.merchant_id = m.id
            GROUP BY tag.code
          ) vote) AS visitor_tag_counts,
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
         ) AS reward_goals,
         ${purposeSummarySql('c.id')} AS purpose
       FROM merchants m
       JOIN campaigns c ON c.merchant_id = m.id
       JOIN campaign_goals g ON g.campaign_id = c.id
       WHERE ${publicCampaignPredicate(1)}
       GROUP BY m.id, c.id
       HAVING ${publicCampaignGoalsHaving}
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
      category: row.category,
      campaign: {
        id: row.campaign_id,
        title: row.campaign_title,
        startsAt: row.starts_at.toISOString(),
        endsAt: row.ends_at.toISOString(),
        enrollmentStatus: row.enrollment_open ? 'OPEN' : 'FULL',
        rewardGoals: parseRewardGoals(row.reward_goals),
        ...purposeField(row.purpose),
      },
      demo: row.is_demo,
      artUrl: artUrlFor(row.art_sha256),
      visitorTags: publicVisitorTags(parseVisitorTagCounts(row.visitor_tag_counts), row.is_demo),
    }));
  }
}

function purposeField(value: unknown): Pick<PublicCampaign, 'purpose'> {
  const purpose = parsePurposeSummary(value);
  return purpose ? { purpose } : {};
}

function parseVisitorTagCounts(value: unknown): { code: string; count: number }[] {
  if (!Array.isArray(value)) {
    throw new Error('invalid visitor tag counts');
  }
  return value.map((entry) => {
    const code = entry && typeof entry === 'object' ? Reflect.get(entry, 'code') : undefined;
    const count = entry && typeof entry === 'object' ? Reflect.get(entry, 'count') : undefined;
    if (typeof code !== 'string' || typeof count !== 'number') {
      throw new Error('invalid visitor tag count');
    }
    return { code, count };
  });
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
