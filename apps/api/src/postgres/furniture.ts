import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { FurnitureError, type FurnitureCatalogItem, type FurnitureInventoryItem, type FurnitureService } from '../furniture.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { earnedAndSpent } from './mileage-shop.js';

type CatalogRow = { id: string; name: string; kind: FurnitureCatalogItem['kind']; asset_id: string | null;
  price_mileage: number | null; available: boolean };
type InventoryRow = { id: string; item_id: string };
const validRequest = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 100;

export class PostgresFurnitureService implements FurnitureService {
  constructor(private readonly pool: Pool, private readonly lifecycle: PostgresAccountLifecycle,
    private readonly options: { showcaseBonusMileage?: number } = {}) {}

  async get(accountId: string) {
    return this.transaction(async client => {
      await this.lifecycle.assertActive(client, accountId);
      const catalog = (await client.query<CatalogRow>('SELECT * FROM furniture_catalog ORDER BY kind,name,id')).rows
        .map(item => ({ id: item.id, name: item.name, kind: item.kind, assetId: item.asset_id,
          priceMileage: item.price_mileage, sellable: item.available && item.price_mileage !== null }));
      const inventory = (await client.query<InventoryRow>(`SELECT id,item_id FROM furniture_inventory
        WHERE account_id=$1 ORDER BY acquired_at,id`, [accountId])).rows.map(item => ({ id: item.id, itemId: item.item_id }));
      return { catalog, inventory };
    });
  }

  async purchase(input: { accountId: string; itemId: string; requestId: string }) {
    if (!validRequest(input.itemId) || !validRequest(input.requestId)) throw new FurnitureError('FURNITURE_INVALID');
    return this.transaction(async client => {
      await this.lifecycle.assertActive(client, input.accountId); // The account row lock serializes all mileage spends.
      const existing = (await client.query<{ item_id: string; inventory_id: string; price_mileage: number }>(`
        SELECT item_id,inventory_id,price_mileage FROM furniture_purchases WHERE account_id=$1 AND request_id=$2`,
      [input.accountId,input.requestId])).rows[0];
      const balance = async () => {
        const { earned, spent } = await earnedAndSpent(client, input.accountId);
        return earned + (this.options.showcaseBonusMileage ?? 0) - spent;
      };
      if (existing) {
        if (existing.item_id !== input.itemId) throw new FurnitureError('FURNITURE_REQUEST_CONFLICT');
        return { inventoryItem: { id: existing.inventory_id, itemId: existing.item_id }, balance: await balance(), replayed: true };
      }
      const item = (await client.query<CatalogRow>(`SELECT * FROM furniture_catalog WHERE id=$1 FOR SHARE`, [input.itemId])).rows[0];
      if (!item || !item.available || item.price_mileage === null) throw new FurnitureError('FURNITURE_UNAVAILABLE');
      const current = await balance();
      if (current < item.price_mileage) throw new FurnitureError('FURNITURE_INSUFFICIENT_MILEAGE');
      const inventoryItem: FurnitureInventoryItem = { id: randomUUID(), itemId: item.id };
      await client.query(`INSERT INTO furniture_inventory(id,account_id,item_id) VALUES($1,$2,$3)`,
      [inventoryItem.id,input.accountId,item.id]);
      await client.query(`INSERT INTO furniture_purchases(account_id,request_id,item_id,inventory_id,price_mileage)
        VALUES($1,$2,$3,$4,$5)`, [input.accountId,input.requestId,item.id,inventoryItem.id,item.price_mileage]);
      return { inventoryItem, balance: current - item.price_mileage, replayed: false };
    });
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new FurnitureError(error.code);
      throw error;
    } finally { client.release(); }
  }
}
