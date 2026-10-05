import { randomInt as cryptoRandomInt, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import {
  MileageShopError,
  type MileageShopClothingView,
  type MileageRerollResult,
  type MileageShopHistory,
  type MileageShopService,
  type MileageShopSnapshot,
} from '../mileage-shop.js';
import {
  MILEAGE_CATALOG,
  MILEAGE_CLOTHING_CATALOG,
  DRAW_BONUS_MILEAGE,
  DRAW_CLOTHING_PROBABILITY,
  MILEAGE_EARN_RULES,
  MILEAGE_GRADE_PRICES,
  canEquipClothing,
  canSetAvatar,
  chooseUniform,
  computeEarnedMileage,
  decideDrawRewards,
  findClothingItem,
  decideReroll,
  findCatalogItem,
  itemsOfGrade,
  summarizeMileage,
  type MileageGrade,
} from '../mileage-rules.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { countedVisitFilterSql, countedVisitFromSql } from './badge-rewards.js';
import { nextCosmeticBonus, EXPERIENCE_COSMETICS } from '../collection-experience.js';

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
type CreditRow = { credited: number };
type Queryable = Pool | PoolClient;

// db가 PoolClient면 한 연결이라 동시에 두 질의를 보낼 수 없다(Pool과 달리 질의를 줄 세워야 한다) —
// 이 함수가 어느 쪽으로 불려도 안전하도록 항상 순서대로 기다린다.
async function earnedAndSpent(db: Queryable, accountId: string): Promise<{ earned: number; spent: number }> {
  const earnedResult = await db.query<EarnedRow>(earnedMileageSql, [accountId]);
  const spentResult = await db.query<SpentRow>(
    `SELECT coalesce(sum(amount), 0)::integer AS spent FROM mileage_spends WHERE account_id = $1`,
    [accountId],
  );
  const creditResult = await db.query<CreditRow>(
    `SELECT coalesce(sum(amount), 0)::integer AS credited FROM mileage_credits WHERE account_id = $1`,
    [accountId],
  );
  const row = earnedResult.rows[0]!;
  return {
    earned: computeEarnedMileage({
      countedVisits: row.counted_visits,
      distinctMerchants: row.distinct_merchants,
      completedSeries: row.completed_series,
    }) + (creditResult.rows[0]?.credited ?? 0),
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

async function ownedClothingIds(db: Queryable, accountId: string): Promise<Set<string>> {
  const rows = await db.query<{ item_id: string }>(
    'SELECT item_id FROM account_clothing WHERE account_id = $1',
    [accountId],
  );
  return new Set(rows.rows.map((row) => row.item_id));
}

function requireCatalogItem(itemId: string): { id: string; grade: MileageGrade; name: string } {
  const item = findCatalogItem(itemId);
  if (!item) throw new Error(`unknown mileage catalog item persisted: ${itemId}`);
  return item;
}

function requireClothingItem(itemId: string): { id: string; name: string } {
  const item = findClothingItem(itemId);
  if (!item) throw new Error(`unknown clothing catalog item persisted: ${itemId}`);
  return item;
}

function kstBusinessDate(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function drawRewardPayload(input: {
  bonusMileage: number;
  clothingItemId: string | null;
  clothingDuplicate: boolean;
}): MileageRerollResult['rewards'] {
  return {
    mileage: {
      amount: input.bonusMileage,
      min: DRAW_BONUS_MILEAGE.min,
      max: DRAW_BONUS_MILEAGE.max,
      probabilityPerAmount: DRAW_BONUS_MILEAGE.probabilityPerAmount,
    },
    clothing: {
      awarded: input.clothingItemId !== null,
      duplicate: input.clothingDuplicate,
      item: input.clothingItemId === null ? null : requireClothingItem(input.clothingItemId),
      probability: DRAW_CLOTHING_PROBABILITY,
    },
    sequence: ['MILEAGE', 'CLOTHING', 'CHARACTER'],
  };
}

function cosmeticBonus(id: string): MileageRerollResult['bonus'] {
  const item = EXPERIENCE_COSMETICS.find((candidate) => candidate.id === id)!;
  return { id, name: item.name, slot: item.slot };
}

const historyCursorPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresMileageShopService implements MileageShopService {
  private readonly now: () => Date;
  private readonly nextSpendId: () => string;
  private readonly accountLifecycle: PostgresAccountLifecycle;
  // ponytail: 시간당 재뽑기 횟수는 완료된 구매(mileage_spends 행)만 센다. 등급 완료·잔액 부족으로 실패하는
  // 시도는 assertActive의 계정 잠금 아래서 도는 값싼 조회라 따로 막지 않는다. 실패 시도 자체의 남용이 실제로
  // 문제가 되면 별도 시도 기록 테이블(friend_code_attempts와 같은 모양)을 추가한다.
  private readonly rerollRateLimit: number;
  private readonly rerollRateLimitWindowMs: number;
  // 시연 전부 체험(#333): 시연 서버만 server.ts에서 양수로 넘긴다. 잔액(balance)에만 더해지고 earned·spent는 진짜 값 그대로다.
  private readonly showcaseBonusMileage: number;
  private readonly randomInt: (bound: number) => number;
  private readonly nextCreditId: () => string;

  constructor(
    private readonly pool: Pool,
    options: {
      accountLifecycle: PostgresAccountLifecycle;
      now?: () => Date;
      nextSpendId?: () => string;
      nextCreditId?: () => string;
      randomInt?: (bound: number) => number;
      rerollRateLimit?: number;
      rerollRateLimitWindowMs?: number;
      showcaseBonusMileage?: number;
    },
  ) {
    this.accountLifecycle = options.accountLifecycle;
    this.now = options.now ?? (() => new Date());
    this.nextSpendId = options.nextSpendId ?? randomUUID;
    this.nextCreditId = options.nextCreditId ?? randomUUID;
    this.randomInt = options.randomInt ?? cryptoRandomInt;
    this.rerollRateLimit = options.rerollRateLimit ?? 30;
    this.rerollRateLimitWindowMs = options.rerollRateLimitWindowMs ?? 60 * 60 * 1000;
    this.showcaseBonusMileage = options.showcaseBonusMileage ?? 0;
    if (!Number.isSafeInteger(this.showcaseBonusMileage) || this.showcaseBonusMileage < 0) {
      throw new Error('mileage shop showcaseBonusMileage must be a non-negative safe integer');
    }
  }

  async getShop(accountId: string): Promise<MileageShopSnapshot> {
    const [{ earned, spent }, owned, clothingOwned, profileResult] = await Promise.all([
      earnedAndSpent(this.pool, accountId),
      ownedItemIds(this.pool, accountId),
      ownedClothingIds(this.pool, accountId),
      this.pool.query<{ avatar_item_id: string | null; equipped_clothing_item_id: string | null }>(
        'SELECT avatar_item_id, equipped_clothing_item_id FROM account_profile WHERE account_id = $1',
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
    const equippedClothing = profileResult.rows[0]?.equipped_clothing_item_id ?? null;
    const clothingItems: MileageShopClothingView[] = MILEAGE_CLOTHING_CATALOG.map((item) => ({
      ...item,
      owned: clothingOwned.has(item.id),
      equipped: item.id === equippedClothing,
    }));
    return {
      mileage: {
        ...summarizeMileage({ earned, spent, showcaseBonus: this.showcaseBonusMileage }),
        rules: { ...MILEAGE_EARN_RULES },
      },
      grades,
      items: MILEAGE_CATALOG.map((item) => ({ ...item, owned: owned.has(item.id) })),
      avatar: profileResult.rows[0]?.avatar_item_id ?? null,
      clothing: {
        items: clothingItems,
        equipped: equippedClothing,
        draw: { probability: DRAW_CLOTHING_PROBABILITY },
      },
      drawRewards: {
        bonusMileage: {
          min: DRAW_BONUS_MILEAGE.min,
          max: DRAW_BONUS_MILEAGE.max,
          probabilityPerAmount: DRAW_BONUS_MILEAGE.probabilityPerAmount,
        },
      },
    };
  }

  async getHistory(input: { accountId: string; cursor?: string }): Promise<MileageShopHistory> {
    const pageSize = 20;
    let beforeCreatedAt: Date | null = null;
    if (input.cursor !== undefined) {
      // 커서는 이 계정의 사용 기록 id(uuid)다. 형식이 틀리면 DB까지 보내지 않고 잘못된 요청으로 거절한다.
      if (!historyCursorPattern.test(input.cursor)) throw new MileageShopError('INVALID_REQUEST');
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
      mileage: summarizeMileage({ earned, spent, showcaseBonus: this.showcaseBonusMileage }),
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

      const existingResult = await client.query<{
        grade: MileageGrade;
        item_id: string;
        cosmetic_bonus_id: string;
        bonus_mileage_amount: number;
        clothing_item_id: string | null;
        clothing_duplicate: boolean;
      }>(
        `SELECT grade, item_id, cosmetic_bonus_id, bonus_mileage_amount, clothing_item_id, clothing_duplicate
         FROM mileage_spends WHERE account_id = $1 AND request_id = $2`,
        [input.accountId, input.requestId],
      );
      const previous = existingResult.rows[0];

      // 모두 같은 connection(client)을 쓰므로 Pool.query처럼 동시에 보낼 수 없다(한 번에 하나).
      const recentResult = await client.query<{ n: number }>(
        `SELECT count(*)::integer AS n FROM mileage_spends
         WHERE account_id = $1 AND created_at > $2`,
        [input.accountId, new Date(now.getTime() - this.rerollRateLimitWindowMs)],
      );
      const owned = await ownedItemIds(client, input.accountId);
      const clothingOwned = await ownedClothingIds(client, input.accountId);
      const { earned, spent } = await earnedAndSpent(client, input.accountId);
      const unowned = itemsOfGrade(input.grade).filter((item) => !owned.has(item.id));
      const price = MILEAGE_GRADE_PRICES[input.grade];
      // 시연 서버에서는 보너스가 잔액에 들어가 진짜 적립을 넘겨 쓰지 않고도 살 수 있다. 운영은 보너스 0이라 earned - spent 그대로다.
      const { balance } = summarizeMileage({ earned, spent, showcaseBonus: this.showcaseBonusMileage });

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
        return {
          item,
          bonus: cosmeticBonus(previous!.cosmetic_bonus_id),
          balance,
          replayed: true,
          rewards: drawRewardPayload({
            bonusMileage: previous!.bonus_mileage_amount,
            clothingItemId: previous!.clothing_item_id,
            clothingDuplicate: previous!.clothing_duplicate,
          }),
        };
      }
      if (decision.kind === 'REQUEST_CONFLICT') throw new MileageShopError('SHOP_REQUEST_CONFLICT');
      if (decision.kind === 'RATE_LIMITED') {
        throw new MileageShopError('SHOP_RATE_LIMITED', Math.ceil(this.rerollRateLimitWindowMs / 1000));
      }
      if (decision.kind === 'STATE_CHANGED') throw new MileageShopError('SHOP_STATE_CHANGED');
      if (decision.kind === 'GRADE_COMPLETE') throw new MileageShopError('SHOP_GRADE_COMPLETE');
      if (decision.kind === 'INSUFFICIENT_MILEAGE') throw new MileageShopError('SHOP_INSUFFICIENT_MILEAGE');

      const bonuses = await client.query<{ cosmetic_bonus_id: string }>(
        'SELECT cosmetic_bonus_id FROM mileage_spends WHERE account_id = $1 AND grade = $2',
        [input.accountId, input.grade],
      );
      const bonusId = nextCosmeticBonus(input.grade, new Set(bonuses.rows.map((row) => row.cosmetic_bonus_id)));
      const chosen = chooseUniform(unowned, this.randomInt);
      const rewards = decideDrawRewards(this.randomInt);
      const clothingDuplicate = rewards.clothingItem !== null && clothingOwned.has(rewards.clothingItem.id);
      const spendId = this.nextSpendId();
      await client.query(
        `INSERT INTO account_characters (account_id, item_id, acquired_at, source)
         VALUES ($1, $2, $3, 'REROLL')`,
        [input.accountId, chosen.id, now],
      );
      if (rewards.clothingItem) {
        await client.query(
          `INSERT INTO account_clothing (account_id, item_id, acquired_at, source)
           VALUES ($1, $2, $3, 'REROLL')
           ON CONFLICT DO NOTHING`,
          [input.accountId, rewards.clothingItem.id, now],
        );
      }
      await client.query(
        `INSERT INTO mileage_spends (
           id, account_id, amount, reason, grade, item_id, request_id, created_at, cosmetic_bonus_id,
           bonus_mileage_amount, clothing_item_id, clothing_awarded, clothing_duplicate
         )
         VALUES ($1, $2, $3, 'REROLL', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          spendId, input.accountId, price, input.grade, chosen.id, input.requestId, now, bonusId,
          rewards.bonusMileage, rewards.clothingItem?.id ?? null, rewards.clothingItem !== null, clothingDuplicate,
        ],
      );
      await client.query(
        `INSERT INTO mileage_credits (id, account_id, amount, reason, source_id, business_date, created_at)
         VALUES ($1, $2, $3, 'DRAW_BONUS', $4, $5, $6)`,
        [this.nextCreditId(), input.accountId, rewards.bonusMileage, `shop-reroll:${spendId}`, kstBusinessDate(now), now],
      );
      await client.query('COMMIT');
      return {
        item: chosen,
        bonus: cosmeticBonus(bonusId),
        balance: balance - price + rewards.bonusMileage,
        replayed: false,
        rewards: drawRewardPayload({
          bonusMileage: rewards.bonusMileage,
          clothingItemId: rewards.clothingItem?.id ?? null,
          clothingDuplicate,
        }),
      };
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

  async setClothing(input: { accountId: string; itemId: string | null }): Promise<{ equippedClothing: string | null }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.assertActive(client, input.accountId);
      const owned = await ownedClothingIds(client, input.accountId);
      if (!canEquipClothing(input.itemId, owned)) throw new MileageShopError('SHOP_CLOTHING_NOT_OWNED');
      const now = this.now();
      await client.query(
        `INSERT INTO account_profile (account_id, equipped_clothing_item_id, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE SET equipped_clothing_item_id = $2, updated_at = $3`,
        [input.accountId, input.itemId, now],
      );
      await client.query('COMMIT');
      return { equippedClothing: input.itemId };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new MileageShopError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }
}
