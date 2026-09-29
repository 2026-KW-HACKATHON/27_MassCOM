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
    await this.assertAllActive(client, [accountId]);
  }

  async assertAllActive(client: PoolClient, accountIds: readonly string[]): Promise<void> {
    for (const reference of this.sortedReferences(accountIds)) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        reference.lockKey,
      ]);
      const deleted = await client.query(
        `SELECT 1
         FROM account_deletion_requests
         WHERE account_reference_hash = $1`,
        [reference.referenceHash],
      );
      if (deleted.rowCount === 1) throw new AccountLifecycleError('ACCOUNT_DELETED');
    }
  }

  /**
   * Takes the advisory locks of several accounts in the one global (sorted) order, without checking any of them.
   * A caller that will later lock the same accounts one at a time (the operator's, then the target's) must call this
   * first, or two operators acting on each other's filings can each hold one lock and wait for the other's.
   */
  async lockAllForDeletion(client: PoolClient, accountIds: readonly string[]): Promise<void> {
    for (const reference of this.sortedReferences(accountIds)) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [reference.lockKey]);
    }
  }

  private sortedReferences(accountIds: readonly string[]): { referenceHash: Buffer; lockKey: string }[] {
    return [...new Set(accountIds)]
      .map((accountId) => {
        const referenceHash = this.referenceHash(accountId);
        return { referenceHash, lockKey: referenceHash.toString('hex') };
      })
      .sort((left, right) => left.lockKey.localeCompare(right.lockKey));
  }
}
