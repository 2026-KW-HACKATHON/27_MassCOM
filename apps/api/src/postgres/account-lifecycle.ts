import { createHmac } from 'node:crypto';

import type { PoolClient } from 'pg';

export class AccountLifecycleError extends Error {
  constructor(readonly code: 'ACCOUNT_DELETED') {
    super(code);
    this.name = 'AccountLifecycleError';
  }
}

export class PostgresAccountLifecycle {
  constructor(private readonly options: { hmacSecret: string }) {
    if (Buffer.byteLength(options.hmacSecret) < 32) {
      throw new Error('account lifecycle HMAC secret must be at least 32 bytes');
    }
  }

  referenceHash(accountId: string): Buffer {
    return createHmac('sha256', this.options.hmacSecret).update(accountId).digest();
  }

  async lockForDeletion(client: PoolClient, accountId: string): Promise<Buffer> {
    const referenceHash = this.referenceHash(accountId);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      referenceHash.toString('hex'),
    ]);
    return referenceHash;
  }

  async assertActive(client: PoolClient, accountId: string): Promise<void> {
    const referenceHash = await this.lockForDeletion(client, accountId);
    const deleted = await client.query(
      `SELECT 1
       FROM account_deletion_requests
       WHERE account_reference_hash = $1`,
      [referenceHash],
    );
    if (deleted.rowCount === 1) throw new AccountLifecycleError('ACCOUNT_DELETED');
  }
}
