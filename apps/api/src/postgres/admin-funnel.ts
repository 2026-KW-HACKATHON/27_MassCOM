import type { Pool } from 'pg';

import type { AdminFunnel, AdminFunnelReader, AdminFunnelMerchant } from '../admin-funnel.js';
import { kstDateOf, kstMidnight } from '../merchant-overview-rules.js';
import { countedVisitFilterSql, countedVisitFromSql } from './badge-rewards.js';

type MerchantRow = { id: string; name: string };
type VisitRow = { merchant_id: string; counted_visits: number; unique_visitors: number; repeat_visitors: number };
type AmountRow = { merchant_id: string; amount: number };
type NewVisitorRow = { new_visitors: number; second_store: number; repeat_visitors: number };

export class PostgresAdminFunnelService implements AdminFunnelReader {
  constructor(private readonly pool: Pool, private readonly now: () => Date = () => new Date()) {}

  async funnel(days: number): Promise<AdminFunnel> {
    if (!Number.isInteger(days) || days < 7 || days > 90) throw new RangeError('days must be an integer from 7 to 90');
    const to = kstDateOf(this.now());
    const from = kstDateOf(new Date(kstMidnight(to).getTime() - (days - 1) * 86_400_000));
    const next = new Date(kstMidnight(to).getTime() + 86_400_000);
    const start = kstMidnight(from);
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5s'");
      const merchants = await client.query<MerchantRow>(
        `SELECT id, name FROM merchants WHERE NOT is_demo
         AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials WHERE merchant_id = merchants.id)
         ORDER BY name, id`,
      );
      const visits = await client.query<VisitRow>(
        `WITH counted AS (
           SELECT visit.merchant_id, visit.customer_account_id, visit.business_date
           ${countedVisitFromSql}
           WHERE NOT merchant.is_demo AND ${countedVisitFilterSql}
             AND visit.business_date BETWEEN $1::date AND $2::date
         ), by_customer AS (
           SELECT merchant_id, customer_account_id, count(*)::integer AS visits,
                  count(DISTINCT business_date)::integer AS days
           FROM counted GROUP BY merchant_id, customer_account_id
         )
         SELECT merchant_id, sum(visits)::integer AS counted_visits,
                count(*)::integer AS unique_visitors,
                count(*) FILTER (WHERE days >= 2)::integer AS repeat_visitors
         FROM by_customer GROUP BY merchant_id`, [from, to],
      );
      // 첫 방문 날짜는 창 밖의 과거까지 본다. 두 번째 가게와 재방문은 창 안의 실제 점포 방문만 본다.
      const people = await client.query<NewVisitorRow>(
        `WITH counted AS (
           SELECT visit.merchant_id, visit.customer_account_id, visit.business_date
           ${countedVisitFromSql}
           WHERE NOT merchant.is_demo AND ${countedVisitFilterSql}
             AND visit.business_date <= $2::date
         ), by_customer AS (
           SELECT customer_account_id, min(business_date) AS first_date,
                  count(DISTINCT merchant_id) FILTER (WHERE business_date >= $1::date)::integer AS stores
           FROM counted GROUP BY customer_account_id
         ), repeaters AS (
           SELECT DISTINCT customer_account_id FROM counted
           WHERE business_date >= $1::date
           GROUP BY customer_account_id, merchant_id
           HAVING count(DISTINCT business_date) >= 2
         )
         SELECT count(*) FILTER (WHERE first_date >= $1::date)::integer AS new_visitors,
                count(*) FILTER (WHERE first_date >= $1::date AND stores >= 2)::integer AS second_store,
                (SELECT count(*)::integer FROM repeaters) AS repeat_visitors
         FROM by_customer`, [from, to],
      );
      const views = await client.query<AmountRow>(
        `SELECT detail.merchant_id, sum(detail.views)::integer AS amount
         FROM merchant_detail_view_counts AS detail JOIN merchants AS merchant ON merchant.id = detail.merchant_id
         WHERE NOT merchant.is_demo AND detail.business_date BETWEEN $1::date AND $2::date
           AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials WHERE merchant_id = merchant.id)
         GROUP BY detail.merchant_id`, [from, to],
      );
      const issued = await client.query<AmountRow>(
        `SELECT coupon.merchant_id, count(*)::integer AS amount
         FROM badge_coupons AS coupon JOIN merchants AS merchant ON merchant.id = coupon.merchant_id
         WHERE NOT merchant.is_demo AND coupon.issued_at >= $1 AND coupon.issued_at < $2
           AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials WHERE merchant_id = merchant.id)
         GROUP BY coupon.merchant_id`, [start, next],
      );
      const redeemed = await client.query<AmountRow>(
        `SELECT coupon.merchant_id, count(*)::integer AS amount
         FROM badge_coupons AS coupon JOIN merchants AS merchant ON merchant.id = coupon.merchant_id
         WHERE NOT merchant.is_demo AND coupon.status = 'REDEEMED'
           AND coupon.redeemed_at >= $1 AND coupon.redeemed_at < $2
           AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials WHERE merchant_id = merchant.id)
         GROUP BY coupon.merchant_id`, [start, next],
      );
      const acquired = await client.query<AmountRow>(
        `SELECT publication.merchant_id, count(*)::integer AS amount
         FROM collectible_acquisitions AS acquisition
         JOIN collectible_publications AS publication ON publication.id = acquisition.publication_id
         JOIN merchants AS merchant ON merchant.id = publication.merchant_id
         WHERE NOT merchant.is_demo AND acquisition.acquired_at >= $1 AND acquisition.acquired_at < $2
           AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials WHERE merchant_id = merchant.id)
         GROUP BY publication.merchant_id`, [start, next],
      );
      await client.query('COMMIT');

      const amounts = (rows: AmountRow[]) => new Map(rows.map(row => [row.merchant_id, row.amount]));
      const visitByMerchant = new Map(visits.rows.map(row => [row.merchant_id, row]));
      const viewByMerchant = amounts(views.rows);
      const issuedByMerchant = amounts(issued.rows);
      const redeemedByMerchant = amounts(redeemed.rows);
      const acquiredByMerchant = amounts(acquired.rows);
      const result: AdminFunnelMerchant[] = merchants.rows.map(merchant => ({
        merchantId: merchant.id, name: merchant.name,
        detailViews: viewByMerchant.get(merchant.id) ?? 0,
        countedVisits: visitByMerchant.get(merchant.id)?.counted_visits ?? 0,
        uniqueVisitors: visitByMerchant.get(merchant.id)?.unique_visitors ?? 0,
        repeatVisitors: visitByMerchant.get(merchant.id)?.repeat_visitors ?? 0,
        couponsIssued: issuedByMerchant.get(merchant.id) ?? 0,
        couponsRedeemed: redeemedByMerchant.get(merchant.id) ?? 0,
        collectiblesAcquired: acquiredByMerchant.get(merchant.id) ?? 0,
      }));
      const sum = (field: 'detailViews' | 'countedVisits') => result.reduce((total, row) => total + row[field], 0);
      return {
        from, to, days,
        totals: {
          detailViews: sum('detailViews'), countedVisits: sum('countedVisits'),
          newVisitors: people.rows[0]!.new_visitors,
          newVisitorsWithSecondStore: people.rows[0]!.second_store,
          repeatVisitors: people.rows[0]!.repeat_visitors,
        },
        merchants: result,
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally {
      client.release(broken);
    }
  }
}
