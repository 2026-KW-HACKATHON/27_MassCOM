import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from './account-consent.js';
import { FriendError } from './friends.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresFriendService } from './postgres/friends.js';
import { PostgresPlayService } from './postgres/play.js';
import { PostgresRoomCommunityService } from './postgres/room-community.js';
import { runMigrations } from './postgres/migrate.js';

test('guestbook friendship requires author opt-in and caps created adds per KST day', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test'))
    throw new Error('dedicated test DB required');
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(`TRUNCATE public_rooms,room_guestbook_friend_add_counts,account_consents,
    friendships,friend_blocks,friend_codes,explorer_profiles,account_deletion_requests CASCADE`);

  let now = new Date('2026-10-08T14:59:00Z');
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'guestbook-friends-test-secret-at-least-32-bytes' });
  const rooms = new PostgresRoomCommunityService(pool, { accountLifecycle: lifecycle,
    play: new PostgresPlayService(pool, lifecycle), now: () => now });
  const friends = new PostgresFriendService(pool, { accountLifecycle: lifecycle, now: () => now });
  const consent = async (account: string) => pool.query(`INSERT INTO account_consents
    (account_id,terms_version,privacy_version,age_confirmed,source)
    VALUES($1,$2,$3,true,'ANDROID')`, [account,CURRENT_TERMS_VERSION,CURRENT_PRIVACY_VERSION]);
  const rejects = (code: string) => (error: unknown) => error instanceof FriendError && error.code === code;
  const reader = 'reader', owner = 'owner';
  await consent(reader); await consent(owner);
  const ownerRoomId = (await rooms.setVisibility({ accountId: owner, visibility: 'PUBLIC' })).roomId!;
  const entryFor = async (author: string) => (await rooms.postGuestbook({
    accountId: author, roomId: ownerRoomId, requestId: randomUUID(), message: 'hello',
  })).entry.id;

  for (const visibility of [undefined, 'PRIVATE', 'FRIENDS'] as const) {
    const author = `closed-${visibility ?? 'missing'}`;
    await consent(author);
    if (visibility) await rooms.setVisibility({ accountId: author, visibility });
    const entryId = await entryFor(author);
    await assert.rejects(friends.addGuestbookAuthor({ accountId: reader, entryId }),
      rejects('FRIEND_GUESTBOOK_NOT_FOUND'), visibility);
  }
  for (const visibility of ['NEIGHBORS', 'PUBLIC'] as const) {
    const author = `open-${visibility}`;
    await consent(author);
    await rooms.setVisibility({ accountId: author, visibility });
    const entryId = await entryFor(author);
    const added = await friends.addGuestbookAuthor({ accountId: reader, entryId });
    assert.equal(added.created, true);
    assert.equal((await friends.addGuestbookAuthor({ accountId: reader, entryId })).created, false);
  }

  const entries: string[] = [];
  for (let i = 0; i < 20; i++) {
    const author = `cap-author-${i}`;
    await consent(author);
    await rooms.setVisibility({ accountId: author, visibility: 'PUBLIC' });
    entries.push(await entryFor(author));
  }
  for (const entryId of entries.slice(0,17))
    assert.equal((await friends.addGuestbookAuthor({ accountId: reader, entryId })).created, true);
  const final = await Promise.allSettled([
    friends.addGuestbookAuthor({ accountId: reader, entryId: entries[17]! }),
    friends.addGuestbookAuthor({ accountId: reader, entryId: entries[18]! }),
  ]);
  assert.deepEqual(final.map(result => result.status).sort(), ['fulfilled','rejected']);
  for (const result of final) {
    if (result.status === 'fulfilled') assert.equal(result.value.created, true);
    else assert.equal(rejects('FRIEND_GUESTBOOK_DAILY_LIMIT')(result.reason), true);
  }

  const author = 'over-cap';
  await consent(author);
  await rooms.setVisibility({ accountId: author, visibility: 'PUBLIC' });
  const overCapEntry = await entryFor(author);
  await assert.rejects(friends.addGuestbookAuthor({ accountId: reader, entryId: overCapEntry }),
    rejects('FRIEND_GUESTBOOK_DAILY_LIMIT'));
  assert.deepEqual((await pool.query(`SELECT business_date::text,created_count FROM room_guestbook_friend_add_counts
    WHERE account_id=$1`, [reader])).rows, [{ business_date: '2026-10-08', created_count: 20 }]);
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM friendships WHERE
    account_low=$1 OR account_high=$1`, [author])).rows[0].n, 0, 'rejected add rolls back friendship');
  assert.equal((await friends.addGuestbookAuthor({ accountId: reader, entryId: entries[0]! })).created, false);

  await pool.query(`DELETE FROM friendships WHERE account_low=$1 OR account_high=$1`, ['open-NEIGHBORS']);
  const removedEntry = await pool.query<{ id: string }>(`SELECT id FROM room_guestbook_entries WHERE author_account_id=$1`, ['open-NEIGHBORS']);
  await assert.rejects(friends.addGuestbookAuthor({ accountId: reader, entryId: removedEntry.rows[0]!.id }),
    rejects('FRIEND_GUESTBOOK_DAILY_LIMIT'), 'recreating a removed friendship spends another slot');
  now = new Date('2026-10-08T15:00:00Z');
  assert.equal((await friends.addGuestbookAuthor({ accountId: reader, entryId: overCapEntry })).created, true);
  assert.equal((await pool.query(`SELECT created_count FROM room_guestbook_friend_add_counts
    WHERE account_id=$1 AND business_date='2026-10-09'`, [reader])).rows[0].created_count, 1);
});
