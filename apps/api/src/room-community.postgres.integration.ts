import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool, type PoolClient } from 'pg';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from './account-consent.js';
import { AdminError } from './postgres/admin.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresPlayService } from './postgres/play.js';
import { PostgresFriendService } from './postgres/friends.js';
import { PostgresRoomCommunityService } from './postgres/room-community.js';
import { RoomCommunityError } from './room-community.js';
import { FriendError } from './friends.js';

test('public rooms require consent, respect blocks and revocation, and cap actual visit rewards', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must name a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(`TRUNCATE room_stamp_reports,room_stamps,room_visits,room_blocks,public_rooms,
    mileage_credits,friend_blocks,friendships,account_consents,account_deletion_requests,platform_admins,
    auth_identities,merchants CASCADE`);
  const at = new Date('2026-10-07T12:00:00.000Z');
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'room-community-test-secret-at-least-32-bytes' });
  const play = new PostgresPlayService(pool, lifecycle, { now: () => at });
  const rooms = new PostgresRoomCommunityService(pool, { accountLifecycle: lifecycle, play, now: () => at });
  const consent = async (account: string) => pool.query(`INSERT INTO account_consents
    (account_id,terms_version,privacy_version,age_confirmed,source) VALUES($1,$2,$3,true,'ANDROID')`,
  [account, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION]);
  const rejects = (code: string) => (error: unknown) => error instanceof RoomCommunityError && error.code === code;
  assert.deepEqual(await rooms.getSettings('owner-0'), { visible: false, visibility: 'PRIVATE', roomId: null });
  await assert.rejects(() => rooms.setVisibility({ accountId: 'owner-0', visible: true }), rejects('ROOM_CONSENT_REQUIRED'));
  await consent('visitor');
  await consent('reporter');
  for (let i = 0; i < 7; i++) await consent(`owner-${i}`);
  for (let i = 0; i < 7; i++) await pool.query(`INSERT INTO friendships(id,account_low,account_high)
    VALUES($1,$2,'visitor')`, [randomUUID(), `owner-${i}`]);
  await pool.query(`INSERT INTO friendships(id,account_low,account_high) VALUES($1,'owner-0','reporter')`, [randomUUID()]);
  const roomIds: string[] = [];
  for (let i = 0; i < 7; i++) roomIds.push((await rooms.setVisibility({ accountId: `owner-${i}`, visible: true })).roomId!);
  assert.equal((await rooms.randomRoom({ accountId: 'visitor' }))?.studio.studio.goal, null);
  assert.equal((await rooms.getRoom({ accountId: 'owner-0', roomId: roomIds[0]! })).mine, true);
  assert.deepEqual(Object.keys(await rooms.getRoom({ accountId: 'visitor', roomId: roomIds[0]! })).sort(),
    ['friendshipId', 'hasVisited', 'mine', 'returnVisitAvailable', 'roomId', 'sharedMerchants',
      'stamps', 'studio', 'visibility', 'visitorCount']);
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
  await consent('neighbor');
  await assert.rejects(() => rooms.getRoom({ accountId: 'neighbor', roomId: roomIds[0]! }), rejects('ROOM_NOT_FOUND'));
  const countedVisit = async (account: string) => {
    const claim = randomUUID();
    await pool.query(`INSERT INTO claim_slots(id,merchant_id,customer_account_id,merchant_reference_hash,created_by_account_id,
      token_hash,status,expires_at,claimed_at,created_at,updated_at)
      VALUES($1,'room-test-merchant',$2,$3,'staff',$4,'CLAIMED','2026-10-07T13:00:00Z',
        '2026-10-07T12:00:00Z','2026-10-07T11:00:00Z','2026-10-07T12:00:00Z')`,
    [claim,account,randomBytes(32),randomBytes(32)]);
    const visit = randomUUID();
    await pool.query(`INSERT INTO visit_events(id,claim_slot_id,merchant_id,campaign_id,customer_account_id,occurred_at,
      business_date,verification_level,status,progress_counted)
      VALUES($1,$2,'room-test-merchant','room-test-campaign',$3,'2026-10-07T12:00:00Z',
        '2026-10-07','MERCHANT_CONFIRMED','VALID',true)`, [visit,claim,account]);
    return visit;
  };
  const ownerVisit = await countedVisit('owner-0');
  await countedVisit('neighbor');
  assert.deepEqual((await rooms.getRoom({ accountId: 'neighbor', roomId: roomIds[0]! })).sharedMerchants,
    [{ merchantId: 'room-test-merchant', merchantName: 'test' }]);
  assert.equal((await rooms.neighbors('neighbor')).some(room => room.roomId === roomIds[0]), true);
  const friends = new PostgresFriendService(pool, { accountLifecycle: lifecycle });
  const addedNeighbor = await friends.addNeighbor({ accountId: 'neighbor', roomId: roomIds[0]! });
  assert.equal(addedNeighbor.created, true);
  assert.equal((await friends.addNeighbor({ accountId: 'neighbor', roomId: roomIds[0]! })).created, false);
  await friends.remove({ accountId: 'neighbor', friendshipId: addedNeighbor.friend.friendshipId });
  await assert.rejects(() => friends.addNeighbor({ accountId: 'neighbor', roomId: roomIds[0]! }),
    error => error instanceof FriendError && error.code === 'FRIEND_NEIGHBOR_NOT_FOUND');
  await pool.query("DELETE FROM friend_blocks WHERE blocker='neighbor' AND blocked='owner-0'");
  await rooms.setVisibility({ accountId: 'owner-0', visibility: 'FRIENDS' });
  await assert.rejects(() => rooms.getRoom({ accountId: 'neighbor', roomId: roomIds[0]! }), rejects('ROOM_NOT_FOUND'));
  await assert.rejects(() => friends.addNeighbor({ accountId: 'neighbor', roomId: roomIds[0]! }),
    error => error instanceof FriendError && error.code === 'FRIEND_NEIGHBOR_NOT_FOUND');
  assert.equal((await rooms.getRoom({ accountId: 'visitor', roomId: roomIds[0]! })).visibility, 'FRIENDS');
  await rooms.setVisibility({ accountId: 'owner-0', visibility: 'PRIVATE' });
  await assert.rejects(() => rooms.getRoom({ accountId: 'visitor', roomId: roomIds[0]! }), rejects('ROOM_NOT_FOUND'));
  await assert.rejects(() => friends.addNeighbor({ accountId: 'neighbor', roomId: roomIds[0]! }),
    error => error instanceof FriendError && error.code === 'FRIEND_NEIGHBOR_NOT_FOUND');
  assert.equal((await rooms.getRoom({ accountId: 'owner-0', roomId: roomIds[0]! })).mine, true);
  await rooms.setVisibility({ accountId: 'owner-0', visibility: 'NEIGHBORS' });
  const visitorRoomId = (await rooms.setVisibility({ accountId: 'visitor', visibility: 'NEIGHBORS' })).roomId;
  let waiting = 0;
  let release!: () => void;
  const bothReadersStarted = new Promise<void>(resolve => { release = resolve; });
  class GatedLifecycle extends PostgresAccountLifecycle {
    override async assertActive(client: PoolClient, accountId: string): Promise<void> {
      await super.assertActive(client, accountId);
      if (accountId === 'owner-0' || accountId === 'visitor') {
        if (++waiting === 2) release();
        await bothReadersStarted;
      }
    }
  }
  const reciprocal = new PostgresRoomCommunityService(pool, {
    accountLifecycle: new GatedLifecycle({ hmacSecret: 'room-community-test-secret-at-least-32-bytes' }), play,
    now: () => at });
  const [ownerNeighbors, visitorNeighbors] = await Promise.all([
    reciprocal.neighbors('owner-0'), reciprocal.neighbors('visitor'),
  ]);
  assert.equal(ownerNeighbors.some(room => room.roomId === visitorRoomId), true);
  assert.equal(visitorNeighbors.some(room => room.roomId === roomIds[0]), true);
  await pool.query("INSERT INTO room_blocks(blocker_account_id,blocked_account_id) VALUES('neighbor','owner-0')");
  await assert.rejects(() => friends.addNeighbor({ accountId: 'neighbor', roomId: roomIds[0]! }),
    error => error instanceof FriendError && error.code === 'FRIEND_NEIGHBOR_NOT_FOUND');
  await pool.query("DELETE FROM room_blocks WHERE blocker_account_id='neighbor' AND blocked_account_id='owner-0'");
  await pool.query("UPDATE visit_events SET status='CANCELED' WHERE id=$1", [ownerVisit]);
  await assert.rejects(() => rooms.getRoom({ accountId: 'neighbor', roomId: roomIds[0]! }), rejects('ROOM_NOT_FOUND'));
  await assert.rejects(() => friends.addNeighbor({ accountId: 'neighbor', roomId: roomIds[0]! }),
    error => error instanceof FriendError && error.code === 'FRIEND_NEIGHBOR_NOT_FOUND');
  await assert.rejects(() => rooms.visit({ accountId: 'neighbor', roomId: roomIds[0]! }), rejects('ROOM_NOT_FOUND'));
  await assert.rejects(() => rooms.stamp({ accountId: 'neighbor', roomId: roomIds[0]!, kind: 'COZY' }), rejects('ROOM_NOT_FOUND'));

  const [first, replay] = await Promise.all([
    rooms.visit({ accountId: 'visitor', roomId: roomIds[0]! }),
    rooms.visit({ accountId: 'visitor', roomId: roomIds[0]! }),
  ]);
  assert.deepEqual([first.creditedMileage, replay.creditedMileage].sort(), [0, 2]);
  assert.equal((await rooms.visitors('owner-0')).some(visitor => visitor.nickname === '탐험가' && visitor.visits === 1), true);
  for (let i = 1; i < 7; i++) await rooms.visit({ accountId: 'visitor', roomId: roomIds[i]! });
  assert.deepEqual((await pool.query(`SELECT amount FROM mileage_credits WHERE account_id='visitor' AND reason='ROOM_VISIT'`)).rows,
    Array.from({ length: 5 }, () => ({ amount: 2 })));
  await pool.query('DELETE FROM room_visits WHERE room_id=$1', [roomIds[0]]);
  assert.equal((await rooms.visit({ accountId: 'visitor', roomId: roomIds[0]! })).creditedMileage, 0,
    'deleting old room visits cannot reset the daily credit cap');
  const stamp = await rooms.stamp({ accountId: 'visitor', roomId: roomIds[0]!, kind: 'COZY', message: '  다시 오고 싶어요  ' });
  assert.equal(stamp.mine, true);
  assert.equal(stamp.message, '다시 오고 싶어요');
  assert.equal(stamp.authorNickname, '탐험가');
  assert.equal((await rooms.getRoom({ accountId: 'owner-0', roomId: roomIds[0]! })).stamps[0]?.message, stamp.message);
  assert.equal((await rooms.getRoom({ accountId: 'reporter', roomId: roomIds[0]! })).stamps[0]?.id, stamp.id);
  await pool.query("INSERT INTO friend_blocks(blocker,blocked) VALUES('reporter','visitor')");
  assert.deepEqual((await rooms.getRoom({ accountId: 'reporter', roomId: roomIds[0]! })).stamps, [],
    'a third-party room cannot reveal a blocked writer through the guestbook');
  await pool.query("DELETE FROM friend_blocks WHERE blocker='reporter' AND blocked='visitor'");
  await pool.query("INSERT INTO room_blocks(blocker_account_id,blocked_account_id) VALUES('visitor','reporter')");
  assert.deepEqual((await rooms.getRoom({ accountId: 'reporter', roomId: roomIds[0]! })).stamps, [],
    'room blocks hide a writer in either direction');
  await pool.query("DELETE FROM room_blocks WHERE blocker_account_id='visitor' AND blocked_account_id='reporter'");
  await pool.query("INSERT INTO room_blocks(blocker_account_id,blocked_account_id) VALUES('owner-0','visitor')");
  assert.deepEqual((await rooms.getRoom({ accountId: 'owner-0', roomId: roomIds[0]! })).stamps, [],
    'the room owner also stops seeing a blocked visitor message');
  await pool.query("DELETE FROM room_blocks WHERE blocker_account_id='owner-0' AND blocked_account_id='visitor'");
  await assert.rejects(() => rooms.stamp({ accountId: 'visitor', roomId: roomIds[0]!, kind: 'COOL' }), rejects('ROOM_STAMP_LIMIT'));
  await rooms.reportStamp({ accountId: 'reporter', stampId: stamp.id });
  await assert.rejects(() => rooms.listReports('visitor'), error => error instanceof AdminError && error.code === 'ADMIN_FORBIDDEN');
  await pool.query(`INSERT INTO auth_identities(provider,subject,account_id,created_at)
    VALUES('google','room-test-admin','room-admin',now())`);
  await pool.query("INSERT INTO platform_admins(account_id) VALUES('room-admin')");
  assert.deepEqual((await rooms.listReports('room-admin')).map(report => [report.stampId, report.kind, report.reports]),
    [[stamp.id, 'COZY', 1]]);
  assert.equal((await rooms.listReports('room-admin'))[0]?.message, '다시 오고 싶어요');
  await rooms.moderateStamp({ actorAccountId: 'room-admin', stampId: stamp.id });
  assert.deepEqual(await rooms.listReports('room-admin'), []);
  assert.equal((await rooms.getRoom({ accountId: 'visitor', roomId: roomIds[0]! })).stamps.length, 0);
  const secondStamp = await rooms.stamp({ accountId: 'visitor', roomId: roomIds[1]!, kind: 'RETURN', message: '좋았어요' });
  await rooms.removeStamp({ accountId: 'owner-1', stampId: secondStamp.id });
  assert.equal((await rooms.getRoom({ accountId: 'visitor', roomId: roomIds[1]! })).stamps.length, 0);
  await rooms.blockRoom({ accountId: 'visitor', roomId: roomIds[0]! });
  assert.equal((await rooms.visitors('owner-0')).some(visitor => visitor.nickname === '탐험가'), false);
  await assert.rejects(() => rooms.getRoom({ accountId: 'visitor', roomId: roomIds[0]! }), rejects('ROOM_NOT_FOUND'));
  await rooms.setVisibility({ accountId: 'owner-1', visible: false });
  await assert.rejects(() => rooms.getRoom({ accountId: 'visitor', roomId: roomIds[1]! }), rejects('ROOM_NOT_FOUND'));
  await pool.query('INSERT INTO friend_blocks(blocker,blocked) VALUES($1,$2)', ['owner-2', 'visitor']);
  await assert.rejects(() => rooms.getRoom({ accountId: 'visitor', roomId: roomIds[2]! }), rejects('ROOM_NOT_FOUND'));
  await pool.query('DELETE FROM account_consents WHERE account_id=$1', ['owner-3']);
  await assert.rejects(() => rooms.getRoom({ accountId: 'visitor', roomId: roomIds[3]! }), rejects('ROOM_NOT_FOUND'));
});
