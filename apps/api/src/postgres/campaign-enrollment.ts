import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  CampaignEnrollmentError,
  type CampaignEnrollmentResult,
  type CampaignEnrollmentService,
} from '../campaign-enrollment.js';
import {
  AccountLifecycleError,
  type PostgresAccountLifecycle,
} from './account-lifecycle.js';

type ServiceOptions = {
  now: () => Date;
  nextId: () => string;
};

type ServiceOverrides = Partial<ServiceOptions> & {
  accountLifecycle?: PostgresAccountLifecycle;
};

type EnrollmentRow = {
  id: string;
  campaign_id: string;
  account_id: string;
  enrolled_at: Date;
};

type CampaignStateRow = {
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';
  is_public: boolean;
  starts_at: Date;
  ends_at: Date;
  enrollment_capacity: number;
  enrolled_count: number;
};

const defaultOptions: ServiceOptions = {
  now: () => new Date(),
  nextId: () => randomUUID(),
};

export class PostgresCampaignEnrollmentService implements CampaignEnrollmentService {
  private readonly options: ServiceOptions;
  private readonly accountLifecycle: PostgresAccountLifecycle | undefined;

  constructor(
    private readonly pool: Pool,
    options: ServiceOverrides = {},
  ) {
    this.options = { ...defaultOptions, ...options };
    this.accountLifecycle = options.accountLifecycle;
  }

  async enroll(input: {
    campaignId: string;
    accountId: string;
  }): Promise<CampaignEnrollmentResult> {
    const now = this.options.now();
    const client = await this.pool.connect();
    let transactionActive = false;
    try {
      await client.query('BEGIN');
      transactionActive = true;
      await this.accountLifecycle?.assertActive(client, input.accountId);

      const existing = await findEnrollment(client, input.campaignId, input.accountId);
      if (existing) {
        await client.query('COMMIT');
        transactionActive = false;
        return enrollmentResult(existing, false);
      }

      const reserved = await client.query<{ id: string }>(
        `UPDATE campaigns
         SET enrolled_count = enrolled_count + 1
         WHERE id = $1
           AND enrolled_count < enrollment_capacity
           AND status = 'ACTIVE'
           AND is_public
           AND starts_at <= $2
           AND ends_at >= $2
         RETURNING id`,
        [input.campaignId, now],
      );

      if (reserved.rowCount !== 1) {
        // A concurrent request from the same account may have taken the last seat while this one
        // waited on the campaign row; that account is enrolled, not turned away.
        const concurrent = await findEnrollment(client, input.campaignId, input.accountId);
        if (concurrent) {
          await client.query('COMMIT');
          transactionActive = false;
          return enrollmentResult(concurrent, false);
        }
        const state = await client.query<CampaignStateRow>(
          `SELECT status, is_public, starts_at, ends_at, enrollment_capacity, enrolled_count
           FROM campaigns
           WHERE id = $1`,
          [input.campaignId],
        );
        const campaign = state.rows[0];
        await client.query('ROLLBACK');
        transactionActive = false;
        if (!campaign || !campaign.is_public) {
          throw new CampaignEnrollmentError('CAMPAIGN_NOT_FOUND');
        }
        if (
          campaign.status !== 'ACTIVE' ||
          campaign.starts_at.getTime() > now.getTime() ||
          campaign.ends_at.getTime() < now.getTime()
        ) {
          throw new CampaignEnrollmentError('CAMPAIGN_NOT_AVAILABLE');
        }
        throw new CampaignEnrollmentError('CAMPAIGN_FULL');
      }

      const enrollmentId = this.options.nextId();
      const inserted = await client.query<EnrollmentRow>(
        `INSERT INTO campaign_enrollments (id, campaign_id, account_id, enrolled_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, campaign_id, account_id, enrolled_at`,
        [enrollmentId, input.campaignId, input.accountId, now],
      );
      await client.query('COMMIT');
      transactionActive = false;
      return enrollmentResult(inserted.rows[0]!, true);
    } catch (error) {
      if (transactionActive) {
        await client.query('ROLLBACK');
        transactionActive = false;
      }
      if (error instanceof AccountLifecycleError) {
        throw new CampaignEnrollmentError('ACCOUNT_DELETED');
      }
      if (isPostgresConstraint(error, 'campaign_enrollments_unique_account')) {
        const existing = await findEnrollment(client, input.campaignId, input.accountId);
        if (existing) {
          return enrollmentResult(existing, false);
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

async function findEnrollment(
  client: PoolClient | Pool,
  campaignId: string,
  accountId: string,
): Promise<EnrollmentRow | undefined> {
  return (
    await client.query<EnrollmentRow>(
      `SELECT id, campaign_id, account_id, enrolled_at
       FROM campaign_enrollments
       WHERE campaign_id = $1 AND account_id = $2`,
      [campaignId, accountId],
    )
  ).rows[0];
}

function enrollmentResult(row: EnrollmentRow, created: boolean): CampaignEnrollmentResult {
  return {
    enrollmentId: row.id,
    campaignId: row.campaign_id,
    accountId: row.account_id,
    enrolledAt: row.enrolled_at.toISOString(),
    created,
  };
}

function isPostgresConstraint(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === constraint
  );
}
