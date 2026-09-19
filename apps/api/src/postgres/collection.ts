import type { Pool } from 'pg';

import type {
  CollectionCollectible,
  CollectionReader,
  CollectionSnapshot,
  CollectionVisit,
} from '../collection.js';

type VisitRow = {
  visit_event_id: string;
  merchant_id: string;
  merchant_name: string;
  campaign_id: string;
  campaign_title: string;
  business_date: string;
  progress_counted: boolean;
  verification_level: 'MERCHANT_CONFIRMED' | 'POS_VERIFIED';
};

type CollectibleRow = {
  entitlement_id: string;
  merchant_id: string;
  merchant_name: string;
  campaign_id: string;
  campaign_title: string;
  target_visit_count: 1 | 3 | 5;
  display_name: string;
  entitlement_status: 'GRANTED' | 'MINT_REQUESTED' | 'FULFILLED';
};

export class PostgresCollectionReader implements CollectionReader {
  constructor(private readonly pool: Pool) {}

  async getCollection(accountId: string): Promise<CollectionSnapshot> {
    const [visits, collectibles] = await Promise.all([
      this.pool.query<VisitRow>(
        `SELECT
           visit.id AS visit_event_id,
           visit.merchant_id,
           merchant.name AS merchant_name,
           visit.campaign_id,
           campaign.title AS campaign_title,
           visit.business_date::text,
           visit.progress_counted,
           visit.verification_level
         FROM visit_events AS visit
         JOIN merchants AS merchant ON merchant.id = visit.merchant_id
         JOIN campaigns AS campaign ON campaign.id = visit.campaign_id
         WHERE visit.customer_account_id = $1
           AND visit.status = 'VALID'
         ORDER BY visit.business_date DESC, visit.id DESC`,
        [accountId],
      ),
      this.pool.query<CollectibleRow>(
        `SELECT
           entitlement.id AS entitlement_id,
           campaign.merchant_id,
           merchant.name AS merchant_name,
           entitlement.campaign_id,
           campaign.title AS campaign_title,
           entitlement.target_visit_count,
           goal.display_name,
           entitlement.status AS entitlement_status
         FROM reward_entitlements AS entitlement
         JOIN campaigns AS campaign ON campaign.id = entitlement.campaign_id
         JOIN merchants AS merchant ON merchant.id = campaign.merchant_id
         JOIN campaign_goals AS goal
           ON goal.campaign_id = entitlement.campaign_id
          AND goal.target_visit_count = entitlement.target_visit_count
         WHERE entitlement.customer_account_id = $1
           AND entitlement.status IN ('GRANTED', 'MINT_REQUESTED', 'FULFILLED')
         ORDER BY entitlement.target_visit_count DESC, entitlement.id DESC`,
        [accountId],
      ),
    ]);

    return {
      visits: visits.rows.map(mapVisit),
      collectibles: collectibles.rows.map(mapCollectible),
    };
  }
}

function mapVisit(row: VisitRow): CollectionVisit {
  return {
    visitEventId: row.visit_event_id,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    campaignId: row.campaign_id,
    campaignTitle: row.campaign_title,
    businessDate: row.business_date,
    progressCounted: row.progress_counted,
    verificationLevel: row.verification_level,
  };
}

function mapCollectible(row: CollectibleRow): CollectionCollectible {
  return {
    entitlementId: row.entitlement_id,
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    campaignId: row.campaign_id,
    campaignTitle: row.campaign_title,
    targetVisitCount: row.target_visit_count,
    displayName: row.display_name,
    appCollectibleStatus: 'COLLECTED',
    nftStatus: nftStatusFor(row.entitlement_status),
  };
}

function nftStatusFor(
  status: CollectibleRow['entitlement_status'],
): CollectionCollectible['nftStatus'] {
  if (status === 'MINT_REQUESTED') return 'REQUESTED';
  if (status === 'FULFILLED') return 'FULFILLED';
  return 'NOT_REQUESTED';
}
