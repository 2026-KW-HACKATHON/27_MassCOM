import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../account-consent.js';
import { RoomCommunityError, parseRoomMessage, roomVisitMileageRule, type PublicRoom, type RoomCommunityService,
  type RoomReport, type RoomSettings, type RoomStamp, type RoomStampKind, type RoomVisit } from '../room-community.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { assertPlatformAdmin } from './admin.js';
import { countedVisitFilterSql, countedVisitFromSql } from './badge-rewards.js';
import { canViewRoom, sharedRoomMerchants } from './room-access.js';
import type { PostgresPlayService } from './play.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
type RoomRow = { id: string; account_id: string; visible: boolean; visibility: 'PRIVATE' | 'FRIENDS' | 'NEIGHBORS' };
type StampRow = { id: string; kind: RoomStampKind; created_at: Date; author_account_id: string;
  message?: string | null; author_nickname?: string | null };

export class PostgresRoomCommunityService implements RoomCommunityService {
  private readonly now: () => Date;
  constructor(private readonly pool: Pool,
    private readonly options: { accountLifecycle: PostgresAccountLifecycle; play: Pick<PostgresPlayService, 'getPublicStudio'>; now?: () => Date }) {
    this.now = options.now ?? (() => new Date());
  }

  async getSettings(accountId: string): Promise<RoomSettings> {
    return this.transaction(async client => {
      await this.options.accountLifecycle.assertActive(client, accountId);
      const room = (await client.query<RoomRow>('SELECT id,account_id,visible,visibility FROM public_rooms WHERE account_id=$1', [accountId])).rows[0];
      return { visible: room?.visibility !== undefined && room.visibility !== 'PRIVATE', visibility: room?.visibility ?? 'PRIVATE', roomId: room?.id ?? null };
    });
  }

  async setVisibility(input: { accountId: string; visible?: boolean; visibility?: RoomRow['visibility'] }): Promise<RoomSettings> {
    const visibility = input.visibility ?? (input.visible === true ? 'NEIGHBORS' : input.visible === false ? 'PRIVATE' : undefined);
    if (!visibility || !['PRIVATE','FRIENDS','NEIGHBORS'].includes(visibility) ||
      (input.visible !== undefined && input.visible !== (visibility !== 'PRIVATE'))) throw new RoomCommunityError('ROOM_VISIBILITY_INVALID');
    return this.transaction(async client => {
      await this.options.accountLifecycle.assertActive(client, input.accountId);
      if (visibility !== 'PRIVATE' && !(await this.hasConsent(client, input.accountId))) throw new RoomCommunityError('ROOM_CONSENT_REQUIRED');
      const room = (await client.query<RoomRow>(`INSERT INTO public_rooms(account_id,id,visible,visibility,updated_at)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id) DO UPDATE SET visible=excluded.visible,
        visibility=excluded.visibility,updated_at=excluded.updated_at RETURNING id,account_id,visible,visibility`,
      [input.accountId, randomUUID(), visibility !== 'PRIVATE', visibility, this.now()])).rows[0]!;
      return { visible: room.visible, visibility: room.visibility, roomId: room.id };
    });
  }

  async randomRoom(input: { accountId: string; excludeRoomId?: string }): Promise<PublicRoom | null> {
    if (input.excludeRoomId !== undefined && !uuidPattern.test(input.excludeRoomId)) throw new RoomCommunityError('ROOM_NOT_FOUND');
    return this.transaction(async client => {
      if (!(await this.hasConsent(client, input.accountId))) {
        await this.options.accountLifecycle.assertActive(client, input.accountId);
        throw new RoomCommunityError('ROOM_CONSENT_REQUIRED');
      }
      // ponytail: random sort is acceptable for the current small opt-in population; indexed sampling if it grows.
      const candidates = (await client.query<RoomRow>(`SELECT room.id,room.account_id,room.visible,room.visibility FROM public_rooms room
        WHERE room.visibility<>'PRIVATE' AND room.account_id<>$1 AND room.id<>coalesce($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
          AND EXISTS(SELECT 1 FROM account_consents c WHERE c.account_id=room.account_id
            AND c.terms_version=$3 AND c.privacy_version=$4)
          AND NOT EXISTS(SELECT 1 FROM friend_blocks b WHERE
            (b.blocker=$1 AND b.blocked=room.account_id) OR (b.blocker=room.account_id AND b.blocked=$1))
          AND NOT EXISTS(SELECT 1 FROM room_blocks b WHERE
            (b.blocker_account_id=$1 AND b.blocked_account_id=room.account_id) OR
            (b.blocker_account_id=room.account_id AND b.blocked_account_id=$1))
        ORDER BY random()`, [input.accountId, input.excludeRoomId ?? null, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION])).rows;
      for (const candidate of candidates) {
        if (await canViewRoom(client, input.accountId, candidate.account_id, candidate.visibility))
          return this.checkedRoom(client, input.accountId, candidate.id);
      }
      await this.options.accountLifecycle.assertActive(client, input.accountId);
      return null;
    });
  }

  async neighbors(accountId: string): Promise<PublicRoom[]> {
    const rows = await this.transaction(async client => {
      await this.options.accountLifecycle.assertActive(client, accountId);
      if (!(await this.hasConsent(client, accountId))) throw new RoomCommunityError('ROOM_CONSENT_REQUIRED');
      return (await client.query<RoomRow>(`SELECT id,account_id,visible,visibility FROM public_rooms
        WHERE visibility='NEIGHBORS' AND account_id<>$1 ORDER BY updated_at DESC`, [accountId])).rows;
    });
    const eligible: PublicRoom[] = [];
    // Each candidate takes its own globally ordered account-pair locks; no prior candidate lock survives.
    for (const row of rows) {
      try { eligible.push(await this.getRoom({ accountId, roomId: row.id })); }
      catch (error) { if (!(error instanceof RoomCommunityError) || error.code !== 'ROOM_NOT_FOUND') throw error; }
      if (eligible.length === 20) break;
    }
    return eligible;
  }

  async visitors(accountId: string) {
    return this.transaction(async client => {
      await this.options.accountLifecycle.assertActive(client, accountId);
      const rows = (await client.query<{ visitor_account_id: string; nickname: string; visits: number;
        room_id: string | null; visibility: RoomRow['visibility'] | null }>(`
        SELECT visit.visitor_account_id,coalesce(profile.nickname,'탐험가') AS nickname,
          count(*)::integer AS visits, visitor_room.id AS room_id,visitor_room.visibility
        FROM public_rooms mine JOIN room_visits visit ON visit.room_id=mine.id
        LEFT JOIN explorer_profiles profile ON profile.account_id=visit.visitor_account_id
        LEFT JOIN public_rooms visitor_room ON visitor_room.account_id=visit.visitor_account_id
        WHERE mine.account_id=$1
          AND EXISTS (SELECT 1 FROM account_consents consent WHERE consent.account_id=visit.visitor_account_id
            AND consent.terms_version=$2 AND consent.privacy_version=$3)
          AND NOT EXISTS (SELECT 1 FROM friend_blocks blocked WHERE
            (blocked.blocker=$1 AND blocked.blocked=visit.visitor_account_id) OR
            (blocked.blocked=$1 AND blocked.blocker=visit.visitor_account_id))
          AND NOT EXISTS (SELECT 1 FROM room_blocks blocked WHERE
            (blocked.blocker_account_id=$1 AND blocked.blocked_account_id=visit.visitor_account_id) OR
            (blocked.blocked_account_id=$1 AND blocked.blocker_account_id=visit.visitor_account_id))
        GROUP BY visit.visitor_account_id,profile.nickname,visitor_room.id,visitor_room.visibility
        ORDER BY max(visit.visited_at) DESC LIMIT 20`,
      [accountId,CURRENT_TERMS_VERSION,CURRENT_PRIVACY_VERSION])).rows;
      const result = [];
      for (const row of rows) {
        const canReturn = Boolean(row.room_id && row.visibility &&
          await canViewRoom(client, accountId, row.visitor_account_id, row.visibility) &&
          await this.hasConsent(client, row.visitor_account_id));
        result.push({ nickname: row.nickname, visits: row.visits, roomId: canReturn ? row.room_id : null, canReturn });
      }
      return result;
    });
  }

  async getRoom(input: { accountId: string; roomId: string }): Promise<PublicRoom> {
    return this.transaction(async client => this.checkedRoom(client, input.accountId, input.roomId, true));
  }

  async visit(input: { accountId: string; roomId: string }): Promise<RoomVisit> {
    return this.transaction(async client => {
      const room = await this.checkedRoomRow(client, input.accountId, input.roomId);
      const day = dayFormatter.format(this.now());
      const existing = await client.query('SELECT 1 FROM room_visits WHERE visitor_account_id=$1 AND room_id=$2 AND business_date=$3',
        [input.accountId, room.id, day]);
      if (existing.rowCount) return { roomId: room.id, creditedMileage: 0, visitsToday: await this.visitsToday(client, input.accountId, day) };
      const count = await this.visitsToday(client, input.accountId, day);
      if (count >= 30) throw new RoomCommunityError('ROOM_RATE_LIMITED');
      const credited = (await client.query<{ n: number }>(`SELECT count(*)::integer AS n FROM mileage_credits
        WHERE account_id=$1 AND business_date=$2 AND reason='ROOM_VISIT'`,
        [input.accountId, day])).rows[0]!.n;
      const eligible = Boolean((await client.query(`SELECT 1 ${countedVisitFromSql} WHERE visit.customer_account_id=$1
        AND ${countedVisitFilterSql} LIMIT 1`, [input.accountId])).rowCount);
      const amount = roomVisitMileageRule({ firstVisitToday: true, eligible, creditedRoomsToday: credited });
      const id = randomUUID();
      await client.query(`INSERT INTO room_visits(id,visitor_account_id,room_id,business_date,visited_at,credited_mileage)
        VALUES($1,$2,$3,$4,$5,$6)`, [id, input.accountId, room.id, day, this.now(), amount]);
      if (amount) await client.query(`INSERT INTO mileage_credits(id,account_id,amount,reason,source_id,business_date,created_at)
        VALUES($1,$2,$3,'ROOM_VISIT',$4,$5,$6)`, [randomUUID(), input.accountId, amount, id, day, this.now()]);
      return { roomId: room.id, creditedMileage: amount, visitsToday: count + 1 };
    });
  }

  async stamp(input: { accountId: string; roomId: string; kind: RoomStampKind; message?: string }): Promise<RoomStamp> {
    if (!['COZY', 'COOL', 'RETURN'].includes(input.kind)) throw new RoomCommunityError('ROOM_STAMP_INVALID');
    const message = input.message === undefined ? null : parseRoomMessage(input.message);
    if (input.message !== undefined && message === null) throw new RoomCommunityError('ROOM_MESSAGE_INVALID');
    return this.transaction(async client => {
      const room = await this.checkedRoomRow(client, input.accountId, input.roomId);
      const day = dayFormatter.format(this.now());
      const count = (await client.query<{ n: number }>('SELECT count(*)::integer AS n FROM room_stamps WHERE author_account_id=$1 AND business_date=$2',
        [input.accountId, day])).rows[0]!.n;
      if (count >= 20) throw new RoomCommunityError('ROOM_STAMP_LIMIT');
      const stampedAt = this.now();
      const inserted = (await client.query<StampRow>(`INSERT INTO room_stamps(id,room_id,author_account_id,kind,business_date,created_at,message)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(room_id,author_account_id,business_date) DO NOTHING
        RETURNING id,kind,created_at,author_account_id,message`,
      [randomUUID(), room.id, input.accountId, input.kind, day, stampedAt, message])).rows[0];
      if (!inserted) throw new RoomCommunityError('ROOM_STAMP_LIMIT');
      inserted.author_nickname = (await client.query<{ nickname: string }>(
        'SELECT nickname FROM explorer_profiles WHERE account_id=$1', [input.accountId])).rows[0]?.nickname ?? null;
      return this.stampView(inserted, input.accountId);
    });
  }

  async removeStamp(input: { accountId: string; stampId: string }): Promise<void> {
    return this.moderateOwnStamp(input, 'remove');
  }

  async reportStamp(input: { accountId: string; stampId: string }): Promise<void> {
    return this.moderateOwnStamp(input, 'report');
  }

  async blockRoom(input: { accountId: string; roomId: string }): Promise<void> {
    return this.transaction(async client => {
      if (!uuidPattern.test(input.roomId)) throw new RoomCommunityError('ROOM_NOT_FOUND');
      const row = (await client.query<RoomRow>('SELECT id,account_id,visible,visibility FROM public_rooms WHERE id=$1', [input.roomId])).rows[0];
      if (!row || row.account_id === input.accountId) throw new RoomCommunityError('ROOM_NOT_FOUND');
      await this.assertPair(client, input.accountId, row.account_id);
      await client.query(`INSERT INTO room_blocks(blocker_account_id,blocked_account_id,created_at)
        VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [input.accountId, row.account_id, this.now()]);
    });
  }

  async listReports(actorAccountId: string): Promise<RoomReport[]> {
    return this.transaction(async client => {
      await assertPlatformAdmin(client, this.options.accountLifecycle, actorAccountId);
      const rows = (await client.query<{ stamp_id: string; kind: RoomStampKind; message: string | null;
        reports: number; first_reported_at: Date }>(
        `SELECT report.stamp_id,stamp.kind,stamp.message,count(*)::integer AS reports,min(report.created_at) AS first_reported_at
         FROM room_stamp_reports report JOIN room_stamps stamp ON stamp.id=report.stamp_id
         WHERE report.resolved_at IS NULL GROUP BY report.stamp_id,stamp.kind,stamp.message
         ORDER BY first_reported_at ASC,report.stamp_id ASC LIMIT 50`)).rows;
      return rows.map(row => ({ stampId: row.stamp_id, kind: row.kind, message: row.message, reports: row.reports,
        firstReportedAt: row.first_reported_at.toISOString() }));
    });
  }

  async moderateStamp(input: { actorAccountId: string; stampId: string }): Promise<void> {
    if (!uuidPattern.test(input.stampId)) throw new RoomCommunityError('ROOM_STAMP_NOT_FOUND');
    return this.transaction(async client => {
      await assertPlatformAdmin(client, this.options.accountLifecycle, input.actorAccountId);
      const hidden = await client.query('UPDATE room_stamps SET hidden_at=coalesce(hidden_at,$2) WHERE id=$1',
        [input.stampId, this.now()]);
      if (!hidden.rowCount) throw new RoomCommunityError('ROOM_STAMP_NOT_FOUND');
      await client.query(`UPDATE room_stamp_reports SET resolved_at=coalesce(resolved_at,$2),
        moderated_by_account_id=coalesce(moderated_by_account_id,$3) WHERE stamp_id=$1`,
      [input.stampId, this.now(), input.actorAccountId]);
    });
  }

  private async moderateOwnStamp(input: { accountId: string; stampId: string }, action: 'remove' | 'report'): Promise<void> {
    if (!uuidPattern.test(input.stampId)) throw new RoomCommunityError('ROOM_STAMP_NOT_FOUND');
    return this.transaction(async client => {
      const row = (await client.query<StampRow & { room_id: string; owner_id: string }>(`SELECT stamp.id,stamp.kind,stamp.created_at,
        stamp.author_account_id,stamp.room_id,room.account_id AS owner_id FROM room_stamps stamp
        JOIN public_rooms room ON room.id=stamp.room_id WHERE stamp.id=$1`, [input.stampId])).rows[0];
      if (!row) throw new RoomCommunityError('ROOM_STAMP_NOT_FOUND');
      await this.assertPair(client, input.accountId, row.owner_id);
      if (action === 'remove') {
        if (input.accountId !== row.author_account_id && input.accountId !== row.owner_id) throw new RoomCommunityError('ROOM_STAMP_NOT_FOUND');
        await client.query('UPDATE room_stamps SET hidden_at=coalesce(hidden_at,$2) WHERE id=$1', [input.stampId, this.now()]);
      } else {
        await this.checkedRoomRow(client, input.accountId, row.room_id);
        await client.query(`INSERT INTO room_stamp_reports(reporter_account_id,stamp_id,created_at)
          VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [input.accountId, input.stampId, this.now()]);
      }
    });
  }

  private async checkedRoom(client: PoolClient, viewer: string, roomId: string, allowOwner = false): Promise<PublicRoom> {
    const room = await this.checkedRoomRow(client, viewer, roomId, allowOwner);
    const studio = await this.options.play.getPublicStudio(client, room.account_id);
    const stamps = (await client.query<StampRow>(`SELECT stamp.id,stamp.kind,stamp.created_at,stamp.author_account_id,
      stamp.message,profile.nickname AS author_nickname FROM room_stamps stamp
      JOIN account_consents consent ON consent.account_id=stamp.author_account_id
        AND consent.terms_version=$2 AND consent.privacy_version=$3
      LEFT JOIN explorer_profiles profile ON profile.account_id=stamp.author_account_id
      WHERE stamp.room_id=$1 AND stamp.hidden_at IS NULL AND (stamp.author_account_id=$4 OR (
        NOT EXISTS (SELECT 1 FROM friend_blocks blocked WHERE
          (blocked.blocker=$4 AND blocked.blocked=stamp.author_account_id) OR
          (blocked.blocked=$4 AND blocked.blocker=stamp.author_account_id))
        AND NOT EXISTS (SELECT 1 FROM room_blocks blocked WHERE
          (blocked.blocker_account_id=$4 AND blocked.blocked_account_id=stamp.author_account_id) OR
          (blocked.blocked_account_id=$4 AND blocked.blocker_account_id=stamp.author_account_id))
      )) ORDER BY stamp.created_at DESC,stamp.id DESC LIMIT 20`,
    [room.id,CURRENT_TERMS_VERSION,CURRENT_PRIVACY_VERSION,viewer])).rows;
    const sharedMerchants = room.account_id === viewer ? [] : await sharedRoomMerchants(client, viewer, room.account_id);
    const visits = (await client.query<{ count: number; mine: boolean }>(`SELECT count(DISTINCT visitor_account_id)::integer AS count,
      coalesce(bool_or(visitor_account_id=$2),false) AS mine FROM room_visits WHERE room_id=$1`, [room.id, viewer])).rows[0]!;
    const returnVisitAvailable = room.account_id !== viewer && Boolean((await client.query(`SELECT 1 FROM room_visits
      WHERE visitor_account_id=$1 AND room_id IN (SELECT id FROM public_rooms WHERE account_id=$2) LIMIT 1`,
    [room.account_id, viewer])).rowCount);
    const friendshipId = room.account_id === viewer ? null : (await client.query<{ id: string }>(`SELECT id FROM friendships WHERE
      (account_low=$1 AND account_high=$2) OR (account_low=$2 AND account_high=$1)`, [viewer,room.account_id])).rows[0]?.id ?? null;
    return { roomId: room.id, mine: room.account_id === viewer, visibility: room.visibility, studio,
      stamps: stamps.map(stamp => this.stampView(stamp, viewer)), sharedMerchants,
      visitorCount: visits.count, hasVisited: visits.mine, returnVisitAvailable, friendshipId };
  }

  private async checkedRoomRow(client: PoolClient, viewer: string, roomId: string, allowOwner = false): Promise<RoomRow> {
    if (!uuidPattern.test(roomId)) throw new RoomCommunityError('ROOM_NOT_FOUND');
    const candidate = (await client.query<RoomRow>('SELECT id,account_id,visible,visibility FROM public_rooms WHERE id=$1', [roomId])).rows[0];
    if (!candidate || (candidate.account_id === viewer && !allowOwner)) throw new RoomCommunityError('ROOM_NOT_FOUND');
    await this.assertPair(client, viewer, candidate.account_id);
    const row = (await client.query<RoomRow>('SELECT id,account_id,visible,visibility FROM public_rooms WHERE id=$1 FOR SHARE', [roomId])).rows[0];
    if (!row || !(await this.hasConsent(client, viewer)) || !(await this.hasConsent(client, row.account_id))) {
      throw new RoomCommunityError('ROOM_NOT_FOUND');
    }
    if (!(await canViewRoom(client, viewer, row.account_id, row.visibility))) throw new RoomCommunityError('ROOM_NOT_FOUND');
    return row;
  }

  private async assertPair(client: PoolClient, viewer: string, owner: string): Promise<void> {
    try { await this.options.accountLifecycle.assertAllActive(client, [viewer, owner]); }
    catch (error) {
      if (!(error instanceof AccountLifecycleError)) throw error;
      await this.options.accountLifecycle.assertActive(client, viewer);
      throw new RoomCommunityError('ROOM_NOT_FOUND');
    }
  }

  private async hasConsent(client: PoolClient, accountId: string): Promise<boolean> {
    return Boolean((await client.query(`SELECT 1 FROM account_consents
      WHERE account_id=$1 AND terms_version=$2 AND privacy_version=$3`,
    [accountId, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION])).rowCount);
  }

  private async visitsToday(client: PoolClient, accountId: string, day: string): Promise<number> {
    return (await client.query<{ n: number }>(`SELECT count(*)::integer AS n FROM room_visits
      WHERE visitor_account_id=$1 AND business_date=$2`, [accountId, day])).rows[0]!.n;
  }

  private stampView(row: StampRow, viewer: string): RoomStamp {
    return { id: row.id, kind: row.kind, createdAt: row.created_at.toISOString(), mine: row.author_account_id === viewer,
      authorNickname: row.author_nickname ?? '탐험가', ...(row.message ? { message: row.message } : {}) };
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new RoomCommunityError(error.code);
      throw error;
    } finally { client.release(); }
  }
}
