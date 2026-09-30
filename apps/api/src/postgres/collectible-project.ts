import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import {
  CollectibleProjectError, type CollectibleArtwork, type CollectibleDetail, type CollectibleProject, type CollectibleProjectService,
  type CollectibleCampaign, type CollectibleProjectSummary, type CollectibleProjectView, type CollectibleUnpublishResult,
} from '../collectible-project.js';
import { collectibleSnapshot, validateCollectibleProject } from '../collectible-project-rules.js';
import { MerchantAccessError } from '../merchant-access.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';

type ProjectRow = {
  id: string; merchant_id: string; version: number; status: 'DRAFT' | 'PUBLISHED'; project: CollectibleProject;
  publication_id: string | null; created_at: Date; updated_at: Date;
};
const columns = 'id, merchant_id, version, status, project, publication_id, created_at, updated_at';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type MerchantInput = { merchantId: string; accountId: string };
type ProjectInput = MerchantInput & { projectId: string };
type VersionInput = ProjectInput & { expectedVersion: number };

export class PostgresCollectibleProjectService implements CollectibleProjectService {
  constructor(private readonly pool: Pool, private readonly options: { staffMayManageArt?: boolean; accountLifecycle?: PostgresAccountLifecycle; now?: () => Date } = {}) {}

  async list(input: MerchantInput): Promise<readonly CollectibleProjectSummary[]> {
    return this.transaction(input, async client => {
      // Fetch only scalar metadata: a project list never loads or returns original media.
      const result = await client.query<Omit<ProjectRow, 'project'> & { name: string; distributing_campaign_id: string | null }>(
        `SELECT project.id, project.merchant_id, project.version, project.status, project.project->>'name' AS name, project.publication_id,
           project.created_at, project.updated_at, link.campaign_id AS distributing_campaign_id
         FROM collectible_projects project
         LEFT JOIN campaign_collectible_publications link ON link.publication_id = project.publication_id
         WHERE project.merchant_id = $1 AND project.project IS NOT NULL ORDER BY project.updated_at DESC, project.id DESC LIMIT 100`, [input.merchantId]);
      return result.rows.map(row => ({ ...mapMetadata(row), name: row.name, schemaVersion: 1, distributingCampaignId: row.distributing_campaign_id }));
    });
  }

  // 점주 웹 제작기의 게시 대상: 이 점포의 지금 게시할 수 있는(공개·ACTIVE·기간 안) 캠페인과 기존 목표, 현재 연결된 발행본.
  // publish가 받는 조건과 같다. 권한은 다른 수집품 경로처럼 거래 안에서 다시 확인한다.
  async listCampaigns(input: MerchantInput): Promise<readonly CollectibleCampaign[]> {
    return this.transaction(input, async client => {
      const result = await client.query<{ id: string; title: string; status: string; starts_at: Date; ends_at: Date; goals: number[];
        publication_id: string | null; project_id: string | null }>(
        `SELECT campaign.id, campaign.title, campaign.status, campaign.starts_at, campaign.ends_at,
           COALESCE((SELECT array_agg(goal.target_visit_count ORDER BY goal.target_visit_count) FROM campaign_goals goal
             WHERE goal.campaign_id = campaign.id), '{}') AS goals,
           link.publication_id, publication.project_id
         FROM campaigns campaign
         LEFT JOIN campaign_collectible_publications link ON link.campaign_id = campaign.id
         LEFT JOIN collectible_publications publication ON publication.id = link.publication_id
         WHERE campaign.merchant_id = $1 AND campaign.status = 'ACTIVE' AND campaign.is_public
           AND campaign.starts_at <= $2 AND campaign.ends_at > $2
         ORDER BY campaign.starts_at DESC, campaign.id`, [input.merchantId, this.now()]);
      return result.rows.map(row => ({
        id: row.id, title: row.title, status: 'ACTIVE' as const, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(),
        goals: row.goals.filter((goal): goal is 1 | 3 | 5 => goal === 1 || goal === 3 || goal === 5),
        publication: row.publication_id && row.project_id ? { publicationId: row.publication_id, projectId: row.project_id } : null,
      }));
    });
  }

  async create(input: MerchantInput & { project: unknown }): Promise<CollectibleProjectView> {
    return this.transaction(input, client => this.insert(client, input, validateCollectibleProject(input.project)));
  }

  async get(input: ProjectInput): Promise<CollectibleProjectView> {
    return this.transaction(input, async client => mapProject(await this.load(client, input)));
  }

  async save(input: VersionInput & { project: unknown }): Promise<CollectibleProjectView> {
    return this.transaction(input, async client => {
      const row = await this.load(client, input, true); checkVersion(row, input.expectedVersion);
      if (row.status === 'PUBLISHED') throw new CollectibleProjectError('COLLECTIBLE_PUBLISHED_IMMUTABLE');
      const project = validateCollectibleProject(input.project);
      const result = await client.query<ProjectRow>(
        `UPDATE collectible_projects SET project = $3::jsonb, version = version + 1, edited_by_account_id = $4, updated_at = $5
         WHERE id = $1 AND merchant_id = $2 RETURNING ${columns}`,
        [input.projectId, input.merchantId, JSON.stringify(project), input.accountId, this.now()]);
      await client.query(`INSERT INTO collectible_project_contributors (project_id,account_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [input.projectId,input.accountId]);
      return mapProject(result.rows[0]!);
    });
  }

  async publish(input: VersionInput & { campaignId: string }): Promise<{ project: CollectibleProjectView; publicationId: string; campaignId: string }> {
    return this.transaction(input, async client => {
      const row = await this.load(client, input, true); checkVersion(row, input.expectedVersion);
      if (row.status === 'PUBLISHED') throw new CollectibleProjectError('COLLECTIBLE_PUBLISHED_IMMUTABLE');
      // Validate, decode and strip every grade before the campaign lock: claims on this campaign wait only for the insert below.
      const project = validateCollectibleProject(row.project, true);
      const goals = await client.query<{ target_visit_count: number }>(
        `SELECT goal.target_visit_count FROM campaign_goals goal JOIN campaigns campaign ON campaign.id = goal.campaign_id
         WHERE goal.campaign_id = $1 AND campaign.merchant_id = $2`, [input.campaignId, input.merchantId]);
      if (Object.keys(project.rewardGrades).some(goal => !goals.rows.some(g => String(g.target_visit_count) === goal))) throw new CollectibleProjectError('COLLECTIBLE_CAMPAIGN_UNAVAILABLE');
      const publicationId = randomUUID();
      const grades: { gradeId: string; summary: CollectibleArtwork; detail: Omit<CollectibleDetail, keyof CollectibleArtwork> }[] = [];
      for (const gradeId of new Set(Object.values(project.rewardGrades))) {
        if (!gradeId) continue;
        const { projectId, publicationId: _publication, gradeId: _grade, gradeName, shape, theme, name, thumbnailDataUrl, ...detail } =
          collectibleSnapshot(project, row.id, publicationId, gradeId);
        grades.push({ gradeId, summary: { projectId, publicationId, gradeId, gradeName, shape, theme, name, thumbnailDataUrl }, detail });
      }
      // Claim capture holds FOR KEY SHARE on a linked campaign; this FOR UPDATE serializes the link replacement with it.
      const campaign = await client.query<{ id: string }>(
        `SELECT id FROM campaigns WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE' AND is_public
          AND starts_at <= $3 AND ends_at > $3 FOR UPDATE`, [input.campaignId, input.merchantId, this.now()]);
      if (!campaign.rows[0]) throw new CollectibleProjectError('COLLECTIBLE_CAMPAIGN_UNAVAILABLE');
      await client.query(
        `INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades, published_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [publicationId, row.id, input.merchantId, input.campaignId, row.version, JSON.stringify(project.rewardGrades), this.now()]);
      for (const grade of grades) {
        await client.query(
          `INSERT INTO collectible_publication_grades (publication_id, grade_id, summary, detail) VALUES ($1,$2,$3::jsonb,$4::jsonb)`,
          [publicationId, grade.gradeId, JSON.stringify(grade.summary), JSON.stringify(grade.detail)]);
      }
      await client.query(
        `INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1,$2)
         ON CONFLICT (campaign_id) DO UPDATE SET publication_id = EXCLUDED.publication_id`, [input.campaignId, publicationId]);
      const saved = await client.query<ProjectRow>(
        `UPDATE collectible_projects SET status = 'PUBLISHED', publication_id = $3, version = version + 1, edited_by_account_id = $4, updated_at = $5
         WHERE id = $1 AND merchant_id = $2 RETURNING ${columns}`, [row.id, input.merchantId, publicationId, input.accountId, this.now()]);
      return { project: mapProject(saved.rows[0]!), publicationId, campaignId: input.campaignId };
    });
  }

  // 게시 중지: 이 발행본의 캠페인 배포 연결만 끊는다. 이미 획득한 고객의 발행본은 그대로다.
  // 캠페인 FOR UPDATE는 보상권 트리거의 FOR KEY SHARE와 직렬화되어, 반환 뒤 새 획득이 이 발행본을 잡지 않는다.
  async unpublish(input: VersionInput): Promise<CollectibleUnpublishResult> {
    return this.transaction(input, async client => {
      const row = await this.load(client, input, true); checkVersion(row, input.expectedVersion);
      if (row.status !== 'PUBLISHED' || !row.publication_id) throw new CollectibleProjectError('COLLECTIBLE_NOT_PUBLISHED');
      const unlinkedCampaignId = await unlinkPublication(client, row.publication_id);
      return { projectId: row.id, publicationId: row.publication_id, unlinkedCampaignId };
    });
  }

  // 삭제: 초안은 행째 지우고, 게시 프로젝트는 배포 연결을 끊고 비공개 원본·작성자 식별자를 비운다(발행본 행은 불변이라 남는다).
  async remove(input: VersionInput): Promise<{ projectId: string; deleted: true; unlinkedCampaignId: string | null }> {
    return this.transaction(input, async client => {
      const row = await this.load(client, input, true); checkVersion(row, input.expectedVersion);
      let unlinkedCampaignId: string | null = null;
      if (row.status === 'DRAFT') {
        await client.query('DELETE FROM collectible_projects WHERE id = $1 AND merchant_id = $2', [row.id, input.merchantId]);
      } else {
        unlinkedCampaignId = await unlinkPublication(client, row.publication_id!);
        await client.query('DELETE FROM collectible_project_contributors WHERE project_id = $1', [row.id]);
        await client.query(
          `UPDATE collectible_projects SET project = NULL, created_by_account_id = NULL, edited_by_account_id = NULL, updated_at = $3
           WHERE id = $1 AND merchant_id = $2`, [row.id, input.merchantId, this.now()]);
      }
      return { projectId: row.id, deleted: true, unlinkedCampaignId };
    });
  }

  async copy(input: VersionInput): Promise<CollectibleProjectView> {
    return this.transaction(input, async client => {
      const row = await this.load(client, input, true); checkVersion(row, input.expectedVersion);
      const copied = await this.insert(client, input, validateCollectibleProject(row.project), row.id);
      await client.query(`INSERT INTO collectible_project_contributors (project_id,account_id)
        SELECT $1,account_id FROM collectible_project_contributors WHERE project_id=$2 ON CONFLICT DO NOTHING`,[copied.id,row.id]);
      return copied;
    });
  }

  async getAcquired(input: { accountId: string; entitlementId: string }): Promise<CollectibleDetail> {
    if (!uuid.test(input.entitlementId)) throw new CollectibleProjectError('COLLECTIBLE_NOT_FOUND');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await this.options.accountLifecycle?.assertActive(client, input.accountId);
      // The acquisition is a reference; the immutable publication grade row holds the version the customer acquired.
      const result = await client.query<{ summary: CollectibleArtwork; detail: Omit<CollectibleDetail, keyof CollectibleArtwork> }>(
        `SELECT grade.summary, grade.detail FROM collectible_acquisitions acquisition
         JOIN reward_entitlements entitlement ON entitlement.id = acquisition.entitlement_id
         JOIN collectible_publications publication ON publication.id = acquisition.publication_id
         JOIN collectible_publication_grades grade
           ON grade.publication_id = acquisition.publication_id AND grade.grade_id = acquisition.grade_id
         WHERE entitlement.id = $1 AND entitlement.customer_account_id = $2
           AND entitlement.status IN ('GRANTED','MINT_REQUESTED','FULFILLED') AND publication.media_removed_at IS NULL`,
        [input.entitlementId, input.accountId]);
      if (!result.rows[0]) throw new CollectibleProjectError('COLLECTIBLE_NOT_FOUND');
      await client.query('COMMIT'); return { ...result.rows[0].summary, ...result.rows[0].detail };
    } catch (error) { await client.query('ROLLBACK'); this.rethrow(error); } finally { client.release(); }
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }
  private async load(client: PoolClient, input: ProjectInput, lock = false): Promise<ProjectRow> {
    if (!uuid.test(input.projectId)) throw new CollectibleProjectError('COLLECTIBLE_PROJECT_NOT_FOUND');
    const result = await client.query<ProjectRow>(
      `SELECT ${columns} FROM collectible_projects WHERE id = $1 AND merchant_id = $2 AND project IS NOT NULL${lock ? ' FOR UPDATE' : ''}`, [input.projectId, input.merchantId]);
    if (!result.rows[0]) throw new CollectibleProjectError('COLLECTIBLE_PROJECT_NOT_FOUND'); return result.rows[0];
  }
  // A copy inherits the source's lineage id (the first project of the chain), so operator media removal can find every copy
  // even after a draft in the middle was deleted or a source was cleared.
  private async insert(client: PoolClient, input: MerchantInput, project: CollectibleProject, copiedFrom?: string): Promise<CollectibleProjectView> {
    // Serialize creation per store so the limit cannot be bypassed by parallel copies.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`collectible-projects:${input.merchantId}`]);
    const count = await client.query<{ count: string }>('SELECT count(*)::text FROM collectible_projects WHERE merchant_id = $1 AND project IS NOT NULL', [input.merchantId]);
    if (Number(count.rows[0]!.count) >= 100) throw new CollectibleProjectError('COLLECTIBLE_PROJECT_LIMIT');
    const result = await client.query<ProjectRow>(
      `INSERT INTO collectible_projects (id, merchant_id, created_by_account_id, edited_by_account_id, project, created_at, updated_at, lineage_id)
       VALUES ($1,$2,$3,$3,$4::jsonb,$5,$5,COALESCE((SELECT lineage_id FROM collectible_projects WHERE id = $6 AND merchant_id = $2), $1))
       RETURNING ${columns}`, [randomUUID(), input.merchantId, input.accountId, JSON.stringify(project), this.now(), copiedFrom ?? null]);
    await client.query(`INSERT INTO collectible_project_contributors (project_id,account_id) VALUES ($1,$2)`,[result.rows[0]!.id,input.accountId]);
    return mapProject(result.rows[0]!);
  }
  private async transaction<T>(input: MerchantInput, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await this.options.accountLifecycle?.assertActive(client, input.accountId);
      // Deletion takes this same store lock before starting its source UPDATE. A copied source cannot appear after
      // that UPDATE's MVCC snapshot and survive the deletion of an inherited contributor.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`collectible-sources:${input.merchantId}`]);
      // This check happens on every operation, within the mutation transaction. Hide/revoke must wait for these row locks.
      const merchant = await client.query(`SELECT 1 FROM merchants WHERE id = $1 AND status = 'ACTIVE' FOR SHARE`, [input.merchantId]);
      if(!merchant.rowCount) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      // Match the revoke/hide transaction's merchant-before-member lock order.
      const access = await client.query<{ role: string }>(
        `SELECT role FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 AND status = 'ACTIVE' FOR SHARE`, [input.merchantId, input.accountId]);
      if (!access.rows[0] || (access.rows[0].role !== 'OWNER' && !this.options.staffMayManageArt)) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
      const result = await work(client); await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); this.rethrow(error); } finally { client.release(); }
  }
  private rethrow(error: unknown): never {
    if (error instanceof AccountLifecycleError) throw new CollectibleProjectError(error.code); throw error;
  }
}

async function unlinkPublication(client: PoolClient, publicationId: string): Promise<string | null> {
  const link = await client.query<{ campaign_id: string }>(
    'SELECT campaign_id FROM campaign_collectible_publications WHERE publication_id = $1', [publicationId]);
  const campaignId = link.rows[0]?.campaign_id;
  if (!campaignId) return null;
  await client.query('SELECT 1 FROM campaigns WHERE id = $1 FOR UPDATE', [campaignId]);
  const removed = await client.query(
    'DELETE FROM campaign_collectible_publications WHERE campaign_id = $1 AND publication_id = $2', [campaignId, publicationId]);
  return removed.rowCount ? campaignId : null;
}
function checkVersion(row: ProjectRow, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 1) throw new CollectibleProjectError('COLLECTIBLE_INVALID_PROJECT');
  if (row.version !== expected) throw new CollectibleProjectError('COLLECTIBLE_VERSION_CONFLICT');
}
function mapMetadata(row: Omit<ProjectRow,'project'>): Omit<CollectibleProjectView,'project'> {
  return { id: row.id, merchantId: row.merchant_id, version: row.version, status: row.status, publicationId: row.publication_id,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function mapProject(row: ProjectRow): CollectibleProjectView { return { ...mapMetadata(row), project: row.project }; }
