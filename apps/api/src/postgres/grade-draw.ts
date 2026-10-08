import { createHash, randomInt as cryptoRandomInt, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import type { CollectibleArtwork } from '../collectible-project.js';
import { catalogRewards, categoryWeightsByRarity, chooseGradeReward, gradeWeights, rewardEntries } from '../grade-draw-rules.js';
import { GradeDrawError, type GradeDrawHistory, type GradeDrawPool, type GradeDrawResult,
  type GradeDrawService, type GradeDrawShop, type GradeReward, type DrawRarity } from '../grade-draw.js';
import { MILEAGE_CATALOG, MILEAGE_GRADE_PRICES, isMileageGrade, type MileageGrade } from '../mileage-rules.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { earnedAndSpent } from './mileage-shop.js';

type CoinRow = { publication_id: string; grade_id: string; merchant_id: string; merchant_name: string;
  summary: CollectibleArtwork };
type DrawRow = { id: string; grade: MileageGrade; price: number; pool_version: string;
  reward_kind: GradeReward['kind']; item_id: string | null; publication_id: string | null;
  grade_id: string | null; rarity: DrawRarity | null; reward_amount: number | null;
  duplicate: boolean; quantity: number; created_at: Date };
type Queryable = Pool | PoolClient;

const grades = ['BRONZE', 'SILVER', 'GOLD'] as const;
const requestPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const versionPattern = /^[0-9a-f]{64}$/;

function rewardFromCoin(row: CoinRow): GradeReward {
  return { kind: 'COIN', id: `${row.publication_id}:${row.grade_id}`,
    name: row.summary.name, publicationId: row.publication_id, gradeId: row.grade_id,
    merchantId: row.merchant_id, merchantName: row.merchant_name, artwork: row.summary };
}

function versionFor(pool: Pick<GradeDrawPool, 'rewards' | 'gradeWeights' | 'categoryWeightsByRarity'>): string {
  return createHash('sha256').update(JSON.stringify(pool)).digest('hex');
}

function kstBusinessDate(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export class PostgresGradeDrawService implements GradeDrawService {
  private readonly now: () => Date;
  private readonly randomInt: (bound: number) => number;
  private readonly nextId: () => string;
  private readonly showcaseBonusMileage: number;

  constructor(private readonly pool: Pool, private readonly accountLifecycle: PostgresAccountLifecycle,
    options: { now?: () => Date; randomInt?: (bound: number) => number;
      nextId?: () => string; showcaseBonusMileage?: number } = {}) {
    this.now = options.now ?? (() => new Date());
    this.randomInt = options.randomInt ?? cryptoRandomInt;
    this.nextId = options.nextId ?? randomUUID;
    this.showcaseBonusMileage = options.showcaseBonusMileage ?? 0;
    if (!Number.isSafeInteger(this.showcaseBonusMileage) || this.showcaseBonusMileage < 0) {
      throw new Error('invalid showcaseBonusMileage');
    }
  }

  private async balance(db: Queryable, accountId: string): Promise<number> {
    const { earned, spent } = await earnedAndSpent(db, accountId);
    return earned + this.showcaseBonusMileage - spent;
  }

  private async poolFor(db: Queryable, grade: MileageGrade, lock: boolean): Promise<GradeDrawPool> {
    const furniture = (await db.query<{ id: string; name: string; assetId: string | null }>(
      `SELECT id,name,asset_id AS "assetId" FROM furniture_catalog ORDER BY id${lock ? ' FOR SHARE' : ''}`)).rows;
    if (!furniture.length) throw new Error('general box furniture catalog is empty');
    const rewards = rewardEntries(grade, furniture);
    const policy = { rewards, gradeWeights: gradeWeights[grade], categoryWeightsByRarity };
    return { grade, price: MILEAGE_GRADE_PRICES[grade], version: versionFor(policy),
      total: rewards.length, ...policy };
  }

  private async storedReward(db: Queryable, row: DrawRow): Promise<GradeReward> {
    if (row.reward_kind === 'CHARACTER') {
      const item = MILEAGE_CATALOG.find((candidate) => candidate.id === row.item_id);
      if (!item) throw new Error(`unknown persisted grade draw character: ${row.item_id}`);
      return { kind: 'CHARACTER', id: item.id, name: item.name };
    }
    if (row.reward_kind === 'THEME') {
      const reward = catalogRewards(row.rarity ?? row.grade).find((candidate) => candidate.kind === 'THEME' && candidate.id === row.item_id);
      if (!reward) throw new Error(`unknown persisted grade draw theme: ${row.item_id}`);
      return reward;
    }
    if (row.reward_kind === 'MILEAGE') {
      if (!row.item_id || !row.reward_amount) throw new Error(`invalid persisted mileage reward: ${row.id}`);
      return { kind: 'MILEAGE', id: row.item_id, name: `${row.reward_amount}P`, amount: row.reward_amount };
    }
    if (row.reward_kind === 'REROLL_TICKET') {
      const grade = row.rarity === 'PLATINUM' ? 'GOLD' : row.rarity;
      if (!grade || !row.item_id) throw new Error(`invalid persisted reroll ticket: ${row.id}`);
      return { kind: 'REROLL_TICKET', id: row.item_id, name: `${grade} 재뽑기권`, grade };
    }
    if (row.reward_kind === 'FURNITURE') {
      const item = (await db.query<{ id: string; name: string; assetId: string | null }>(
        'SELECT id,name,asset_id AS "assetId" FROM furniture_catalog WHERE id=$1', [row.item_id])).rows[0];
      if (!item) throw new Error(`unknown persisted furniture: ${row.item_id}`);
      return { kind: 'FURNITURE', id: item.id, name: item.name, assetId: item.assetId };
    }
    const coin = (await db.query<CoinRow & { removed: boolean }>(`SELECT publication.id AS publication_id,
      grade.grade_id, merchant.id AS merchant_id, merchant.name AS merchant_name,
      grade.summary, publication.media_removed_at IS NOT NULL AS removed
      FROM collectible_publications publication
      JOIN collectible_publication_grades grade ON grade.publication_id = publication.id AND grade.grade_id = $2
      JOIN merchants merchant ON merchant.id = publication.merchant_id WHERE publication.id = $1`,
    [row.publication_id, row.grade_id])).rows[0];
    if (!coin) throw new Error(`unknown persisted grade draw coin: ${row.id}`);
    if (coin.removed) return { kind: 'COIN', id: `${coin.publication_id}:${coin.grade_id}`,
      name: '공개가 중단된 코인', publicationId: coin.publication_id, gradeId: coin.grade_id,
      merchantId: coin.merchant_id, merchantName: coin.merchant_name };
    return rewardFromCoin(coin);
  }

  async getShop(accountId: string): Promise<GradeDrawShop> {
    const [balance, pools, rows] = await Promise.all([
      this.balance(this.pool, accountId),
      Promise.all(grades.map((grade) => this.poolFor(this.pool, grade, false))),
      this.pool.query<DrawRow>(`SELECT * FROM grade_draws WHERE account_id = $1
        ORDER BY created_at DESC, id DESC LIMIT 20`, [accountId]),
    ]);
    const history: GradeDrawHistory[] = await Promise.all(rows.rows.map(async (row) => ({
      drawId: row.id, grade: row.grade, price: row.price, rarity: row.rarity,
      reward: await this.storedReward(this.pool, row),
      createdAt: row.created_at.toISOString(),
    })));
    return { balance, pools, history };
  }

  async draw(input: { accountId: string; grade: MileageGrade; requestId: string;
    expectedPoolVersion: string }): Promise<GradeDrawResult> {
    if (!isMileageGrade(input.grade) || !requestPattern.test(input.requestId)
      || !versionPattern.test(input.expectedPoolVersion)) throw new GradeDrawError('INVALID_REQUEST');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.assertActive(client, input.accountId);
      const prior = (await client.query<DrawRow>(`SELECT * FROM grade_draws WHERE account_id = $1 AND request_id = $2`,
        [input.accountId, input.requestId])).rows[0];
      if (prior) {
        if (prior.grade !== input.grade || prior.pool_version !== input.expectedPoolVersion) {
          throw new GradeDrawError('DRAW_REQUEST_CONFLICT');
        }
        const result = { drawId: prior.id, grade: prior.grade, price: prior.price,
          reward: await this.storedReward(client, prior), rarity: prior.rarity, duplicate: prior.duplicate,
          quantity: prior.quantity, balance: await this.balance(client, input.accountId), replayed: true };
        await client.query('COMMIT'); return result;
      }
      const now = this.now();
      const recent = await client.query<{ n: number }>(`SELECT (
        (SELECT count(*) FROM grade_draws WHERE account_id = $1 AND created_at > $2)
        + (SELECT count(*) FROM mileage_spends WHERE account_id = $1 AND created_at > $2)
      )::integer AS n`, [input.accountId, new Date(now.getTime() - 60 * 60 * 1000)]);
      if (recent.rows[0]!.n >= 30) throw new GradeDrawError('DRAW_RATE_LIMITED');
      const pool = await this.poolFor(client, input.grade, true);
      if (pool.version !== input.expectedPoolVersion) throw new GradeDrawError('DRAW_STATE_CHANGED');
      const balance = await this.balance(client, input.accountId);
      if (balance < pool.price) throw new GradeDrawError('DRAW_INSUFFICIENT_MILEAGE');
      const { reward, rarity } = chooseGradeReward(pool.rewards, this.randomInt);
      const quantity = await this.ownedQuantity(client, input.accountId, reward);
      const id = this.nextId();
      await client.query(`INSERT INTO grade_draws (id,account_id,request_id,grade,price,pool_version,
          reward_kind,item_id,publication_id,grade_id,duplicate,quantity,created_at,rarity,reward_amount)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,$9,$10,$11,$12,$13)`,
      [id, input.accountId, input.requestId, input.grade, pool.price, pool.version, reward.kind,
        reward.id, quantity > 0, quantity + 1, now, rarity, reward.kind === 'MILEAGE' ? reward.amount : null]);
      if (reward.kind === 'REROLL_TICKET') {
        await client.query(`INSERT INTO coin_reroll_tickets
          (id,account_id,grade,request_id,source,granted_by_account_id,acquired_at)
          VALUES ($1,$2,$3,$4,'GRADE_DRAW',NULL,$5)`,
        [this.nextId(), input.accountId, reward.grade, `grade-draw:${id}`, now]);
      } else if (reward.kind === 'MILEAGE') {
        await client.query(`INSERT INTO mileage_credits
          (id,account_id,amount,reason,source_id,business_date,created_at)
          VALUES ($1,$2,$3,'DRAW_BONUS',$4,$5,$6)`,
        [this.nextId(), input.accountId, reward.amount, `grade-draw:${id}`, kstBusinessDate(now), now]);
      } else if (reward.kind === 'FURNITURE') {
        await client.query(`INSERT INTO furniture_inventory(id,account_id,item_id,acquired_at)
          VALUES($1,$2,$3,$4)`, [this.nextId(), input.accountId, reward.id, now]);
      }
      await client.query('COMMIT');
      return { drawId: id, grade: input.grade, price: pool.price, reward, rarity,
        duplicate: quantity > 0, quantity: quantity + 1,
        balance: balance - pool.price + (reward.kind === 'MILEAGE' ? reward.amount : 0), replayed: false };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new GradeDrawError('ACCOUNT_DELETED');
      throw error;
    } finally { client.release(); }
  }

  private async ownedQuantity(db: PoolClient, accountId: string, reward: GradeReward): Promise<number> {
    if (reward.kind === 'MILEAGE' || reward.kind === 'REROLL_TICKET') {
      const result = await db.query<{ n: number }>(`SELECT count(*)::integer AS n FROM grade_draws
        WHERE account_id=$1 AND reward_kind=$2 AND item_id=$3`, [accountId, reward.kind, reward.id]);
      return result.rows[0]!.n;
    }
    if (reward.kind === 'FURNITURE') {
      const result = await db.query<{ n: number }>(`SELECT count(*)::integer AS n FROM furniture_inventory
        WHERE account_id=$1 AND item_id=$2`, [accountId, reward.id]);
      return result.rows[0]!.n;
    }
    if (reward.kind === 'CHARACTER') {
      const result = await db.query<{ n: number }>(`SELECT (
        (SELECT count(*) FROM account_characters WHERE account_id=$1 AND item_id=$2 AND source='REROLL')
        + (SELECT count(*) FROM grade_draws WHERE account_id=$1 AND reward_kind='CHARACTER' AND item_id=$2)
      )::integer AS n`, [accountId, reward.id]);
      return result.rows[0]!.n;
    }
    if (reward.kind === 'THEME') {
      const result = await db.query<{ n: number }>(`SELECT (
        (SELECT count(*) FROM mileage_spends WHERE account_id=$1 AND cosmetic_bonus_id=$2)
        + (SELECT count(*) FROM grade_draws WHERE account_id=$1 AND reward_kind='THEME' AND item_id=$2)
      )::integer AS n`, [accountId, reward.id]);
      return result.rows[0]!.n;
    }
    const result = await db.query<{ n: number }>(`SELECT (
      (SELECT count(*) FROM collectible_acquisitions acquisition
        JOIN reward_entitlements entitlement ON entitlement.id=acquisition.entitlement_id
        WHERE entitlement.customer_account_id=$1 AND entitlement.status IN ('GRANTED','MINT_REQUESTED','FULFILLED')
          AND acquisition.publication_id=$2 AND acquisition.grade_id=$3
          AND NOT EXISTS (SELECT 1 FROM coin_reroll_consumptions spent
            WHERE spent.source_kind='VISIT' AND spent.source_id=acquisition.entitlement_id))
      + (SELECT count(*) FROM coin_draws draw JOIN coin_tickets ticket ON ticket.id=draw.ticket_id
        WHERE ticket.account_id=$1 AND draw.publication_id=$2 AND draw.grade_id=$3
          AND NOT EXISTS (SELECT 1 FROM coin_reroll_consumptions spent
            WHERE spent.source_kind='STORE_DRAW' AND spent.source_id=draw.ticket_id))
      + (SELECT count(*) FROM grade_draws WHERE account_id=$1 AND reward_kind='COIN'
        AND publication_id=$2 AND grade_id=$3
        AND NOT EXISTS (SELECT 1 FROM coin_reroll_consumptions spent
          WHERE spent.source_kind='GRADE_DRAW' AND spent.source_id=grade_draws.id))
      + (SELECT count(*) FROM coin_rerolls WHERE account_id=$1 AND publication_id=$2 AND grade_id=$3
          AND revoked_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM coin_reroll_consumptions spent
            WHERE spent.source_kind='REROLL' AND spent.source_id=coin_rerolls.id))
    )::integer AS n`, [accountId, reward.publicationId, reward.gradeId]);
    return result.rows[0]!.n;
  }
}
