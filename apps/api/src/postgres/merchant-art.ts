import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { AiArtGenerationError, type AiArtImageClient } from '../ai-art-client.js';
import {
  artStyles,
  artUrlFor,
  buildDraftPrompt,
  buildFinalPrompt,
  canApply,
  canChoose,
  costMicroUsd,
  draftCount,
  estimatedDraftCallMicroUsd,
  estimatedFinalMicroUsd,
  isInProgress,
  kstBusinessDate,
  kstDayRange,
  kstMonthRange,
  menuNamesFrom,
  merchantUserHash,
  pickFailureCode,
  secondsUntilNextKstMidnight,
  staleRoundMs,
  unappliedRoundRetentionMs,
  type AiArtConfig,
  type AiArtFailureCode,
  type ArtRoundStatus,
  type ArtSubject,
} from '../ai-art-rules.js';
import {
  MerchantArtError,
  type ArtRoundView,
  type MerchantArtService,
  type MerchantArtState,
} from '../merchant-art.js';
import { safeErrorMetadata } from '../security-log.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inProgressSql = `('DRAFTING', 'FINALIZING')`;
const oneInProgressIndex = 'merchant_art_rounds_one_in_progress';

type Options = {
  // 없으면 기능이 꺼진 것이다(OPENAI_API_KEY 없음). 조회·적용·되돌리기·공개 그림은 그래도 동작한다.
  client?: AiArtImageClient;
  config: Pick<AiArtConfig, 'monthlyBudgetMicroUsd' | 'dailyDraftRounds' | 'dailyFinals' | 'rates'>;
  accountLifecycle?: PostgresAccountLifecycle;
  now?: () => Date;
  nextRoundId?: () => string;
  staleAfterMs?: number;
  heartbeatMs?: number;
};

type RoundRow = {
  id: string;
  merchant_id: string;
  status: ArtRoundStatus;
  chosen_index: number | null;
  failure_code: AiArtFailureCode | null;
  created_at: Date;
};

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

const roundColumns = 'id, merchant_id, status, chosen_index, failure_code, created_at';

export class PostgresMerchantArtService implements MerchantArtService {
  private readonly client: AiArtImageClient | undefined;
  private readonly config: Options['config'];
  private readonly accountLifecycle: PostgresAccountLifecycle | undefined;
  private readonly now: () => Date;
  private readonly nextRoundId: () => string;
  private readonly staleAfterMs: number;
  private readonly heartbeatMs: number;
  private readonly jobs = new Set<Promise<void>>();

  constructor(private readonly pool: Pool, options: Options) {
    this.client = options.client;
    this.config = options.config;
    this.accountLifecycle = options.accountLifecycle;
    this.now = options.now ?? (() => new Date());
    this.nextRoundId = options.nextRoundId ?? randomUUID;
    this.staleAfterMs = options.staleAfterMs ?? staleRoundMs;
    this.heartbeatMs = options.heartbeatMs ?? 60_000;
  }

  // 시험·종료 절차용: 백그라운드에서 돌고 있는 생성 작업이 모두 끝날 때까지 기다린다.
  async drain(): Promise<void> {
    while (this.jobs.size > 0) await Promise.allSettled([...this.jobs]);
  }

  async getState(merchantId: string): Promise<MerchantArtState> {
    await this.interruptStale(this.pool, merchantId);
    const now = this.now();
    const current = await this.pool.query<{ sha256: string }>(
      'SELECT sha256 FROM merchant_art WHERE merchant_id = $1', [merchantId],
    );
    const latest = await this.pool.query<RoundRow>(
      `SELECT ${roundColumns} FROM merchant_art_rounds WHERE merchant_id = $1
       ORDER BY (status IN ${inProgressSql}) DESC, created_at DESC, id DESC LIMIT 1`,
      [merchantId],
    );
    const row = latest.rows[0];
    // 진행 중인 라운드가 있으면 그것을, 없으면 가장 최근 라운드를 보여 준다. 그 라운드가 이미 적용된 것이면 보여 줄 작업이 없다
    // (더 오래된 미적용 라운드는 되살리지 않는다).
    const round = row && row.status !== 'APPLIED' ? await this.view(this.pool, row) : null;
    const artUrl = artUrlFor(current.rows[0]?.sha256 ?? null);
    return {
      configured: this.client !== undefined,
      current: artUrl ? { artUrl } : null,
      quota: {
        draftRoundsLeft: Math.max(0, this.config.dailyDraftRounds - await this.draftRoundsToday(this.pool, merchantId, now)),
        finalsLeft: Math.max(0, this.config.dailyFinals - await this.finalsToday(this.pool, merchantId, now)),
      },
      round,
    };
  }

  async createRound(input: { merchantId: string; accountId: string }): Promise<ArtRoundView> {
    if (!this.client) throw new MerchantArtError('AI_ART_NOT_CONFIGURED');
    const merchant = (await this.pool.query<{ name: string; menu_items: unknown }>(
      'SELECT name, menu_items FROM merchants WHERE id = $1', [input.merchantId],
    )).rows[0];
    if (!merchant) throw new MerchantArtError('AI_ART_ROUND_NOT_FOUND');
    const subject: ArtSubject = { merchantName: merchant.name, menuNames: menuNamesFrom(merchant.menu_items) };
    const now = this.now();
    const roundId = this.nextRoundId();

    const spendIds = await this.transaction(async (client) => {
      if (this.accountLifecycle) await this.accountLifecycle.assertActive(client, input.accountId);
      await this.lockMerchant(client, input.merchantId);
      await this.interruptStale(client, input.merchantId);
      // 오래된 미적용 라운드 정리(이미지는 CASCADE). 적용된 라운드 행은 지우지 않는다(다시 눌렀을 때 같은 결과를 주는 멱등 기록).
      // 다만 적용된 지 30일이 지난 라운드의 이미지는 지운다: 그림 자체는 merchant_art에 있고 이 이미지는 다시 쓰이지 않는다.
      const cutoff = new Date(now.getTime() - unappliedRoundRetentionMs);
      await client.query(
        `DELETE FROM merchant_art_rounds
         WHERE merchant_id = $1 AND status <> 'APPLIED' AND created_at < $2`,
        [input.merchantId, cutoff],
      );
      await client.query(
        `DELETE FROM merchant_art_images
         WHERE round_id IN (
           SELECT id FROM merchant_art_rounds
           WHERE merchant_id = $1 AND status = 'APPLIED' AND updated_at < $2
         )`,
        [input.merchantId, cutoff],
      );
      const busy = await client.query(
        `SELECT 1 FROM merchant_art_rounds WHERE merchant_id = $1 AND status IN ${inProgressSql}`,
        [input.merchantId],
      );
      if (busy.rowCount) throw new MerchantArtError('AI_ART_ROUND_IN_PROGRESS');
      if (await this.draftRoundsToday(client, input.merchantId, now) >= this.config.dailyDraftRounds) {
        throw new MerchantArtError('AI_ART_DAILY_LIMIT', secondsUntilNextKstMidnight(now));
      }
      await this.assertBudget(client, now, estimatedDraftCallMicroUsd * draftCount);
      try {
        await client.query(
          `INSERT INTO merchant_art_rounds (
             id, merchant_id, requested_by_account_id, status, business_date, created_at, updated_at
           ) VALUES ($1, $2, $3, 'DRAFTING', $4::date, $5, $5)`,
          [roundId, input.merchantId, input.accountId, kstBusinessDate(now), now],
        );
      } catch (error) {
        throw this.mapUniqueViolation(error);
      }
      const ids: number[] = [];
      for (let index = 0; index < draftCount; index++) {
        ids.push(await this.recordSpend(client, input.merchantId, roundId, 'DRAFT', estimatedDraftCallMicroUsd, now));
      }
      return ids;
    });

    // 202로 돌려주는 모습(DRAFTING)을 먼저 읽고 나서 생성을 시작한다. 빠른 생성이 응답보다 먼저 끝나도 응답은 바뀌지 않는다.
    // 라운드는 이미 커밋됐으므로 읽기가 실패해도 생성은 반드시 시작한다(안 그러면 5분 뒤 중단 처리될 때까지 DRAFTING에 갇힌다).
    try {
      return await this.requireView(roundId, input.merchantId);
    } finally {
      this.launch(roundId, () => this.runDrafts(roundId, input.merchantId, subject, spendIds));
    }
  }

  async getRound(input: { merchantId: string; roundId: string }): Promise<ArtRoundView> {
    await this.interruptStale(this.pool, input.merchantId);
    return this.requireView(input.roundId, input.merchantId);
  }

  async chooseDraft(input: { merchantId: string; roundId: string; index: number }): Promise<ArtRoundView> {
    if (!this.client) throw new MerchantArtError('AI_ART_NOT_CONFIGURED');
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= draftCount) {
      throw new RangeError('draft index out of range');
    }
    if (!uuidPattern.test(input.roundId)) throw new MerchantArtError('AI_ART_ROUND_NOT_FOUND');
    const now = this.now();

    const spendId = await this.transaction(async (client) => {
      await this.lockMerchant(client, input.merchantId);
      await this.interruptStale(client, input.merchantId);
      const round = await this.lockRound(client, input.merchantId, input.roundId);
      if (!canChoose({ status: round.status, chosenIndex: round.chosen_index })) {
        throw new MerchantArtError('AI_ART_ROUND_STATE');
      }
      // 시안 네 장이 모두 남아 있어야 하고 고른 것이 그중 하나여야 한다(최종이 실패한 라운드에서 다시 고를 때도 같다).
      const drafts = await client.query<{ idx: number }>(
        `SELECT idx FROM merchant_art_images WHERE round_id = $1 AND kind = 'DRAFT'`, [round.id],
      );
      if (drafts.rowCount !== draftCount || !drafts.rows.some((draft) => draft.idx === input.index)) {
        throw new MerchantArtError('AI_ART_ROUND_STATE');
      }
      if (await this.finalsToday(client, input.merchantId, now) >= this.config.dailyFinals) {
        throw new MerchantArtError('AI_ART_DAILY_LIMIT', secondsUntilNextKstMidnight(now));
      }
      await this.assertBudget(client, now, estimatedFinalMicroUsd);
      try {
        await client.query(
          `UPDATE merchant_art_rounds
           SET status = 'FINALIZING', chosen_index = $2, failure_code = NULL, updated_at = $3 WHERE id = $1`,
          [round.id, input.index, now],
        );
      } catch (error) {
        throw this.mapUniqueViolation(error);
      }
      // 실패한 최종을 다시 만드는 경우를 위해 이 라운드에 남은 최종 조각은 지운다(새 호출이 옛 조각에 막히지 않게).
      await client.query(`DELETE FROM merchant_art_images WHERE round_id = $1 AND kind = 'FINAL'`, [round.id]);
      return this.recordSpend(client, input.merchantId, round.id, 'FINAL', estimatedFinalMicroUsd, now);
    });

    // 라운드는 이미 커밋됐으므로 읽기가 실패해도 최종 생성은 반드시 시작한다(FINALIZING에 갇히지 않게).
    try {
      return await this.requireView(input.roundId, input.merchantId);
    } finally {
      this.launch(input.roundId, () => this.runFinal(input.roundId, input.merchantId, input.index, spendId));
    }
  }

  async apply(input: { merchantId: string; roundId: string }): Promise<{ artUrl: string }> {
    if (!uuidPattern.test(input.roundId)) throw new MerchantArtError('AI_ART_ROUND_NOT_FOUND');
    const now = this.now();
    const sha256 = await this.transaction(async (client) => {
      await this.lockMerchant(client, input.merchantId);
      const round = await this.lockRound(client, input.merchantId, input.roundId);
      if (round.status === 'APPLIED') {
        // 응답이 유실돼 다시 눌렀을 때: 지금 적용된 그림이 이 라운드의 것이면 같은 결과를 돌려준다.
        const applied = await client.query<{ sha256: string }>(
          'SELECT sha256 FROM merchant_art WHERE merchant_id = $1 AND round_id = $2',
          [input.merchantId, round.id],
        );
        if (applied.rows[0]) return applied.rows[0].sha256;
        throw new MerchantArtError('AI_ART_ROUND_STATE');
      }
      if (!canApply(round.status) || round.chosen_index === null) throw new MerchantArtError('AI_ART_ROUND_STATE');
      const final = (await client.query<{ image: Buffer; sha256: string }>(
        `SELECT image, sha256 FROM merchant_art_images WHERE round_id = $1 AND kind = 'FINAL' AND idx = $2`,
        [round.id, round.chosen_index],
      )).rows[0];
      if (!final) throw new MerchantArtError('AI_ART_ROUND_STATE');
      await client.query(
        `INSERT INTO merchant_art (merchant_id, image, sha256, round_id, applied_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (merchant_id) DO UPDATE
           SET image = EXCLUDED.image, sha256 = EXCLUDED.sha256, round_id = EXCLUDED.round_id,
               applied_at = EXCLUDED.applied_at`,
        [input.merchantId, final.image, final.sha256, round.id, now],
      );
      await client.query(
        `UPDATE merchant_art_rounds SET status = 'APPLIED', updated_at = $2 WHERE id = $1`,
        [round.id, now],
      );
      // 적용된 뒤에는 시안이 다시 쓰이지 않는다(고른 그림은 merchant_art에 있다). 이 라운드의 시안 이미지를 바로 지운다.
      await client.query(`DELETE FROM merchant_art_images WHERE round_id = $1 AND kind = 'DRAFT'`, [round.id]);
      return final.sha256;
    });
    const artUrl = artUrlFor(sha256);
    if (!artUrl) throw new Error('stored art hash is malformed');
    return { artUrl };
  }

  // 적용(apply)과 같은 가게 잠금을 잡아 되돌리기와 적용이 엇갈려도 결과가 하나로 정해진다. 그림이 없어도 성공한다(멱등).
  async reset(merchantId: string): Promise<void> {
    await this.transaction(async (client) => {
      await this.lockMerchant(client, merchantId);
      await client.query('DELETE FROM merchant_art WHERE merchant_id = $1', [merchantId]);
    });
  }

  async getPublicImage(sha256: string): Promise<Buffer | null> {
    // 같은 그림 바이트를 여러 가게가 쓸 수 있어(sha256은 유일하지 않다) 가게 id 순으로 하나를 고른다. sha256이 같으면 바이트도 같다.
    const found = await this.pool.query<{ image: Buffer }>(
      'SELECT image FROM merchant_art WHERE sha256 = $1 ORDER BY merchant_id LIMIT 1', [sha256],
    );
    return found.rows[0]?.image ?? null;
  }

  // ---- 백그라운드 생성 ----------------------------------------------------------------------

  // 생성은 응답 뒤 이 프로세스 안에서 이어 간다. 어떤 예외도 밖으로 새지 않고, 마지막 방어선에서 FAILED로 적는다.
  private launch(roundId: string, work: () => Promise<void>): void {
    const timer = setInterval(() => {
      this.pool.query(
        `UPDATE merchant_art_rounds SET updated_at = $2 WHERE id = $1 AND status IN ${inProgressSql}`,
        [roundId, this.now()],
      ).catch((error) => console.error(safeErrorMetadata('merchant_art.heartbeat', error)));
    }, this.heartbeatMs);
    timer.unref();
    const job: Promise<void> = this.guarded(roundId, work).finally(() => {
      clearInterval(timer);
      this.jobs.delete(job);
    });
    this.jobs.add(job);
  }

  private async guarded(roundId: string, work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      console.error(safeErrorMetadata('merchant_art.job', error));
      await this.failRound(roundId, 'AI_ART_INTERRUPTED').catch((inner) =>
        console.error(safeErrorMetadata('merchant_art.job_fail_write', inner)));
    }
  }

  private async runDrafts(
    roundId: string, merchantId: string, subject: ArtSubject, spendIds: readonly number[],
  ): Promise<void> {
    const client = this.client!;
    const userHash = merchantUserHash(merchantId);
    const outcomes = await Promise.allSettled(artStyles.map(async (style, index) => {
      try {
        const made = await client.generateDraft({ prompt: buildDraftPrompt(subject, style), userHash });
        await this.settleSpend(spendIds[index]!, made.usage
          ? costMicroUsd(made.usage, this.config.rates) : estimatedDraftCallMicroUsd);
        await this.storeImage(roundId, 'DRAFT', index, style.key, made.image);
      } catch (error) {
        await this.settleFailedSpend(spendIds[index]!, error);
        throw error;
      }
    }));
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    if (failures.length > 0) {
      for (const failure of failures) this.logUnexpected(failure.reason);
      await this.pool.query(
        `DELETE FROM merchant_art_images WHERE round_id = $1 AND kind = 'DRAFT'`, [roundId],
      );
      await this.failRound(roundId, pickFailureCode(failures.map((failure) => failureCodeOf(failure.reason))));
      return;
    }
    await this.pool.query(
      `UPDATE merchant_art_rounds SET status = 'DRAFTS_READY', updated_at = $2
       WHERE id = $1 AND status = 'DRAFTING'`,
      [roundId, this.now()],
    );
  }

  private async runFinal(roundId: string, merchantId: string, index: number, spendId: number): Promise<void> {
    const client = this.client!;
    try {
      const draft = (await this.pool.query<{ image: Buffer; style: string }>(
        `SELECT image, style FROM merchant_art_images WHERE round_id = $1 AND kind = 'DRAFT' AND idx = $2`,
        [roundId, index],
      )).rows[0];
      if (!draft) throw new Error('chosen draft image is missing');
      const made = await client.editFinal({
        prompt: buildFinalPrompt(), image: draft.image, userHash: merchantUserHash(merchantId),
      });
      await this.settleSpend(spendId, made.usage ? costMicroUsd(made.usage, this.config.rates) : estimatedFinalMicroUsd);
      await this.storeImage(roundId, 'FINAL', index, draft.style, made.image);
    } catch (error) {
      await this.settleFailedSpend(spendId, error);
      this.logUnexpected(error);
      await this.failRound(roundId, failureCodeOf(error));
      return;
    }
    await this.pool.query(
      `UPDATE merchant_art_rounds SET status = 'FINAL_READY', updated_at = $2
       WHERE id = $1 AND status = 'FINALIZING'`,
      [roundId, this.now()],
    );
  }

  private async storeImage(
    roundId: string, kind: 'DRAFT' | 'FINAL', index: number, style: string, image: Buffer,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO merchant_art_images (round_id, kind, idx, style, image, sha256, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (round_id, kind, idx) DO NOTHING`,
      [roundId, kind, index, style, image, createHash('sha256').update(image).digest('hex'), this.now()],
    );
  }

  private async failRound(roundId: string, code: AiArtFailureCode): Promise<void> {
    await this.pool.query(
      `UPDATE merchant_art_rounds SET status = 'FAILED', failure_code = $2, updated_at = $3
       WHERE id = $1 AND status IN ${inProgressSql}`,
      [roundId, code, this.now()],
    );
  }

  // 네트워크 끊김·시간 초과처럼 이미지가 만들어졌는지 알 수 없는 실패는 예상 비용을 그대로 두고(보수적으로 센다),
  // OpenAI가 오류 응답을 준 실패는 이미지가 없으므로 0으로 고친다.
  private async settleFailedSpend(spendId: number, error: unknown): Promise<void> {
    if (error instanceof AiArtGenerationError && !error.chargeable) await this.settleSpend(spendId, 0);
  }

  private async settleSpend(spendId: number, microUsd: number): Promise<void> {
    await this.pool.query('UPDATE ai_art_spend SET micro_usd = $2 WHERE id = $1', [spendId, microUsd]);
  }

  private logUnexpected(error: unknown): void {
    if (!(error instanceof AiArtGenerationError)) console.error(safeErrorMetadata('merchant_art.generate', error));
  }

  // ---- 한도·예산 ---------------------------------------------------------------------------

  private async draftRoundsToday(db: Queryable, merchantId: string, now: Date): Promise<number> {
    const result = await db.query<{ used: number }>(
      `SELECT count(*)::integer AS used FROM merchant_art_rounds
       WHERE merchant_id = $1 AND business_date = $2::date`,
      [merchantId, kstBusinessDate(now)],
    );
    return result.rows[0]!.used;
  }

  private async finalsToday(db: Queryable, merchantId: string, now: Date): Promise<number> {
    const day = kstDayRange(now);
    const result = await db.query<{ used: number }>(
      `SELECT count(*)::integer AS used FROM ai_art_spend
       WHERE merchant_id = $1 AND kind = 'FINAL' AND created_at >= $2 AND created_at < $3`,
      [merchantId, day.start, day.end],
    );
    return result.rows[0]!.used;
  }

  // 환경(이 DB) 전체 advisory lock으로 직렬화해 이번 달(한국) 합계에 예상 비용을 더한 값이 상한을 넘는지 본다.
  // 잠금은 거래가 끝날 때(예상 비용 기록 뒤) 풀리므로 동시에 들어온 요청이 같은 잔액을 두 번 쓰지 못한다.
  private async assertBudget(client: PoolClient, now: Date, estimateMicroUsd: number): Promise<void> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('ai-art-budget', 0))`);
    const month = kstMonthRange(now);
    const spent = await client.query<{ total: string }>(
      `SELECT coalesce(sum(micro_usd), 0)::bigint AS total FROM ai_art_spend
       WHERE created_at >= $1 AND created_at < $2`,
      [month.start, month.end],
    );
    if (Number(spent.rows[0]!.total) + estimateMicroUsd > this.config.monthlyBudgetMicroUsd) {
      throw new MerchantArtError('AI_ART_BUDGET_EXHAUSTED');
    }
  }

  private async recordSpend(
    client: PoolClient, merchantId: string, roundId: string, kind: 'DRAFT' | 'FINAL', microUsd: number, now: Date,
  ): Promise<number> {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO ai_art_spend (merchant_id, round_id, kind, micro_usd, created_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [merchantId, roundId, kind, microUsd, now],
    );
    return Number(inserted.rows[0]!.id);
  }

  // ---- 조회·상태 ---------------------------------------------------------------------------

  // 진행 중 라운드가 staleAfterMs 넘게 갱신되지 않으면(API 재시작 등) 읽을 때 INTERRUPTED로 바꾼다.
  private async interruptStale(db: Queryable, merchantId: string): Promise<void> {
    const now = this.now();
    await db.query(
      `UPDATE merchant_art_rounds
       SET status = 'FAILED', failure_code = 'AI_ART_INTERRUPTED', updated_at = $2
       WHERE merchant_id = $1 AND status IN ${inProgressSql} AND updated_at < $3`,
      [merchantId, now, new Date(now.getTime() - this.staleAfterMs)],
    );
  }

  private async lockMerchant(client: PoolClient, merchantId: string): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ai-art-merchant:${merchantId}`]);
  }

  // 다른 가게의 라운드·없는 라운드·UUID가 아닌 값은 구분 없이 같은 404다.
  private async lockRound(client: PoolClient, merchantId: string, roundId: string): Promise<RoundRow> {
    if (!uuidPattern.test(roundId)) throw new MerchantArtError('AI_ART_ROUND_NOT_FOUND');
    const round = (await client.query<RoundRow>(
      `SELECT ${roundColumns} FROM merchant_art_rounds WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [roundId, merchantId],
    )).rows[0];
    if (!round) throw new MerchantArtError('AI_ART_ROUND_NOT_FOUND');
    return round;
  }

  private async requireView(roundId: string, merchantId: string): Promise<ArtRoundView> {
    if (!uuidPattern.test(roundId)) throw new MerchantArtError('AI_ART_ROUND_NOT_FOUND');
    const row = (await this.pool.query<RoundRow>(
      `SELECT ${roundColumns} FROM merchant_art_rounds WHERE id = $1 AND merchant_id = $2`,
      [roundId, merchantId],
    )).rows[0];
    if (!row) throw new MerchantArtError('AI_ART_ROUND_NOT_FOUND');
    return this.view(this.pool, row);
  }

  // 만드는 중(DRAFTING·FINALIZING)에는 이미지를 읽지도 보내지도 않는다(3초마다 조회하므로). 시안은 네 장이 모두 있을 때만 보인다.
  private async view(db: Queryable, row: RoundRow): Promise<ArtRoundView> {
    const images = isInProgress(row.status) ? [] : (await db.query<{
      kind: 'DRAFT' | 'FINAL'; idx: number; style: string; image: Buffer;
    }>(
      'SELECT kind, idx, style, image FROM merchant_art_images WHERE round_id = $1 ORDER BY kind, idx',
      [row.id],
    )).rows;
    const draftRows = images.filter((image) => image.kind === 'DRAFT');
    // 시안을 만들다 실패·중단된 라운드(고른 시안이 없는 FAILED)에는 늦게 도착한 조각이 남았더라도 시안을 보여 주지 않는다.
    const showDrafts = draftRows.length === draftCount && !(row.status === 'FAILED' && row.chosen_index === null);
    const drafts = showDrafts
      ? draftRows.map((image) => {
        const style = artStyles.find((candidate) => candidate.key === image.style) ?? artStyles[image.idx]!;
        return { index: image.idx, style: style.key, label: style.label, imageDataUrl: dataUrl(image.image) };
      })
      : [];
    const finalRow = row.chosen_index === null || (row.status !== 'FINAL_READY' && row.status !== 'APPLIED')
      ? undefined
      : images.find((image) => image.kind === 'FINAL' && image.idx === row.chosen_index);
    return {
      id: row.id,
      status: row.status,
      drafts,
      chosenIndex: row.chosen_index,
      final: finalRow ? { imageDataUrl: dataUrl(finalRow.image) } : null,
      failureCode: row.failure_code,
      createdAt: row.created_at.toISOString(),
    };
  }

  private mapUniqueViolation(error: unknown): unknown {
    return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === '23505'
      && Reflect.get(error, 'constraint') === oneInProgressIndex
      ? new MerchantArtError('AI_ART_ROUND_IN_PROGRESS')
      : error;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new MerchantArtError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }
}

function dataUrl(image: Buffer): string {
  return `data:image/webp;base64,${image.toString('base64')}`;
}

function failureCodeOf(error: unknown): AiArtFailureCode {
  return error instanceof AiArtGenerationError ? error.failureCode : 'AI_ART_INTERRUPTED';
}
