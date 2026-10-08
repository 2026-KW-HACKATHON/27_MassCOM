import type { Pool } from 'pg';
import type { CourseService } from '../course-rules.js';
import { safeErrorMetadata } from '../security-log.js';
import type { CourseNextHint } from './courses.js';

import type {
  RecommendationCandidate,
  RecommendationSource,
} from '../recommendation-service.js';
import { parseRewardGoals } from './merchant-catalog.js';

type RecommendationRow = {
  merchant_id: string;
  merchant_name: string;
  road_address: string;
  is_demo: boolean;
  campaign_id: string;
  campaign_title: string;
  enrollment_open: boolean;
  progress_visit_count: number;
  reward_goals: unknown;
};

export class PostgresRecommendationSource implements RecommendationSource {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
    private readonly courses?: Pick<CourseService, 'list'> & { listHints?: (accountId: string) => Promise<CourseNextHint[]> },
  ) {}

  async listCandidates(accountId: string): Promise<readonly RecommendationCandidate[]> {
    let inProgress: CourseNextHint[] = [];
    try {
      inProgress = this.courses?.listHints ? await this.courses.listHints(accountId) :
        (await this.courses?.list(accountId) ?? [])
          .filter(course => course.done > 0 && course.done < course.total)
          .flatMap(course => {
            const next = course.steps.find(step => !step.done);
            return next && next.state !== 'UNAVAILABLE' ? [{ id: course.id, title: course.title, situation: course.situation,
              done: course.done, total: course.total, startsAt: course.startsAt,
              nextMerchantId: next.merchantId, nextGoal: next.targetVisitCount }] : [];
          });
    } catch (error) { console.error(safeErrorMetadata('recommendation.course_hints', error)); }
    inProgress.sort((left, right) => (left.total - left.done) - (right.total - right.done) ||
      (left.startsAt ? Date.parse(left.startsAt) : 0) - (right.startsAt ? Date.parse(right.startsAt) : 0) ||
      left.id.localeCompare(right.id));
    const result = await this.pool.query<RecommendationRow>(
      `SELECT
         merchant.id AS merchant_id,
         merchant.name AS merchant_name,
         merchant.road_address,
         merchant.is_demo,
         campaign.id AS campaign_id,
         campaign.title AS campaign_title,
         campaign.enrolled_count < campaign.enrollment_capacity AS enrollment_open,
         count(DISTINCT visit.business_date)::integer AS progress_visit_count,
         jsonb_agg(
           DISTINCT jsonb_build_object(
             'targetVisitCount', goal.target_visit_count,
             'displayName', goal.display_name
           )
         ) AS reward_goals
       FROM merchants AS merchant
       JOIN campaigns AS campaign ON campaign.merchant_id = merchant.id
       JOIN campaign_goals AS goal ON goal.campaign_id = campaign.id
       LEFT JOIN visit_events AS visit
         ON visit.campaign_id = campaign.id
        AND visit.customer_account_id = $1
        AND visit.status = 'VALID'
        AND visit.progress_counted = true
       WHERE merchant.status = 'ACTIVE'
         AND merchant.id <> 'trial-showcase-practice'
         AND campaign.status = 'ACTIVE'
         AND campaign.is_public = true
         -- 로그인 없는 체험 가게(#309)는 누구의 추천에도 나오지 않는다(D-064).
         AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials trial WHERE trial.merchant_id = merchant.id)
         AND campaign.starts_at <= $2
         AND campaign.ends_at > $2
       GROUP BY merchant.id, campaign.id
       HAVING array_agg(DISTINCT goal.target_visit_count ORDER BY goal.target_visit_count) = ARRAY[1, 3, 5]::integer[]
         OR merchant.id = ANY($3::text[])
       ORDER BY merchant.id`,
      [accountId, this.now(), inProgress.map(course => course.nextMerchantId)],
    );

    return result.rows.flatMap((row) => {
      const goals = [...parseRewardGoals(row.reward_goals)].sort(
        (left, right) => left.targetVisitCount - right.targetVisitCount);
      const course = inProgress.find(course => course.nextMerchantId === row.merchant_id &&
        goals.some(goal => goal.targetVisitCount === course.nextGoal));
      if (!course && goals.map(goal => goal.targetVisitCount).join(',') !== '1,3,5') return [];
      return {
        merchantId: row.merchant_id,
        merchantName: row.merchant_name,
        roadAddress: row.road_address,
        campaignId: row.campaign_id,
        campaignTitle: row.campaign_title,
        enrollmentStatus: row.enrollment_open ? 'OPEN' : 'FULL',
        progressVisitCount: row.progress_visit_count,
        rewardGoals: goals,
        demo: row.is_demo,
        ...(course ? {
          courseHint: { courseId: course.id, title: course.title, situation: course.situation, done: course.done, total: course.total },
          courseStartsAt: course.startsAt,
        } : {}),
      };
    });
  }
}
