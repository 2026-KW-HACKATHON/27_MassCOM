import { randomInt as cryptoRandomInt, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  CoinEconomyError, type CoinCollection, type CoinEconomyService, type CoinOwned,
  type CoinPool, type CoinReference, type CoinSeries, type CoinShop, type CoinSource, type CoinSourceKind,
  type CoinCatalog, type CoinRerollOption, type CoinRerollTicket,
  type CoinTicket, type PublishCoinPoolInput, type PublishCoinSeriesInput,
} from '../coin-economy.js';
import { isCompleteOwnerOfferConsent, normalizeDocumentReference } from '../store-go-live-rules.js';
import { assertPlatformAdmin } from './admin.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { earnedAndSpent } from './mileage-shop.js';

type PoolRow = {
  id: string; merchant_id: string; merchant_name: string; event_name: string; grade: CoinPool['grade'];
  price: number; purchase_starts_at: Date; purchase_ends_at: Date; use_expires_at: Date;
  per_account_limit: number; issuance_cap: number; issued_count: number; status: CoinPool['status'];
};
type EntryRow = { pool_id: string; publication_id: string; grade_id: string; weight: number; summary: Record<string, unknown>; media_removed: boolean; sale_unavailable: boolean };
type TicketRow = {
  id: string; account_id: string; pool_id: string; merchant_id: string; event_name: string;
  grade: CoinTicket['grade']; acquired_at: Date; expires_at: Date; used_at: Date | null;
  request_id: string; source: 'PURCHASE' | 'GRANT';
};
type OwnedRow = { publication_id: string; grade_id: string; summary: Record<string, unknown>; visit_quantity: number; draw_quantity: number; reroll_quantity: number };
type SourceRow = { source_kind: CoinSourceKind; source_id: string; publication_id: string; grade_id: string;
  merchant_id: string; nft_status: CoinSource['nftStatus']; consumed: boolean };
type CatalogRow = { merchant_id: string; merchant_name: string; publication_id: string; grade_id: string;
  summary: Record<string, unknown> };
type RerollTicketRow = { id: string; account_id: string; grade: CoinRerollTicket['grade']; acquired_at: Date;
  used_at: Date | null; request_id: string };
type RerollRow = { id: string; ticket_id: string; pool_id: string; account_id: string; request_id: string;
  source_kind: CoinSourceKind; source_id: string; publication_id: string; grade_id: string; drawn_at: Date;
  spent_source: CoinSource; result_coin: CoinOwned; revoked_at: Date | null };
type SeriesRow = {
  id: string; merchant_id: string; merchant_name: string; merchant_status: 'ACTIVE' | 'PAUSED';
  title: string; ends_at: Date; status: 'ACTIVE' | 'PAUSED';
  base_title: string; base_detail: string; base_valid_days: number; base_cap: number; base_issued: number;
  prism_title: string; prism_detail: string; prism_valid_days: number; prism_cap: number; prism_issued: number;
};
type SeriesEntryRow = { series_id: string; tier: 'BASE' | 'PRISM'; publication_id: string; grade_id: string; summary: Record<string, unknown>; media_removed: boolean };
type SeriesCouponRow = {
  id: string; account_id: string; series_id: string; merchant_id: string; tier: 'BASE' | 'PRISM';
  title: string; detail: string; issued_at: Date; expires_at: Date; redeemed_at: Date | null; revoked_at: Date | null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nameOf = (summary: Record<string, unknown>) => typeof summary.name === 'string' ? summary.name : '수집 코인';
const keyOf = (reference: CoinReference) => `${reference.publicationId}:${reference.gradeId}`;
const validDate = (value: string) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validText = (value: string, max: number) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const positive = (value: number, max: number) => Number.isSafeInteger(value) && value > 0 && value <= max;
const poolSql = `SELECT pool.*, merchant.name AS merchant_name FROM coin_pools AS pool
  JOIN merchants AS merchant ON merchant.id = pool.merchant_id`;
const ticketSql = `SELECT ticket.*, pool.merchant_id, pool.event_name, pool.grade FROM coin_tickets AS ticket
  JOIN coin_pools AS pool ON pool.id = ticket.pool_id`;
const seriesSql = `SELECT series.*, merchant.name AS merchant_name, merchant.status AS merchant_status FROM coin_series AS series
  JOIN merchants AS merchant ON merchant.id = series.merchant_id`;

// 각 획득 행은 보존하고 회수된 행만 현재 보유량에서 제외한다.
const ownedSql = `WITH visit_coins AS (
    SELECT acquisition.publication_id, acquisition.grade_id, count(*)::integer AS n
    FROM collectible_acquisitions acquisition
    JOIN reward_entitlements entitlement ON entitlement.id = acquisition.entitlement_id
    WHERE entitlement.customer_account_id = $1 AND entitlement.status IN ('GRANTED','MINT_REQUESTED','FULFILLED')
      AND NOT EXISTS (SELECT 1 FROM coin_reroll_consumptions spent
        WHERE spent.source_kind = 'VISIT' AND spent.source_id = acquisition.entitlement_id)
    GROUP BY acquisition.publication_id, acquisition.grade_id
  ), draw_coins AS (
    SELECT acquired.publication_id, acquired.grade_id, count(*)::integer AS n
    FROM (
      SELECT draw.publication_id, draw.grade_id
      FROM coin_draws draw JOIN coin_tickets ticket ON ticket.id = draw.ticket_id
      WHERE ticket.account_id = $1 AND NOT EXISTS (SELECT 1 FROM coin_reroll_consumptions spent
        WHERE spent.source_kind = 'STORE_DRAW' AND spent.source_id = draw.ticket_id)
      UNION ALL
      SELECT draw.publication_id, draw.grade_id
      FROM grade_draws draw WHERE draw.account_id = $1 AND draw.reward_kind = 'COIN'
        AND NOT EXISTS (SELECT 1 FROM coin_reroll_consumptions spent
          WHERE spent.source_kind = 'GRADE_DRAW' AND spent.source_id = draw.id)
    ) acquired GROUP BY acquired.publication_id, acquired.grade_id
  ), reroll_coins AS (
    SELECT draw.publication_id, draw.grade_id, count(*)::integer AS n
    FROM coin_rerolls draw WHERE draw.account_id = $1 AND draw.revoked_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM coin_reroll_consumptions spent
        WHERE spent.source_kind = 'REROLL' AND spent.source_id = draw.id)
    GROUP BY draw.publication_id, draw.grade_id
  )
  SELECT grade.publication_id, grade.grade_id,
    CASE WHEN publication.media_removed_at IS NOT NULL
      THEN '{"name":"공개가 중단된 코인","mediaRemoved":true}'::jsonb ELSE grade.summary END AS summary,
    coalesce(visit_coins.n,0)::integer AS visit_quantity,
    coalesce(draw_coins.n,0)::integer AS draw_quantity,
    coalesce(reroll_coins.n,0)::integer AS reroll_quantity
  FROM collectible_publication_grades grade
  JOIN collectible_publications publication ON publication.id = grade.publication_id
  LEFT JOIN visit_coins USING (publication_id, grade_id)
  LEFT JOIN draw_coins USING (publication_id, grade_id)
  LEFT JOIN reroll_coins USING (publication_id, grade_id)
  WHERE (visit_coins.n IS NOT NULL OR draw_coins.n IS NOT NULL OR reroll_coins.n IS NOT NULL)`;

const sourceSql = `SELECT source.*, publication.merchant_id,
  CASE WHEN source.source_kind = 'VISIT' AND (source.entitlement_status = 'FULFILLED' OR source.has_asset)
    THEN 'COMPLETED'
    WHEN source.source_kind = 'VISIT' AND (source.entitlement_status = 'MINT_REQUESTED' OR source.has_job)
    THEN 'PENDING' ELSE 'NOT_REQUESTED' END AS nft_status,
  spent.source_id IS NOT NULL AS consumed
  FROM (
    SELECT 'VISIT'::text AS source_kind, acquisition.entitlement_id AS source_id,
      acquisition.publication_id, acquisition.grade_id, entitlement.status AS entitlement_status,
      job.id IS NOT NULL AS has_job, asset.id IS NOT NULL AS has_asset
    FROM collectible_acquisitions acquisition
    JOIN reward_entitlements entitlement ON entitlement.id = acquisition.entitlement_id
    LEFT JOIN mint_jobs job ON job.entitlement_id = entitlement.id
    LEFT JOIN nft_assets asset ON asset.mint_job_id = job.id
    WHERE entitlement.customer_account_id = $1 AND entitlement.status IN ('GRANTED','MINT_REQUESTED','FULFILLED')
    UNION ALL
    SELECT 'STORE_DRAW', draw.ticket_id, draw.publication_id, draw.grade_id, NULL, false, false
    FROM coin_draws draw JOIN coin_tickets ticket ON ticket.id = draw.ticket_id WHERE ticket.account_id = $1
    UNION ALL
    SELECT 'GRADE_DRAW', draw.id, draw.publication_id, draw.grade_id, NULL, false, false
    FROM grade_draws draw WHERE draw.account_id = $1 AND draw.reward_kind = 'COIN'
    UNION ALL
    SELECT 'REROLL', draw.id, draw.publication_id, draw.grade_id, NULL, false, false
    FROM coin_rerolls draw WHERE draw.account_id = $1 AND draw.revoked_at IS NULL
  ) source
  JOIN collectible_publications publication ON publication.id = source.publication_id
  LEFT JOIN coin_reroll_consumptions spent ON spent.source_kind = source.source_kind AND spent.source_id = source.source_id`;

function viewPool(row: PoolRow, entries: EntryRow[]): CoinPool {
  const relevant = entries.filter(entry => entry.pool_id === row.id);
  const total = relevant.reduce((sum, entry) => sum + entry.weight, 0);
  return {
    id: row.id, merchantId: row.merchant_id, merchantName: row.merchant_name,
    eventName: row.event_name, grade: row.grade, price: row.price,
    purchaseStartsAt: row.purchase_starts_at.toISOString(), purchaseEndsAt: row.purchase_ends_at.toISOString(),
    useExpiresAt: row.use_expires_at.toISOString(), perAccountLimit: row.per_account_limit,
    issuanceCap: row.issuance_cap, issuedCount: row.issued_count, status: row.status,
    ...(relevant.some(entry => entry.media_removed) ? { unavailableReason: 'MEDIA_REMOVED' as const }
      : relevant.some(entry => entry.sale_unavailable) ? { unavailableReason: 'PUBLICATION_UNAVAILABLE' as const } : {}),
    entries: relevant.map(entry => ({ publicationId: entry.publication_id, gradeId: entry.grade_id,
      name: nameOf(entry.summary), weight: entry.weight, probability: entry.weight / total, summary: entry.summary })),
  };
}
function viewTicket(row: TicketRow, now: Date): CoinTicket {
  return {
    id: row.id, poolId: row.pool_id, merchantId: row.merchant_id,
    eventName: row.event_name, grade: row.grade, acquiredAt: row.acquired_at.toISOString(),
    expiresAt: row.expires_at.toISOString(), status: row.used_at ? 'USED' : row.expires_at <= now ? 'EXPIRED' : 'UNUSED',
  };
}
function viewOwned(row: OwnedRow): CoinOwned {
  return { publicationId: row.publication_id, gradeId: row.grade_id, name: nameOf(row.summary),
    summary: row.summary, visitQuantity: row.visit_quantity, drawQuantity: row.draw_quantity,
    rerollQuantity: row.reroll_quantity, quantity: row.visit_quantity + row.draw_quantity + row.reroll_quantity };
}
function viewSource(row: SourceRow): CoinSource {
  return { sourceKind: row.source_kind, sourceId: row.source_id, publicationId: row.publication_id,
    gradeId: row.grade_id, merchantId: row.merchant_id, nftStatus: row.nft_status,
    rerollEligible: !row.consumed && row.nft_status === 'NOT_REQUESTED' };
}
export function coinGradeRank(entry: { grade_id: string; summary: Record<string, unknown> }): number {
  const label = `${entry.grade_id} ${String(entry.summary.gradeName ?? '')}`.toLowerCase();
  if (/prism|platinum|프리즘|플래티넘/.test(label)) return 4;
  if (/gold|골드/.test(label)) return 3;
  if (/silver|실버/.test(label)) return 2;
  if (/bronze|브론즈/.test(label)) return 1;
  return 0;
}
function viewRerollTicket(row: RerollTicketRow): CoinRerollTicket {
  return { id: row.id, grade: row.grade, status: row.used_at ? 'USED' : 'UNUSED', acquiredAt: row.acquired_at.toISOString() };
}
function viewSeries(row: SeriesRow, entries: SeriesEntryRow[], owned: CoinOwned[], coupon: SeriesCouponRow | undefined, now: Date): CoinSeries {
  const quantities = new Map(owned.map(coin => [keyOf(coin), coin.quantity]));
  const slots = (tier: 'BASE' | 'PRISM') => entries.filter(entry => entry.series_id === row.id && entry.tier === tier)
    .map(entry => ({ publicationId: entry.publication_id, gradeId: entry.grade_id,
      name: nameOf(entry.summary), quantity: quantities.get(keyOf({ publicationId: entry.publication_id, gradeId: entry.grade_id })) ?? 0 }));
  const baseSlots = slots('BASE'); const prismSlots = slots('PRISM');
  const baseComplete = baseSlots.length > 0 && baseSlots.every(slot => slot.quantity > 0);
  const prismComplete = prismSlots.length > 0 && prismSlots.every(slot => slot.quantity > 0);
  return {
    id: row.id, title: row.title, merchantId: row.merchant_id, merchantName: row.merchant_name,
    endsAt: row.ends_at.toISOString(),
    base: { slots: baseSlots, complete: baseComplete, title: row.base_title, detail: row.base_detail },
    prism: { slots: prismSlots, complete: prismComplete, title: row.prism_title, detail: row.prism_detail },
    claimable: coupon || row.status !== 'ACTIVE' || row.merchant_status !== 'ACTIVE' || row.ends_at <= now
      || entries.some(entry => entry.series_id === row.id && entry.media_removed) ? null
      : prismComplete ? row.prism_issued < row.prism_cap ? 'PRISM' : null
      : baseComplete && row.base_issued < row.base_cap ? 'BASE' : null,
    coupon: coupon ? { id: coupon.id, tier: coupon.tier, title: coupon.title, detail: coupon.detail,
      expiresAt: coupon.expires_at.toISOString(), status: coupon.revoked_at ? 'REVOKED' : coupon.redeemed_at ? 'REDEEMED'
        : coupon.expires_at <= now ? 'EXPIRED' : 'ISSUED',
      redeemedAt: coupon.redeemed_at?.toISOString() ?? null } : null,
  };
}

export function chooseWeightedCoin<T extends { weight: number }>(entries: readonly T[], randomInt: (bound: number) => number): T {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!entries.length || !Number.isSafeInteger(total) || total <= 0) throw new CoinEconomyError('INVALID_REQUEST');
  let position = randomInt(total);
  if (!Number.isInteger(position) || position < 0 || position >= total) throw new CoinEconomyError('INVALID_REQUEST');
  for (const entry of entries) { position -= entry.weight; if (position < 0) return entry; }
  throw new CoinEconomyError('INVALID_REQUEST');
}

export class PostgresCoinEconomyService implements CoinEconomyService {
  private readonly now: () => Date;
  private readonly randomInt: (bound: number) => number;
  private readonly nextId: () => string;
  private readonly showcaseBonusMileage: number;
  private readonly accountLifecycle: PostgresAccountLifecycle;
  constructor(private readonly pool: Pool, options: {
    accountLifecycle: PostgresAccountLifecycle; now?: () => Date; randomInt?: (bound: number) => number;
    nextId?: () => string; showcaseBonusMileage?: number;
  }) {
    this.accountLifecycle = options.accountLifecycle;
    this.now = options.now ?? (() => new Date());
    this.randomInt = options.randomInt ?? cryptoRandomInt;
    this.nextId = options.nextId ?? randomUUID;
    this.showcaseBonusMileage = options.showcaseBonusMileage ?? 0;
    if (!Number.isSafeInteger(this.showcaseBonusMileage) || this.showcaseBonusMileage < 0) throw new Error('invalid showcaseBonusMileage');
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const value = await run(client); await client.query('COMMIT'); return value; }
    catch (error) { await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new CoinEconomyError('ACCOUNT_DELETED');
      throw error;
    } finally { client.release(); }
  }

  private async poolEntries(client: Pool | PoolClient, poolIds: string[]): Promise<EntryRow[]> {
    if (!poolIds.length) return [];
    return (await client.query<EntryRow>(`SELECT entry.*,
      CASE WHEN publication.media_removed_at IS NOT NULL
        THEN '{"name":"공개가 중단된 코인","mediaRemoved":true}'::jsonb ELSE grade.summary END AS summary,
      publication.media_removed_at IS NOT NULL AS media_removed,
      (current_publication.publication_id IS NULL OR campaign.status <> 'ACTIVE' OR NOT campaign.is_public
        OR campaign.starts_at > $2 OR campaign.ends_at <= $2) AS sale_unavailable
      FROM coin_pool_entries entry
      JOIN collectible_publication_grades grade USING (publication_id, grade_id)
      JOIN collectible_publications publication ON publication.id = entry.publication_id
      JOIN campaigns campaign ON campaign.id = publication.campaign_id
      LEFT JOIN campaign_collectible_publications current_publication
        ON current_publication.campaign_id = campaign.id AND current_publication.publication_id = publication.id
      WHERE entry.pool_id = ANY($1::uuid[]) ORDER BY entry.pool_id, entry.publication_id, entry.grade_id`, [poolIds,this.now()])).rows;
  }
  private async owned(client: Pool | PoolClient, accountId: string): Promise<CoinOwned[]> {
    return (await client.query<OwnedRow>(ownedSql, [accountId])).rows.map(viewOwned);
  }
  private async sources(client: Pool | PoolClient, accountId: string): Promise<CoinSource[]> {
    return (await client.query<SourceRow>(sourceSql, [accountId])).rows.filter(row => !row.consumed).map(viewSource);
  }
  private async rerollOptions(client: Pool | PoolClient, merchantIds: string[]): Promise<CoinRerollOption[]> {
    if (!merchantIds.length) return [];
    const now = this.now();
    const pools = (await client.query<PoolRow>(`${poolSql} WHERE pool.merchant_id = ANY($1::text[])
      AND pool.status = 'ACTIVE' AND merchant.status = 'ACTIVE'
      AND pool.purchase_starts_at <= $2 AND pool.purchase_ends_at > $2 AND pool.use_expires_at > $2
      ORDER BY pool.created_at DESC`, [merchantIds, now])).rows;
    const entries = await this.poolEntries(client, pools.map(pool => pool.id));
    return pools.flatMap(pool => {
      const published = entries.filter(entry => entry.pool_id === pool.id && !entry.media_removed && !entry.sale_unavailable);
      if (published.length !== entries.filter(entry => entry.pool_id === pool.id).length) return [];
      return (['NORMAL', 'SILVER'] as const).flatMap(grade => {
        const available = published.filter(entry => coinGradeRank(entry) >= (grade === 'SILVER' ? 2 : 1));
        const total = available.reduce((sum, entry) => sum + entry.weight, 0);
        return total ? [{ poolId: pool.id, merchantId: pool.merchant_id, merchantName: pool.merchant_name,
          eventName: pool.event_name, grade, entries: available.map(entry => ({ publicationId: entry.publication_id,
            gradeId: entry.grade_id, name: nameOf(entry.summary), weight: entry.weight,
            probability: entry.weight / total })) }] : [];
      });
    });
  }
  private async balance(client: Pool | PoolClient, accountId: string) {
    const { earned, spent } = await earnedAndSpent(client, accountId);
    return { earned, spent, balance: earned + this.showcaseBonusMileage - spent };
  }

  async getShop(accountId: string): Promise<CoinShop> {
    const now = this.now();
    const [liveTickets, oldTickets, availablePools, mileage] = await Promise.all([
      this.pool.query<TicketRow>(`${ticketSql} WHERE ticket.account_id = $1
        AND ticket.used_at IS NULL AND ticket.expires_at > $2 ORDER BY ticket.acquired_at DESC`, [accountId, now]),
      this.pool.query<TicketRow>(`${ticketSql} WHERE ticket.account_id = $1
        AND (ticket.used_at IS NOT NULL OR ticket.expires_at <= $2)
        ORDER BY ticket.acquired_at DESC LIMIT 100`, [accountId, now]),
      this.pool.query<PoolRow>(`${poolSql} WHERE pool.status = 'ACTIVE' AND merchant.status = 'ACTIVE'
        AND pool.purchase_starts_at <= $1 AND pool.purchase_ends_at > $1
        AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials trial
          WHERE trial.merchant_id = merchant.id AND trial.account_id <> $2)
        ORDER BY pool.created_at DESC LIMIT 100`, [now, accountId]),
      this.balance(this.pool, accountId),
    ]);
    const tickets = [...liveTickets.rows, ...oldTickets.rows]
      .sort((left, right) => right.acquired_at.getTime() - left.acquired_at.getTime());
    const ticketPoolIds = [...new Set(tickets.map(ticket => ticket.pool_id))];
    const ticketPools = ticketPoolIds.length ? (await this.pool.query<PoolRow>(
      `${poolSql} WHERE pool.id = ANY($1::uuid[])`, [ticketPoolIds])).rows : [];
    const pools = [...new Map([...availablePools.rows, ...ticketPools].map(pool => [pool.id, pool])).values()];
    const entries = await this.poolEntries(this.pool, pools.map(pool => pool.id));
    return { mileage, pools: pools.map(pool => viewPool(pool, entries)), tickets: tickets.map(row => viewTicket(row, now)) };
  }

  async purchase(input: { accountId: string; poolId: string; requestId: string }) {
    return this.issue(input, 'PURCHASE');
  }
  async grantTicket(input: { actorAccountId: string; accountId: string; poolId: string; requestId: string }) {
    return this.issue(input, 'GRANT');
  }
  async grantRerollTicket(input: { actorAccountId: string; accountId: string;
    grade: CoinRerollTicket['grade']; requestId: string }) {
    if (!['NORMAL', 'SILVER'].includes(input.grade) || !validText(input.requestId, 100)) {
      throw new CoinEconomyError('INVALID_REQUEST');
    }
    return this.transaction(async client => {
      await this.accountLifecycle.assertAllActive(client, [input.actorAccountId, input.accountId]);
      await assertPlatformAdmin(client, this.accountLifecycle, input.actorAccountId);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`coin-reroll:${input.accountId}`]);
      const prior = (await client.query<RerollTicketRow>(`SELECT ticket.*, draw.drawn_at AS used_at
        FROM coin_reroll_tickets ticket LEFT JOIN coin_rerolls draw ON draw.ticket_id = ticket.id
        WHERE ticket.account_id = $1 AND ticket.request_id = $2`, [input.accountId, input.requestId])).rows[0];
      if (prior) {
        if (prior.grade !== input.grade) throw new CoinEconomyError('COIN_REQUEST_CONFLICT');
        return { ticket: viewRerollTicket(prior), replayed: true };
      }
      const id = this.nextId(); const now = this.now();
      await client.query(`INSERT INTO coin_reroll_tickets
        (id,account_id,grade,request_id,granted_by_account_id,acquired_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, input.accountId, input.grade, input.requestId, input.actorAccountId, now]);
      return { ticket: { id, grade: input.grade, status: 'UNUSED' as const, acquiredAt: now.toISOString() }, replayed: false };
    });
  }
  async useRerollTicket(input: { accountId: string; ticketId: string; poolId: string;
    sourceKind: CoinSourceKind; sourceId: string; requestId: string }) {
    if (!uuid.test(input.ticketId) || !uuid.test(input.poolId) || !uuid.test(input.sourceId)
      || !['VISIT', 'STORE_DRAW', 'GRADE_DRAW', 'REROLL'].includes(input.sourceKind)
      || !validText(input.requestId, 100)) throw new CoinEconomyError('INVALID_REQUEST');
    return this.transaction(async client => {
      await this.accountLifecycle.assertActive(client, input.accountId);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`coin-reroll:${input.accountId}`]);
      const ticket = (await client.query<RerollTicketRow>(`SELECT ticket.*, draw.drawn_at AS used_at
        FROM coin_reroll_tickets ticket LEFT JOIN coin_rerolls draw ON draw.ticket_id = ticket.id
        WHERE ticket.id = $1 AND ticket.account_id = $2 FOR UPDATE OF ticket`, [input.ticketId, input.accountId])).rows[0];
      if (!ticket) throw new CoinEconomyError('COIN_REROLL_TICKET_NOT_FOUND');
      const prior = (await client.query<RerollRow>(`SELECT * FROM coin_rerolls WHERE account_id = $1 AND request_id = $2`,
        [input.accountId, input.requestId])).rows[0];
      if (prior) {
        if (prior.ticket_id !== input.ticketId || prior.pool_id !== input.poolId
          || prior.source_kind !== input.sourceKind || prior.source_id !== input.sourceId) {
          throw new CoinEconomyError('COIN_REQUEST_CONFLICT');
        }
        if (prior.revoked_at) throw new CoinEconomyError('COIN_REROLL_RESULT_REVOKED');
        const removed = (await client.query<{ media_removed_at: Date | null }>(
          'SELECT media_removed_at FROM collectible_publications WHERE id = $1', [prior.publication_id])).rows[0]?.media_removed_at;
        const coin = removed ? { ...prior.result_coin, name: '공개가 중단된 코인',
          summary: { name: '공개가 중단된 코인', mediaRemoved: true } } : prior.result_coin;
        return { rerollId: prior.id, ticket: viewRerollTicket(ticket), spent: prior.spent_source,
          coin, replayed: true };
      }
      if (ticket.used_at) throw new CoinEconomyError('COIN_REROLL_TICKET_USED');
      const sourceSqlByKind: Record<CoinSourceKind, string> = {
        VISIT: `SELECT acquisition.publication_id, acquisition.grade_id, publication.merchant_id,
          entitlement.status AS entitlement_status, job.id IS NOT NULL AS has_job
          FROM collectible_acquisitions acquisition
          JOIN reward_entitlements entitlement ON entitlement.id = acquisition.entitlement_id
          JOIN collectible_publications publication ON publication.id = acquisition.publication_id
          LEFT JOIN mint_jobs job ON job.entitlement_id = entitlement.id
          WHERE acquisition.entitlement_id = $1 AND entitlement.customer_account_id = $2 FOR UPDATE OF entitlement`,
        STORE_DRAW: `SELECT draw.publication_id, draw.grade_id, publication.merchant_id,
          NULL::text AS entitlement_status, false AS has_job FROM coin_draws draw
          JOIN coin_tickets ticket ON ticket.id = draw.ticket_id
          JOIN collectible_publications publication ON publication.id = draw.publication_id
          WHERE draw.ticket_id = $1 AND ticket.account_id = $2 FOR UPDATE OF ticket`,
        GRADE_DRAW: `SELECT draw.publication_id, draw.grade_id, publication.merchant_id,
          NULL::text AS entitlement_status, false AS has_job FROM grade_draws draw
          JOIN collectible_publications publication ON publication.id = draw.publication_id
          WHERE draw.id = $1 AND draw.account_id = $2 AND draw.reward_kind = 'COIN' FOR UPDATE OF draw`,
        REROLL: `SELECT draw.publication_id, draw.grade_id, publication.merchant_id,
          NULL::text AS entitlement_status, false AS has_job FROM coin_rerolls draw
          JOIN collectible_publications publication ON publication.id = draw.publication_id
          WHERE draw.id = $1 AND draw.account_id = $2 AND draw.revoked_at IS NULL FOR UPDATE OF draw`,
      };
      const source = (await client.query<{ publication_id: string; grade_id: string; merchant_id: string;
        entitlement_status: string | null; has_job: boolean }>(sourceSqlByKind[input.sourceKind],
      [input.sourceId, input.accountId])).rows[0];
      if (!source || (input.sourceKind === 'VISIT' && !['GRANTED','MINT_REQUESTED','FULFILLED'].includes(source.entitlement_status ?? ''))) {
        throw new CoinEconomyError('COIN_REROLL_SOURCE_NOT_FOUND');
      }
      if (input.sourceKind === 'VISIT' && (source.entitlement_status !== 'GRANTED' || source.has_job)) {
        throw new CoinEconomyError('COIN_REROLL_SOURCE_LOCKED');
      }
      const spent = (await client.query<{ source_id: string }>(`SELECT source_id FROM coin_reroll_consumptions
        WHERE source_kind = $1 AND source_id = $2`, [input.sourceKind, input.sourceId])).rows[0];
      if (spent) throw new CoinEconomyError('COIN_REROLL_SOURCE_NOT_FOUND');
      const pool = (await client.query<PoolRow>(`${poolSql} WHERE pool.id = $1 FOR SHARE OF pool, merchant`,
        [input.poolId])).rows[0];
      const now = this.now();
      if (!pool || pool.merchant_id !== source.merchant_id || pool.status !== 'ACTIVE'
        || pool.purchase_starts_at > now || pool.purchase_ends_at <= now || pool.use_expires_at <= now) {
        throw new CoinEconomyError('COIN_REROLL_POOL_UNAVAILABLE');
      }
      const entries = (await client.query<EntryRow>(`SELECT entry.*, grade.summary,
        publication.media_removed_at IS NOT NULL AS media_removed,
        (merchant.status <> 'ACTIVE' OR campaign.status <> 'ACTIVE' OR NOT campaign.is_public
          OR campaign.starts_at > $2 OR campaign.ends_at <= $2
          OR link.publication_id IS NULL) AS sale_unavailable
        FROM coin_pool_entries entry
        JOIN collectible_publication_grades grade USING (publication_id,grade_id)
        JOIN collectible_publications publication ON publication.id = entry.publication_id
        JOIN campaigns campaign ON campaign.id = publication.campaign_id
        JOIN merchants merchant ON merchant.id = publication.merchant_id
        LEFT JOIN campaign_collectible_publications link
          ON link.campaign_id = campaign.id AND link.publication_id = publication.id
        WHERE entry.pool_id = $1 ORDER BY entry.publication_id,entry.grade_id
        FOR SHARE OF publication,campaign,merchant`, [pool.id, now])).rows;
      if (!entries.length || entries.some(entry => entry.media_removed || entry.sale_unavailable)) {
        throw new CoinEconomyError('COIN_REROLL_POOL_UNAVAILABLE');
      }
      const available = entries.filter(entry => coinGradeRank(entry) >= (ticket.grade === 'SILVER' ? 2 : 1));
      if (!available.length) throw new CoinEconomyError('COIN_REROLL_NO_CANDIDATES');
      const chosen = chooseWeightedCoin(available, this.randomInt);
      const rerollId = this.nextId();
      const spentSource: CoinSource = { sourceKind: input.sourceKind, sourceId: input.sourceId,
        publicationId: source.publication_id, gradeId: source.grade_id, merchantId: source.merchant_id,
        nftStatus: 'NOT_REQUESTED', rerollEligible: false };
      // 새 획득을 포함한 현재 수량을 기록해 재시도에서 같은 결과를 되돌린다.
      const oldCoin = (await this.owned(client, input.accountId)).find(coin => coin.publicationId === chosen.publication_id
        && coin.gradeId === chosen.grade_id);
      const resultCoin: CoinOwned = { publicationId: chosen.publication_id, gradeId: chosen.grade_id,
        name: nameOf(chosen.summary), summary: chosen.summary,
        visitQuantity: oldCoin?.visitQuantity ?? 0, drawQuantity: oldCoin?.drawQuantity ?? 0,
        rerollQuantity: (oldCoin?.rerollQuantity ?? 0) + 1,
        quantity: (oldCoin?.quantity ?? 0) + 1 - (source.publication_id === chosen.publication_id
          && source.grade_id === chosen.grade_id ? 1 : 0) };
      if (source.publication_id === chosen.publication_id && source.grade_id === chosen.grade_id) {
        if (input.sourceKind === 'VISIT') resultCoin.visitQuantity--;
        else if (input.sourceKind === 'REROLL') resultCoin.rerollQuantity--;
        else resultCoin.drawQuantity--;
      }
      await client.query(`INSERT INTO coin_rerolls
        (id,ticket_id,pool_id,account_id,request_id,source_kind,source_id,publication_id,grade_id,spent_source,result_coin,drawn_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
      [rerollId, ticket.id, pool.id, input.accountId, input.requestId, input.sourceKind, input.sourceId,
        chosen.publication_id, chosen.grade_id, JSON.stringify(spentSource), JSON.stringify(resultCoin), now]);
      await client.query(`INSERT INTO coin_reroll_consumptions (account_id,source_kind,source_id,reroll_id,consumed_at)
        VALUES ($1,$2,$3,$4,$5)`, [input.accountId, input.sourceKind, input.sourceId, rerollId, now]);
      await client.query(`UPDATE collection_experience_profiles
        SET coin_source_kind = NULL, coin_source_id = NULL, coin_entitlement_id = NULL, updated_at = $4
        WHERE account_id = $1 AND ((coin_source_kind = $2 AND coin_source_id = $3)
          OR ($2 = 'VISIT' AND coin_source_kind IS NULL AND coin_entitlement_id = $3))`,
      [input.accountId, input.sourceKind, input.sourceId, now]);
      return { rerollId, ticket: { ...viewRerollTicket(ticket), status: 'USED' as const },
        spent: spentSource, coin: resultCoin, replayed: false };
    });
  }
  private async issue(input: { accountId: string; poolId: string; requestId: string; actorAccountId?: string }, source: 'PURCHASE' | 'GRANT') {
    if (!uuid.test(input.poolId) || !validText(input.requestId, 100)) throw new CoinEconomyError('INVALID_REQUEST');
    if (source === 'GRANT' && !validText(input.actorAccountId!, 100)) throw new CoinEconomyError('INVALID_REQUEST');
    return this.transaction(async client => {
      if (source === 'GRANT') {
        await this.accountLifecycle.assertAllActive(client, [input.actorAccountId!, input.accountId]);
        await assertPlatformAdmin(client, this.accountLifecycle, input.actorAccountId!);
      } else await this.accountLifecycle.assertActive(client, input.accountId);
      const previous = (await client.query<TicketRow>(`${ticketSql} WHERE ticket.account_id = $1 AND ticket.request_id = $2`,
        [input.accountId, input.requestId])).rows[0];
      const mileage = await this.balance(client, input.accountId);
      if (previous) {
        if (previous.pool_id !== input.poolId || previous.source !== source) throw new CoinEconomyError('COIN_REQUEST_CONFLICT');
        return { ticket: viewTicket(previous, this.now()), balance: mileage.balance, replayed: true };
      }
      const pool = (await client.query<PoolRow>(`${poolSql} WHERE pool.id = $1
        AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials trial
          WHERE trial.merchant_id = merchant.id AND trial.account_id <> $2)
        FOR UPDATE OF pool`, [input.poolId, input.accountId])).rows[0];
      if (!pool) throw new CoinEconomyError('COIN_POOL_UNAVAILABLE');
      const now = this.now();
      if (pool.use_expires_at <= now) throw new CoinEconomyError('COIN_POOL_EXPIRED');
      if (pool.issued_count >= pool.issuance_cap) throw new CoinEconomyError('COIN_POOL_LIMIT_REACHED');
      if (source === 'PURCHASE' && (pool.status !== 'ACTIVE' || pool.purchase_starts_at > now || pool.purchase_ends_at <= now)) {
        throw new CoinEconomyError('COIN_POOL_UNAVAILABLE');
      }
      const merchant = (await client.query<{ status: string }>('SELECT status FROM merchants WHERE id = $1 FOR SHARE', [pool.merchant_id])).rows[0];
      if (!merchant || merchant.status !== 'ACTIVE') throw new CoinEconomyError('COIN_POOL_UNAVAILABLE');
      const liveEntries = await client.query<{ removed: boolean; unavailable: boolean }>(`SELECT publication.media_removed_at IS NOT NULL AS removed,
        (campaign.status <> 'ACTIVE' OR NOT campaign.is_public
          OR campaign.starts_at > $2 OR campaign.ends_at <= $2) AS unavailable
        FROM coin_pool_entries entry JOIN collectible_publications publication ON publication.id = entry.publication_id
        JOIN campaigns campaign ON campaign.id = publication.campaign_id
        JOIN campaign_collectible_publications current_publication
          ON current_publication.campaign_id = campaign.id AND current_publication.publication_id = publication.id
        WHERE entry.pool_id = $1 FOR SHARE OF publication, campaign, current_publication`, [pool.id, now]);
      const entryCount = (await client.query<{ n: number }>(
        'SELECT count(*)::integer AS n FROM coin_pool_entries WHERE pool_id = $1', [pool.id])).rows[0]!.n;
      if (!liveEntries.rowCount || liveEntries.rowCount !== entryCount || liveEntries.rows.some(entry => entry.removed)) {
        throw new CoinEconomyError('COIN_PUBLICATION_UNAVAILABLE');
      }
      if (liveEntries.rows.some(entry => entry.unavailable)) throw new CoinEconomyError('COIN_PUBLICATION_UNAVAILABLE');
      const count = (await client.query<{ n: number }>(
        'SELECT count(*)::integer AS n FROM coin_tickets WHERE account_id = $1 AND pool_id = $2',
        [input.accountId, pool.id])).rows[0]!.n;
      if (count >= pool.per_account_limit) throw new CoinEconomyError('COIN_POOL_LIMIT_REACHED');
      if (source === 'PURCHASE' && mileage.balance < pool.price) throw new CoinEconomyError('COIN_INSUFFICIENT_MILEAGE');
      const ticketId = this.nextId();
      await client.query(`INSERT INTO coin_tickets
        (id, account_id, pool_id, request_id, source, price, acquired_at, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ticketId, input.accountId, pool.id, input.requestId, source, source === 'PURCHASE' ? pool.price : 0, now, pool.use_expires_at]);
      await client.query('UPDATE coin_pools SET issued_count = issued_count + 1 WHERE id = $1', [pool.id]);
      return { ticket: { id: ticketId, poolId: pool.id, merchantId: pool.merchant_id,
        eventName: pool.event_name, grade: pool.grade, acquiredAt: now.toISOString(),
        expiresAt: pool.use_expires_at.toISOString(), status: 'UNUSED' as const },
      balance: mileage.balance - (source === 'PURCHASE' ? pool.price : 0), replayed: false };
    });
  }

  async useTicket(input: { accountId: string; ticketId: string }) {
    if (!uuid.test(input.ticketId)) throw new CoinEconomyError('COIN_TICKET_NOT_FOUND');
    return this.transaction(async client => {
      await this.accountLifecycle.assertActive(client, input.accountId);
      const ticket = (await client.query<TicketRow>(`${ticketSql} WHERE ticket.id = $1 AND ticket.account_id = $2 FOR UPDATE OF ticket`,
        [input.ticketId, input.accountId])).rows[0];
      if (!ticket) throw new CoinEconomyError('COIN_TICKET_NOT_FOUND');
      const now = this.now();
      const existing = (await client.query<OwnedRow>(`SELECT draw.publication_id, draw.grade_id,
        CASE WHEN publication.media_removed_at IS NOT NULL
          THEN '{"name":"공개가 중단된 코인","mediaRemoved":true}'::jsonb ELSE grade.summary END AS summary,
        0::integer AS visit_quantity, 0::integer AS draw_quantity, 0::integer AS reroll_quantity FROM coin_draws draw
        JOIN collectible_publication_grades grade USING (publication_id,grade_id)
        JOIN collectible_publications publication ON publication.id = draw.publication_id
        WHERE draw.ticket_id = $1`, [ticket.id])).rows[0];
      if (existing) {
        const coin = (await this.owned(client, input.accountId)).find(item => keyOf(item) === keyOf({ publicationId: existing.publication_id, gradeId: existing.grade_id }));
        return { ticket: viewTicket(ticket, now), coin: coin ?? viewOwned(existing), replayed: true };
      }
      if (ticket.expires_at <= now) throw new CoinEconomyError('COIN_TICKET_EXPIRED');
      const entries = (await client.query<EntryRow>(`SELECT entry.*, grade.summary FROM coin_pool_entries entry
        JOIN collectible_publication_grades grade USING (publication_id,grade_id)
        JOIN collectible_publications publication ON publication.id = entry.publication_id
        WHERE entry.pool_id = $1 AND publication.media_removed_at IS NULL ORDER BY entry.publication_id,entry.grade_id
        FOR SHARE OF publication`,
      [ticket.pool_id])).rows;
      const total = (await client.query<{ n: number }>('SELECT count(*)::integer AS n FROM coin_pool_entries WHERE pool_id = $1', [ticket.pool_id])).rows[0]!.n;
      if (!entries.length || entries.length !== total) throw new CoinEconomyError('COIN_PUBLICATION_UNAVAILABLE');
      const chosen = chooseWeightedCoin(entries, this.randomInt);
      await client.query('UPDATE coin_tickets SET used_at = $2 WHERE id = $1', [ticket.id, now]);
      await client.query('INSERT INTO coin_draws (ticket_id,publication_id,grade_id,drawn_at) VALUES ($1,$2,$3,$4)',
        [ticket.id, chosen.publication_id, chosen.grade_id, now]);
      const coin = (await this.owned(client, input.accountId)).find(item => item.publicationId === chosen.publication_id && item.gradeId === chosen.grade_id)!;
      return { ticket: viewTicket({ ...ticket, used_at: now }, now), coin, replayed: false };
    });
  }

  private async seriesRows(client: Pool | PoolClient, accountId: string, seriesId?: string): Promise<CoinSeries[]> {
    const now = this.now();
    const rows = seriesId ? (await client.query<SeriesRow>(`${seriesSql} WHERE series.id = $1
      AND (series.status = 'ACTIVE' OR EXISTS (SELECT 1 FROM coin_series_coupons coupon
        WHERE coupon.series_id = series.id AND coupon.account_id = $2))`, [seriesId, accountId])).rows : [
      ...(await client.query<SeriesRow>(`${seriesSql} WHERE series.status = 'ACTIVE'
        ORDER BY series.created_at DESC LIMIT 100`)).rows,
      ...(await client.query<SeriesRow>(`${seriesSql}
        JOIN coin_series_coupons coupon ON coupon.series_id = series.id
        WHERE coupon.account_id = $1 AND coupon.redeemed_at IS NULL AND coupon.expires_at > $2`,
      [accountId, now])).rows,
      ...(await client.query<SeriesRow>(`${seriesSql}
        JOIN coin_series_coupons coupon ON coupon.series_id = series.id
        WHERE coupon.account_id = $1 AND (coupon.redeemed_at IS NOT NULL OR coupon.expires_at <= $2)
        ORDER BY coupon.issued_at DESC LIMIT 100`, [accountId, now])).rows,
    ];
    const distinctRows = [...new Map(rows.map(row => [row.id, row])).values()];
    if (!distinctRows.length) return [];
    // PoolClient와 Pool이 모두 쓰므로 같은 연결에서는 순서대로 보낸다.
    const entries = await client.query<SeriesEntryRow>(`SELECT entry.*,
        CASE WHEN publication.media_removed_at IS NOT NULL
          THEN '{"name":"공개가 중단된 코인","mediaRemoved":true}'::jsonb ELSE grade.summary END AS summary,
        publication.media_removed_at IS NOT NULL AS media_removed FROM coin_series_entries entry
        JOIN collectible_publication_grades grade USING (publication_id,grade_id)
        JOIN collectible_publications publication ON publication.id = entry.publication_id
        WHERE entry.series_id = ANY($1::uuid[]) ORDER BY entry.series_id,entry.tier,entry.publication_id,entry.grade_id`, [distinctRows.map(row => row.id)]);
    const coupons = await client.query<SeriesCouponRow>(
      'SELECT * FROM coin_series_coupons WHERE account_id = $1 AND series_id = ANY($2::uuid[])',
      [accountId, distinctRows.map(row => row.id)]);
    const owned = await this.owned(client, accountId);
    return distinctRows.map(row => viewSeries(row, entries.rows, owned, coupons.rows.find(coupon => coupon.series_id === row.id), now));
  }
  async getCollection(accountId: string): Promise<CoinCollection> {
    const now = this.now();
    const [coins, series, sources, tickets, rows] = await Promise.all([
      this.owned(this.pool, accountId), this.seriesRows(this.pool, accountId), this.sources(this.pool, accountId),
      this.pool.query<RerollTicketRow>(`SELECT ticket.*, draw.drawn_at AS used_at FROM coin_reroll_tickets ticket
        LEFT JOIN coin_rerolls draw ON draw.ticket_id = ticket.id WHERE ticket.account_id = $1
        ORDER BY ticket.acquired_at DESC`, [accountId]),
      this.pool.query<CatalogRow>(`SELECT merchant.id AS merchant_id, merchant.name AS merchant_name,
        publication.id AS publication_id, grade.grade_id,
        CASE WHEN publication.media_removed_at IS NOT NULL
          THEN '{"name":"공개가 중단된 코인","mediaRemoved":true}'::jsonb ELSE grade.summary END AS summary
        FROM collectible_publications publication
        JOIN merchants merchant ON merchant.id = publication.merchant_id
        JOIN collectible_publication_grades grade ON grade.publication_id = publication.id
        WHERE NOT EXISTS (SELECT 1 FROM showcase_guest_trials trial
          WHERE trial.merchant_id = merchant.id AND trial.account_id <> $1)
        AND publication.id IN (
          SELECT publication_id FROM campaign_collectible_publications link JOIN campaigns campaign
            ON campaign.id = link.campaign_id WHERE campaign.status = 'ACTIVE' AND campaign.is_public
              AND campaign.starts_at <= $2 AND campaign.ends_at > $2
          UNION SELECT publication_id FROM collectible_acquisitions acquisition JOIN reward_entitlements entitlement
            ON entitlement.id = acquisition.entitlement_id WHERE entitlement.customer_account_id = $1
          UNION SELECT draw.publication_id FROM coin_draws draw JOIN coin_tickets ticket
            ON ticket.id = draw.ticket_id WHERE ticket.account_id = $1
          UNION SELECT publication_id FROM grade_draws WHERE account_id = $1 AND reward_kind = 'COIN'
          UNION SELECT publication_id FROM coin_rerolls WHERE account_id = $1)
        ORDER BY merchant.name, publication.id, grade.grade_id`, [accountId, now]),
    ]);
    const catalog: CoinCatalog = [];
    for (const row of rows.rows) {
      let merchant = catalog.find(item => item.merchantId === row.merchant_id);
      if (!merchant) { merchant = { merchantId: row.merchant_id, merchantName: row.merchant_name, types: [] }; catalog.push(merchant); }
      let type = merchant.types.find(item => item.publicationId === row.publication_id);
      if (!type) { type = { publicationId: row.publication_id, name: nameOf(row.summary), grades: [] }; merchant.types.push(type); }
      const gradeSources = sources.filter(source => source.publicationId === row.publication_id && source.gradeId === row.grade_id);
      type.grades.push({ publicationId: row.publication_id, gradeId: row.grade_id, name: nameOf(row.summary),
        summary: row.summary, quantity: gradeSources.length, sources: gradeSources });
    }
    return { coins, series, catalog, reroll: { tickets: tickets.rows.map(viewRerollTicket), sources,
      options: await this.rerollOptions(this.pool, [...new Set(sources.filter(source => source.rerollEligible).map(source => source.merchantId))]) } };
  }

  async claimSeries(input: { accountId: string; seriesId: string }) {
    if (!uuid.test(input.seriesId)) throw new CoinEconomyError('COIN_SERIES_UNAVAILABLE');
    return this.transaction(async client => {
      await this.accountLifecycle.assertActive(client, input.accountId);
      const coupon = (await client.query<SeriesCouponRow>(
        'SELECT * FROM coin_series_coupons WHERE account_id = $1 AND series_id = $2', [input.accountId, input.seriesId])).rows[0];
      if (coupon) return { series: (await this.seriesRows(client, input.accountId, input.seriesId))[0]!, replayed: true };
      const row = (await client.query<SeriesRow>(`${seriesSql} WHERE series.id = $1 FOR UPDATE OF series`, [input.seriesId])).rows[0];
      if (!row || row.status !== 'ACTIVE' || row.ends_at <= this.now()) throw new CoinEconomyError('COIN_SERIES_UNAVAILABLE');
      const merchant = (await client.query<{ status: string }>('SELECT status FROM merchants WHERE id = $1 FOR SHARE', [row.merchant_id])).rows[0];
      if (!merchant || merchant.status !== 'ACTIVE') throw new CoinEconomyError('COIN_SERIES_UNAVAILABLE');
      const series = (await this.seriesRows(client, input.accountId, input.seriesId))[0]!;
      const publications = await client.query<{ removed: boolean }>(`SELECT publication.media_removed_at IS NOT NULL AS removed FROM coin_series_entries entry
        JOIN collectible_publications publication ON publication.id = entry.publication_id
        WHERE entry.series_id = $1 FOR SHARE OF publication`, [row.id]);
      if (!publications.rowCount || publications.rows.some(publication => publication.removed)) {
        throw new CoinEconomyError('COIN_PUBLICATION_UNAVAILABLE');
      }
      const tier = series.claimable;
      if (!tier) {
        if (series.base.complete || series.prism.complete) throw new CoinEconomyError('COIN_SERIES_CAP_REACHED');
        throw new CoinEconomyError('COIN_SERIES_INCOMPLETE');
      }
      const now = this.now();
      const days = tier === 'PRISM' ? row.prism_valid_days : row.base_valid_days;
      const expires = new Date(now.getTime() + days * 86_400_000);
      await client.query(`INSERT INTO coin_series_coupons
        (id,account_id,series_id,merchant_id,tier,title,detail,issued_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [this.nextId(), input.accountId, row.id, row.merchant_id, tier,
        tier === 'PRISM' ? row.prism_title : row.base_title, tier === 'PRISM' ? row.prism_detail : row.base_detail, now, expires]);
      await client.query(`UPDATE coin_series SET ${tier === 'PRISM' ? 'prism_issued' : 'base_issued'} = ${tier === 'PRISM' ? 'prism_issued' : 'base_issued'} + 1 WHERE id = $1`, [row.id]);
      return { series: (await this.seriesRows(client, input.accountId, input.seriesId))[0]!, replayed: false };
    });
  }

  private async publishedCoins(client: PoolClient, references: CoinReference[]): Promise<void> {
    if (!Array.isArray(references) || !references.length || references.length > 50 ||
      references.some(ref => !ref || typeof ref !== 'object') ||
      new Set(references.map(keyOf)).size !== references.length ||
      references.some(ref => !uuid.test(ref.publicationId) || !validText(ref.gradeId, 80))) throw new CoinEconomyError('INVALID_REQUEST');
    const rows = await client.query<{ publication_id: string; grade_id: string; merchant_id: string }>(
      `SELECT grade.publication_id,grade.grade_id,publication.merchant_id
       FROM collectible_publication_grades grade
       JOIN collectible_publications publication ON publication.id = grade.publication_id
       JOIN campaigns campaign ON campaign.id = publication.campaign_id
       JOIN campaign_collectible_publications current_publication
         ON current_publication.campaign_id = campaign.id AND current_publication.publication_id = publication.id
       JOIN merchants merchant ON merchant.id = publication.merchant_id
       WHERE (grade.publication_id,grade.grade_id) IN (
         SELECT (ref.value->>'publicationId')::uuid,ref.value->>'gradeId' FROM jsonb_array_elements($1::jsonb) AS ref(value)
       ) AND publication.media_removed_at IS NULL AND campaign.is_public AND campaign.status = 'ACTIVE'
         AND merchant.status = 'ACTIVE' AND campaign.starts_at <= $2 AND campaign.ends_at > $2
       FOR SHARE OF publication, campaign, current_publication`, [JSON.stringify(references), this.now()]);
    if (rows.rowCount !== references.length) throw new CoinEconomyError('COIN_PUBLICATION_UNAVAILABLE');
  }

  async publishPool(input: PublishCoinPoolInput): Promise<CoinPool> {
    if (!validText(input.merchantId, 100) || !validText(input.eventName, 80) ||
      !['BRONZE','SILVER','GOLD','PLATINUM'].includes(input.grade) || !positive(input.price, 100000) ||
      !positive(input.perAccountLimit, 100) || !positive(input.issuanceCap, 100000) ||
      !validDate(input.purchaseStartsAt) || !validDate(input.purchaseEndsAt) || !validDate(input.useExpiresAt) ||
      Date.parse(input.purchaseStartsAt) >= Date.parse(input.purchaseEndsAt) ||
      Date.parse(input.purchaseEndsAt) >= Date.parse(input.useExpiresAt) ||
      Date.parse(input.useExpiresAt) <= this.now().getTime() ||
      !Array.isArray(input.entries) || !input.entries.length || input.entries.some(entry => !entry || !positive(entry.weight, 100000)) ||
      input.entries.reduce((sum, entry) => sum + entry.weight, 0) > 1_000_000) throw new CoinEconomyError('INVALID_REQUEST');
    return this.transaction(async client => {
      await assertPlatformAdmin(client, this.accountLifecycle, input.actorAccountId);
      await this.publishedCoins(client, input.entries);
      const merchant = (await client.query<{ id: string; status: string }>('SELECT id,status FROM merchants WHERE id = $1 FOR SHARE', [input.merchantId])).rows[0];
      if (!merchant || merchant.status !== 'ACTIVE') throw new CoinEconomyError('COIN_POOL_UNAVAILABLE');
      const attached = await client.query<{ n: number }>(`SELECT count(*)::integer AS n FROM collectible_publications
        WHERE id = ANY($1::uuid[]) AND merchant_id = $2`, [input.entries.map(entry => entry.publicationId), input.merchantId]);
      if (attached.rows[0]!.n !== new Set(input.entries.map(entry => entry.publicationId)).size) throw new CoinEconomyError('COIN_PUBLICATION_UNAVAILABLE');
      const id = this.nextId();
      await client.query(`INSERT INTO coin_pools
        (id,merchant_id,event_name,grade,price,purchase_starts_at,purchase_ends_at,use_expires_at,per_account_limit,issuance_cap)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,input.merchantId,input.eventName.trim(),input.grade,input.price,
        input.purchaseStartsAt,input.purchaseEndsAt,input.useExpiresAt,input.perAccountLimit,input.issuanceCap]);
      for (const entry of input.entries) await client.query(`INSERT INTO coin_pool_entries (pool_id,publication_id,grade_id,weight)
        VALUES ($1,$2,$3,$4)`, [id,entry.publicationId,entry.gradeId,entry.weight]);
      const pool = (await client.query<PoolRow>(`${poolSql} WHERE pool.id = $1`,[id])).rows[0]!;
      return viewPool(pool, await this.poolEntries(client,[id]));
    });
  }

  async pausePool(input: { actorAccountId: string; poolId: string }): Promise<CoinPool> {
    if (!uuid.test(input.poolId)) throw new CoinEconomyError('COIN_POOL_UNAVAILABLE');
    return this.transaction(async client => {
      await assertPlatformAdmin(client, this.accountLifecycle, input.actorAccountId);
      const row = (await client.query<PoolRow>(`${poolSql} WHERE pool.id = $1 FOR UPDATE OF pool`,[input.poolId])).rows[0];
      if (!row) throw new CoinEconomyError('COIN_POOL_UNAVAILABLE');
      if (row.status === 'ACTIVE') await client.query("UPDATE coin_pools SET status = 'PAUSED' WHERE id = $1",[row.id]);
      return viewPool({ ...row, status: 'PAUSED' }, await this.poolEntries(client,[row.id]));
    });
  }

  async publishSeries(input: PublishCoinSeriesInput): Promise<CoinSeries> {
    const consent = normalizeDocumentReference(input.consentDocumentRef);
    const basePublications = Array.isArray(input.baseCoins) ? input.baseCoins.map(coin => coin?.publicationId).sort() : [];
    const prismPublications = Array.isArray(input.prismCoins) ? input.prismCoins.map(coin => coin?.publicationId).sort() : [];
    if (!validText(input.title,80) || !validText(input.merchantId,100) || !validDate(input.endsAt) ||
      Date.parse(input.endsAt) <= this.now().getTime() || !consent || !isCompleteOwnerOfferConsent(input.consent) ||
      !Array.isArray(input.baseCoins) || !Array.isArray(input.prismCoins) ||
      !input.baseCoins.length || !input.prismCoins.length ||
      input.baseCoins.some(coin => !coin || typeof coin !== 'object') ||
      input.prismCoins.some(coin => !coin || typeof coin !== 'object') ||
      new Set(basePublications).size !== basePublications.length ||
      basePublications.join(',') !== prismPublications.join(',') ||
      input.baseCoins.some(base => input.prismCoins.some(prism =>
        base.publicationId === prism.publicationId && base.gradeId === prism.gradeId)) ||
      [input.baseCoupon,input.prismCoupon].some(coupon => !coupon || !validText(coupon.title,40) ||
        typeof coupon.detail !== 'string' || coupon.detail.length > 120 ||
        !positive(coupon.validDays,365) || !positive(coupon.issuanceCap,10000))) throw new CoinEconomyError('INVALID_REQUEST');
    return this.transaction(async client => {
      await assertPlatformAdmin(client,this.accountLifecycle,input.actorAccountId);
      const merchant = (await client.query<{ status: string; is_demo: boolean }>(
        'SELECT status,is_demo FROM merchants WHERE id = $1 FOR SHARE',[input.merchantId])).rows[0];
      if (!merchant || merchant.status !== 'ACTIVE' || merchant.is_demo) throw new CoinEconomyError('COIN_SERIES_UNAVAILABLE');
      await this.publishedCoins(client,[...new Map([...input.baseCoins,...input.prismCoins].map(ref => [keyOf(ref),ref])).values()]);
      const id = this.nextId();
      await client.query(`INSERT INTO coin_series
        (id,merchant_id,title,ends_at,base_title,base_detail,base_valid_days,base_cap,
         prism_title,prism_detail,prism_valid_days,prism_cap,consent_document_ref)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id,input.merchantId,input.title.trim(),input.endsAt,input.baseCoupon.title.trim(),input.baseCoupon.detail,
        input.baseCoupon.validDays,input.baseCoupon.issuanceCap,input.prismCoupon.title.trim(),input.prismCoupon.detail,
        input.prismCoupon.validDays,input.prismCoupon.issuanceCap,consent]);
      for (const [tier, refs] of [['BASE',input.baseCoins],['PRISM',input.prismCoins]] as const) {
        if (new Set(refs.map(keyOf)).size !== refs.length || refs.length > 50) throw new CoinEconomyError('INVALID_REQUEST');
        for (const ref of refs) await client.query(`INSERT INTO coin_series_entries (series_id,tier,publication_id,grade_id)
          VALUES ($1,$2,$3,$4)`,[id,tier,ref.publicationId,ref.gradeId]);
      }
      return (await this.seriesRows(client,input.actorAccountId,id))[0]!;
    });
  }
}
