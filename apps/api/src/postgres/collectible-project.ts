import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import {
  CollectibleProjectError, type CollectibleDetail, type CollectibleProject, type CollectibleProjectService,
  type CollectibleProjectSummary, type CollectibleProjectView,
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
      const result = await client.query<Omit<ProjectRow, 'project'> & { name: string }>(
        `SELECT id, merchant_id, version, status, project->>'name' AS name, publication_id, created_at, updated_at
         FROM collectible_projects WHERE merchant_id = $1 AND project IS NOT NULL ORDER BY updated_at DESC, id DESC LIMIT 100`, [input.merchantId]);
      return result.rows.map(row => ({ ...mapMetadata(row), name: row.name, schemaVersion: 1 }));
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
      // Claim capture and publication replacement use the same campaign row lock; this also rejects another store's campaign.
      const campaign = await client.query<{ id: string }>(
        `SELECT id FROM campaigns WHERE id = $1 AND merchant_id = $2 AND status = 'ACTIVE' AND is_public
          AND starts_at <= $3 AND ends_at > $3 FOR UPDATE`, [input.campaignId, input.merchantId, this.now()]);
      if (!campaign.rows[0]) throw new CollectibleProjectError('COLLECTIBLE_CAMPAIGN_UNAVAILABLE');
      const row = await this.load(client, input, true); checkVersion(row, input.expectedVersion);
      if (row.status === 'PUBLISHED') throw new CollectibleProjectError('COLLECTIBLE_PUBLISHED_IMMUTABLE');
      const project = validateCollectibleProject(row.project, true);
      const goals = await client.query<{ target_visit_count: number }>('SELECT target_visit_count FROM campaign_goals WHERE campaign_id = $1', [input.campaignId]);
      if (Object.keys(project.rewardGrades).some(goal => !goals.rows.some(g => String(g.target_visit_count) === goal))) throw new CollectibleProjectError('COLLECTIBLE_CAMPAIGN_UNAVAILABLE');
      const publicationId = randomUUID();
      const snapshots: Record<string, CollectibleDetail> = Object.create(null) as Record<string, CollectibleDetail>;
      for (const gradeId of new Set(Object.values(project.rewardGrades))) {
        if (gradeId) snapshots[gradeId] = collectibleSnapshot(project, row.id, publicationId, gradeId);
      }
      await client.query(
        `INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, snapshots, reward_grades, published_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
        [publicationId, row.id, input.merchantId, input.campaignId, row.version, JSON.stringify(snapshots), JSON.stringify(project.rewardGrades), this.now()]);
      await client.query(
        `INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ($1,$2)
         ON CONFLICT (campaign_id) DO UPDATE SET publication_id = EXCLUDED.publication_id`, [input.campaignId, publicationId]);
      const saved = await client.query<ProjectRow>(
        `UPDATE collectible_projects SET status = 'PUBLISHED', publication_id = $3, version = version + 1, edited_by_account_id = $4, updated_at = $5
         WHERE id = $1 AND merchant_id = $2 RETURNING ${columns}`, [row.id, input.merchantId, publicationId, input.accountId, this.now()]);
      return { project: mapProject(saved.rows[0]!), publicationId, campaignId: input.campaignId };
    });
  }

  async copy(input: VersionInput): Promise<CollectibleProjectView> {
    return this.transaction(input, async client => {
      const row = await this.load(client, input, true); checkVersion(row, input.expectedVersion);
      const copied = await this.insert(client, input, validateCollectibleProject(row.project));
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
      const result = await client.query<{ snapshot: CollectibleDetail }>(
        `SELECT acquisition.snapshot FROM collectible_acquisitions acquisition
         JOIN reward_entitlements entitlement ON entitlement.id = acquisition.entitlement_id
         WHERE entitlement.id = $1 AND entitlement.customer_account_id = $2
           AND entitlement.status IN ('GRANTED','MINT_REQUESTED','FULFILLED')`, [input.entitlementId, input.accountId]);
      if (!result.rows[0]) throw new CollectibleProjectError('COLLECTIBLE_NOT_FOUND');
      await client.query('COMMIT'); return result.rows[0].snapshot;
    } catch (error) { await client.query('ROLLBACK'); this.rethrow(error); } finally { client.release(); }
  }

  private now(): Date { return this.options.now?.() ?? new Date(); }
  private async load(client: PoolClient, input: ProjectInput, lock = false): Promise<ProjectRow> {
    if (!uuid.test(input.projectId)) throw new CollectibleProjectError('COLLECTIBLE_PROJECT_NOT_FOUND');
    const result = await client.query<ProjectRow>(
      `SELECT ${columns} FROM collectible_projects WHERE id = $1 AND merchant_id = $2 AND project IS NOT NULL${lock ? ' FOR UPDATE' : ''}`, [input.projectId, input.merchantId]);
    if (!result.rows[0]) throw new CollectibleProjectError('COLLECTIBLE_PROJECT_NOT_FOUND'); return result.rows[0];
  }
  private async insert(client: PoolClient, input: MerchantInput, project: CollectibleProject): Promise<CollectibleProjectView> {
    // Serialize creation per store so the limit cannot be bypassed by parallel copies.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`collectible-projects:${input.merchantId}`]);
    const count = await client.query<{ count: string }>('SELECT count(*)::text FROM collectible_projects WHERE merchant_id = $1 AND project IS NOT NULL', [input.merchantId]);
    if (Number(count.rows[0]!.count) >= 100) throw new CollectibleProjectError('COLLECTIBLE_PROJECT_LIMIT');
    const result = await client.query<ProjectRow>(
      `INSERT INTO collectible_projects (id, merchant_id, created_by_account_id, edited_by_account_id, project, created_at, updated_at)
       VALUES ($1,$2,$3,$3,$4::jsonb,$5,$5) RETURNING ${columns}`, [randomUUID(), input.merchantId, input.accountId, JSON.stringify(project), this.now()]);
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

function checkVersion(row: ProjectRow, expected: number): void {
  if (!Number.isSafeInteger(expected) || expected < 1) throw new CollectibleProjectError('COLLECTIBLE_INVALID_PROJECT');
  if (row.version !== expected) throw new CollectibleProjectError('COLLECTIBLE_VERSION_CONFLICT');
}
function mapMetadata(row: Omit<ProjectRow,'project'>): Omit<CollectibleProjectView,'project'> {
  return { id: row.id, merchantId: row.merchant_id, version: row.version, status: row.status, publicationId: row.publication_id,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function mapProject(row: ProjectRow): CollectibleProjectView { return { ...mapMetadata(row), project: row.project }; }
