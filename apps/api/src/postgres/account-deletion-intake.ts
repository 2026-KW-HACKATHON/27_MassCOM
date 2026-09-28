import type { Pool } from 'pg';

import type { AccountDeletionIntakeService } from '../account-deletion-intake.js';
import { WebSessionError } from '../web-session.js';
import { AccountLifecycleError, PostgresAccountLifecycle } from './account-lifecycle.js';

export class PostgresAccountDeletionIntakeService implements AccountDeletionIntakeService {
  private readonly lifecycle: PostgresAccountLifecycle;

  constructor(private readonly pool: Pool, hmacSecret: string) {
    this.lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  }

  async request(accountId: string): Promise<{ status: 'REQUESTED' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lifecycle.assertActive(client, accountId);
      const identity = await client.query(
        `SELECT 1 FROM auth_identities WHERE provider = 'google' AND account_id = $1`,
        [accountId],
      );
      if (identity.rowCount !== 1) throw new WebSessionError('WEB_SESSION_INVALID');
      await client.query(
        `INSERT INTO account_deletion_intake_requests (account_id) VALUES ($1)
         ON CONFLICT (account_id) DO NOTHING`,
        [accountId],
      );
      await client.query('COMMIT');
      return { status: 'REQUESTED' };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new WebSessionError('WEB_SESSION_INVALID');
      throw error;
    } finally {
      client.release();
    }
  }
}
