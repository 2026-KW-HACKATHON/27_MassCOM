import { randomInt, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  MileageShopError,
  type MileageRerollResult,
  type MileageShopHistory,
  type MileageShopService,
  type MileageShopSnapshot,
} from '../mileage-shop.js';
import {
  MILEAGE_CATALOG,
  MILEAGE_EARN_RULES,
  MILEAGE_GRADE_PRICES,
  canSetAvatar,
  chooseUniform,
  computeEarnedMileage,
  decideReroll,
  findCatalogItem,
  itemsOfGrade,
  type MileageGrade,
} from '../mileage-rules.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { countedVisitFilterSql, countedVisitFromSql } from './badge-rewards.js';

// 적립 공식의 두 항(센 방문·서로 다른 점포)은 배지 집계(badge-rewards.ts)와 완전히 같은 방문 집합을 쓴다:
// countedVisitFromSql/countedVisitFilterSql을 그대로 가져와 다시 만들지 않는다(design-298.md 4번).
// 세 번째 항(완성한 점포 시리즈)은 그 점포의 아무 캠페인이든(기간이 끝났거나 비공개여도) 그 캠페인의 목표를
// 전부(유효·비철회 reward_entitlements로) 채웠으면 그 점포를 한 번만 센다(design-298.md 5번).
// reward_entitlements.status IN (GRANTED, MINT_REQUESTED, FULFILLED)은 "유효·비철회"의 뜻이다
// (postgres/collection.ts의 보유 수집품 조건과 같다; CANCELED는 되돌리기로 철회된 상태다).
const earnedMileageSql = `
  WITH counted AS (
    SELECT visit.merchant_id, visit.business_date
    ${countedVisitFromSql}
    WHERE visit.customer_account_id = $1 AND ${countedVisitFilterSql}
  ),
  visit_totals AS (
    SELECT
      count(*)::integer AS counted_visits,
      count(DISTINCT merchant_id)::integer AS distinct_merchants
    FROM counted
  ),
  account_entitlements AS (
    SELECT campaign_id, target_visit_count
    FROM reward_entitlements
    WHERE customer_account_id = $1 AND status IN ('GRANTED', 'MINT_REQUESTED', 'FULFILLED')
  ),
  campaign_goal_totals AS (
    SELECT campaign_id, count(*)::integer AS total_goals FROM campaign_goals GROUP BY campaign_id
  ),
  completed_campaigns AS (
    SELECT goal.campaign_id
    FROM campaign_goals AS goal
    JOIN account_entitlements AS entitlement
      ON entitlement.campaign_id = goal.campaign_id
     AND entitlement.target_visit_count = goal.target_visit_count
    GROUP BY goal.campaign_id
    HAVING count(*) = (
      SELECT total_goals FROM campaign_goal_totals WHERE campaign_goal_totals.campaign_id = goal.campaign_id
    )
  ),
  series_totals AS (
    SELECT count(DISTINCT campaign.merchant_id)::integer AS completed_series
    FROM completed_campaigns
    JOIN campaigns AS campaign ON campaign.id = completed_campaigns.campaign_id
  )
  SELECT visit_totals.counted_visits, visit_totals.distinct_merchants, series_totals.completed_series
  FROM visit_totals, series_totals`;

type EarnedRow = { counted_visits: number; distinct_merchants: number; completed_series: number };
type SpentRow = { spent: number };
type Queryable = Pool | PoolClient;

async function earnedAndSpent(db: Queryable, accountId: string): Promise<{ earned: number; spent: number }> {
  const [earnedResult, spentResult] = await Promise.all([
    db.query<EarnedRow>(earnedMileageSql, [accountId]),
    db.query<SpentRow>(
      `SELECT coalesce(sum(amount), 0)::integer AS spent FROM mileage_spends WHERE account_id = $1`,
      [accountId],
    ),
  ]);
  const row = earnedResult.rows[0]!;
  return {
    earned: computeEarnedMileage({
      countedVisits: row.counted_visits,
      distinctMerchants: row.distinct_merchants,
      completedSeries: row.completed_series,
    }),
    spent: spentResult.rows[0]?.spent ?? 0,
  };
}

async function ownedItemIds(db: Queryable, accountId: string): Promise<Set<string>> {
  const rows = await db.query<{ item_id: string }>(
    'SELECT item_id FROM account_characters WHERE account_id = $1',
    [accountId],
  );
  return new Set(rows.rows.map((row) => row.item_id));
}

function requireCatalogItem(itemId: string): { id: string; grade: MileageGrade; name: string } {
  const item = findCatalogItem(itemId);
  if (!item) throw new Error(`unknown mileage catalog item persisted: ${itemId}`);
  return item;
}

export class PostgresMileageShopService implements MileageShopService {
  private readonly now: () => Date;
  private readonly nextSpendId: () => string;
  private readonly accountLifecycle: PostgresAccountLifecycle;
  // ponytail: 시간당 재뽑기 횟수는 완료된 구매(mileage_spends 행)만 센다. 등급 완료·잔액 부족으로 실패하는
  // 시도는 assertActive의 계정 잠금 아래서 도는 값싼 조회라 따로 막지 않는다. 실패 시도 자체의 남용이 실제로
  // 문제가 되면 별도 시도 기록 테이블(friend_code_attempts와 같은 모양)을 추가한다.
  private readonly rerollRateLimit: number;
  private readonly rerollRateLimitWindowMs: number;

  constructor(
    private readonly pool: Pool,
    options: {
      accountLifecycle: PostgresAccountLifecycle;
      now?: () => Date;
      nextSpendId?: () => string;
      rerollRateLimit?: number;
      rerollRateLimitWindowMs?: number;
    },
  ) {
    this.accountLifecycle = options.accountLifecycle;
    this.now = options.now ?? (() => new Date());
    this.nextSpendId = options.nextSpendId ?? randomUUID;
    this.rerollRateLimit = options.rerollRateLimit ?? 30;
    this.rerollRateLimitWindowMs = options.rerollRateLimitWindowMs ?? 60 * 60 * 1000;
  }

  async getShop(accountId: string): Promise<MileageShopSnapshot> {
    const [{ earned, spent }, owned, avatarResult] = await Promise.all([
      earnedAndSpent(this.pool, accountId),
      ownedItemIds(this.pool, accountId),
      this.pool.query<{ avatar_item_id: string | null }>(
        'SELECT avatar_item_id FROM account_profile WHERE account_id = $1',
        [accountId],
      ),
    ]);
    const grades = (['BRONZE', 'SILVER', 'GOLD'] as const).map((grade) => {
      const items = itemsOfGrade(grade);
      const ownedCount = items.filter((item) => owned.has(item.id)).length;
      const remaining = items.length - ownedCount;
      return {
        grade,
        price: MILEAGE_GRADE_PRICES[grade],
        total: items.length,
        owned: ownedCount,
        remaining,
        probabilityPerItem: remaining > 0 ? 1 / remaining : null,
      };
    });
    return {
      mileage: { earned, spent, balance: earned - spent, rules: { ...MILEAGE_EARN_RULES } },
      grades,
      items: MILEAGE_CATALOG.map((item) => ({ ...item, owned: owned.has(item.id) })),
      avatar: avatarResult.rows[0]?.avatar_item_id ?? null,
    };
  }

  async getHistory(input: { accountId: string; cursor?: string }): Promise<MileageShopHistory> {
    const pageSize = 20;
    let beforeCreatedAt: Date | null = null;
    if (input.cursor !== undefined) {
      const cursorRow = await this.pool.query<{ created_at: Date }>(
        'SELECT created_at FROM mileage_spends WHERE account_id = $1 AND id = $2',
        [input.accountId, input.cursor],
      );
      const found = cursorRow.rows[0];
      if (!found) throw new MileageShopError('INVALID_REQUEST');
      beforeCreatedAt = found.created_at;
    }
    const [{ earned, spent }, rows] = await Promise.all([
      earnedAndSpent(this.pool, input.accountId),
      this.pool.query<{ id: string; amount: number; grade: MileageGrade; item_id: string; created_at: Date }>(
        `SELECT id, amount, grade, item_id, created_at FROM mileage_spends
         WHERE account_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2)
         ORDER BY created_at DESC, id DESC
         LIMIT $3`,
        [input.accountId, beforeCreatedAt, pageSize + 1],
      ),
    ]);
    const page = rows.rows.slice(0, pageSize);
    return {
      mileage: { earned, spent, balance: earned - spent },
      spends: page.map((row) => ({
        id: row.id,
        amount: row.amount,
        grade: row.grade,
        itemId: row.item_id,
        itemName: requireCatalogItem(row.item_id).name,
        createdAt: row.created_at.toISOString(),
      })),
      nextCursor: rows.rows.length > pageSize ? page[page.length - 1]!.id : null,
    };
  }

  async reroll(input: {
    accountId: string;
    grade: MileageGrade;
    requestId: string;
    expectedRemaining: number;
  }): Promise<MileageRerollResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // design-298.md "Design review fixes" 1번: assertActive가 거는 계정 잠금 하나로 충분히 직렬화된다
      // (방문 수령·되돌리기와 같은 잠금). 상점 전용 별도 advisory/row 잠금은 두지 않는다.
      await this.accountLifecycle.assertActive(client, input.accountId);
      const now = this.now();

      const existingResult = await client.query<{ grade: MileageGrade; item_id: string }>(
        'SELECT grade, item_id FROM mileage_spends WHERE account_id = $1 AND request_id = $2',
        [input.accountId, input.requestId],
      );
      const previous = existingResult.rows[0];

      const [recentResult, owned, { earned, spent }] = await Promise.all([
        client.query<{ n: number }>(
          `SELECT count(*)::integer AS n FROM mileage_spends
           WHERE account_id = $1 AND created_at > $2`,
          [input.accountId, new Date(now.getTime() - this.rerollRateLimitWindowMs)],
        ),
        ownedItemIds(client, input.accountId),
        earnedAndSpent(client, input.accountId),
      ]);
      const unowned = itemsOfGrade(input.grade).filter((item) => !owned.has(item.id));
      const price = MILEAGE_GRADE_PRICES[input.grade];
      const balance = earned - spent;

      const decision = decideReroll({
        existingRequest: previous ? { grade: previous.grade } : undefined,
        grade: input.grade,
        withinRateLimit: recentResult.rows[0]!.n < this.rerollRateLimit,
        expectedRemaining: input.expectedRemaining,
        actualRemaining: unowned.length,
        balance,
        price,
      });

      if (decision.kind === 'REPLAY') {
        const item = requireCatalogItem(previous!.item_id);
        await client.query('COMMIT');
        return { item, balance, replayed: true };
      }
      if (decision.kind === 'REQUEST_CONFLICT') throw new MileageShopError('SHOP_REQUEST_CONFLICT');
      if (decision.kind === 'RATE_LIMITED') {
        throw new MileageShopError('SHOP_RATE_LIMITED', Math.ceil(this.rerollRateLimitWindowMs / 1000));
      }
      if (decision.kind === 'STATE_CHANGED') throw new MileageShopError('SHOP_STATE_CHANGED');
      if (decision.kind === 'GRADE_COMPLETE') throw new MileageShopError('SHOP_GRADE_COMPLETE');
      if (decision.kind === 'INSUFFICIENT_MILEAGE') throw new MileageShopError('SHOP_INSUFFICIENT_MILEAGE');

      const chosen = chooseUniform(unowned, (bound) => randomInt(bound));
      await client.query(
        `INSERT INTO account_characters (account_id, item_id, acquired_at, source)
         VALUES ($1, $2, $3, 'REROLL')`,
        [input.accountId, chosen.id, now],
      );
      await client.query(
        `INSERT INTO mileage_spends (id, account_id, amount, reason, grade, item_id, request_id, created_at)
         VALUES ($1, $2, $3, 'REROLL', $4, $5, $6, $7)`,
        [this.nextSpendId(), input.accountId, price, input.grade, chosen.id, input.requestId, now],
      );
      await client.query('COMMIT');
      return { item: chosen, balance: balance - price, replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new MileageShopError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }

  async setAvatar(input: { accountId: string; itemId: string | null }): Promise<{ avatar: string | null }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.assertActive(client, input.accountId);
      const owned = await ownedItemIds(client, input.accountId);
      if (!canSetAvatar(input.itemId, owned)) throw new MileageShopError('SHOP_ITEM_NOT_OWNED');
      const now = this.now();
      await client.query(
        `INSERT INTO account_profile (account_id, avatar_item_id, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE SET avatar_item_id = $2, updated_at = $3`,
        [input.accountId, input.itemId, now],
      );
      await client.query('COMMIT');
      return { avatar: input.itemId };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new MileageShopError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }
}
