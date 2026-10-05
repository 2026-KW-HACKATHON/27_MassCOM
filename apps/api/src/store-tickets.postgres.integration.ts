import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';

import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresCollectionReader } from './postgres/collection.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresStoreTicketService } from './postgres/store-tickets.js';

test('store tickets are owned valid entitlements: concurrent ACK is idempotent, cancellation and deletion revoke access', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !new URL(connectionString).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE merchants, store_ticket_openings, account_deletion_requests CASCADE');
  const secret = 'store-ticket-test-only-secret-at-least-32-bytes';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const reader = new PostgresCollectionReader(pool);
  const service = new PostgresStoreTicketService(pool, reader, lifecycle);
  await pool.query(`INSERT INTO merchants (id,name,story,road_address,minimum_spend_won,status,is_demo)
    VALUES ('ticket-shop','가게권 시험','시험','시험 주소',0,'ACTIVE',true)`);
  await pool.query(`INSERT INTO merchant_members (merchant_id,account_id,role,status)
    VALUES ('ticket-shop','staff','STAFF','ACTIVE')`);
  await pool.query(`INSERT INTO campaigns (id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES ('ticket-campaign','ticket-shop','방문 시험','2026-01-01','2027-01-01','ACTIVE',true,100)`);
  await pool.query(`INSERT INTO campaign_goals (campaign_id,target_visit_count,display_name)
    VALUES ('ticket-campaign',1,'첫 방문'),('ticket-campaign',3,'세 번 방문'),('ticket-campaign',5,'다섯 번 방문')`);
  const slot = randomUUID();
  const visit = randomUUID();
  await pool.query(`INSERT INTO claim_slots
    (id,merchant_id,customer_account_id,merchant_reference_hash,created_by_account_id,token_hash,status,
     expires_at,claimed_at,created_at)
    VALUES ($1,'ticket-shop','ticket-owner',$2,'staff',$3,'CLAIMED',
    '2026-10-01T03:15:00Z','2026-10-01T03:00:00Z','2026-10-01T02:55:00Z')`,
  [slot, randomBytes(32), randomBytes(32)]);
  await pool.query(`INSERT INTO visit_events (id,claim_slot_id,merchant_id,campaign_id,customer_account_id,
    occurred_at,business_date,verification_level,status,progress_counted)
    VALUES ($1,$2,'ticket-shop','ticket-campaign','ticket-owner','2026-10-01T03:00:00Z','2026-10-01',
    'MERCHANT_CONFIRMED','VALID',true)`, [visit, slot]);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [index, goal] of [1, 3, 5].entries()) {
    await pool.query(`INSERT INTO reward_entitlements
      (id,customer_account_id,campaign_id,target_visit_count,source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
      VALUES ($1,'ticket-owner','ticket-campaign',$2,$3,$4,'test','2026-10-01','2027-01-01')`,
    [ids[index], goal, visit, index === 2 ? 'CANCELED' : 'GRANTED']);
  }
  const original = await reader.getCollection('ticket-owner');
  assert.equal(original.collectibles.length, 2);
  assert.deepEqual((await service.list('ticket-owner')).tickets, original.collectibles);
  assert.deepEqual((await service.list('stranger')).tickets, []);
  await assert.rejects(service.open({ accountId: 'stranger', entitlementId: ids[0]! }), { code: 'STORE_TICKET_NOT_FOUND' });
  await assert.rejects(service.open({ accountId: 'ticket-owner', entitlementId: ids[2]! }), { code: 'STORE_TICKET_NOT_FOUND' });
  await assert.rejects(service.open({ accountId: 'ticket-owner', entitlementId: '../../x' }), { code: 'INVALID_REQUEST' });
  const opened = await Promise.all(Array.from({ length: 8 }, () => service.open({ accountId: 'ticket-owner', entitlementId: ids[0]! })));
  assert.equal(opened.filter(result => !result.replayed).length, 1);
  assert.equal((await pool.query('SELECT * FROM store_ticket_openings')).rowCount, 1);
  assert.equal((await service.list('ticket-owner')).tickets.length, 1);
  assert.deepEqual(await reader.getCollection('ticket-owner'), original, 'ACK never changes the collectible or mint state');
  const restored = new PostgresStoreTicketService(pool, reader, lifecycle);
  assert.equal((await restored.list('ticket-owner')).tickets.length, 1, 'a new client retains opened state');
  await pool.query(`UPDATE reward_entitlements SET status='CANCELED' WHERE id=$1`, [ids[0]]);
  await assert.rejects(restored.open({ accountId: 'ticket-owner', entitlementId: ids[0]! }), { code: 'STORE_TICKET_NOT_FOUND' });
  const deletion = new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test', accountLifecycle: lifecycle });
  await deletion.requestDeletion({ accountId: 'ticket-owner', confirmation: 'DELETE MY ACCOUNT' });
  assert.equal((await pool.query('SELECT * FROM store_ticket_openings')).rowCount, 0);
  await assert.rejects(restored.list('ticket-owner'), { code: 'ACCOUNT_DELETED' });
  await assert.rejects(restored.open({ accountId: 'ticket-owner', entitlementId: ids[1]! }), { code: 'ACCOUNT_DELETED' });
});
