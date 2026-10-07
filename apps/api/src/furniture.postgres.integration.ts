import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from './account-consent.js';
import { FurnitureError } from './furniture.js';
import { PlayError } from './play.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresFurnitureService } from './postgres/furniture.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresPlayService } from './postgres/play.js';
import { PostgresRoomCommunityService } from './postgres/room-community.js';

test('furniture purchase replays once and studio accepts only owned placement with revision', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test'))
    throw new Error('TEST_DATABASE_URL must name a dedicated _test database');
  const pool = new Pool({ connectionString }); t.after(() => pool.end());
  await runMigrations(pool);
  const accountId = `furniture-${randomUUID()}`;
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'furniture-test-secret-at-least-32-bytes' });
  const furniture = new PostgresFurnitureService(pool, lifecycle);
  const play = new PostgresPlayService(pool, lifecycle);
  await pool.query("UPDATE furniture_catalog SET available=false,price_mileage=NULL WHERE id='oak-chair'");
  assert.equal((await furniture.get(accountId)).catalog.find(item => item.id === 'oak-chair')?.sellable, false);
  await pool.query("UPDATE furniture_catalog SET available=true,price_mileage=2 WHERE id='oak-chair'");
  await pool.query(`INSERT INTO mileage_credits(id,account_id,amount,reason,source_id,business_date)
    VALUES($1,$2,2,'ROOM_VISIT',$3,'2026-10-07')`, [randomUUID(),accountId,randomUUID()]);
  const input = { accountId, itemId: 'oak-chair', requestId: randomUUID() };
  const purchased = await furniture.purchase(input);
  assert.equal(purchased.balance, 0);
  assert.equal(purchased.replayed, false);
  assert.deepEqual((await furniture.purchase(input)).inventoryItem, purchased.inventoryItem);
  await assert.rejects(() => furniture.purchase({ ...input, itemId: 'round-table' }),
    error => error instanceof FurnitureError && error.code === 'FURNITURE_REQUEST_CONFLICT');
  await assert.rejects(() => furniture.purchase({ ...input, requestId: randomUUID() }),
    error => error instanceof FurnitureError && error.code === 'FURNITURE_INSUFFICIENT_MILEAGE');
  const base = { theme: 'daylight' as const, layout: 'shelf' as const, accent: 'mint' as const, slots: [], goal: null };
  await assert.rejects(() => play.saveStudio({ accountId, studio: { ...base, wall: 'evening' } }),
    error => error instanceof PlayError && error.code === 'STUDIO_THEME_LOCKED');
  await assert.rejects(() => play.saveStudio({ accountId, studio: { ...base,
    furniture: [{ inventoryId: randomUUID(), x: 0.5, y: 0.5, rotation: 0 }] } }),
  error => error instanceof PlayError && error.code === 'STUDIO_ITEM_NOT_OWNED');
  const saved = await play.saveStudio({ accountId, expectedRevision: 0, studio: { ...base,
    wall: 'daylight', floor: 'daylight',
    furniture: [{ inventoryId: purchased.inventoryItem.id, x: 0.5, y: 0.5, rotation: 90 }] } });
  assert.equal(saved.revision, 1);
  assert.equal(saved.furnitureItems[0]?.assetId, 'oak-chair');
  const viewer = `furniture-viewer-${randomUUID()}`;
  const friendshipId = randomUUID();
  await pool.query(`INSERT INTO account_consents(account_id,terms_version,privacy_version,age_confirmed,source)
    VALUES($1,$2,$3,true,'ANDROID')`, [accountId,CURRENT_TERMS_VERSION,CURRENT_PRIVACY_VERSION]);
  await pool.query(`INSERT INTO friendships(id,account_low,account_high) VALUES($1,$2,$3)`,
    [friendshipId,...[accountId,viewer].sort()]);
  const rooms = new PostgresRoomCommunityService(pool, { accountLifecycle: lifecycle, play });
  const roomId = (await rooms.setVisibility({ accountId, visibility: 'FRIENDS' })).roomId;
  const publicStudio = await play.getFriendStudio({ accountId: viewer, friendshipId });
  assert.equal(publicStudio.roomId, roomId);
  assert.equal(publicStudio.studio.furniture?.[0]?.inventoryId, 'placement-0');
  assert.equal(publicStudio.furnitureItems?.[0]?.id, 'placement-0');
  assert.equal(JSON.stringify(publicStudio).includes(purchased.inventoryItem.id), false,
    'public room does not expose owner inventory IDs');
  await assert.rejects(() => play.saveStudio({ accountId, expectedRevision: 0, studio: base }),
    error => error instanceof PlayError && error.code === 'STUDIO_VERSION_CONFLICT');
});
