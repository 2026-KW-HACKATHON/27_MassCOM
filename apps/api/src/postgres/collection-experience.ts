import type { Pool, PoolClient } from 'pg';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../account-consent.js';
import { buildMedals, type MedalValues } from '../badge-rules.js';
import { badgeTarget, emptyEquipment, EXPERIENCE_BADGES, EXPERIENCE_COSMETICS,
  EXPERIENCE_PACKS, ExperienceError, type CollectionExperienceService, type Equipment,
  type ExperienceCoinSource, type ExperienceProfile, type ExperienceSnapshot,
  type PublicExperienceProfile, type PublicRepresentativeCoin } from '../collection-experience.js';
import { MILEAGE_CATALOG, type MileageGrade } from '../mileage-rules.js';
import { gameKinds, gameSkills, legacyGameAchievementScore, type GameKind } from '../play-rules.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { medalValuesSql } from './badge-rewards.js';

type Stored = { badge_id: string | null; cosmetics: Equipment; coin_entitlement_id: string | null;
  coin_source_kind: ExperienceCoinSource['sourceKind'] | null; coin_source_id: string | null; wishlist_item_id: string | null };
type Spend = { id: string; grade: MileageGrade; cosmetic_bonus_id: string };
type GradeDraw = { grade: MileageGrade; reward_kind: string; item_id: string | null };
type Skill = { kind: GameKind; progress: number; achieved: boolean; best_score: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresCollectionExperienceService implements CollectionExperienceService {
  constructor(private readonly pool: Pool, private readonly accountLifecycle: PostgresAccountLifecycle) {}

  async getSnapshot(accountId: string): Promise<ExperienceSnapshot> {
    return this.transaction(async (db) => { await this.accountLifecycle.assertActive(db, accountId); return this.snapshot(db, accountId); });
  }

  async setEquipment(input: { accountId: string; badgeId?: string | null; cosmetics?: Partial<Equipment>;
    coinEntitlementId?: string | null; coinSource?: ExperienceCoinSource | null }): Promise<ExperienceSnapshot> {
    if (input.badgeId !== undefined && input.badgeId !== null && typeof input.badgeId !== 'string') throw new ExperienceError('EXPERIENCE_INVALID');
    if (input.coinEntitlementId !== undefined && input.coinEntitlementId !== null &&
      (typeof input.coinEntitlementId !== 'string' || !uuid.test(input.coinEntitlementId))) throw new ExperienceError('EXPERIENCE_INVALID');
    if (input.coinSource !== undefined && input.coinSource !== null &&
      (!input.coinSource || typeof input.coinSource !== 'object' || Array.isArray(input.coinSource) ||
        Object.keys(input.coinSource).sort().join(',') !== 'sourceId,sourceKind' ||
        !['VISIT','STORE_DRAW','GRADE_DRAW','REROLL'].includes(input.coinSource.sourceKind) ||
        !uuid.test(input.coinSource.sourceId))) throw new ExperienceError('EXPERIENCE_INVALID');
    if (input.coinSource !== undefined && input.coinEntitlementId !== undefined &&
      (input.coinSource?.sourceKind === 'VISIT' ? input.coinSource.sourceId : null) !== input.coinEntitlementId)
      throw new ExperienceError('EXPERIENCE_INVALID');
    if (input.cosmetics !== undefined && (!input.cosmetics || typeof input.cosmetics !== 'object' || Array.isArray(input.cosmetics) ||
      Object.entries(input.cosmetics).some(([slot, id]) => !['hat', 'bag', 'prop', 'pose', 'decor'].includes(slot) ||
        (id !== null && typeof id !== 'string')))) throw new ExperienceError('EXPERIENCE_INVALID');
    return this.transaction(async (db) => {
      await this.accountLifecycle.assertActive(db, input.accountId);
      const before = await this.snapshot(db, input.accountId);
      const badgeId = input.badgeId === undefined ? before.profile.badgeId : input.badgeId;
      const cosmetics = { ...before.profile.cosmetics, ...input.cosmetics };
      const coinSource = input.coinSource !== undefined ? input.coinSource :
        input.coinEntitlementId !== undefined ? null : before.profile.coinSource;
      const coin = input.coinSource !== undefined ? coinSource?.sourceKind === 'VISIT' ? coinSource.sourceId : null :
        input.coinEntitlementId === undefined ? before.profile.coinEntitlementId : input.coinEntitlementId;
      if (badgeId && !before.progress.badges.some((badge) => badge.id === badgeId && badge.owned)) throw new ExperienceError('EXPERIENCE_LOCKED');
      for (const [slot, id] of Object.entries(cosmetics)) {
        if (id && !EXPERIENCE_COSMETICS.some((item) => item.id === id && item.slot === slot &&
          before.progress.cosmetics.some((progress) => progress.id === id && progress.equippable))) throw new ExperienceError('EXPERIENCE_LOCKED');
      }
      if (coinSource && !(await this.representative(db, input.accountId, coinSource, true))) throw new ExperienceError('EXPERIENCE_LOCKED');
      if (coin && !coinSource && !(await this.ownsCoin(db, input.accountId, coin))) throw new ExperienceError('EXPERIENCE_LOCKED');
      await db.query(`INSERT INTO collection_experience_profiles
        (account_id,badge_id,cosmetics,coin_entitlement_id,coin_source_kind,coin_source_id,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (account_id) DO UPDATE SET
        badge_id=excluded.badge_id,cosmetics=excluded.cosmetics,coin_entitlement_id=excluded.coin_entitlement_id,
        coin_source_kind=excluded.coin_source_kind,coin_source_id=excluded.coin_source_id,updated_at=now()`,
      [input.accountId, badgeId, JSON.stringify(cosmetics), coin, coinSource?.sourceKind ?? null, coinSource?.sourceId ?? null]);
      return this.snapshot(db, input.accountId);
    });
  }

  async setWishlist(input: { accountId: string; itemId: string | null }): Promise<ExperienceSnapshot> {
    if (input.itemId !== null && (typeof input.itemId !== 'string' ||
      !EXPERIENCE_COSMETICS.some((item) => item.id === input.itemId) &&
      !MILEAGE_CATALOG.some((item) => item.id === input.itemId))) throw new ExperienceError('EXPERIENCE_INVALID');
    return this.transaction(async (db) => {
      await this.accountLifecycle.assertActive(db, input.accountId);
      await db.query(`INSERT INTO collection_experience_profiles (account_id,wishlist_item_id,updated_at)
        VALUES ($1,$2,now()) ON CONFLICT (account_id) DO UPDATE SET
        wishlist_item_id=excluded.wishlist_item_id,updated_at=now()`, [input.accountId, input.itemId]);
      return this.snapshot(db, input.accountId);
    });
  }

  async getFriend(input: { accountId: string; friendshipId: string }): Promise<PublicExperienceProfile> {
    if (!uuid.test(input.friendshipId)) throw new ExperienceError('EXPERIENCE_FRIEND_NOT_FOUND');
    return this.transaction(async (db) => {
      const pair = (await db.query<{ account_low: string; account_high: string }>(
        `SELECT account_low,account_high FROM friendships WHERE id=$1 AND (account_low=$2 OR account_high=$2)`,
        [input.friendshipId, input.accountId])).rows[0];
      if (!pair) throw new ExperienceError('EXPERIENCE_FRIEND_NOT_FOUND');
      try { await this.accountLifecycle.assertAllActive(db, [pair.account_low, pair.account_high]); }
      catch (error) { if (error instanceof AccountLifecycleError) throw new ExperienceError('EXPERIENCE_FRIEND_NOT_FOUND'); throw error; }
      // Friend removal takes the same account locks. Re-read after waiting for them so a stale pre-lock pair never leaks display state.
      const current = await db.query(`SELECT 1 FROM friendships WHERE id=$1 AND account_low=$2 AND account_high=$3`,
        [input.friendshipId, pair.account_low, pair.account_high]);
      if (!current.rowCount) throw new ExperienceError('EXPERIENCE_FRIEND_NOT_FOUND');
      const friendId = pair.account_low === input.accountId ? pair.account_high : pair.account_low;
      const consent = await db.query(`SELECT 1 FROM account_consents WHERE account_id=$1 AND terms_version=$2 AND privacy_version=$3`,
        [friendId, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION]);
      if (!consent.rowCount) return { badgeId: null, badgeName: null, cosmetics: emptyEquipment(), coin: null };
      const snapshot = await this.snapshot(db, friendId);
      const { badgeId, cosmetics, representativeCoin: coin } = snapshot.profile;
      return { badgeId, badgeName: EXPERIENCE_BADGES.find((badge) => badge.id === badgeId)?.name ?? null,
        cosmetics, coin };
    });
  }

  private async snapshot(db: PoolClient, accountId: string): Promise<ExperienceSnapshot> {
    const stored = (await db.query<Stored>(`SELECT badge_id,cosmetics,coin_entitlement_id,
      coin_source_kind,coin_source_id,wishlist_item_id
      FROM collection_experience_profiles WHERE account_id=$1`, [accountId])).rows[0];
    const medals = buildMedals((await db.query<MedalValues>(medalValuesSql, [accountId])).rows[0]!);
    const spends = (await db.query<Spend>(`SELECT id,grade,cosmetic_bonus_id FROM mileage_spends WHERE account_id=$1 AND reason='REROLL'`, [accountId])).rows;
    const gradeDraws = (await db.query<GradeDraw>(`SELECT grade,reward_kind,item_id FROM grade_draws
      WHERE account_id=$1`, [accountId])).rows;
    const skills = (await db.query<Skill>(`SELECT kind,skill_progress AS progress,skill_achieved AS achieved,best_score
      FROM play_records WHERE account_id=$1`, [accountId])).rows;
    const bonusIds = new Set([...spends.map((spend) => spend.cosmetic_bonus_id),
      ...gradeDraws.filter((draw) => draw.reward_kind === 'THEME').map((draw) => draw.item_id)
        .filter((id): id is string => id !== null)]);
    const badges = EXPERIENCE_BADGES.map((badge) => {
      const [kind] = badge.id.split('-');
      const medal = medals.find((candidate) => candidate.kind === kind);
      const game = gameKinds.find((candidate) => gameSkills[candidate].id === badge.id);
      const skill = skills.find((candidate) => candidate.kind === game);
      const legacy = game && (skills.find((record) => record.kind === game)?.best_score ?? 0) >= legacyGameAchievementScore[game];
      const target = game ? gameSkills[game].target : badgeTarget(badge.id);
      const value = medal?.value ?? (legacy ? target : skill?.progress ?? 0);
      return { id: badge.id, value, target, owned: game ? Boolean(skill?.achieved || legacy) : value >= target,
        nextAction: game ? `놀이 공간에서 ${badge.name} 도전` : kind === 'explorer' ? '새 가게 방문' :
          kind === 'regular' ? '같은 가게 재방문' : '다른 날 다시 방문' };
    });
    const ownedBadges = new Set(badges.filter((badge) => badge.owned).map((badge) => badge.id));
    const cosmetics = EXPERIENCE_COSMETICS.map((item) => ({ id: item.id,
      owned: item.source.kind === 'pack' ? bonusIds.has(item.id) : ownedBadges.has(item.source.badgeId),
      equippable: item.source.kind === 'pack' ? bonusIds.has(item.id) : ownedBadges.has(item.source.badgeId) }));
    const ownedCosmetics = new Set(cosmetics.filter((item) => item.equippable).map((item) => item.id));
    const equipment = emptyEquipment();
    for (const slot of Object.keys(equipment) as (keyof Equipment)[]) {
      const candidate = stored?.cosmetics?.[slot];
      equipment[slot] = candidate && ownedCosmetics.has(candidate) &&
        EXPERIENCE_COSMETICS.some((item) => item.id === candidate && item.slot === slot) ? candidate : null;
    }
    const selectedSource = stored?.coin_source_kind && stored.coin_source_id ?
      { sourceKind: stored.coin_source_kind, sourceId: stored.coin_source_id } : null;
    const legacySource = !selectedSource && stored?.coin_entitlement_id ?
      { sourceKind: 'VISIT' as const, sourceId: stored.coin_entitlement_id } : null;
    const representativeCoin = selectedSource ? await this.representative(db, accountId, selectedSource, true) :
      legacySource ? await this.representative(db, accountId, legacySource, false) : null;
    const coin = representativeCoin && (selectedSource?.sourceKind === 'VISIT' || legacySource) ?
      (selectedSource ?? legacySource)!.sourceId : null;
    const profile: ExperienceProfile = {
      badgeId: stored?.badge_id && ownedBadges.has(stored.badge_id) ? stored.badge_id : null,
      cosmetics: equipment, coinEntitlementId: coin, coinSource: representativeCoin ? selectedSource : null,
      representativeCoin, wishlist: stored?.wishlist_item_id ?? null,
    };
    return { catalog: { badges: EXPERIENCE_BADGES, cosmetics: EXPERIENCE_COSMETICS, packs: EXPERIENCE_PACKS },
      profile, progress: { badges, cosmetics, packs: EXPERIENCE_PACKS.map((pack) => ({ id: pack.id,
        opens: spends.filter((spend) => spend.grade === pack.grade).length
          + gradeDraws.filter((draw) => draw.grade === pack.grade).length,
        ownedBonuses: pack.bonusItemIds.filter((id) => bonusIds.has(id)).length,
        totalBonuses: pack.bonusItemIds.length })) } };
  }

  private async ownsCoin(db: PoolClient, accountId: string, id: string): Promise<boolean> {
    const row = await db.query(`SELECT 1 FROM reward_entitlements WHERE id=$1 AND customer_account_id=$2
      AND status IN ('GRANTED','MINT_REQUESTED','FULFILLED')
      AND NOT EXISTS (SELECT 1 FROM coin_reroll_consumptions consumed WHERE consumed.source_kind='VISIT'
        AND consumed.source_id=reward_entitlements.id)`, [id, accountId]);
    return Boolean(row.rowCount);
  }

  private async representative(db: PoolClient, accountId: string, source: ExperienceCoinSource,
    requireAcquisition: boolean): Promise<PublicRepresentativeCoin | null> {
    const row = (await db.query<PublicRepresentativeCoin>(`
      WITH owned AS (
        SELECT entitlement.campaign_id,entitlement.target_visit_count,
          acquisition.publication_id,acquisition.grade_id
        FROM reward_entitlements entitlement
        LEFT JOIN collectible_acquisitions acquisition ON acquisition.entitlement_id=entitlement.id
        WHERE $2='VISIT' AND entitlement.id=$3 AND entitlement.customer_account_id=$1
          AND entitlement.status IN ('GRANTED','MINT_REQUESTED','FULFILLED')
          AND (NOT $4::boolean OR acquisition.publication_id IS NOT NULL)
        UNION ALL SELECT publication.campaign_id,NULL,draw.publication_id,draw.grade_id
        FROM coin_draws draw JOIN coin_tickets ticket ON ticket.id=draw.ticket_id
        JOIN collectible_publications publication ON publication.id=draw.publication_id
        WHERE $2='STORE_DRAW' AND draw.ticket_id=$3 AND ticket.account_id=$1
        UNION ALL SELECT publication.campaign_id,NULL,draw.publication_id,draw.grade_id
        FROM grade_draws draw JOIN collectible_publications publication ON publication.id=draw.publication_id
        WHERE $2='GRADE_DRAW' AND draw.id=$3 AND draw.account_id=$1 AND draw.reward_kind='COIN'
        UNION ALL SELECT publication.campaign_id,NULL,draw.publication_id,draw.grade_id
        FROM coin_rerolls draw JOIN collectible_publications publication ON publication.id=draw.publication_id
        WHERE $2='REROLL' AND draw.id=$3 AND draw.account_id=$1 AND draw.revoked_at IS NULL
      )
      SELECT merchant.id AS "merchantId",merchant.name AS "merchantName",campaign.title AS "campaignTitle",
        coalesce(goal.display_name,grade.summary->>'name','수집 코인') AS "displayName",
        CASE WHEN publication.media_removed_at IS NULL THEN grade.summary ELSE NULL END AS artwork
      FROM owned JOIN campaigns campaign ON campaign.id=owned.campaign_id
      JOIN merchants merchant ON merchant.id=campaign.merchant_id
      LEFT JOIN campaign_goals goal ON goal.campaign_id=owned.campaign_id AND goal.target_visit_count=owned.target_visit_count
      LEFT JOIN collectible_publications publication ON publication.id=owned.publication_id
      LEFT JOIN collectible_publication_grades grade ON grade.publication_id=owned.publication_id AND grade.grade_id=owned.grade_id
      WHERE NOT EXISTS (SELECT 1 FROM coin_reroll_consumptions consumed
        WHERE consumed.source_kind=$2 AND consumed.source_id=$3) LIMIT 1`,
    [accountId, source.sourceKind, source.sourceId, requireAcquisition])).rows[0];
    return row ? { merchantId: row.merchantId, merchantName: row.merchantName,
      campaignTitle: row.campaignTitle, displayName: row.displayName,
      ...(row.artwork ? { artwork: row.artwork } : {}) } : null;
  }

  private async transaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try { await db.query('BEGIN'); const result = await work(db); await db.query('COMMIT'); return result; }
    catch (error) { await db.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new ExperienceError('ACCOUNT_DELETED'); throw error; }
    finally { db.release(); }
  }
}
