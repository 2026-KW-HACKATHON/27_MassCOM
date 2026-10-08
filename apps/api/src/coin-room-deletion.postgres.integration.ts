import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { runMigrations } from './postgres/migrate.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresPlayService } from './postgres/play.js';
import { PostgresRoomCommunityService } from './postgres/room-community.js';
import { RoomCommunityError } from './room-community.js';

test('account deletion removes public room relations and coin rights without deleting other owners', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) throw new Error('dedicated test DB required');
  const pool = new Pool({ connectionString, application_name: 'room-deletion-lock-order-test' }); t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE merchants, public_rooms, room_blocks, room_guestbook_friend_add_counts, account_deletion_requests CASCADE');
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'coin-room-deletion-test-secret-at-least-32-bytes' });
  const room = randomUUID(), otherRoom = randomUUID(), stamp = randomUUID(), otherStamp = randomUUID();
  await pool.query(`INSERT INTO public_rooms(account_id,id,visible) VALUES ('delete-me',$1,true),('other',$2,true)`, [room, otherRoom]);
  await pool.query(`INSERT INTO room_stamps(id,room_id,author_account_id,kind,business_date,created_at)
    VALUES ($1,$2,'other','COZY','2026-10-07',now()),($3,$4,'delete-me','COOL','2026-10-07',now())`, [stamp, room, otherStamp, otherRoom]);
  await pool.query(`INSERT INTO room_stamp_reports(reporter_account_id,stamp_id) VALUES ('other',$1),('delete-me',$2)`, [stamp, otherStamp]);
  const entry = randomUUID(), otherEntry = randomUUID();
  await pool.query(`INSERT INTO room_guestbook_entries(id,room_id,author_account_id,request_id,message,message_hash,business_date,created_at,credited_mileage,owner_read_at)
    VALUES($1,$2,'other','first','안녕하세요',$5,'2026-10-07',now(),5,now()),
      ($3,$4,'delete-me','first','안녕하세요',$5,'2026-10-07',now(),5,NULL)`,
  [entry,room,otherEntry,otherRoom,lifecycle.referenceHash('guestbook-message:안녕하세요')]);
  await pool.query(`INSERT INTO room_guestbook_reports(reporter_account_id,entry_id,created_at)
    VALUES('other',$1,now()),('delete-me',$2,now())`, [entry,otherEntry]);
  await pool.query(`INSERT INTO room_guestbook_friend_add_counts(account_id,business_date,created_count)
    VALUES('delete-me','2026-10-07',1)`);
  await pool.query(`INSERT INTO room_visits(id,visitor_account_id,room_id,business_date,visited_at)
    VALUES ($1,'other',$2,'2026-10-07',now()),($3,'delete-me',$4,'2026-10-07',now())`, [randomUUID(), room, randomUUID(), otherRoom]);
  await pool.query(`INSERT INTO room_blocks(blocker_account_id,blocked_account_id) VALUES ('other','delete-me')`);
  await pool.query(`INSERT INTO merchants(id,name,story,road_address,minimum_spend_won,status,is_demo)
    VALUES ('delete-store','시험','','서울',0,'ACTIVE',false)`);
  const coinPool = randomUUID(), ticket = randomUUID(), series = randomUUID();
  await pool.query(`INSERT INTO coin_pools(id,merchant_id,event_name,grade,price,purchase_starts_at,purchase_ends_at,use_expires_at,per_account_limit,issuance_cap)
    VALUES ($1,'delete-store','시험','BRONZE',1,'2026-10-01','2026-10-10','2026-10-20',5,10)`, [coinPool]);
  await pool.query(`INSERT INTO coin_tickets(id,account_id,pool_id,request_id,source,price,acquired_at,expires_at)
    VALUES ($1,'delete-me',$2,'delete-ticket','PURCHASE',1,'2026-10-07','2026-10-20')`, [ticket, coinPool]);
  await pool.query(`INSERT INTO coin_series(id,merchant_id,title,ends_at,base_title,base_detail,base_valid_days,base_cap,
    prism_title,prism_detail,prism_valid_days,prism_cap,consent_document_ref)
    VALUES ($1,'delete-store','시험','2026-10-20','기본','시험',7,10,'프리즘','시험',7,10,'test-consent')`, [series]);
  await pool.query(`INSERT INTO coin_series_coupons(id,account_id,series_id,merchant_id,tier,title,detail,issued_at,expires_at)
    VALUES ($1,'delete-me',$2,'delete-store','BASE','시험','시험','2026-10-07','2026-10-14')`, [randomUUID(), series]);
  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'coin-room-deletion-test-secret-at-least-32-bytes', policyVersion: 'test', now: () => new Date('2026-10-07T01:00:00Z'),
  });
  await pool.query(`INSERT INTO auth_identities(provider,subject,account_id,created_at)
    VALUES('google','room-delete-admin','room-delete-admin',now())`);
  await pool.query("INSERT INTO platform_admins(account_id) VALUES('room-delete-admin')");
  const rooms = new PostgresRoomCommunityService(pool,{ accountLifecycle: lifecycle,play: new PostgresPlayService(pool,lifecycle) });
  const blocker = await pool.connect();
  const waitForLock = async (sql: string) => {
    const deadline = Date.now()+3000;
    while (Date.now()<deadline) {
      const waiting = await pool.query<{ n: number }>(`SELECT count(*)::integer AS n FROM pg_stat_activity
        WHERE application_name='room-deletion-lock-order-test' AND wait_event_type='Lock' AND query LIKE $1`, [`%${sql}%`]);
      if (waiting.rows[0]!.n) return;
      await new Promise(resolve => setTimeout(resolve,10));
    }
    assert.fail(`${sql} did not wait on the entry lock`);
  };
  let moderation: Promise<PromiseSettledResult<void>> | undefined;
  let deletionRun: Promise<PromiseSettledResult<unknown>> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM room_guestbook_entries WHERE id=$1 FOR UPDATE',[entry]);
    moderation = rooms.moderateGuestbook({ actorAccountId: 'room-delete-admin',entryId: entry })
      .then(() => ({ status: 'fulfilled' as const,value: undefined }),reason => ({ status: 'rejected' as const,reason }));
    await waitForLock('UPDATE room_guestbook_entries');
    deletionRun = deletion.requestDeletion({ accountId: 'delete-me', confirmation: 'DELETE MY ACCOUNT' })
      .then(value => ({ status: 'fulfilled' as const,value }),reason => ({ status: 'rejected' as const,reason }));
    await waitForLock('SELECT entry.id FROM room_guestbook_entries');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  const [moderationResult,deletionResult] = await Promise.all([moderation!,deletionRun!]);
  assert.equal(deletionResult.status,'fulfilled','deletion completes alongside moderation');
  if (moderationResult.status==='rejected') assert.equal(moderationResult.reason instanceof RoomCommunityError &&
    moderationResult.reason.code==='ROOM_GUESTBOOK_NOT_FOUND',true,'the only acceptable race loss is an already-deleted entry');
  for (const table of ['room_guestbook_entries','room_guestbook_reports','room_guestbook_friend_add_counts',
    'room_stamps', 'room_stamp_reports', 'room_visits', 'room_blocks', 'coin_tickets', 'coin_series_coupons']) {
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows[0].n, 0, table);
  }
  assert.equal((await pool.query('SELECT account_id FROM public_rooms')).rows[0].account_id, 'other');
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM coin_pools')).rows[0].n, 1);
});
