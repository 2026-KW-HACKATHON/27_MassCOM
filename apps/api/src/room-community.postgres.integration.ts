import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from './account-consent.js';
import { AdminError } from './postgres/admin.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresPlayService } from './postgres/play.js';
import { PostgresRoomCommunityService } from './postgres/room-community.js';
import { RoomCommunityError } from './room-community.js';

test('public rooms require consent, respect blocks and revocation, and cap actual visit rewards', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must name a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(`TRUNCATE room_stamp_reports,room_stamps,room_visits,room_blocks,public_rooms,
    mileage_credits,friend_blocks,account_consents,account_deletion_requests,platform_admins,
    auth_identities,merchants CASCADE`);
  const at = new Date('2026-10-07T12:00:00.000Z');
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'room-community-test-secret-at-least-32-bytes' });
  const play = new PostgresPlayService(pool, lifecycle, { now: () => at });
  const rooms = new PostgresRoomCommunityService(pool, { accountLifecycle: lifecycle, play, now: () => at });
  const consent = async (account: string) => pool.query(`INSERT INTO account_consents
    (account_id,terms_version,privacy_version,age_confirmed,source) VALUES($1,$2,$3,true,'ANDROID')`,
  [account, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION]);
  const rejects = (code: string) => (error: unknown) => error instanceof RoomCommunityError && error.code === code;
  assert.deepEqual(await rooms.getSettings('owner-0'), { visible: false, roomId: null });
  await assert.rejects(() => rooms.setVisibility({ accountId: 'owner-0', visible: true }), rejects('ROOM_CONSENT_REQUIRED'));
  await consent('visitor');
  await consent('reporter');
  for (let i = 0; i < 7; i++) await consent(`owner-${i}`);
  const roomIds: string[] = [];
  for (let i = 0; i < 7; i++) roomIds.push((await rooms.setVisibility({ accountId: `owner-${i}`, visible: true })).roomId!);
  assert.equal((await rooms.randomRoom({ accountId: 'visitor' }))?.studio.studio.goal, null);
  assert.equal((await rooms.getRoom({ accountId: 'owner-0', roomId: roomIds[0]! })).mine, true);
  assert.deepEqual(Object.keys(await rooms.getRoom({ accountId: 'visitor', roomId: roomIds[0]! })).sort(),
    ['mine', 'roomId', 'stamps', 'studio']);
  await assert.rejects(() => rooms.visit({ accountId: 'owner-0', roomId: roomIds[0]! }), rejects('ROOM_NOT_FOUND'));
  assert.equal((await rooms.visit({ accountId: 'visitor', roomId: roomIds[6]! })).creditedMileage, 0,
    'a customer without a counted merchant visit earns no room mileage');

  await pool.query(`INSERT INTO merchants(id,name,story,road_address,minimum_spend_won,status,is_demo)
    VALUES('room-test-merchant','test','test','test',0,'ACTIVE',true)`);
  await pool.query(`INSERT INTO merchant_members(merchant_id,account_id,role,status)
    VALUES('room-test-merchant','staff','STAFF','ACTIVE')`);
  await pool.query(`INSERT INTO campaigns(id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES('room-test-campaign','room-test-merchant','test','2026-01-01','2027-01-01','ACTIVE',true,20)`);
  const slotId = randomUUID();
  await pool.query(`INSERT INTO claim_slots(id,merchant_id,customer_account_id,merchant_reference_hash,created_by_account_id,
    token_hash,status,expires_at,claimed_at,created_at,updated_at)
    VALUES($1,'room-test-merchant','visitor',$2,'staff',$3,'CLAIMED','2026-10-07T13:00:00Z',
      '2026-10-07T12:00:00Z','2026-10-07T11:00:00Z','2026-10-07T12:00:00Z')`,
  [slotId, randomBytes(32), randomBytes(32)]);
  await pool.query(`INSERT INTO visit_events(id,claim_slot_id,merchant_id,campaign_id,customer_account_id,occurred_at,
    business_date,verification_level,status,progress_counted)
    VALUES($1,$2,'room-test-merchant','room-test-campaign','visitor','2026-10-07T12:00:00Z',
      '2026-10-07','MERCHANT_CONFIRMED','VALID',true)`, [randomUUID(), slotId]);

  const [first, replay] = await Promise.all([
    rooms.visit({ accountId: 'visitor', roomId: roomIds[0]! }),
    rooms.visit({ accountId: 'visitor', roomId: roomIds[0]! }),
  ]);
  assert.deepEqual([first.creditedMileage, replay.creditedMileage].sort(), [0, 2]);
  for (let i = 1; i < 7; i++) await rooms.visit({ accountId: 'visitor', roomId: roomIds[i]! });
  assert.deepEqual((await pool.query(`SELECT amount FROM mileage_credits WHERE account_id='visitor' AND reason='ROOM_VISIT'`)).rows,
    Array.from({ length: 5 }, () => ({ amount: 2 })));
  await pool.query('DELETE FROM room_visits WHERE room_id=$1', [roomIds[0]]);
  assert.equal((await rooms.visit({ accountId: 'visitor', roomId: roomIds[0]! })).creditedMileage, 0,
    'deleting old room visits cannot reset the daily credit cap');
  const stamp = await rooms.stamp({ accountId: 'visitor', roomId: roomIds[0]!, kind: 'COZY' });
  assert.equal(stamp.mine, true);
  await assert.rejects(() => rooms.stamp({ accountId: 'visitor', roomId: roomIds[0]!, kind: 'COOL' }), rejects('ROOM_STAMP_LIMIT'));
  await rooms.reportStamp({ accountId: 'reporter', stampId: stamp.id });
  await assert.rejects(() => rooms.listReports('visitor'), error => error instanceof AdminError && error.code === 'ADMIN_FORBIDDEN');
  await pool.query(`INSERT INTO auth_identities(provider,subject,account_id,created_at)
    VALUES('google','room-test-admin','room-admin',now())`);
  await pool.query("INSERT INTO platform_admins(account_id) VALUES('room-admin')");
  assert.deepEqual((await rooms.listReports('room-admin')).map(report => [report.stampId, report.kind, report.reports]),
    [[stamp.id, 'COZY', 1]]);
  await rooms.moderateStamp({ actorAccountId: 'room-admin', stampId: stamp.id });
  assert.deepEqual(await rooms.listReports('room-admin'), []);
  assert.equal((await rooms.getRoom({ accountId: 'visitor', roomId: roomIds[0]! })).stamps.length, 0);
  const secondStamp = await rooms.stamp({ accountId: 'visitor', roomId: roomIds[1]!, kind: 'RETURN' });
  await rooms.removeStamp({ accountId: 'owner-1', stampId: secondStamp.id });
  assert.equal((await rooms.getRoom({ accountId: 'visitor', roomId: roomIds[1]! })).stamps.length, 0);
  await rooms.blockRoom({ accountId: 'visitor', roomId: roomIds[0]! });
  await assert.rejects(() => rooms.getRoom({ accountId: 'visitor', roomId: roomIds[0]! }), rejects('ROOM_NOT_FOUND'));
  await rooms.setVisibility({ accountId: 'owner-1', visible: false });
  await assert.rejects(() => rooms.getRoom({ accountId: 'visitor', roomId: roomIds[1]! }), rejects('ROOM_NOT_FOUND'));
  await pool.query('INSERT INTO friend_blocks(blocker,blocked) VALUES($1,$2)', ['owner-2', 'visitor']);
  await assert.rejects(() => rooms.getRoom({ accountId: 'visitor', roomId: roomIds[2]! }), rejects('ROOM_NOT_FOUND'));
  await pool.query('DELETE FROM account_consents WHERE account_id=$1', ['owner-3']);
  await assert.rejects(() => rooms.getRoom({ accountId: 'visitor', roomId: roomIds[3]! }), rejects('ROOM_NOT_FOUND'));
});
