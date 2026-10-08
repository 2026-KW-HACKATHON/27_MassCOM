import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';

import type {
  CampaignSummary, DiscoveryEvent, DiscoveryPage, DiscoveryQuery, Engagement,
  MerchantDetail, MerchantPhoto, MerchantReport, MerchantSummary, PhotoUploadInput, Point,
  RealGameContext, RealWorldMediaStore, RealWorldProfile, RealWorldProfileView,
} from '../real-world-contract.js';
import { RealWorldError } from '../real-world-contract.js';
import { businessStateAt } from '../real-world-hours.js';
import { validatePoint, validateRealWorldProfile } from '../real-world-rules.js';
import type { PostgresAccountLifecycle } from './account-lifecycle.js';

type MerchantRow = {
  id: string; name: string; road_address: string; category: string | null; is_demo: boolean;
  version: number; story: string; business_hours: string; minimum_spend_won: number;
  updated_at: Date; consent_document_ref: string | null;
  legacy_menu_items: { name: string; priceWon: number }[];
  profile: RealWorldProfile | null; latitude: number | null; longitude: number | null;
};
type CampaignRow = { id: string; title: string; starts_at: Date; ends_at: Date; status: string;
  enrolled_count: number; enrollment_capacity: number; collectible_available: boolean;
  goals: { targetVisitCount: 1 | 3 | 5; displayName: string }[] };
type PhotoRow = { id: string; digest: string; mime_type: PhotoUploadInput['mimeType']; width: number; height: number;
  kind: MerchantPhoto['kind']; caption: string | null; updated_at: Date };
type ReportRow = { id: string; merchant_id: string; kind: MerchantReport['kind']; note: string;
  status: MerchantReport['status']; created_at: Date; resolution: string | null };

const emptyProfile = (): RealWorldProfile => ({ location: null, schedule: null, todayOverride: null,
  menuItems: [], visitInstructions: '', contact: { phone: null, website: null } });
const profileFor = (row: MerchantRow): RealWorldProfile => row.profile ?? {
  ...emptyProfile(), menuItems: row.legacy_menu_items.map((item, index) => ({
    id: `legacy-${createHash('sha256').update(`${row.id}:${index}:${item.name}:${item.priceWon}`).digest('hex').slice(0, 16)}`,
    name: item.name, priceWon: item.priceWon, priceNote: null, photoId: null,
  })),
};
const toPhoto = (row: PhotoRow): MerchantPhoto => ({ id: row.id, url: `/v1/discovery/photos/${row.digest}`,
  width: row.width, height: row.height, kind: row.kind, source: 'OWNER_PHOTO', caption: row.caption,
  updatedAt: row.updated_at.toISOString() });
const toReport = (row: ReportRow): MerchantReport => ({ id: row.id, merchantId: row.merchant_id,
  kind: row.kind, note: row.note, status: row.status, createdAt: row.created_at.toISOString(), resolution: row.resolution });
const digestQuery = (query: DiscoveryQuery) => createHash('sha256').update(JSON.stringify({
  bounds: query.bounds, zoom: query.zoom, query: query.query ?? '', category: query.category ?? '',
  campaignOnly: query.campaignOnly ?? false, openOnly: query.openOnly ?? false,
  origin: query.origin ?? null,
})).digest('hex');

function decodeCursor(cursor: string | undefined, fingerprint: string): { name: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') throw 0;
    const raw = parsed as Record<string, unknown>;
    if (raw.fingerprint !== fingerprint || typeof raw.name !== 'string' || typeof raw.id !== 'string') throw 0;
    return { name: raw.name, id: raw.id };
  } catch { throw new RealWorldError('DISCOVERY_CURSOR_INVALID'); }
}

function campaignAt(row: CampaignRow | undefined, now: Date): CampaignSummary | null {
  if (!row) return null;
  const state = row.status === 'ENDED' || row.ends_at <= now ? 'ENDED'
    : row.status === 'PAUSED' ? 'PAUSED' : row.starts_at > now ? 'SCHEDULED' : 'ACTIVE';
  const enrollment = state !== 'ACTIVE' ? 'CLOSED' : row.enrolled_count >= row.enrollment_capacity ? 'FULL' : 'OPEN';
  return { id: row.id, title: row.title, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(),
    state, enrollment, rewardAvailability: state !== 'ACTIVE' ? 'NOT_RUNNING' : !row.collectible_available ? 'UNKNOWN'
      : 'AVAILABLE', goals: row.goals ?? [] };
}

function distance(origin: Point, destination: Point): number {
  const toRad = Math.PI / 180;
  const a = Math.sin((destination.latitude - origin.latitude) * toRad / 2) ** 2 +
    Math.cos(origin.latitude * toRad) * Math.cos(destination.latitude * toRad) *
    Math.sin((destination.longitude - origin.longitude) * toRad / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export class PostgresRealWorldService {
  private readonly now: () => Date;
  private readonly includeDemo: boolean;
  private readonly mediaStore: RealWorldMediaStore | undefined;
  private readonly accountLifecycle: PostgresAccountLifecycle | undefined;
  private readonly isAdmin: (client: PoolClient, accountId: string) => Promise<boolean>;

  constructor(private readonly pool: Pool, options: {
    now?: () => Date; includeDemo?: boolean; mediaStore?: RealWorldMediaStore;
    accountLifecycle?: PostgresAccountLifecycle; isAdmin?: (client: PoolClient, accountId: string) => Promise<boolean>;
  } = {}) {
    this.now = options.now ?? (() => new Date());
    this.includeDemo = options.includeDemo === true;
    this.mediaStore = options.mediaStore;
    this.accountLifecycle = options.accountLifecycle;
    this.isAdmin = options.isAdmin ?? (async () => false);
  }

  private requireLifecycle(): PostgresAccountLifecycle {
    if (!this.accountLifecycle) throw new RealWorldError('ACCOUNT_LIFECYCLE_NOT_CONFIGURED', 503);
    return this.accountLifecycle;
  }

  private async visible(id: string, db: Pool | PoolClient = this.pool): Promise<MerchantRow> {
    const result = await db.query<MerchantRow>(
      `SELECT m.id, m.name, m.road_address, m.category, m.is_demo, m.version, m.story,
              m.consent_document_ref,
              m.business_hours, m.minimum_spend_won, m.menu_items AS legacy_menu_items,
              m.updated_at, p.profile, p.latitude, p.longitude
       FROM merchants m LEFT JOIN merchant_real_world_profiles p ON p.merchant_id = m.id
       WHERE m.id = $1 AND m.status = 'ACTIVE' AND m.published_at IS NOT NULL
         AND ($2::boolean OR NOT m.is_demo)
         AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials t WHERE t.merchant_id = m.id)`, [id, this.includeDemo]);
    if (!result.rows[0]) throw new RealWorldError('MERCHANT_NOT_FOUND', 404);
    return result.rows[0];
  }

  private async photos(merchantIds: string[]): Promise<Map<string, MerchantPhoto[]>> {
    const result = await this.pool.query<PhotoRow & { merchant_id: string }>(
      `SELECT merchant_id, id, digest, mime_type, width, height, kind, caption, updated_at
       FROM merchant_real_world_photos WHERE merchant_id = ANY($1::text[]) AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC`, [merchantIds]);
    const byMerchant = new Map<string, MerchantPhoto[]>();
    for (const row of result.rows) byMerchant.set(row.merchant_id, [...byMerchant.get(row.merchant_id) ?? [], toPhoto(row)]);
    return byMerchant;
  }

  private async campaigns(ids: string[], at: Date, db: Pool | PoolClient = this.pool): Promise<Map<string, CampaignSummary>> {
    const result = await db.query<CampaignRow & { merchant_id: string }>(
      `SELECT DISTINCT ON (c.merchant_id) c.merchant_id, c.id, c.title, c.starts_at, c.ends_at,
              c.status, c.enrolled_count, c.enrollment_capacity,
              EXISTS (SELECT 1 FROM campaign_collectible_publications link
                JOIN collectible_publications publication ON publication.id = link.publication_id
                JOIN campaign_goals goal ON goal.campaign_id = c.id
                JOIN collectible_publication_grades grade ON grade.publication_id = publication.id
                  AND grade.grade_id = publication.reward_grades->>goal.target_visit_count::text
                WHERE link.campaign_id = c.id AND publication.media_removed_at IS NULL
                  AND (SELECT array_agg(all_goal.target_visit_count ORDER BY all_goal.target_visit_count)
                    FROM campaign_goals all_goal WHERE all_goal.campaign_id = c.id) = ARRAY[1,3,5]::integer[]
              ) AS collectible_available,
              coalesce((SELECT jsonb_agg(jsonb_build_object('targetVisitCount', g.target_visit_count,
                'displayName', g.display_name) ORDER BY g.target_visit_count)
                FROM campaign_goals g WHERE g.campaign_id = c.id), '[]'::jsonb) AS goals
       FROM campaigns c WHERE c.merchant_id = ANY($1::text[]) AND c.is_public
         AND c.status IN ('ACTIVE', 'PAUSED', 'ENDED')
       ORDER BY c.merchant_id, (c.status = 'ACTIVE' AND c.starts_at <= $2 AND c.ends_at > $2) DESC,
                c.ends_at DESC, c.id`, [ids, at]);
    return new Map(result.rows.map(row => [row.merchant_id, campaignAt(row, at)!]));
  }

  private summary(row: MerchantRow, at: Date, campaign: CampaignSummary | null,
    photo: MerchantPhoto | null, origin?: DiscoveryQuery['origin']): MerchantSummary {
    const profile = profileFor(row);
    const position = row.latitude === null || row.longitude === null ? null :
      { latitude: row.latitude, longitude: row.longitude };
    return { id: row.id, name: row.name, roadAddress: row.road_address, category: row.category,
      demo: row.is_demo, profileVersion: row.version, position, positionBasis: position ? 'OWNED' : 'UNVERIFIED',
      positionExpiresAt: null, floor: profile.location?.floor ?? null,
      entranceNote: profile.location?.entranceNote ?? null, thumbnail: photo,
      business: businessStateAt(profile.schedule, at, profile.todayOverride), campaign,
      distance: position && origin ? { meters: distance(origin, position), kind: 'STRAIGHT_LINE', origin: origin.basis } : null };
  }

  private detail(row: MerchantRow, at: Date, campaign: CampaignSummary | null,
    photos: MerchantPhoto[]): MerchantDetail {
    const profile = profileFor(row);
    const location = profile.location;
    return { ...this.summary(row, at, campaign, photos[0] ?? null),
      location: location ? { building: location.building, entrance: location.entrance,
        floor: location.floor, unit: location.unit, entranceNote: location.entranceNote,
        source: location.source, verifiedAt: location.verifiedAt } : null,
      schedule: profile.schedule, todayOverride: profile.todayOverride, menuItems: profile.menuItems,
      visitInstructions: profile.visitInstructions, contact: profile.contact,
      story: row.story, legacyBusinessHours: row.business_hours,
      minimumSpendWon: row.minimum_spend_won, photos, updatedAt: row.updated_at.toISOString() };
  }

  async search(query: DiscoveryQuery): Promise<DiscoveryPage> {
    const { west, south, east, north } = query.bounds;
    if (![west, south, east, north, query.zoom].every(Number.isFinite) ||
        west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north ||
        query.zoom < 0 || query.zoom > 24 || query.query && query.query.length > 100 ||
        query.category && query.category.length > 80) throw new RealWorldError('DISCOVERY_QUERY_INVALID');
    if (query.origin) validatePoint(query.origin);
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RealWorldError('DISCOVERY_QUERY_INVALID');
    const fingerprint = digestQuery(query), cursor = decodeCursor(query.cursor, fingerprint), at = this.now();
    const filter = `m.status = 'ACTIVE' AND m.published_at IS NOT NULL AND ($1::boolean OR NOT m.is_demo)
      AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials t WHERE t.merchant_id = m.id)
      AND (p.latitude IS NULL OR (p.longitude >= $2 AND p.longitude <= $3 AND p.latitude >= $4 AND p.latitude <= $5))
      AND ($6::text IS NULL OR m.name ILIKE '%' || $6 || '%' OR m.road_address ILIKE '%' || $6 || '%')
      AND ($7::text IS NULL OR m.category = $7)`;
    const escapedQuery = query.query?.trim().replace(/[\\%_]/g, '\\$&') || null;
    const params = [this.includeDemo, west, east, south, north, escapedQuery, query.category ?? null];
    const merchants: MerchantSummary[] = [];
    let after = cursor;
    let exhausted = false;
    let batches = 0;
    while (merchants.length <= limit && !exhausted && batches++ < 5) {
      const result = await this.pool.query<MerchantRow>(
        `SELECT m.id, m.name, m.road_address, m.category, m.is_demo, m.version, m.story,
                m.consent_document_ref,
                m.business_hours, m.minimum_spend_won, m.menu_items AS legacy_menu_items,
                m.updated_at, p.profile, p.latitude, p.longitude
         FROM merchants m LEFT JOIN merchant_real_world_profiles p ON p.merchant_id = m.id
         WHERE ${filter} AND ($8::text IS NULL OR (m.name, m.id) > ($8, $9))
         ORDER BY m.name, m.id LIMIT 100`, [...params, after?.name ?? null, after?.id ?? null]);
      if (result.rows.length < 100) exhausted = true;
      if (!result.rows.length) break;
      const ids = result.rows.map(row => row.id);
      const [campaigns, photos] = await Promise.all([this.campaigns(ids, at), this.photos(ids)]);
      for (const row of result.rows) {
        after = { name: row.name, id: row.id };
        const item = this.summary(row, at, campaigns.get(row.id) ?? null,
          photos.get(row.id)?.[0] ?? null, query.origin);
        if ((!query.campaignOnly || item.campaign?.state === 'ACTIVE') &&
            (!query.openOnly || item.business.state === 'OPEN')) merchants.push(item);
        if (merchants.length > limit) break;
      }
    }
    const page = merchants.slice(0, limit);
    const last = page.at(-1);
    const missing = await this.pool.query<{ count: number }>(`SELECT count(*)::integer AS count FROM merchants m
      LEFT JOIN merchant_real_world_profiles p ON p.merchant_id = m.id
      WHERE ${filter} AND p.latitude IS NULL`, params);
    const scale = 2 ** query.zoom;
    const clusterRows = query.openOnly ? null : await this.pool.query<{ cell_y: number; cell_x: number; count: number;
      latitude: number; longitude: number; south: number; north: number; west: number; east: number }>(
      `SELECT floor(p.latitude * $8 / 180)::integer AS cell_y,
              floor(p.longitude * $8 / 360)::integer AS cell_x,
              count(*)::integer AS count, avg(p.latitude) AS latitude, avg(p.longitude) AS longitude,
              min(p.latitude) AS south, max(p.latitude) AS north,
              min(p.longitude) AS west, max(p.longitude) AS east
       FROM merchants m JOIN merchant_real_world_profiles p ON p.merchant_id = m.id
       WHERE ${filter} AND p.latitude IS NOT NULL
         AND ($9::boolean IS FALSE OR EXISTS (SELECT 1 FROM campaigns c
           WHERE c.merchant_id = m.id AND c.is_public AND c.status = 'ACTIVE'
             AND c.starts_at <= $10 AND c.ends_at > $10))
       GROUP BY cell_y, cell_x`, [...params, scale, !!query.campaignOnly, at]);
    const openGroups = new Map<string, Point[]>();
    if (query.openOnly) {
      const candidates = await this.pool.query<{ latitude: number; longitude: number; profile: RealWorldProfile }>(
        `SELECT p.latitude, p.longitude, p.profile
         FROM merchants m JOIN merchant_real_world_profiles p ON p.merchant_id = m.id
         WHERE ${filter} AND p.latitude IS NOT NULL
           AND ($8::boolean IS FALSE OR EXISTS (SELECT 1 FROM campaigns c
             WHERE c.merchant_id = m.id AND c.is_public AND c.status = 'ACTIVE'
               AND c.starts_at <= $9 AND c.ends_at > $9))
         ORDER BY m.id LIMIT 5001`, [...params, !!query.campaignOnly, at]);
      if (candidates.rows.length > 5000) throw new RealWorldError('DISCOVERY_ZOOM_REQUIRED', 422);
      for (const row of candidates.rows) {
        if (businessStateAt(row.profile.schedule, at, row.profile.todayOverride).state !== 'OPEN') continue;
        const key = `${Math.floor(row.latitude * scale / 180)}:${Math.floor(row.longitude * scale / 360)}`;
        openGroups.set(key, [...openGroups.get(key) ?? [], { latitude: row.latitude, longitude: row.longitude }]);
      }
    }
    return { schemaVersion: 1, asOf: at.toISOString(), merchants: page,
      clusters: clusterRows?.rows.map(row => ({ id: `cluster:${row.cell_y}:${row.cell_x}`,
        position: { latitude: Number(row.latitude), longitude: Number(row.longitude) }, count: row.count,
        bounds: { west: row.west, east: row.east, south: row.south, north: row.north } })) ??
        [...openGroups.entries()].map(([key, items]) => ({
          id: `cluster:${key}`, position: items[0]!, count: items.length,
          bounds: { west: Math.min(...items.map(item => item.longitude)),
            east: Math.max(...items.map(item => item.longitude)),
            south: Math.min(...items.map(item => item.latitude)),
            north: Math.max(...items.map(item => item.latitude)) },
        })),
      nextCursor: (merchants.length > limit || !exhausted) && (last || after) ?
        Buffer.from(JSON.stringify({ fingerprint, name: (last ?? after)!.name, id: (last ?? after)!.id })).toString('base64url') : null,
      unlocatedCount: missing.rows[0]?.count ?? 0 };
  }

  async merchant(id: string): Promise<MerchantDetail> {
    const row = await this.visible(id), at = this.now();
    const [campaigns, photos] = await Promise.all([this.campaigns([id], at), this.photos([id])]);
    return this.detail(row, at, campaigns.get(id) ?? null, photos.get(id) ?? []);
  }

  private async lockedOwner(client: PoolClient, accountId: string, id: string, expectedVersion?: number): Promise<MerchantRow> {
    await this.requireLifecycle().assertActive(client, accountId);
    const row = await client.query<MerchantRow>(
      `SELECT m.id, m.name, m.road_address, m.category, m.is_demo, m.version, m.story,
              m.consent_document_ref,
              m.business_hours, m.minimum_spend_won, m.menu_items AS legacy_menu_items,
              m.updated_at, p.profile, p.latitude, p.longitude
       FROM merchants m LEFT JOIN merchant_real_world_profiles p ON p.merchant_id = m.id
       WHERE m.id = $1 FOR UPDATE OF m`, [id]);
    const merchant = row.rows[0];
    if (!merchant) throw new RealWorldError('MERCHANT_FORBIDDEN', 403);
    const membership = await client.query<{ role: string }>(
      `SELECT role FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 AND status = 'ACTIVE'`, [id, accountId]);
    const personalDemo = merchant.is_demo && (await client.query(
      `SELECT 1 FROM showcase_guest_trials WHERE merchant_id = $1 AND account_id = $2
         AND ended_at IS NULL AND expires_at > $3`, [id, accountId, this.now()])).rowCount === 1;
    const admin = await this.isAdmin(client, accountId);
    if (!admin && (membership.rows[0]?.role !== 'OWNER' || merchant.is_demo && !personalDemo)) {
      throw new RealWorldError('MERCHANT_FORBIDDEN', 403);
    }
    if (expectedVersion !== undefined && merchant.version !== expectedVersion) throw new RealWorldError('VERSION_CONFLICT', 409);
    return merchant;
  }

  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await action(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async ownerView(client: PoolClient, merchant: MerchantRow): Promise<RealWorldProfileView> {
    const at = this.now();
    const photos = await client.query<PhotoRow>(
      `SELECT id, digest, mime_type, width, height, kind, caption, updated_at
       FROM merchant_real_world_photos WHERE merchant_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`, [merchant.id]);
    const profile = profileFor(merchant);
    const publicPhotos = photos.rows.map(toPhoto);
    const campaigns = await this.campaigns([merchant.id], at, client);
    return { schemaVersion: 1, asOf: at.toISOString(), merchantId: merchant.id, version: merchant.version,
      profile, photos: publicPhotos,
      preview: this.detail(merchant, at, campaigns.get(merchant.id) ?? null, publicPhotos), readiness: [
        { key: 'location', ready: profile.location !== null, label: '확인된 위치', field: 'location' },
        { key: 'schedule', ready: profile.schedule !== null, label: '영업시간', field: 'schedule' },
        { key: 'menu', ready: profile.menuItems.length > 0, label: '메뉴', field: 'menuItems' },
        { key: 'photo', ready: photos.rows.length > 0, label: '실제 사진', field: 'photos' },
        { key: 'consent', ready: !!merchant.consent_document_ref, label: '점주 동의', field: 'consent' },
      ] };
  }

  async profile(accountId: string, id: string): Promise<RealWorldProfileView> {
    return this.transaction(async client => this.ownerView(client, await this.lockedOwner(client, accountId, id)));
  }

  async updateProfile(accountId: string, id: string, input: { expectedVersion: number; profile: RealWorldProfile }): Promise<RealWorldProfileView> {
    const profile = validateRealWorldProfile(input.profile);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new RealWorldError('VERSION_INVALID');
    return this.transaction(async client => {
      const merchant = await this.lockedOwner(client, accountId, id, input.expectedVersion);
      if (profile.location?.source === 'ADMIN_DOCUMENTED' &&
          !isDeepStrictEqual(profile.location, merchant.profile?.location) &&
          !await this.isAdmin(client, accountId)) {
        throw new RealWorldError('LOCATION_SOURCE_FORBIDDEN', 403);
      }
      if (profile.menuItems.some(item => item.photoId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(item.photoId))) {
        throw new RealWorldError('PROFILE_PHOTO_INVALID');
      }
      const photoIds = [...new Set(profile.menuItems.map(item => item.photoId).filter((photoId): photoId is string => photoId !== null))];
      if (photoIds.length &&
          (await client.query<{ id: string }>(`SELECT id FROM merchant_real_world_photos
            WHERE merchant_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])`,
            [id, photoIds])).rowCount !== photoIds.length) throw new RealWorldError('PROFILE_PHOTO_INVALID');
      await client.query(`INSERT INTO merchant_real_world_profiles (merchant_id, profile, latitude, longitude, updated_at)
        VALUES ($1, $2::jsonb, $3, $4, $5)
        ON CONFLICT (merchant_id) DO UPDATE SET profile = EXCLUDED.profile, latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude, updated_at = EXCLUDED.updated_at`,
      [id, JSON.stringify(profile), profile.location?.building.latitude ?? null,
        profile.location?.building.longitude ?? null, this.now()]);
      const updated = await client.query<MerchantRow>(
        `UPDATE merchants SET version = version + 1, updated_at = $2 WHERE id = $1 RETURNING version, updated_at`, [id, this.now()]);
      return this.ownerView(client, { ...merchant, version: updated.rows[0]!.version,
        updated_at: updated.rows[0]!.updated_at, profile });
    });
  }

  async createPhoto(accountId: string, id: string, input: PhotoUploadInput): Promise<RealWorldProfileView> {
    if (input.rightsConfirmed !== true || !['STORE', 'MENU', 'ENTRANCE', 'PACKAGING', 'SIGN'].includes(input.kind) ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(input.mimeType) || !(input.bytes instanceof Uint8Array) ||
        input.bytes.length < 16 || input.bytes.length > 8 * 1024 * 1024 ||
        !(input.caption === null || typeof input.caption === 'string' && input.caption.length <= 300) ||
        !Number.isSafeInteger(input.expectedVersion)) throw new RealWorldError('PHOTO_INVALID');
    if (!this.mediaStore) throw new RealWorldError('PHOTO_STORE_NOT_CONFIGURED', 503);
    // Fail authorization/version cheaply before decode; recheck after media processing under the same lock order.
    await this.profile(accountId, id).then(view => { if (view.version !== input.expectedVersion) throw new RealWorldError('VERSION_CONFLICT', 409); });
    const media = await this.mediaStore.save(input.bytes, input.mimeType);
    if (!/^[a-f0-9]{64}$/.test(media.digest) || !Number.isInteger(media.width) || media.width < 1 ||
        !Number.isInteger(media.height) || media.height < 1) throw new RealWorldError('PHOTO_INVALID');
    return this.transaction(async client => {
      const merchant = await this.lockedOwner(client, accountId, id, input.expectedVersion);
      await client.query(`INSERT INTO merchant_real_world_photos
        (id, merchant_id, digest, mime_type, width, height, kind, caption, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
      [randomUUID(), id, media.digest, 'image/webp', media.width, media.height, input.kind, input.caption, this.now()]);
      const updated = await client.query<MerchantRow>(
        `UPDATE merchants SET version = version + 1, updated_at = $2 WHERE id = $1 RETURNING version, updated_at`, [id, this.now()]);
      return this.ownerView(client, { ...merchant, version: updated.rows[0]!.version,
        updated_at: updated.rows[0]!.updated_at });
    });
  }

  async deletePhoto(accountId: string, id: string, photoId: string, expectedVersion: number): Promise<RealWorldProfileView> {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(photoId)) {
      throw new RealWorldError('PHOTO_INVALID');
    }
    return this.transaction(async client => {
      const merchant = await this.lockedOwner(client, accountId, id, expectedVersion);
      const now = this.now();
      const changed = await client.query(`UPDATE merchant_real_world_photos SET deleted_at = $3, updated_at = $3
        WHERE id = $1 AND merchant_id = $2 AND deleted_at IS NULL`, [photoId, id, now]);
      if (!changed.rowCount) throw new RealWorldError('PHOTO_NOT_FOUND', 404);
      const profile = merchant.profile && { ...merchant.profile,
        menuItems: merchant.profile.menuItems.map(item => item.photoId?.toLowerCase() === photoId.toLowerCase() ?
          { ...item, photoId: null } : item) };
      if (profile && !isDeepStrictEqual(profile, merchant.profile)) {
        await client.query(`UPDATE merchant_real_world_profiles SET profile = $2::jsonb, updated_at = $3
          WHERE merchant_id = $1`, [id, JSON.stringify(profile), now]);
      }
      const updated = await client.query<MerchantRow>(
        `UPDATE merchants SET version = version + 1, updated_at = $2 WHERE id = $1 RETURNING version, updated_at`, [id, now]);
      return this.ownerView(client, { ...merchant, version: updated.rows[0]!.version,
        updated_at: updated.rows[0]!.updated_at, profile });
    });
  }

  async publicPhoto(digest: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    if (!/^[a-f0-9]{64}$/.test(digest) || !this.mediaStore) return null;
    const row = await this.pool.query<{ mime_type: string }>(
      `SELECT photo.mime_type FROM merchant_real_world_photos photo
       JOIN merchants m ON m.id = photo.merchant_id
       WHERE photo.digest = $1 AND photo.deleted_at IS NULL AND m.status = 'ACTIVE'
         AND m.published_at IS NOT NULL AND ($2::boolean OR NOT m.is_demo)
         AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials t WHERE t.merchant_id = m.id)
       LIMIT 1`, [digest, this.includeDemo]);
    if (!row.rows[0]) return null;
    const bytes = await this.mediaStore.read(digest);
    return bytes ? { bytes, mimeType: row.rows[0].mime_type } : null;
  }

  async privatePhoto(accountId: string, id: string, photoId: string): Promise<{ bytes: Uint8Array; mimeType: 'image/webp' } | null> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(photoId)) return null;
    if (!this.mediaStore) throw new RealWorldError('PHOTO_STORE_NOT_CONFIGURED', 503);
    const digest = await this.transaction(async client => {
      await this.lockedOwner(client, accountId, id);
      const photo = await client.query<{ digest: string }>(
        `SELECT digest FROM merchant_real_world_photos WHERE id = $1 AND merchant_id = $2 AND deleted_at IS NULL`,
        [photoId, id]);
      return photo.rows[0]?.digest ?? null;
    });
    if (!digest) return null;
    const bytes = await this.mediaStore.read(digest);
    return bytes ? { bytes, mimeType: 'image/webp' } : null;
  }

  async report(accountId: string, id: string, input: { kind: MerchantReport['kind']; note: string }): Promise<MerchantReport> {
    if (!['LOCATION', 'HOURS', 'PHOTO', 'OTHER'].includes(input.kind) ||
        typeof input.note !== 'string' || !input.note.trim() || input.note.length > 1000) throw new RealWorldError('REPORT_INVALID');
    return this.transaction(async client => {
      await this.requireLifecycle().assertActive(client, accountId);
      await this.visible(id, client);
      const result = await client.query<ReportRow>(`INSERT INTO merchant_real_world_reports
        (id, merchant_id, reporter_account_id, kind, note, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$6)
        RETURNING id, merchant_id, kind, note, status, created_at, resolution`,
      [randomUUID(), id, accountId, input.kind, input.note.trim(), this.now()]);
      return toReport(result.rows[0]!);
    });
  }

  async reports(accountId: string, id: string): Promise<MerchantReport[]> {
    return this.transaction(async client => {
      await this.lockedOwner(client, accountId, id);
      const rows = await client.query<ReportRow>(`SELECT id, merchant_id, kind, note, status, created_at, resolution
        FROM merchant_real_world_reports WHERE merchant_id = $1 ORDER BY created_at DESC, id`, [id]);
      return rows.rows.map(toReport);
    });
  }

  async resolveReport(accountId: string, id: string, reportId: string,
    input: { status: 'RESOLVED' | 'REJECTED'; resolution: string }): Promise<MerchantReport> {
    if (!['RESOLVED', 'REJECTED'].includes(input.status) || typeof input.resolution !== 'string' ||
        !input.resolution.trim() || input.resolution.length > 1000) throw new RealWorldError('REPORT_INVALID');
    return this.transaction(async client => {
      await this.lockedOwner(client, accountId, id);
      const updated = await client.query<ReportRow>(`UPDATE merchant_real_world_reports
        SET status = $3, resolution = $4, updated_at = $5
        WHERE id = $1 AND merchant_id = $2 AND status = 'OPEN'
        RETURNING id, merchant_id, kind, note, status, created_at, resolution`,
      [reportId, id, input.status, input.resolution.trim(), this.now()]);
      if (!updated.rows[0]) throw new RealWorldError('REPORT_NOT_FOUND', 404);
      return toReport(updated.rows[0]);
    });
  }

  async recordEvent(event: DiscoveryEvent): Promise<void> {
    if (!event || typeof event !== 'object' || Object.keys(event).sort().join(',') !== 'event,eventId,merchantId,source' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(event.eventId) ||
        !['MAP_SELECT', 'DETAIL_VIEW', 'DIRECTIONS_OPEN', 'GOAL_SAVE'].includes(event.event) ||
        !['list', 'map', 'recommendation', 'collection', 'friend', 'link', 'other'].includes(event.source)) {
      throw new RealWorldError('EVENT_INVALID');
    }
    await this.transaction(async client => {
      const now = this.now();
      const visible = await client.query(`SELECT 1 FROM merchants m WHERE m.id = $1 AND m.status = 'ACTIVE'
        AND m.published_at IS NOT NULL AND ($2::boolean OR NOT m.is_demo)
        AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials t WHERE t.merchant_id = m.id)`,
      [event.merchantId, this.includeDemo]);
      if (!visible.rowCount) throw new RealWorldError('MERCHANT_NOT_FOUND', 404);
      await client.query(`DELETE FROM discovery_event_dedupe WHERE created_at < $1::timestamptz - interval '23 hours'`, [now]);
      const inserted = await client.query<{ event_id: string }>(
        `INSERT INTO discovery_event_dedupe (event_id, merchant_id, created_at)
         SELECT $1, m.id, $3 FROM merchants m WHERE m.id = $2 AND m.status = 'ACTIVE'
           AND m.published_at IS NOT NULL AND ($4::boolean OR NOT m.is_demo)
           AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials t WHERE t.merchant_id = m.id)
         ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.eventId, event.merchantId, now, this.includeDemo]);
      if (!inserted.rowCount) return;
      await client.query(`INSERT INTO discovery_daily_events (merchant_id, business_date, event, source, count)
        VALUES ($1, ($2::timestamptz AT TIME ZONE 'Asia/Seoul')::date, $3, $4, 1)
        ON CONFLICT (merchant_id, business_date, event, source)
        DO UPDATE SET count = discovery_daily_events.count + 1`, [event.merchantId, now, event.event, event.source]);
    });
  }

  async engagement(accountId: string, id: string): Promise<Engagement> {
    return this.transaction(async client => {
      await this.lockedOwner(client, accountId, id);
      const end = this.now();
      const start = new Date(end.getTime() - 30 * 86400_000);
      const result = await client.query<{ event: string; count: number }>(
        `SELECT event, sum(count)::integer AS count FROM discovery_daily_events
         WHERE merchant_id = $1 AND business_date >= ($2::timestamptz AT TIME ZONE 'Asia/Seoul')::date
           AND business_date <= ($3::timestamptz AT TIME ZONE 'Asia/Seoul')::date
         GROUP BY event`, [id, start, end]);
      const count = (event: string) => result.rows.find(row => row.event === event)?.count ?? 0;
      return { merchantId: id, from: start.toISOString(), to: end.toISOString(), counts: {
        mapSelect: count('MAP_SELECT'), detailView: count('DETAIL_VIEW'),
        directionsOpen: count('DIRECTIONS_OPEN'), goalSave: count('GOAL_SAVE'),
      } };
    });
  }

  async gameContent(merchantIds: string[]): Promise<RealGameContext[]> {
    if (!Array.isArray(merchantIds) || merchantIds.length > 20 || new Set(merchantIds).size !== merchantIds.length ||
        merchantIds.some(id => typeof id !== 'string' || !id || id.length > 100)) throw new RealWorldError('GAME_CONTENT_INVALID');
    const rows = await this.pool.query<MerchantRow>(
      `SELECT m.id, m.name, m.road_address, m.category, m.is_demo, m.version, m.story,
              m.consent_document_ref,
              m.business_hours, m.minimum_spend_won, m.menu_items AS legacy_menu_items,
              m.updated_at, p.profile, p.latitude, p.longitude
       FROM merchants m LEFT JOIN merchant_real_world_profiles p ON p.merchant_id = m.id
       WHERE m.id = ANY($1::text[]) AND m.status = 'ACTIVE' AND m.published_at IS NOT NULL
         AND ($2::boolean OR NOT m.is_demo)
         AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials t WHERE t.merchant_id = m.id)`,
      [merchantIds, this.includeDemo]);
    const [campaigns, photos] = await Promise.all([this.campaigns(merchantIds, this.now()), this.photos(merchantIds)]);
    const byId = new Map(rows.rows.map(row => [row.id, row]));
    return merchantIds.flatMap(id => {
      const row = byId.get(id);
      return row ? [{ merchantId: id, merchantName: row.name, roadAddress: row.road_address,
        profileVersion: row.version, menuItems: profileFor(row).menuItems,
        photos: photos.get(id) ?? [], campaign: campaigns.get(id) ?? null }] : [];
    });
  }
}
