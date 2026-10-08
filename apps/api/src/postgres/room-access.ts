import type { PoolClient } from 'pg';
import { countedVisitFilterSql, countedVisitFromSql } from './badge-rewards.js';
import type { RoomVisibility } from '../room-community.js';
import { RoomCommunityError } from '../room-community.js';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../account-consent.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';

export async function sharedRoomMerchants(client: PoolClient, viewer: string, owner: string): Promise<{ merchantId: string; merchantName: string }[]> {
  return (await client.query<{ merchantId: string; merchantName: string }>(`
    WITH viewer_merchants AS (SELECT DISTINCT visit.merchant_id ${countedVisitFromSql}
      WHERE visit.customer_account_id=$1 AND ${countedVisitFilterSql}),
    owner_merchants AS (SELECT DISTINCT visit.merchant_id ${countedVisitFromSql}
      WHERE visit.customer_account_id=$2 AND ${countedVisitFilterSql})
    SELECT merchant.id AS "merchantId", merchant.name AS "merchantName"
    FROM viewer_merchants viewer JOIN owner_merchants owner USING (merchant_id)
    JOIN merchants merchant ON merchant.id=viewer.merchant_id ORDER BY merchant.name,merchant.id LIMIT 20`, [viewer, owner])).rows;
}

export async function canViewRoom(client: PoolClient, viewer: string, owner: string, visibility: RoomVisibility): Promise<boolean> {
  if (viewer === owner) return true;
  if (visibility === 'PRIVATE') return false;
  const blocked = await client.query(`SELECT 1 FROM friend_blocks WHERE
    (blocker=$1 AND blocked=$2) OR (blocker=$2 AND blocked=$1)
    UNION ALL SELECT 1 FROM room_blocks WHERE
    (blocker_account_id=$1 AND blocked_account_id=$2) OR (blocker_account_id=$2 AND blocked_account_id=$1) LIMIT 1`, [viewer, owner]);
  if (blocked.rowCount) return false;
  if (visibility === 'PUBLIC') return true;
  const friends = await client.query(`SELECT 1 FROM friendships WHERE
    (account_low=$1 AND account_high=$2) OR (account_low=$2 AND account_high=$1)`, [viewer, owner]);
  if (friends.rowCount) return true;
  return visibility === 'NEIGHBORS' && (await sharedRoomMerchants(client, viewer, owner)).length > 0;
}

// The author popup and friendship action must prove access to the originating visible entry again.
// Lock all three accounts together before any pair checks to preserve the global lifecycle lock order.
export async function checkedGuestbookEntry(client: PoolClient, lifecycle: PostgresAccountLifecycle,
  viewer: string, entryId: string): Promise<{ id: string; room_id: string; author_account_id: string; owner_id: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entryId))
    throw new RoomCommunityError('ROOM_GUESTBOOK_NOT_FOUND');
  const candidate = (await client.query<{ author_account_id: string; owner_id: string }>(`SELECT entry.author_account_id,
    room.account_id AS owner_id FROM room_guestbook_entries entry JOIN public_rooms room ON room.id=entry.room_id
    WHERE entry.id=$1`, [entryId])).rows[0];
  if (!candidate) throw new RoomCommunityError('ROOM_GUESTBOOK_NOT_FOUND');
  try { await lifecycle.assertAllActive(client, [viewer, candidate.owner_id, candidate.author_account_id]); }
  catch (error) {
    if (!(error instanceof AccountLifecycleError)) throw error;
    await lifecycle.assertActive(client, viewer);
    throw new RoomCommunityError('ROOM_GUESTBOOK_NOT_FOUND');
  }
  const row = (await client.query<{ id: string; room_id: string; author_account_id: string; owner_id: string; visibility: RoomVisibility }>(
    `SELECT entry.id,entry.room_id,entry.author_account_id,room.account_id AS owner_id,room.visibility
     FROM room_guestbook_entries entry JOIN public_rooms room ON room.id=entry.room_id
     WHERE entry.id=$1 AND entry.hidden_at IS NULL FOR SHARE OF entry,room`, [entryId])).rows[0];
  if (!row) throw new RoomCommunityError('ROOM_GUESTBOOK_NOT_FOUND');
  const accounts = [...new Set([viewer, row.owner_id, row.author_account_id])];
  const consents = await client.query(`SELECT 1 FROM account_consents WHERE account_id=ANY($1::text[])
    AND terms_version=$2 AND privacy_version=$3`, [accounts,CURRENT_TERMS_VERSION,CURRENT_PRIVACY_VERSION]);
  if (consents.rowCount !== accounts.length || !(await canViewRoom(client,viewer,row.owner_id,row.visibility)) ||
    !(await canViewRoom(client,viewer,row.author_account_id,'PUBLIC')) ||
    !(await canViewRoom(client,row.owner_id,row.author_account_id,'PUBLIC')))
    throw new RoomCommunityError('ROOM_GUESTBOOK_NOT_FOUND');
  return row;
}
