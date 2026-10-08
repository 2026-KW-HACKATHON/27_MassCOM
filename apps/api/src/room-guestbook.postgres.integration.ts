import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from './account-consent.js';
import { RoomCommunityError } from './room-community.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresFriendService } from './postgres/friends.js';
import { PostgresPlayService } from './postgres/play.js';
import { PostgresRoomCommunityService } from './postgres/room-community.js';
import { runMigrations } from './postgres/migrate.js';

test('text guestbook rewards, privacy, unread acknowledgement, moderation and author access remain bound to room access', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) throw new Error('dedicated test DB required');
  const pool = new Pool({ connectionString }); t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(`TRUNCATE public_rooms,room_blocks,friendships,friend_blocks,room_guestbook_friend_add_counts,
    account_consents,account_deletion_requests,
    mileage_credits,friend_codes,explorer_profiles,platform_admins,auth_identities,merchants CASCADE`);
  let at = new Date('2026-10-08T14:59:00Z');
  const hmacSecret = 'guestbook-actions-test-secret-at-least-32-bytes';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  const rooms = new PostgresRoomCommunityService(pool,{ accountLifecycle: lifecycle,
    play: new PostgresPlayService(pool,lifecycle),now: () => at });
  const friends = new PostgresFriendService(pool,{ accountLifecycle: lifecycle,now: () => at });
  const consent = async (account: string) => pool.query(`INSERT INTO account_consents
    (account_id,terms_version,privacy_version,age_confirmed,source) VALUES($1,$2,$3,true,'ANDROID')`,
  [account,CURRENT_TERMS_VERSION,CURRENT_PRIVACY_VERSION]);
  const rejects = (code: string) => (error: unknown) => error instanceof RoomCommunityError && error.code === code;
  for (const account of ['writer','reader','other','owner','private-owner','admin',...Array.from({ length: 6 },(_,i) => `owner${i}`)]) await consent(account);
  const roomId = (await rooms.setVisibility({ accountId: 'owner',visibility: 'PUBLIC' })).roomId!;
  assert.equal((await rooms.getRoom({ accountId: 'reader',roomId })).visibility,'PUBLIC');
  assert.equal((await rooms.randomRoom({ accountId: 'reader',supportsPublic: false }))?.roomId ?? null,null,
    'legacy clients do not receive public rooms from random discovery');
  assert.equal((await rooms.randomRoom({ accountId: 'reader',supportsPublic: true }))?.roomId,roomId);
  await assert.rejects(() => rooms.getRoom({ accountId: 'no-consent',roomId }),rejects('ROOM_NOT_FOUND'));
  const legacyRoom = (await rooms.setVisibility({ accountId: 'private-owner',visible: true })).roomId!;
  assert.equal((await rooms.getSettings('private-owner')).visibility,'NEIGHBORS');
  await assert.rejects(() => rooms.getRoom({ accountId: 'reader',roomId: legacyRoom }),rejects('ROOM_NOT_FOUND'));
  await assert.rejects(() => rooms.postGuestbook({ accountId: 'owner',roomId,requestId: 'self',message: 'self' }),rejects('ROOM_NOT_FOUND'));
  await assert.rejects(() => rooms.postGuestbook({ accountId: 'writer',roomId,requestId: 'bad',message: '\u200b' }),rejects('ROOM_MESSAGE_INVALID'));
  await pool.query(`INSERT INTO mileage_credits(id,account_id,amount,reason,source_id,business_date,created_at)
    VALUES($1,'writer',25,'FRIENDSHIP',$2,'2026-10-08',$3)`, [randomUUID(),randomUUID(),at]);
  const request = { accountId: 'writer',roomId,requestId: 'lost-response',message: '  좋은 방\r\n다시 올게요  ' };
  const posted = await Promise.all([rooms.postGuestbook(request),rooms.postGuestbook(request)]);
  assert.equal(posted[0]!.entry.id,posted[1]!.entry.id);
  assert.deepEqual(posted.map(post => post.replayed).sort(),[false,true]);
  assert.equal(posted[0]!.creditedMileage,5,'guestbook cap is independent of friendship mileage');
  assert.equal(posted[0]!.entry.message,'좋은 방\n다시 올게요');
  const first = posted[0]!.entry;
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM mileage_credits WHERE reason='ROOM_GUESTBOOK'")).rows[0].n,1);
  await assert.rejects(() => rooms.postGuestbook({ ...request,message: 'changed' }),rejects('ROOM_REQUEST_CONFLICT'));
  const repeated = await rooms.postGuestbook({ ...request,requestId: 'second' });
  assert.equal(repeated.creditedMileage,0);
  assert.equal((await rooms.getMyGuestbook({ accountId: 'owner' })).unreadCount,2);
  const snapshot = await rooms.getMyGuestbook({ accountId: 'owner' });
  const arrived = await rooms.postGuestbook({ ...request,requestId: 'arrived-after-page' });
  assert.equal((await rooms.readGuestbook({ accountId: 'owner',entryIds: snapshot.entries.map(entry => entry.id) })).unreadCount,1);
  assert.equal((await rooms.readGuestbook({ accountId: 'reader',entryIds: [arrived.entry.id] })).unreadCount,0);
  assert.equal((await rooms.getMyGuestbook({ accountId: 'owner' })).unreadCount,1,'third party cannot mark owner entries read');
  assert.equal((await rooms.getGuestbook({ accountId: 'reader',roomId })).entries.every(entry => !entry.unread),true);
  const profile = await rooms.getGuestbookAuthor({ accountId: 'reader',entryId: first.id });
  assert.deepEqual(Object.keys(profile).sort(),['avatar','avatarClothingId','earnedBadges','friendshipId','intro','medals','mine','nickname','stampCount','totalBadges']);
  assert.equal(profile.medals.length,3);
  assert.equal(profile.friendshipId,null);
  await rooms.setVisibility({ accountId: 'writer',visibility: 'PUBLIC' });
  const added = await friends.addGuestbookAuthor({ accountId: 'reader',entryId: first.id });
  assert.equal(added.created,true);
  assert.equal((await friends.addGuestbookAuthor({ accountId: 'reader',entryId: first.id })).created,false);
  assert.equal((await rooms.getGuestbookAuthor({ accountId: 'reader',entryId: first.id })).friendshipId,added.friend.friendshipId);
  assert.equal((await friends.addNeighbor({ accountId: 'other',roomId })).created,true,'PUBLIC owner can be added without shared merchant');
  await rooms.setVisibility({ accountId: 'owner',visibility: 'PRIVATE' });
  for (const run of [() => rooms.getGuestbookAuthor({ accountId: 'reader',entryId: first.id }),
    () => friends.addGuestbookAuthor({ accountId: 'reader',entryId: first.id })]) await assert.rejects(run,rejects('ROOM_GUESTBOOK_NOT_FOUND'));
  await rooms.setVisibility({ accountId: 'owner',visibility: 'PUBLIC' });
  for (const [blocker,blocked] of [['reader','writer'],['writer','reader']]) {
    await pool.query('INSERT INTO friend_blocks(blocker,blocked) VALUES($1,$2)',[blocker,blocked]);
    assert.equal((await rooms.getGuestbook({ accountId: 'reader',roomId })).entries.length,0);
    await assert.rejects(() => rooms.getGuestbookAuthor({ accountId: 'reader',entryId: first.id }),rejects('ROOM_GUESTBOOK_NOT_FOUND'));
    await assert.rejects(() => friends.addGuestbookAuthor({ accountId: 'reader',entryId: first.id }),rejects('ROOM_GUESTBOOK_NOT_FOUND'));
    await pool.query('DELETE FROM friend_blocks WHERE blocker=$1 AND blocked=$2',[blocker,blocked]);
  }
  await pool.query("INSERT INTO room_blocks(blocker_account_id,blocked_account_id) VALUES('owner','writer')");
  assert.equal((await rooms.getGuestbook({ accountId: 'reader',roomId })).entries.length,0);
  assert.equal((await rooms.getMyGuestbook({ accountId: 'owner' })).unreadCount,0);
  await pool.query('DELETE FROM room_blocks');
  await pool.query("UPDATE account_consents SET privacy_version='old' WHERE account_id='writer'");
  assert.equal((await rooms.getGuestbook({ accountId: 'reader',roomId })).entries.length,0);
  await assert.rejects(() => rooms.getGuestbookAuthor({ accountId: 'reader',entryId: first.id }),rejects('ROOM_GUESTBOOK_NOT_FOUND'));
  await pool.query('UPDATE account_consents SET privacy_version=$1 WHERE account_id=$2',[CURRENT_PRIVACY_VERSION,'writer']);
  await rooms.removeGuestbook({ accountId: 'owner',entryId: first.id });
  assert.equal((await pool.query('SELECT message,hidden_at IS NOT NULL AS hidden FROM room_guestbook_entries WHERE id=$1',
    [first.id])).rows[0].message,'','removal clears stored text while retaining the dedupe row');
  await assert.rejects(() => rooms.getGuestbookAuthor({ accountId: 'reader',entryId: first.id }),rejects('ROOM_GUESTBOOK_NOT_FOUND'));
  assert.equal((await rooms.postGuestbook({ ...request,requestId: 'after-removal' })).creditedMileage,0);
  const otherRooms: string[] = [];
  for (let i=0;i<6;i++) otherRooms.push((await rooms.setVisibility({ accountId: `owner${i}`,visibility: 'PUBLIC' })).roomId!);
  const rewarded = await Promise.all(otherRooms.map((roomId,i) => rooms.postGuestbook({ ...request,roomId,requestId: `room${i}` })));
  assert.equal(rewarded.reduce((sum,result) => sum+result.creditedMileage,0),20,'concurrent different rooms stop at separate daily25P');
  assert.equal((await pool.query("SELECT sum(amount)::integer AS n FROM mileage_credits WHERE account_id='writer' AND reason='ROOM_GUESTBOOK'")).rows[0].n,25);
  at = new Date('2026-10-08T15:00:00Z');
  assert.equal((await rooms.postGuestbook({ ...request,requestId: 'kst-next-day' })).creditedMileage,5);
  const removedReplay = await rooms.postGuestbook(request);
  assert.equal(removedReplay.creditedMileage,5,'retry carries original grant without a second credit');
  assert.equal(removedReplay.entry.message,'','removed text is not re-exposed on replay');
  await assert.rejects(() => rooms.postGuestbook({ ...request,message: 'changed after removal' }),
    rejects('ROOM_REQUEST_CONFLICT'),'the erased message still has strict idempotency');
  for (let i=0;i<24;i++) {
    if (i===9 || i===19) at = new Date(at.getTime()+24*60*60*1000);
    await rooms.postGuestbook({ ...request,requestId: `page-${i}`,message: `글 ${i}` });
  }
  const ids = new Set<string>(); let cursor: string | undefined;
  do {
    const page = await rooms.getGuestbook({ accountId: 'reader',roomId,...(cursor ? { cursor } : {}) });
    for (const entry of page.entries) { assert.equal(ids.has(entry.id),false); ids.add(entry.id); }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(ids.size,28);
  const validCursor = Buffer.from(JSON.stringify({ at: '2026-10-09T00:00:00.000Z',id: first.id })).toString('base64url');
  const nonCanonicalCursor = `${validCursor.slice(0,-1)}1`;
  assert.equal(Buffer.from(nonCanonicalCursor,'base64url').equals(Buffer.from(validCursor,'base64url')),true);
  for (const invalid of ['@@@',`${validCursor}@@@`,`${validCursor} `,`${validCursor}=`,nonCanonicalCursor,
    Buffer.from(JSON.stringify({ at: '0000-01-01T00:00:00.000Z',id: first.id })).toString('base64url'),
    Buffer.from(JSON.stringify({ at: '2026-02-30T00:00:00.000Z',id: first.id })).toString('base64url'),
    Buffer.from(JSON.stringify({ at: '2026-10-09',id: first.id })).toString('base64url')])
    await assert.rejects(() => rooms.getGuestbook({ accountId: 'reader',roomId,cursor: invalid }),rejects('ROOM_REQUEST_INVALID'));
  const daily = { ...request,requestId: 'daily-cap',message: 'cap' };
  for (let i=0;i<4;i++) await rooms.postGuestbook({ ...daily,requestId: `${daily.requestId}-${i}` });
  const racing = await Promise.allSettled([rooms.postGuestbook({ ...daily,requestId: 'race-a' }),
    rooms.postGuestbook({ ...daily,requestId: 'race-b' })]);
  assert.deepEqual(racing.map(result => result.status).sort(),['fulfilled','rejected']);
  assert.equal(rejects('ROOM_GUESTBOOK_DAILY_LIMIT')((racing.find(result => result.status==='rejected') as PromiseRejectedResult).reason),true);
  const capped = racing.find(result => result.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof rooms.postGuestbook>>>;
  await rooms.removeGuestbook({ accountId: 'owner',entryId: capped.value.entry.id });
  await assert.rejects(() => rooms.postGuestbook({ ...daily,requestId: 'after-hidden-cap' }),rejects('ROOM_GUESTBOOK_DAILY_LIMIT'));
  const replayId = racing[0]!.status === 'fulfilled' ? 'race-a' : 'race-b';
  assert.equal((await rooms.postGuestbook({ ...daily,requestId: replayId })).replayed,true,
    'an existing request still replays at the daily cap');
  await pool.query("INSERT INTO auth_identities(provider,subject,account_id,created_at) VALUES('google','guestbook-admin','admin',now())");
  await pool.query("INSERT INTO platform_admins(account_id) VALUES('admin')");
  await rooms.reportGuestbook({ accountId: 'reader',entryId: repeated.entry.id });
  assert.equal((await rooms.listGuestbookReports('admin'))[0]?.entryId,repeated.entry.id);
  await rooms.moderateGuestbook({ actorAccountId: 'admin',entryId: repeated.entry.id });
  assert.deepEqual(await rooms.listGuestbookReports('admin'),[]);
  await assert.rejects(() => friends.addGuestbookAuthor({ accountId: 'other',entryId: repeated.entry.id }),rejects('ROOM_GUESTBOOK_NOT_FOUND'));
  const referenceHash = lifecycle.referenceHash('writer');
  await pool.query(`INSERT INTO account_deletion_requests(id,account_reference_hash,deleted_account_alias,status,policy_version,
    cancelled_mint_jobs,pending_mint_jobs,retained_finalized_nfts,requested_at,completed_at,updated_at)
    VALUES($1,$2,$3,'COMPLETED','test',0,0,0,$4,$4,$4)`,
  [randomUUID(),referenceHash,`deleted:${referenceHash.toString('hex')}`,at]);
  await assert.rejects(() => rooms.removeGuestbook({ accountId: 'owner',entryId: arrived.entry.id }),
    rejects('ROOM_GUESTBOOK_NOT_FOUND'),'a live owner sees a deleted author as a missing entry');
  await pool.query('DELETE FROM account_deletion_requests WHERE account_reference_hash=$1',[referenceHash]);
  at = new Date(at.getTime()+24*60*60*1000);
  const deletion = new PostgresAccountDeletionService(pool,{ hmacSecret,policyVersion: 'test',now: () => at });
  const deleting = await Promise.allSettled([
    rooms.postGuestbook({ ...request,requestId: 'deletion-race' }),
    deletion.requestDeletion({ accountId: 'writer',confirmation: 'DELETE MY ACCOUNT' }),
  ]);
  assert.equal(deleting[1]!.status,'fulfilled');
  if (deleting[0]!.status === 'rejected') assert.equal(rejects('ACCOUNT_DELETED')(deleting[0]!.reason),true);
  assert.equal((await rooms.getGuestbook({ accountId: 'reader',roomId })).entries.length,0);
  await assert.rejects(() => rooms.getGuestbookAuthor({ accountId: 'reader',entryId: arrived.entry.id }),rejects('ROOM_GUESTBOOK_NOT_FOUND'));
  assert.equal((await rooms.getMyGuestbook({ accountId: 'owner' })).unreadCount,0);
});
