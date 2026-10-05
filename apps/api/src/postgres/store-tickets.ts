import type { Pool, PoolClient } from 'pg';

import type { CollectionReader } from '../collection.js';
import { StoreTicketError, type StoreTicketService } from '../store-tickets.js';
import type { PostgresAccountLifecycle } from './account-lifecycle.js';

export class PostgresStoreTicketService implements StoreTicketService {
  constructor(
    private readonly pool: Pool,
    private readonly collection: CollectionReader,
    private readonly accountLifecycle: PostgresAccountLifecycle,
  ) {}

  async list(accountId: string) {
    // CollectionReader도 pool을 사용하므로 lifecycle 트랜잭션 안에서 다른 연결을 기다리지 않는다.
    const snapshot = await this.collection.getCollection(accountId);
    return this.transaction(accountId, async (client) => {
      const unopened = await client.query<{ id: string }>(
        `SELECT entitlement.id FROM reward_entitlements AS entitlement
         WHERE entitlement.customer_account_id = $1
           AND entitlement.status IN ('GRANTED', 'MINT_REQUESTED', 'FULFILLED')
           AND NOT EXISTS (
             SELECT 1 FROM store_ticket_openings AS opened
             WHERE opened.account_id = $1 AND opened.entitlement_id = entitlement.id
           )`, [accountId],
      );
      const ids = new Set(unopened.rows.map((row) => row.id));
      return { tickets: snapshot.collectibles.filter((item) => ids.has(item.entitlementId)) };
    });
  }

  async open({ accountId, entitlementId }: { accountId: string; entitlementId: string }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entitlementId)) {
      throw new StoreTicketError('INVALID_REQUEST');
    }
    return this.transaction(accountId, async (client) => {
      // 유효성과 소유권을 개봉 ACK 때 다시 확인한다. 취소와 경합하면 이 행 잠금으로 직렬화한다.
      const valid = await client.query(
        `SELECT id FROM reward_entitlements
         WHERE id = $1 AND customer_account_id = $2
           AND status IN ('GRANTED', 'MINT_REQUESTED', 'FULFILLED') FOR UPDATE`,
        [entitlementId, accountId],
      );
      if (!valid.rowCount) throw new StoreTicketError('STORE_TICKET_NOT_FOUND');
      const inserted = await client.query(
        `INSERT INTO store_ticket_openings (account_id, entitlement_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING entitlement_id`, [accountId, entitlementId],
      );
      return { opened: true as const, replayed: inserted.rowCount === 0 };
    });
  }

  private async transaction<T>(accountId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.assertActive(client, accountId);
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
