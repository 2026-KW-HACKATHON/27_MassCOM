import { randomInt, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../account-consent.js';
import { defaultStudio, PlayError, type FriendStudioSnapshot, type PlayEvent, type PlayMetrics, type PlayRecord,
  type PlayResult, type PlayService, type PlaySnapshot, type Studio, type StudioItem,
  type StudioSnapshot } from '../play.js';
import { evaluateGameSkill, gameDurationMs, gameKinds, gameSkills, isGameKind, legacyGameAchievementScore,
  minimumActionGapMs, scoreRunAtElapsed, type GameAction, type GameKind, type GameSkill, type PlayRun } from '../play-rules.js';
import { evaluateQualityGameSkill, getQualityGameState } from '../play-rules-quality.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';
import { publicCampaignGoalsHaving, publicCampaignPredicate } from './merchant-catalog.js';

type RunRow = { id: string; kind: GameKind; seed: number; started_at: Date; expires_at: Date;
  rules_version: 1 | 2; result: PlayResult | null };
type RecordRow = { kind: GameKind; best_score: number; plays: number;
  version2_best_score: number; version2_plays: number };
type SkillRow = { kind: GameKind; progress: number | null; achieved: boolean | null };
type ItemRow = StudioItem & { entitlement_id: string; artwork: StudioItem['artwork'] | null };

const themes = ['daylight', 'evening', 'garden'] as const;
const layouts = ['shelf', 'gallery'] as const;
const accents = ['mint', 'rose', 'sky'] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validStudio(value: unknown): value is Studio {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const studio = value as Record<string, unknown>;
  if (Object.keys(studio).sort().join(',') !== 'accent,goal,layout,slots,theme' ||
      typeof studio.theme !== 'string' || typeof studio.layout !== 'string' || typeof studio.accent !== 'string' ||
      !themes.includes(studio.theme as typeof themes[number]) ||
      !layouts.includes(studio.layout as typeof layouts[number]) ||
      !accents.includes(studio.accent as typeof accents[number]) ||
      !Array.isArray(studio.slots) || studio.slots.length > 6 ||
      studio.slots.some((slot) => typeof slot !== 'string' || !uuidPattern.test(slot)) ||
      new Set(studio.slots).size !== studio.slots.length) return false;
  if (studio.goal === null) return true;
  if (!studio.goal || typeof studio.goal !== 'object' || Array.isArray(studio.goal)) return false;
  const goal = studio.goal as Record<string, unknown>;
  if (typeof goal.kind !== 'string') return false;
  if (goal.kind === 'play') return Object.keys(goal).sort().join(',') === 'gameKind,kind' && isGameKind(goal.gameKind);
  return ['discover', 'regular', 'series'].includes(goal.kind) &&
    Object.keys(goal).sort().join(',') === 'kind,merchantId' &&
    typeof goal.merchantId === 'string' && goal.merchantId.length > 0 && goal.merchantId.length <= 200;
}

function unlocked(records: readonly PlayRecord[]): string[] {
  const completed = records.reduce((sum, record) => sum + record.plays, 0);
  return [...(completed >= 3 ? ['evening'] : []), ...(completed >= 10 ? ['garden'] : [])];
}

export class PostgresPlayService implements PlayService {
  private readonly now: () => Date;
  constructor(private readonly pool: Pool, private readonly accountLifecycle: PostgresAccountLifecycle,
    options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async start(input: { accountId: string; kind: GameKind }): Promise<PlayRun> {
    if (!isGameKind(input.kind)) throw new PlayError('PLAY_KIND_INVALID');
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, input.accountId);
      const now = this.now();
      const recent = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM play_runs WHERE account_id = $1 AND started_at > $2`,
        [input.accountId, new Date(now.getTime() - 60 * 60_000)],
      );
      if (recent.rows[0]!.count >= 30) throw new PlayError('PLAY_RATE_LIMITED');
      const run: PlayRun = { id: randomUUID(), kind: input.kind, seed: randomInt(0, 0x80000000),
        startedAt: now.toISOString(), expiresAt: new Date(now.getTime() + gameDurationMs + 15_000).toISOString(),
        durationMs: gameDurationMs, rulesVersion: 2 };
      await client.query(`INSERT INTO play_runs (id, account_id, kind, seed, started_at, expires_at, rules_version)
        VALUES ($1,$2,$3,$4,$5,$6,2)`,
      [run.id, input.accountId, run.kind, run.seed, run.startedAt, run.expiresAt]);
      await this.count(client, 'start', input.kind, now);
      return run;
    });
  }

  async finish(input: { accountId: string; runId: string; actions: GameAction[] }): Promise<PlayResult> {
    if (!uuidPattern.test(input.runId)) throw new PlayError('PLAY_RUN_NOT_FOUND');
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, input.accountId);
      const run = (await client.query<RunRow>(`SELECT id, kind, seed, started_at, expires_at, rules_version, result
        FROM play_runs WHERE id = $1 AND account_id = $2 FOR UPDATE`, [input.runId, input.accountId])).rows[0];
      if (!run) throw new PlayError('PLAY_RUN_NOT_FOUND');
      if (run.result) return run.result;
      const now = this.now();
      if (now > run.expires_at) throw new PlayError('PLAY_RUN_EXPIRED');
      const elapsed = now.getTime() - run.started_at.getTime();
      let score: ReturnType<typeof scoreRunAtElapsed>;
      let quality: ReturnType<typeof getQualityGameState> | undefined;
      try {
        if (run.rules_version === 1) score = scoreRunAtElapsed(run.kind, run.seed, input.actions, elapsed);
        else if (run.rules_version === 2) {
          if (elapsed < 0 || input.actions.some(action => action.at > elapsed + 2000)) {
            throw new Error('INVALID_GAME_ACTIONS');
          }
          // The final delivery sample fixes the stop time even if the request arrives late.
          quality = getQualityGameState(run.kind, run.seed, input.actions, run.kind === 'delivery' ?
            input.actions.at(-1)?.at ?? 0 : elapsed);
          score = { score: quality.score, completed: quality.completed,
            correct: quality.correct, total: quality.total };
          if (score.completed && (elapsed < (run.kind === 'delivery' ? 24_000 :
            (input.actions.length - 1) * minimumActionGapMs[run.kind]))) {
            throw new Error('INVALID_GAME_ACTIONS');
          }
        } else throw new Error('INVALID_GAME_VERSION');
      }
      catch { throw new PlayError('PLAY_ACTIONS_INVALID'); }
      const priorRecords = await this.records(client, input.accountId);
      const priorSkills = await this.achievements(client, input.accountId, priorRecords);
      const skill = quality ? { ...gameSkills[run.kind], ...evaluateQualityGameSkill(quality) } :
        evaluateGameSkill(run.kind, run.seed, input.actions, score);
      let record: PlayRecord | undefined;
      if (score.completed) {
        const updated = await client.query<RecordRow>(`INSERT INTO play_records
          (account_id, kind, best_score, plays, version2_best_score, version2_plays)
          VALUES ($1,$2,$3,1,$4,$5) ON CONFLICT (account_id,kind) DO UPDATE SET
          best_score = greatest(play_records.best_score, excluded.best_score),
          plays = play_records.plays + 1,
          version2_best_score = greatest(play_records.version2_best_score, excluded.version2_best_score),
          version2_plays = play_records.version2_plays + excluded.version2_plays
          RETURNING kind,best_score,plays,version2_best_score,version2_plays`,
        [input.accountId, run.kind, run.rules_version === 1 ? score.score : 0,
          run.rules_version === 2 ? score.score : 0, run.rules_version === 2 ? 1 : 0]);
        record = this.mapRecord(updated.rows[0]!);
        await this.count(client, 'complete', run.kind, now);
      }
      // 입력 로그의 보관 기간이 지나도 실제로 얻은 성취와 장착 조건은 유지한다.
      await client.query(`INSERT INTO play_records (account_id,kind,best_score,plays,skill_progress,skill_achieved)
        VALUES ($1,$2,0,0,$3,$4) ON CONFLICT (account_id,kind) DO UPDATE SET
        skill_progress=greatest(play_records.skill_progress,excluded.skill_progress),
        skill_achieved=play_records.skill_achieved OR excluded.skill_achieved`,
      [input.accountId, run.kind, skill.progress, skill.achieved]);
      const records = await this.records(client, input.accountId);
      const currentRecord = record ?? records.find((candidate) => candidate.kind === run.kind);
      const result: PlayResult = { kind: run.kind, rulesVersion: run.rules_version, ...score,
        bestScore: currentRecord?.bestScore ?? 0,
        plays: currentRecord?.plays ?? 0, unlockedThemes: unlocked(records), skill,
        version2BestScore: currentRecord?.version2BestScore ?? 0,
        version2Plays: currentRecord?.version2Plays ?? 0,
        newlyEarned: skill.achieved && !priorSkills.some((candidate) => candidate.id === skill.id && candidate.achieved) };
      await client.query(`UPDATE play_runs SET finished_at = $2, result = $3 WHERE id = $1`,
        [input.runId, now, JSON.stringify(result)]);
      return result;
    });
  }

  async getPlay(accountId: string): Promise<PlaySnapshot> {
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, accountId);
      const records = await this.records(client, accountId);
      return { records, unlockedThemes: unlocked(records), achievements: await this.achievements(client, accountId, records) };
    });
  }

  async getStudio(accountId: string): Promise<StudioSnapshot> {
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, accountId);
      return this.studioSnapshot(client, accountId);
    });
  }

  async saveStudio(input: { accountId: string; studio: Studio }): Promise<StudioSnapshot> {
    if (!validStudio(input.studio)) throw new PlayError('STUDIO_INVALID');
    return this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, input.accountId);
      const records = await this.records(client, input.accountId);
      if (input.studio.theme !== 'daylight' && !unlocked(records).includes(input.studio.theme)) {
        throw new PlayError('STUDIO_THEME_LOCKED');
      }
      const items = await this.items(client, input.accountId, input.studio.slots);
      if (items.length !== input.studio.slots.length) throw new PlayError('STUDIO_ITEM_NOT_OWNED');
      if (input.studio.goal && input.studio.goal.kind !== 'play' &&
          !(await this.publicMerchant(client, input.studio.goal.merchantId))) {
        throw new PlayError('STUDIO_GOAL_UNAVAILABLE');
      }
      await client.query(`INSERT INTO studios (account_id,studio,updated_at) VALUES ($1,$2,$3)
        ON CONFLICT (account_id) DO UPDATE SET studio=excluded.studio, updated_at=excluded.updated_at`,
      [input.accountId, JSON.stringify(input.studio), this.now()]);
      await this.count(client, 'studio-save', 'all', this.now());
      return { studio: input.studio, items, avatar: await this.avatar(client, input.accountId),
        records, unlockedThemes: unlocked(records), achievements: await this.achievements(client, input.accountId, records) };
    });
  }

  async getFriendStudio(input: { accountId: string; friendshipId: string }): Promise<FriendStudioSnapshot> {
    if (!uuidPattern.test(input.friendshipId)) throw new PlayError('FRIEND_STUDIO_NOT_FOUND');
    return this.transaction(async (client) => {
      const pair = (await client.query<{ account_low: string; account_high: string }>(
        `SELECT account_low,account_high FROM friendships WHERE id=$1 AND (account_low=$2 OR account_high=$2)`,
        [input.friendshipId, input.accountId])).rows[0];
      if (!pair) throw new PlayError('FRIEND_STUDIO_NOT_FOUND');
      try {
        await this.accountLifecycle.assertAllActive(client, [pair.account_low, pair.account_high]);
      } catch (error) {
        if (!(error instanceof AccountLifecycleError)) throw error;
        await this.accountLifecycle.assertActive(client, input.accountId);
        throw new PlayError('FRIEND_STUDIO_NOT_FOUND');
      }
      const friendId = pair.account_low === input.accountId ? pair.account_high : pair.account_low;
      const stillFriends = await client.query(`SELECT 1 FROM friendships WHERE id=$1 AND account_low=$2 AND account_high=$3`,
        [input.friendshipId, pair.account_low, pair.account_high]);
      if (!stillFriends.rowCount) throw new PlayError('FRIEND_STUDIO_NOT_FOUND');
      const nickname = (await client.query<{ nickname: string }>(
        `SELECT nickname FROM explorer_profiles WHERE account_id=$1`, [friendId])).rows[0]?.nickname ?? '탐험가';
      const saved = (await client.query<{ studio: Studio }>(
        `SELECT studio FROM studios WHERE account_id=$1 AND EXISTS (
          SELECT 1 FROM account_consents WHERE account_id=$1 AND terms_version=$2 AND privacy_version=$3)`,
        [friendId, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION])).rows[0];
      if (!saved) return { nickname, studio: { theme: defaultStudio.theme, layout: defaultStudio.layout,
        accent: defaultStudio.accent, goal: null }, items: [], avatar: null };
      const studio = saved.studio;
      const goal = studio.goal?.kind !== 'play' && studio.goal &&
        !(await this.publicMerchant(client, studio.goal.merchantId)) ? null : studio.goal;
      const items = await this.items(client, friendId, studio.slots);
      return { nickname, studio: { theme: studio.theme, layout: studio.layout, accent: studio.accent, goal },
        items: items.map(({ merchantId, merchantName, campaignTitle, displayName, artwork }) => ({
          merchantId, merchantName, campaignTitle, displayName, ...(artwork ? { artwork } : {}),
        })), avatar: await this.avatar(client, friendId) };
    });
  }

  async recordEvent(input: { accountId: string; event: PlayEvent }): Promise<void> {
    if (input.event !== 'share-open' && input.event !== 'image-created') throw new PlayError('PLAY_EVENT_INVALID');
    await this.transaction(async (client) => {
      await this.accountLifecycle.assertActive(client, input.accountId);
      await this.count(client, input.event, 'all', this.now());
    });
  }

  async aggregate(days: number): Promise<PlayMetrics> {
    if (!Number.isInteger(days) || days < 7 || days > 90) throw new PlayError('PLAY_METRICS_DAYS_INVALID');
    const since = new Date(this.now().getTime() - (days - 1) * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const rows = (await this.pool.query<{ event: string; kind: string; count: number }>(
      `SELECT event,kind,sum(count)::integer AS count FROM play_flow_counts
       WHERE event_date >= $1::date GROUP BY event,kind ORDER BY event,kind`, [since])).rows;
    const names = { start: 'game_started', complete: 'game_completed',
      'studio-save': 'studio_saved', 'share-open': 'share_opened', 'image-created': 'image_created' } as const;
    const events = Object.entries(names).map(([raw, event]) => ({ event,
      count: rows.filter((row) => row.event === raw).reduce((sum, row) => sum + row.count, 0) }));
    const games = gameKinds.map((kind) => ({ kind,
      started: rows.find((row) => row.event === 'start' && row.kind === kind)?.count ?? 0,
      completed: rows.find((row) => row.event === 'complete' && row.kind === kind)?.count ?? 0 }));
    return { days, events, games };
  }

  private async studioSnapshot(client: PoolClient, accountId: string): Promise<StudioSnapshot> {
    const stored = await this.studio(client, accountId);
    const records = await this.records(client, accountId);
    const items = await this.items(client, accountId, stored.slots);
    const goal = stored.goal?.kind !== 'play' && stored.goal &&
      !(await this.publicMerchant(client, stored.goal.merchantId)) ? null : stored.goal;
    const studio = { ...stored, slots: items.map((item) => item.entitlementId!), goal };
    return { studio, records, unlockedThemes: unlocked(records), achievements: await this.achievements(client, accountId, records),
      items, avatar: await this.avatar(client, accountId) };
  }

  private async studio(client: PoolClient, accountId: string): Promise<Studio> {
    const row = (await client.query<{ studio: Studio }>(`SELECT studio FROM studios WHERE account_id=$1`, [accountId])).rows[0];
    return row?.studio ?? { ...defaultStudio, slots: [] };
  }

  private async records(client: PoolClient, accountId: string): Promise<PlayRecord[]> {
    return (await client.query<RecordRow>(`SELECT kind,best_score,plays,version2_best_score,version2_plays
      FROM play_records WHERE account_id=$1 ORDER BY kind`,
      [accountId])).rows.map(this.mapRecord);
  }

  private mapRecord(row: RecordRow): PlayRecord {
    return { kind: row.kind, bestScore: row.best_score, plays: row.plays,
      version2BestScore: row.version2_best_score, version2Plays: row.version2_plays };
  }

  private async achievements(client: PoolClient, accountId: string, records: readonly PlayRecord[]): Promise<GameSkill[]> {
    const rows = (await client.query<SkillRow>(`SELECT kind, skill_progress AS progress, skill_achieved AS achieved
      FROM play_records WHERE account_id=$1`, [accountId])).rows;
    return gameKinds.map((kind) => {
      const row = rows.find((candidate) => candidate.kind === kind);
      const legacy = (records.find((record) => record.kind === kind)?.bestScore ?? 0) >= legacyGameAchievementScore[kind];
      const definition = gameSkills[kind];
      const achieved = Boolean(row?.achieved || legacy);
      return { id: definition.id, progress: achieved ? definition.target : Math.min(row?.progress ?? 0, definition.target),
        target: definition.target, achieved };
    });
  }

  private async items(client: PoolClient, accountId: string, slots: readonly string[]): Promise<StudioItem[]> {
    if (!slots.length) return [];
    const rows = (await client.query<ItemRow>(`SELECT entitlement.id AS entitlement_id,
      merchant.id AS "merchantId",merchant.name AS "merchantName",campaign.title AS "campaignTitle",
      goal.display_name AS "displayName",grade.summary AS artwork
      FROM reward_entitlements entitlement
      JOIN campaigns campaign ON campaign.id=entitlement.campaign_id
      JOIN merchants merchant ON merchant.id=campaign.merchant_id
      JOIN campaign_goals goal ON goal.campaign_id=campaign.id AND goal.target_visit_count=entitlement.target_visit_count
      LEFT JOIN collectible_acquisitions acquisition ON acquisition.entitlement_id=entitlement.id
      LEFT JOIN collectible_publications publication ON publication.id=acquisition.publication_id AND publication.media_removed_at IS NULL
      LEFT JOIN collectible_publication_grades grade ON grade.publication_id=publication.id AND grade.grade_id=acquisition.grade_id
      WHERE entitlement.customer_account_id=$1 AND entitlement.id=ANY($2::uuid[])
        AND entitlement.status IN ('GRANTED','MINT_REQUESTED','FULFILLED')`, [accountId, slots])).rows;
    const byId = new Map(rows.map((row) => [row.entitlement_id, row]));
    return slots.flatMap((id) => {
      const row = byId.get(id);
      return row ? [{ entitlementId: id, merchantId: row.merchantId, merchantName: row.merchantName,
        campaignTitle: row.campaignTitle, displayName: row.displayName,
        ...(row.artwork ? { artwork: row.artwork } : {}) }] : [];
    });
  }

  private async avatar(client: PoolClient, accountId: string): Promise<string | null> {
    return (await client.query<{ avatar_item_id: string | null }>(
      `SELECT avatar_item_id FROM account_profile WHERE account_id=$1`, [accountId])).rows[0]?.avatar_item_id ?? null;
  }

  private async publicMerchant(client: PoolClient, merchantId: string): Promise<boolean> {
    const result = await client.query(`SELECT 1 FROM merchants m
      JOIN campaigns c ON c.merchant_id=m.id
      JOIN campaign_goals g ON g.campaign_id=c.id
      WHERE m.id=$1 AND ${publicCampaignPredicate(2)}
      GROUP BY m.id,c.id
      HAVING ${publicCampaignGoalsHaving}
      LIMIT 1`, [merchantId, this.now()]);
    return Boolean(result.rowCount);
  }

  private async count(client: PoolClient, event: string, kind: GameKind | 'all', at: Date): Promise<void> {
    await client.query(`INSERT INTO play_flow_counts (event_date,event,kind,count) VALUES ($1::date,$2,$3,1)
      ON CONFLICT (event_date,event,kind) DO UPDATE SET count=play_flow_counts.count+1`,
      [at.toISOString().slice(0, 10), event, kind]);
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
      if (error instanceof AccountLifecycleError) throw new PlayError(error.code);
      throw error;
    } finally { client.release(); }
  }
}
