import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import type { CollectibleArtwork } from '../collectible-project.js';
import {
  buildCheckSummary, COURSE_SITUATION_LABEL, CourseError, courseUserState, evaluateSteps,
  parseCourseDraft, publishBlockers, summarizeProgress,
  type AdminCourse, type CourseCheckSummary, type CourseDraftInput, type CourseGoal,
  type CourseMerchantFact, type CourseService, type CourseSituation, type CourseStatus, type CourseView,
  type StepEntitlement,
} from '../course-rules.js';
import type { RealWorldProfile } from '../real-world-contract.js';
import { businessStateAt } from '../real-world-hours.js';
import { AdminError, assertPlatformAdmin } from './admin.js';
import { AccountLifecycleError } from './account-lifecycle.js';
import type { PostgresAccountLifecycle } from './account-lifecycle.js';

type Db = Pool | PoolClient;
type CourseRow = {
  id: string; title: string; situation: CourseSituation; scene_key: string; status: CourseStatus;
  starts_at: Date | null; ends_at: Date | null; counts_from: Date | null;
  checked_at: Date | null; check_summary: CourseCheckSummary | null; created_at: Date;
};
type StepRow = {
  course_id: string; position: number; merchant_id: string; merchant_name: string; target_visit_count: CourseGoal;
  is_demo: boolean; available: boolean;
  piece_key: string; piece_label: string; owner_optin_ref: string | null; owner_optin_at: Date | null;
  campaign_id: string | null; enrollment_open: boolean | null; progress_visit_count: number | null;
  artwork: CollectibleArtwork | null;
};
type FactRow = {
  position: number; merchant_id: string; target_visit_count: number;
  name: string | null; category: string | null; status: string | null; published_at: Date | null;
  is_demo: boolean | null; guest_trial: boolean; latitude: number | null; longitude: number | null;
  profile: RealWorldProfile | null; campaign_id: string | null; campaign_ends_at: Date | null;
  enrolled_count: number | null; enrollment_capacity: number | null; goals: number[] | null; has_coin: boolean | null;
};
type EntitlementRow = {
  entitlement_id: string; merchant_id: string; target_visit_count: number; earned_at: Date; status: string;
};

const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const iso = (date: Date | null) => date?.toISOString() ?? null;
export type CourseNextHint = {
  id: string; title: string; situation: CourseSituation; done: number; total: number;
  startsAt: string | null; nextMerchantId: string; nextGoal: CourseGoal;
};

export class PostgresCourseService implements CourseService {
  private readonly now: () => Date;
  private readonly includeDemo: boolean;
  private readonly accountLifecycle: PostgresAccountLifecycle | undefined;

  constructor(private readonly pool: Pool, options: {
    now?: () => Date; includeDemo?: boolean; accountLifecycle?: PostgresAccountLifecycle;
  } = {}) {
    this.now = options.now ?? (() => new Date());
    this.includeDemo = options.includeDemo === true;
    this.accountLifecycle = options.accountLifecycle;
  }

  private async transaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally { db.release(); }
  }

  private async course(db: Db, id: string, lock: 'UPDATE' | 'SHARE' | null = null): Promise<CourseRow> {
    if (!validId(id)) throw new CourseError('COURSE_NOT_FOUND');
    const result = await db.query<CourseRow>(`SELECT * FROM courses WHERE id = $1 ${lock ? `FOR ${lock}` : ''}`, [id]);
    if (!result.rows[0]) throw new CourseError('COURSE_NOT_FOUND');
    return result.rows[0];
  }

  private async steps(db: Db, ids: string[], at: Date, accountId: string | null = null,
    withArtwork = true): Promise<StepRow[]> {
    if (ids.length === 0) return [];
    const result = await db.query<StepRow>(
      `SELECT step.course_id, step.position, step.merchant_id, merchant.name AS merchant_name, step.target_visit_count,
              merchant.is_demo, (merchant.status = 'ACTIVE' AND merchant.published_at IS NOT NULL
                AND campaign.id IS NOT NULL) AS available,
              step.piece_key, step.piece_label, step.owner_optin_ref, step.owner_optin_at,
              campaign.id AS campaign_id,
              campaign.enrolled_count < campaign.enrollment_capacity AS enrollment_open,
              (SELECT count(DISTINCT visit.business_date)::integer FROM visit_events visit
                WHERE visit.campaign_id = campaign.id AND visit.status = 'VALID'
                  AND visit.progress_counted AND visit.customer_account_id = $3) AS progress_visit_count,
              ${withArtwork ? 'grade.summary' : 'NULL::jsonb'} AS artwork
       FROM course_steps step JOIN merchants merchant ON merchant.id = step.merchant_id
       LEFT JOIN LATERAL (
         SELECT c.id, c.enrolled_count, c.enrollment_capacity
         FROM campaigns c WHERE c.merchant_id = step.merchant_id AND c.status = 'ACTIVE'
           AND c.is_public AND c.starts_at <= $2 AND c.ends_at > $2
           AND EXISTS (SELECT 1 FROM campaign_goals g WHERE g.campaign_id = c.id
             AND g.target_visit_count = step.target_visit_count)
         ORDER BY c.ends_at DESC, c.id LIMIT 1
       ) campaign ON true
       ${withArtwork ? `LEFT JOIN campaign_collectible_publications link ON link.campaign_id = campaign.id
       LEFT JOIN collectible_publications publication ON publication.id = link.publication_id
         AND publication.media_removed_at IS NULL
       LEFT JOIN collectible_publication_grades grade ON grade.publication_id = publication.id
         AND grade.grade_id = publication.reward_grades->>step.target_visit_count::text` : ''}
       WHERE step.course_id = ANY($1::uuid[]) ORDER BY step.course_id, step.position`,
      [ids, at, accountId],
    );
    return result.rows;
  }

  private async adminView(db: Db, row: CourseRow): Promise<AdminCourse> {
    const steps = await this.steps(db, [row.id], this.now());
    return { id: row.id, title: row.title, situation: row.situation, sceneKey: row.scene_key,
      status: row.status, startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), countsFrom: iso(row.counts_from),
      checkedAt: iso(row.checked_at), checkSummary: row.check_summary, createdAt: row.created_at.toISOString(),
      steps: steps.map(step => ({ position: step.position, merchantId: step.merchant_id,
        merchantName: step.merchant_name, targetVisitCount: step.target_visit_count,
        pieceKey: step.piece_key, pieceLabel: step.piece_label, ownerOptinRef: step.owner_optin_ref,
        ownerOptinAt: iso(step.owner_optin_at) })) };
  }

  async adminList(_actorAccountId: string): Promise<AdminCourse[]> {
    const result = await this.pool.query<CourseRow>('SELECT * FROM courses ORDER BY created_at DESC, id DESC');
    return Promise.all(result.rows.map(row => this.adminView(this.pool, row)));
  }

  private async audit(db: Db, actor: string, courseId: string, action: string, before: unknown, after: unknown): Promise<void> {
    const steps = await db.query<{ merchant_id: string }>('SELECT merchant_id FROM course_steps WHERE course_id = $1', [courseId]);
    for (const step of steps.rows) await db.query(
      `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, before_state, after_state)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), actor, step.merchant_id, action, before === null ? null : JSON.stringify(before), JSON.stringify(after)],
    );
  }

  private async admin(db: PoolClient, actorAccountId: string): Promise<void> {
    if (!this.accountLifecycle) throw new AdminError('ADMIN_FORBIDDEN');
    await assertPlatformAdmin(db, this.accountLifecycle, actorAccountId);
  }

  async adminCreate(actorAccountId: string, raw: unknown): Promise<AdminCourse> {
    const input: CourseDraftInput = parseCourseDraft(raw);
    return this.transaction(async db => {
      await this.admin(db, actorAccountId);
      const existing = await db.query<{ id: string }>('SELECT id FROM merchants WHERE id = ANY($1::text[])',
        [input.steps.map(step => step.merchantId)]);
      if (existing.rows.length !== input.steps.length) throw new CourseError('COURSE_INVALID_INPUT');
      const id = randomUUID();
      await db.query(`INSERT INTO courses(id, title, situation, scene_key, starts_at, ends_at, counts_from,
        curated_by_account_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, input.title, input.situation, input.sceneKey, input.startsAt, input.endsAt, input.countsFrom, actorAccountId]);
      for (const [index, step] of input.steps.entries()) await db.query(
        `INSERT INTO course_steps(course_id, position, merchant_id, target_visit_count, piece_key, piece_label,
          owner_optin_ref, owner_optin_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, index + 1, step.merchantId, step.targetVisitCount, step.pieceKey, step.pieceLabel,
          step.ownerOptinRef, step.ownerOptinRef ? this.now() : null]);
      const view = await this.adminView(db, await this.course(db, id));
      await this.audit(db, actorAccountId, id, 'COURSE_CREATED', null, view);
      return view;
    });
  }

  private suggestedAt(now: Date, hour: number | null): Date | null {
    if (hour === null) return null;
    const kst = new Date(now.getTime() + 9 * 3600000);
    kst.setUTCHours(hour, 0, 0, 0);
    let result = new Date(kst.getTime() - 9 * 3600000);
    if (result.getTime() < now.getTime()) result = new Date(result.getTime() + 86400000);
    return result;
  }

  private async checkFacts(db: Db, row: CourseRow, hour: number | null, now: Date): Promise<CourseCheckSummary> {
    const result = await db.query<FactRow>(
      `SELECT step.position, step.merchant_id, step.target_visit_count, merchant.name, merchant.category,
              merchant.status, merchant.published_at, merchant.is_demo,
              EXISTS (SELECT 1 FROM showcase_guest_trials trial WHERE trial.merchant_id = step.merchant_id) AS guest_trial,
              profile.latitude, profile.longitude, profile.profile,
              campaign.id AS campaign_id, campaign.ends_at AS campaign_ends_at,
              campaign.enrolled_count, campaign.enrollment_capacity,
              campaign.goals, campaign.has_coin
       FROM course_steps step
       LEFT JOIN merchants merchant ON merchant.id = step.merchant_id
       LEFT JOIN merchant_real_world_profiles profile ON profile.merchant_id = step.merchant_id
       LEFT JOIN LATERAL (
         SELECT c.id, c.ends_at, c.enrolled_count, c.enrollment_capacity,
           ARRAY(SELECT g.target_visit_count FROM campaign_goals g WHERE g.campaign_id = c.id) AS goals,
           EXISTS (SELECT 1 FROM campaign_collectible_publications link
             JOIN collectible_publications pub ON pub.id = link.publication_id AND pub.media_removed_at IS NULL
             JOIN collectible_publication_grades grade ON grade.publication_id = pub.id
               AND grade.grade_id = pub.reward_grades->>step.target_visit_count::text
             WHERE link.campaign_id = c.id) AS has_coin
         FROM campaigns c WHERE c.merchant_id = step.merchant_id AND c.status = 'ACTIVE'
           AND c.is_public AND c.starts_at <= $2 AND c.ends_at > $2
         ORDER BY c.ends_at DESC, c.id LIMIT 1
       ) campaign ON true
       WHERE step.course_id = $1 ORDER BY step.position`, [row.id, now]);
    const at = this.suggestedAt(now, hour);
    const facts: CourseMerchantFact[] = result.rows.map(item => {
      const state = at && item.profile ? businessStateAt(item.profile.schedule, at, item.profile.todayOverride) : null;
      return { position: item.position, merchantId: item.merchant_id, targetVisitCount: item.target_visit_count,
        exists: item.name !== null, name: item.name ?? item.merchant_id, category: item.category,
        active: item.status === 'ACTIVE', published: item.published_at !== null,
        demo: item.is_demo === true, guestTrial: item.guest_trial,
        point: item.latitude !== null && item.longitude !== null && item.profile?.location
          ? { latitude: item.latitude, longitude: item.longitude } : null,
        campaign: item.campaign_id && item.campaign_ends_at ? { id: item.campaign_id,
          endsAt: item.campaign_ends_at.toISOString(), goals: item.goals ?? [],
          enrollmentOpen: item.enrolled_count !== null && item.enrollment_capacity !== null &&
            item.enrolled_count < item.enrollment_capacity, hasCoin: item.has_coin === true } : null,
        hours: state ? state.state === 'OPEN' && state.acceptingOrders === false ? 'ORDER_CLOSED' : state.state : null };
    });
    return buildCheckSummary({ facts, suggestedHour: hour, evaluatedAt: now, courseEndsAt: row.ends_at });
  }

  async adminCheck(actorAccountId: string, id: string, suggestedHour: number | null): Promise<AdminCourse> {
    if (suggestedHour !== null && (!Number.isInteger(suggestedHour) || suggestedHour < 0 || suggestedHour > 23))
      throw new CourseError('COURSE_INVALID_INPUT');
    return this.transaction(async db => {
      await this.admin(db, actorAccountId);
      const row = await this.course(db, id, 'UPDATE');
      if (row.status !== 'DRAFT' && row.status !== 'PAUSED') throw new CourseError('COURSE_STATE_CONFLICT');
      const now = this.now();
      const summary = await this.checkFacts(db, row, suggestedHour, now);
      await db.query('UPDATE courses SET checked_at = $2, check_summary = $3 WHERE id = $1',
        [id, now, JSON.stringify(summary)]);
      const view = await this.adminView(db, await this.course(db, id));
      await this.audit(db, actorAccountId, id, 'COURSE_CHECKED', row.check_summary, summary);
      return view;
    });
  }

  async adminPublish(actorAccountId: string, id: string): Promise<AdminCourse> {
    return this.transaction(async db => {
      await this.admin(db, actorAccountId);
      const row = await this.course(db, id, 'UPDATE');
      const now = this.now();
      const steps = await this.steps(db, [id], now);
      const live = await this.checkFacts(db, row, row.check_summary?.suggestedHour ?? null, now);
      const reasons = publishBlockers({ status: row.status, stepCount: steps.length,
        stepsWithoutOptin: steps.filter(step => !step.owner_optin_ref).length, endsAt: row.ends_at,
        checkedAt: row.checked_at, stored: row.check_summary, live, now });
      if (reasons.length) throw new CourseError('COURSE_NOT_PUBLISHABLE', reasons);
      await db.query("UPDATE courses SET status = 'ACTIVE' WHERE id = $1", [id]);
      const view = await this.adminView(db, await this.course(db, id));
      await this.audit(db, actorAccountId, id, 'COURSE_PUBLISHED', { status: row.status }, { status: view.status });
      return view;
    });
  }

  async adminPause(actorAccountId: string, id: string): Promise<AdminCourse> {
    return this.transaction(async db => {
      await this.admin(db, actorAccountId);
      const row = await this.course(db, id, 'UPDATE');
      if (row.status !== 'ACTIVE') throw new CourseError('COURSE_STATE_CONFLICT');
      await db.query("UPDATE courses SET status = 'PAUSED' WHERE id = $1", [id]);
      const view = await this.adminView(db, await this.course(db, id));
      await this.audit(db, actorAccountId, id, 'COURSE_PAUSED', { status: row.status }, { status: view.status });
      return view;
    });
  }

  private async entitlements(db: Db, accountId: string, merchantIds: string[], lock = false): Promise<StepEntitlement[]> {
    const result = await db.query<EntitlementRow>(
      `SELECT e.id AS entitlement_id, c.merchant_id, e.target_visit_count, e.earned_at, e.status
       FROM reward_entitlements e JOIN campaigns c ON c.id = e.campaign_id
       WHERE e.customer_account_id = $1 AND c.merchant_id = ANY($2::text[]) AND e.status <> 'CANCELED'
       ORDER BY e.earned_at, e.id ${lock ? 'FOR SHARE OF e' : ''}`, [accountId, merchantIds]);
    return result.rows.map(item => ({ entitlementId: item.entitlement_id, merchantId: item.merchant_id,
      targetVisitCount: item.target_visit_count, earnedAt: item.earned_at, status: item.status }));
  }

  private async customerViews(db: Db, accountId: string, rows: CourseRow[], lock = false): Promise<CourseView[]> {
    if (rows.length === 0) return [];
    const steps = await this.steps(db, rows.map(row => row.id), this.now(), accountId);
    const entitlements = await this.entitlements(db, accountId, [...new Set(steps.map(step => step.merchant_id))], lock);
    const progressByCourse = new Map(rows.map(row => {
      const courseSteps = steps.filter(step => step.course_id === row.id);
      const progress = evaluateSteps(courseSteps.map(step => ({ position: step.position,
        merchantId: step.merchant_id, targetVisitCount: step.target_visit_count })), entitlements, row.counts_from);
      return [row.id, progress] as const;
    }));
    const earnedArtwork = await db.query<{ entitlement_id: string; artwork: CollectibleArtwork }>(
      `SELECT acquisition.entitlement_id, grade.summary AS artwork
       FROM collectible_acquisitions acquisition
       JOIN collectible_publications publication ON publication.id = acquisition.publication_id
         AND publication.media_removed_at IS NULL
       JOIN collectible_publication_grades grade ON grade.publication_id = acquisition.publication_id
         AND grade.grade_id = acquisition.grade_id
       WHERE acquisition.entitlement_id = ANY($1::uuid[])`,
      [[...new Set([...progressByCourse.values()].flatMap(progress =>
        progress.flatMap(step => step.entitlementId ? [step.entitlementId] : [])))]]);
    const artworkByEntitlement = new Map(earnedArtwork.rows.map(item => [item.entitlement_id, item.artwork]));
    const unlocked = await db.query<{ course_id: string; unlocked_at: Date }>(
      'SELECT course_id, unlocked_at FROM course_unlocks WHERE account_id = $1 AND course_id = ANY($2::uuid[]) AND revoked_at IS NULL',
      [accountId, rows.map(row => row.id)]);
    const unlockByCourse = new Map(unlocked.rows.map(item => [item.course_id, item.unlocked_at]));
    return rows.map(row => {
      const courseSteps = steps.filter(step => step.course_id === row.id);
      const progress = progressByCourse.get(row.id)!;
      const visibleProgress = progress.map((item, index) => courseSteps[index]!.available ? item : { ...item, done: false });
      const summary = summarizeProgress(visibleProgress);
      const unlockedAt = iso(unlockByCourse.get(row.id) ?? null);
      const state = unlockedAt && summarizeProgress(progress).complete
        ? 'UNLOCKED' : courseUserState(summary, unlockedAt !== null);
      return { id: row.id, title: row.title, situation: row.situation,
      situationLabel: COURSE_SITUATION_LABEL[row.situation], sceneKey: row.scene_key, status: row.status,
      startsAt: iso(row.starts_at), endsAt: iso(row.ends_at), done: summary.done, total: summary.total,
      state, stale: state === 'STALE', unlockedAt,
      steps: courseSteps.map((step, index) => {
        const artwork = artworkByEntitlement.get(progress[index]!.entitlementId ?? '') ?? step.artwork;
        return { position: step.position, merchantId: step.merchant_id, merchantName: step.merchant_name,
          targetVisitCount: step.target_visit_count, pieceKey: step.piece_key, pieceLabel: step.piece_label,
          state: step.available ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
          done: visibleProgress[index]!.done, earnedAt: progress[index]!.earnedAt,
          progressVisitCount: step.progress_visit_count, full: step.enrollment_open === false,
          ...(artwork ? { artwork } : {}) };
      }) };
    });
  }

  private async customerView(db: Db, accountId: string, row: CourseRow, lock = false): Promise<CourseView> {
    return (await this.customerViews(db, accountId, [row], lock))[0]!;
  }

  private visible(row: CourseRow, now: Date): boolean {
    return row.status === 'ACTIVE' && (row.starts_at === null || row.starts_at <= now) &&
      (row.ends_at === null || row.ends_at > now);
  }

  private async activeCourses(): Promise<CourseRow[]> {
    const now = this.now();
    // Cap active courses before joining their steps so this endpoint has a predictable maximum read size.
    const result = await this.pool.query<CourseRow>(
      `SELECT * FROM courses WHERE status = 'ACTIVE' AND (starts_at IS NULL OR starts_at <= $1)
       AND (ends_at IS NULL OR ends_at > $1)
       AND NOT EXISTS (SELECT 1 FROM course_steps step WHERE step.course_id = courses.id
         AND step.merchant_id = 'trial-showcase-practice')
       AND ($2::boolean OR NOT EXISTS (SELECT 1 FROM course_steps step
         JOIN merchants merchant ON merchant.id = step.merchant_id
         WHERE step.course_id = courses.id AND merchant.is_demo))
       ORDER BY created_at DESC, id LIMIT 50`, [now, this.includeDemo]);
    return result.rows;
  }

  async list(accountId: string): Promise<CourseView[]> {
    return this.customerViews(this.pool, accountId, await this.activeCourses());
  }

  async listHints(accountId: string): Promise<CourseNextHint[]> {
    const rows = await this.activeCourses();
    const steps = await this.steps(this.pool, rows.map(row => row.id), this.now(), accountId, false);
    const entitlements = await this.entitlements(this.pool, accountId,
      [...new Set(steps.map(step => step.merchant_id))]);
    return rows.flatMap(row => {
      const courseSteps = steps.filter(step => step.course_id === row.id);
      const progress = evaluateSteps(courseSteps.map(step => ({ position: step.position,
        merchantId: step.merchant_id, targetVisitCount: step.target_visit_count })), entitlements, row.counts_from);
      const done = progress.filter((item, index) => item.done && courseSteps[index]!.available).length;
      const next = courseSteps.find((step, index) => !step.available || !progress[index]!.done);
      if (!next?.available || done === 0 || done === courseSteps.length) return [];
      return [{ id: row.id, title: row.title, situation: row.situation, done, total: courseSteps.length,
        startsAt: iso(row.starts_at), nextMerchantId: next.merchant_id, nextGoal: next.target_visit_count }];
    });
  }

  async get(accountId: string, id: string): Promise<CourseView> {
    const row = await this.course(this.pool, id);
    if (!this.visible(row, this.now())) throw new CourseError('COURSE_NOT_FOUND');
    const demo = await this.pool.query<{ is_demo: boolean; merchant_id: string }>(
      'SELECT merchant.is_demo, merchant.id AS merchant_id FROM course_steps step JOIN merchants merchant ON merchant.id = step.merchant_id WHERE step.course_id = $1', [id]);
    if (demo.rows.some(step => step.merchant_id === 'trial-showcase-practice')) throw new CourseError('COURSE_NOT_FOUND');
    if (!this.includeDemo && demo.rows.some(step => step.is_demo)) throw new CourseError('COURSE_NOT_FOUND');
    return this.customerView(this.pool, accountId, row);
  }

  async unlock(accountId: string, id: string): Promise<{ course: CourseView; replayed: boolean }> {
    return this.transaction(async db => {
      try { if (this.accountLifecycle) await this.accountLifecycle.assertActive(db, accountId); }
      catch (error) {
        if (error instanceof AccountLifecycleError) throw new CourseError('ACCOUNT_DELETED');
        throw error;
      }
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`course:${accountId}:${id}`]);
      const row = await this.course(db, id, 'SHARE');
      if (!this.visible(row, this.now())) throw new CourseError('COURSE_UNAVAILABLE');
      const demo = await db.query<{ is_demo: boolean; merchant_id: string }>(
        'SELECT merchant.is_demo, merchant.id AS merchant_id FROM course_steps step JOIN merchants merchant ON merchant.id = step.merchant_id WHERE step.course_id = $1', [id]);
      if (demo.rows.some(step => step.merchant_id === 'trial-showcase-practice')) throw new CourseError('COURSE_UNAVAILABLE');
      if (!this.includeDemo && demo.rows.some(step => step.is_demo)) throw new CourseError('COURSE_UNAVAILABLE');
      const course = await this.customerView(db, accountId, row, true);
      if (course.steps.some(step => step.state === 'UNAVAILABLE')) {
        if (course.unlockedAt) return { course, replayed: true };
        throw new CourseError('COURSE_UNAVAILABLE');
      }
      if (course.state === 'STALE' || course.state === 'IN_PROGRESS' || course.state === 'NOT_STARTED')
        throw new CourseError('COURSE_INCOMPLETE');
      const current = await this.entitlements(db, accountId, course.steps.map(step => step.merchantId), true);
      const proof = evaluateSteps(course.steps.map(step => ({ position: step.position, merchantId: step.merchantId,
        targetVisitCount: step.targetVisitCount })), current, row.counts_from);
      const evidence = course.steps.map((step, index) => ({ position: step.position,
        entitlementId: proof[index]!.entitlementId }));
      const inserted = await db.query(
        `INSERT INTO course_unlocks(account_id, course_id, evidence) VALUES ($1, $2, $3)
         ON CONFLICT (account_id, course_id) DO NOTHING`, [accountId, id, JSON.stringify({ steps: evidence })]);
      return { course: await this.customerView(db, accountId, row), replayed: inserted.rowCount === 0 };
    });
  }
}
