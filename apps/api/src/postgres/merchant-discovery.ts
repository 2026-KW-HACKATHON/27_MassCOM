import type { Pool } from 'pg';

import {
  MerchantDiscoveryError,
  type CollectiblePreview,
  type CollectiblePreviewService,
  type DetailViewSource,
  type MerchantDetailViewService,
} from '../merchant-discovery.js';
import { publicCampaignGoalsHaving, publicCampaignPredicate } from './merchant-catalog.js';

type PreviewRow = {
  merchant_id: string;
  campaign_id: string;
  publication_id: string | null;
  name: string;
  goals: CollectiblePreview['goals'];
};

export class PostgresCollectiblePreviewService implements CollectiblePreviewService {
  constructor(private readonly pool: Pool, private readonly now: () => Date = () => new Date()) {}

  async preview(merchantId: string): Promise<CollectiblePreview> {
    const result = await this.pool.query<PreviewRow>(
      `SELECT m.id AS merchant_id, c.id AS campaign_id,
         CASE WHEN publication.media_removed_at IS NULL AND count(grade.grade_id) > 0
           THEN publication.id::text ELSE NULL END AS publication_id,
         coalesce(min(grade.summary->>'name'),
           (SELECT min(named_grade.summary->>'name') FROM collectible_publication_grades named_grade
            WHERE named_grade.publication_id = publication.id),
           min(project.name), '') AS name,
         coalesce(jsonb_agg(jsonb_build_object(
           'visitCount', g.target_visit_count,
           'gradeId', grade.grade_id,
           'gradeName', grade.summary->>'gradeName',
           'shape', grade.summary->>'shape',
           'theme', coalesce(grade.summary->'theme'->>'name', grade.summary->>'theme'),
           'thumbnailDataUrl', CASE WHEN publication.media_removed_at IS NULL
             THEN grade.summary->'thumbnailDataUrl' ELSE NULL END
         ) ORDER BY g.target_visit_count) FILTER (WHERE grade.grade_id IS NOT NULL), '[]'::jsonb) AS goals
       FROM merchants m
       JOIN campaigns c ON c.merchant_id = m.id
       JOIN campaign_goals g ON g.campaign_id = c.id
       JOIN campaign_collectible_publications link ON link.campaign_id = c.id
       JOIN collectible_publications publication ON publication.id = link.publication_id
       LEFT JOIN collectible_projects project ON project.id = publication.project_id
       LEFT JOIN collectible_publication_grades grade
         ON grade.publication_id = publication.id
         AND grade.grade_id = publication.reward_grades->>g.target_visit_count::text
       WHERE m.id = $1 AND ${publicCampaignPredicate(2)}
       GROUP BY m.id, c.id, publication.id
       HAVING ${publicCampaignGoalsHaving}`,
      [merchantId, this.now()],
    );
    const row = result.rows[0];
    if (!row) throw new MerchantDiscoveryError('COLLECTIBLE_PREVIEW_NOT_FOUND');
    return { merchantId: row.merchant_id, campaignId: row.campaign_id,
      ...(row.publication_id ? { publicationId: row.publication_id } : {}), name: row.name, goals: row.goals };
  }
}

export class PostgresMerchantDetailViewService implements MerchantDetailViewService {
  constructor(private readonly pool: Pool, private readonly now: () => Date = () => new Date()) {}

  async record(merchantId: string, source: DetailViewSource): Promise<void> {
    const result = await this.pool.query(
      `INSERT INTO merchant_detail_view_counts (merchant_id, business_date, source, views)
       SELECT m.id, ($2::timestamptz AT TIME ZONE 'Asia/Seoul')::date, $3, 1
       FROM merchants m
       JOIN campaigns c ON c.merchant_id = m.id
       JOIN campaign_goals g ON g.campaign_id = c.id
       WHERE m.id = $1 AND ${publicCampaignPredicate(2)}
       GROUP BY m.id, c.id
       HAVING ${publicCampaignGoalsHaving}
       ON CONFLICT (merchant_id, business_date, source)
       DO UPDATE SET views = merchant_detail_view_counts.views + 1
       RETURNING merchant_id`,
      [merchantId, this.now(), source],
    );
    if (!result.rowCount) throw new MerchantDiscoveryError('MERCHANT_NOT_FOUND');
  }
}
