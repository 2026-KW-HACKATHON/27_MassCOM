// Issue #330: 점주 웹 "가게 현황"의 읽기 전용 집계. 쓰기는 하지 않고, 한 번의 REPEATABLE READ READ ONLY 거래 안에서 읽어
// 카드 숫자들과 체크리스트가 같은 시점의 값이 되게 한다. 규칙(날짜 경계·비교·체크리스트)은 merchant-overview-rules.ts에 있다.
import type { Pool, PoolClient } from 'pg';

import {
  MerchantOverviewError, buildComparison, buildDailySeries, buildReadiness, campaignPhase, kstMidnight, overviewPeriods,
  selectRelevantCampaign,
  type CampaignFacts, type CampaignStatus, type MerchantFacts, type MerchantOverview, type MerchantOverviewReader,
} from '../merchant-overview-rules.js';
import { countedVisitFilterSql, countedVisitFromSql } from './badge-rewards.js';

type MerchantRow = {
  name: string;
  road_address: string;
  business_hours: string;
  menu_count: number;
  status: 'ACTIVE' | 'PAUSED';
  published_at: Date | null;
  guest_trial: boolean;
};

type CampaignRow = {
  id: string;
  title: string;
  status: CampaignStatus;
  is_public: boolean;
  starts_at: Date;
  ends_at: Date;
  goals: number[];
  collectible_linked: boolean;
};

type VisitTotalsRow = {
  today: number;
  this_week: number;
  last_week: number;
  last_week_same_span: number;
  total: number;
  repeat_visitors: number;
};

export class PostgresMerchantOverviewService implements MerchantOverviewReader {
  constructor(
    private readonly pool: Pool,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async overview(input: { merchantId: string }): Promise<MerchantOverview> {
    const now = this.now();
    const periods = overviewPeriods(now);
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const merchant = await this.readMerchant(client, input.merchantId);
      if (!merchant) throw new MerchantOverviewError('MERCHANT_NOT_FOUND');
      const members = await client.query<{ owners: number; staff: number }>(
        `SELECT count(*) FILTER (WHERE role = 'OWNER')::integer AS owners,
                count(*) FILTER (WHERE role = 'STAFF')::integer AS staff
         FROM merchant_members
         WHERE merchant_id = $1 AND status = 'ACTIVE'`,
        [input.merchantId],
      );
      const campaigns = await this.readCampaigns(client, input.merchantId);
      // 방문은 배지·마일리지와 같은 "세어지는 방문"만 센다(badge-rewards.ts countedVisitFilterSql): 취소된 방문,
      // 같은 날 두 번째 방문(progress_counted = false), 실제 점포의 직원 본인 적립, 체험 가게 방문은 빠진다.
      const totals = await client.query<VisitTotalsRow>(
        `WITH counted AS (
           SELECT visit.customer_account_id, visit.business_date
           ${countedVisitFromSql}
           WHERE visit.merchant_id = $1 AND ${countedVisitFilterSql}
         )
         SELECT
           count(*) FILTER (WHERE business_date = $2::date)::integer AS today,
           count(*) FILTER (WHERE business_date >= $3::date AND business_date <= $2::date)::integer AS this_week,
           count(*) FILTER (WHERE business_date >= $4::date AND business_date < $3::date)::integer AS last_week,
           count(*) FILTER (WHERE business_date >= $4::date AND business_date <= $5::date)::integer AS last_week_same_span,
           count(*)::integer AS total,
           (SELECT count(*) FROM (
              SELECT 1 FROM counted GROUP BY customer_account_id HAVING count(*) >= 2
            ) AS repeaters)::integer AS repeat_visitors
         FROM counted`,
        [input.merchantId, periods.today, periods.thisWeekStart, periods.lastWeekStart, periods.lastWeekSameSpanEnd],
      );
      const days = await client.query<{ date: string; count: number }>(
        `SELECT visit.business_date::text AS date, count(*)::integer AS count
         ${countedVisitFromSql}
         WHERE visit.merchant_id = $1 AND ${countedVisitFilterSql}
           AND visit.business_date >= $2::date AND visit.business_date <= $3::date
         GROUP BY visit.business_date`,
        [input.merchantId, periods.sevenDayStart, periods.today],
      );
      // 쿠폰 사용 되돌리기는 redeemed_at을 비우므로 status = 'REDEEMED'인 행만 센다. 이번 주 = 월요일 00:00 KST 이상 다음 월요일 미만.
      const coupons = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM badge_coupons
         WHERE merchant_id = $1 AND status = 'REDEEMED' AND redeemed_at >= $2 AND redeemed_at < $3`,
        [input.merchantId, kstMidnight(periods.thisWeekStart), kstMidnight(periods.nextWeekStart)],
      );
      await client.query('COMMIT');

      const counts = totals.rows[0]!;
      const merchantFacts: MerchantFacts = {
        name: merchant.name, roadAddress: merchant.road_address, businessHours: merchant.business_hours,
        menuItemCount: merchant.menu_count, status: merchant.status, publishedAt: merchant.published_at,
        guestTrial: merchant.guest_trial,
      };
      const selected = selectRelevantCampaign(campaigns, now);
      return {
        generatedAt: now.toISOString(),
        businessDate: periods.today,
        weekStartsOn: periods.thisWeekStart,
        visits: {
          today: counts.today,
          thisWeek: counts.this_week,
          lastWeek: counts.last_week,
          last7Days: buildDailySeries(days.rows, periods.today),
          total: counts.total,
        },
        comparison: buildComparison({
          publishedAt: merchant.published_at, now, thisWeek: counts.this_week, lastWeekSameSpan: counts.last_week_same_span,
        }),
        couponsRedeemedThisWeek: coupons.rows[0]!.count,
        repeatVisitors: counts.repeat_visitors,
        campaign: selected && {
          title: selected.title,
          status: selected.status,
          isPublic: selected.isPublic,
          startsAt: selected.startsAt.toISOString(),
          endsAt: selected.endsAt.toISOString(),
          phase: campaignPhase(selected, now),
        },
        readiness: buildReadiness({
          now, merchant: merchantFacts, owners: members.rows[0]!.owners, staff: members.rows[0]!.staff, campaigns,
        }),
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true; // 되돌리기마저 실패한 연결은 풀에 돌려주지 않고 버린다.
      }
      throw error;
    } finally {
      client.release(broken);
    }
  }

  private async readMerchant(client: PoolClient, merchantId: string): Promise<MerchantRow | undefined> {
    const result = await client.query<MerchantRow>(
      `SELECT merchant.name, merchant.road_address, merchant.business_hours,
              jsonb_array_length(merchant.menu_items)::integer AS menu_count,
              merchant.status, merchant.published_at,
              -- 로그인 없는 체험 가게(#309)는 공개 목록에 나오지 않는다. 운영 DB는 이 표가 비어 있다.
              EXISTS (SELECT 1 FROM showcase_guest_trials AS trial WHERE trial.merchant_id = merchant.id) AS guest_trial
       FROM merchants AS merchant
       WHERE merchant.id = $1`,
      [merchantId],
    );
    return result.rows[0];
  }

  private async readCampaigns(client: PoolClient, merchantId: string): Promise<CampaignFacts[]> {
    const result = await client.query<CampaignRow>(
      `SELECT campaign.id, campaign.title, campaign.status, campaign.is_public, campaign.starts_at, campaign.ends_at,
              coalesce((SELECT array_agg(goal.target_visit_count ORDER BY goal.target_visit_count)
                        FROM campaign_goals AS goal WHERE goal.campaign_id = campaign.id), ARRAY[]::integer[]) AS goals,
              EXISTS (SELECT 1 FROM campaign_collectible_publications AS link
                      WHERE link.campaign_id = campaign.id) AS collectible_linked
       FROM campaigns AS campaign
       WHERE campaign.merchant_id = $1
       ORDER BY campaign.starts_at DESC, campaign.id`,
      [merchantId],
    );
    return result.rows.map(row => ({
      id: row.id, title: row.title, status: row.status, isPublic: row.is_public,
      startsAt: row.starts_at, endsAt: row.ends_at, goals: row.goals, collectibleLinked: row.collectible_linked,
    }));
  }
}
