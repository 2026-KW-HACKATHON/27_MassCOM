import type { PoolClient } from 'pg';
import { countedVisitFilterSql, countedVisitFromSql } from './badge-rewards.js';
import type { RoomVisibility } from '../room-community.js';

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
  const friends = await client.query(`SELECT 1 FROM friendships WHERE
    (account_low=$1 AND account_high=$2) OR (account_low=$2 AND account_high=$1)`, [viewer, owner]);
  if (friends.rowCount) return true;
  return visibility === 'NEIGHBORS' && (await sharedRoomMerchants(client, viewer, owner)).length > 0;
}
