import type { Pool } from 'pg';

import { kstBusinessDate } from '../reversal-rules.js';
import {
  VisitorFeedbackError,
  type VisitorFeedbackCount,
  type VisitorFeedbackSelection,
  type VisitorFeedbackService,
  type VisitorFeedbackSummary,
} from '../visitor-feedback.js';
import {
  isEmptyVisitorFeedback,
  maskedVisitorFeedbackLabel,
  normalizeVisitorFeedback,
  rankVisitorCounts,
  visitorFeedbackNoteListLimit,
  visitorSuggestionCodes,
  visitorSuggestionLabels,
  visitorTagCodes,
  visitorTagLabels,
} from '../visitor-feedback-rules.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';

type Options = {
  accountLifecycle: PostgresAccountLifecycle;
  // 점주 요약의 고객 가림 표시를 만드는 HMAC 비밀(32바이트 이상). 방문 취소 화면(recent-visits)과 같은 비밀이다.
  labelHmacSecret: string;
  now?: () => Date;
};

type FeedbackRow = { tags: VisitorFeedbackSelection['tags']; suggestions: VisitorFeedbackSelection['suggestions']; note: string | null };
type CountRow = { code: string; count: number };

const emptySelection = (): VisitorFeedbackSelection => ({ tags: [], suggestions: [], note: null });

// 실제 방문이 있어도 체험 계정·체험 가게의 가상 실적은 의견 자격에서 제외한다.
const eligibleVisitSql = `
  SELECT 1
  FROM visit_events AS visit
  WHERE visit.customer_account_id = $1
    AND visit.merchant_id = $2
    AND visit.status = 'VALID'
    AND visit.progress_excluded_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials WHERE account_id = $1)
    AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials AS trial WHERE trial.merchant_id = visit.merchant_id)
  LIMIT 1`;

export class PostgresVisitorFeedbackService implements VisitorFeedbackService {
  private readonly accountLifecycle: PostgresAccountLifecycle;
  private readonly labelHmacSecret: string;
  private readonly now: () => Date;

  constructor(private readonly pool: Pool, options: Options) {
    if (Buffer.byteLength(options.labelHmacSecret, 'utf8') < 32) {
      throw new Error('visitor feedback labelHmacSecret must be at least 32 bytes');
    }
    this.accountLifecycle = options.accountLifecycle;
    this.labelHmacSecret = options.labelHmacSecret;
    this.now = options.now ?? (() => new Date());
  }

  async getMine(accountId: string, merchantId: string): Promise<VisitorFeedbackSelection> {
    const result = await this.pool.query<FeedbackRow>(
      `SELECT tags, suggestions, note FROM merchant_visitor_feedback
       WHERE customer_account_id = $1 AND merchant_id = $2`,
      [accountId, merchantId],
    );
    const row = result.rows[0];
    return row ? { tags: row.tags, suggestions: row.suggestions, note: row.note } : emptySelection();
  }

  async upsert(
    accountId: string,
    merchantId: string,
    input: { tags: unknown; suggestions: unknown; note: unknown },
  ): Promise<VisitorFeedbackSelection> {
    const normalized = normalizeVisitorFeedback(input);
    if (!normalized.ok) throw new VisitorFeedbackError(normalized.code);
    const selection = normalized.value;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 계정 삭제·방문 취소와 같은 잠금: 자격 확인과 저장 사이에 마지막 방문이 취소되지 않는다.
      await this.accountLifecycle.assertActive(client, accountId);
      if (isEmptyVisitorFeedback(selection)) {
        // 거둬들이기는 방문 자격과 상관없이 허용한다(자기 데이터를 지울 뿐이라 새로 만드는 것이 없다).
        await client.query(
          'DELETE FROM merchant_visitor_feedback WHERE customer_account_id = $1 AND merchant_id = $2',
          [accountId, merchantId],
        );
        await client.query('COMMIT');
        return selection;
      }
      const eligible = await client.query(eligibleVisitSql, [accountId, merchantId]);
      if (eligible.rowCount === 0) throw new VisitorFeedbackError('VISITOR_FEEDBACK_NOT_ELIGIBLE');
      const now = this.now();
      await client.query(
        `INSERT INTO merchant_visitor_feedback
           (customer_account_id, merchant_id, tags, suggestions, note, created_at, updated_at)
         VALUES ($1, $2, $3::text[], $4::text[], $5, $6, $6)
         ON CONFLICT (customer_account_id, merchant_id) DO UPDATE
           SET tags = EXCLUDED.tags, suggestions = EXCLUDED.suggestions, note = EXCLUDED.note,
               updated_at = EXCLUDED.updated_at`,
        [accountId, merchantId, selection.tags, selection.suggestions, selection.note, now],
      );
      await client.query('COMMIT');
      return selection;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new VisitorFeedbackError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }

  async merchantSummary(merchantId: string): Promise<VisitorFeedbackSummary> {
    const [tagRows, suggestionRows, noteRows] = await Promise.all([
      this.pool.query<CountRow>(
        `SELECT vote.code, count(*)::integer AS count
         FROM merchant_visitor_feedback AS feedback, unnest(feedback.tags) AS vote(code)
         WHERE feedback.merchant_id = $1 GROUP BY vote.code`,
        [merchantId],
      ),
      this.pool.query<CountRow>(
        `SELECT vote.code, count(*)::integer AS count
         FROM merchant_visitor_feedback AS feedback, unnest(feedback.suggestions) AS vote(code)
         WHERE feedback.merchant_id = $1 GROUP BY vote.code`,
        [merchantId],
      ),
      this.pool.query<{ customer_account_id: string; note: string; updated_at: Date }>(
        `SELECT customer_account_id, note, updated_at FROM merchant_visitor_feedback
         WHERE merchant_id = $1 AND note IS NOT NULL
         ORDER BY updated_at DESC, customer_account_id
         LIMIT $2`,
        [merchantId, visitorFeedbackNoteListLimit],
      ),
    ]);
    return {
      tags: rankVisitorCounts(tagRows.rows, visitorTagCodes, 1).map(
        (entry): VisitorFeedbackCount<(typeof visitorTagCodes)[number]> => ({ ...entry, label: visitorTagLabels[entry.code] }),
      ),
      suggestions: rankVisitorCounts(suggestionRows.rows, visitorSuggestionCodes, 1).map(
        (entry): VisitorFeedbackCount<(typeof visitorSuggestionCodes)[number]> => ({
          ...entry,
          label: visitorSuggestionLabels[entry.code],
        }),
      ),
      notes: noteRows.rows.map((row) => ({
        customerLabel: maskedVisitorFeedbackLabel(this.labelHmacSecret, merchantId, row.customer_account_id),
        date: kstBusinessDate(row.updated_at),
        text: row.note,
      })),
    };
  }
}
