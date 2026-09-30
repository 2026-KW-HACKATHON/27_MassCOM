import type { Pool } from 'pg';
import type { CollectibleArtwork } from '../collectible-project.js';

import type {
  CollectionCollectible,
  CollectionReader,
  CollectionSnapshot,
  CollectionVisit,
  NftMintingMode,
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
  artwork: CollectibleArtwork | null;
  entitlement_id: string;
  merchant_id: string;
  merchant_name: string;
  campaign_id: string;
  campaign_title: string;
  target_visit_count: 1 | 3 | 5;
  display_name: string;
  entitlement_status: 'GRANTED' | 'MINT_REQUESTED' | 'FULFILLED';
  mint_job_id: string | null;
  mint_job_status:
    | 'QUEUED'
    | 'PREPARED'
    | 'SUBMITTED'
    | 'CONFIRMING'
    | 'FINALIZED'
    | 'RETRYABLE'
    | 'PAUSED'
    | 'MANUAL_REVIEW'
    | 'CANCELLED'
    | null;
  recipient_address: string | null;
  asset_chain_id: number | null;
  asset_contract_address: string | null;
  asset_token_id: string | null;
};

export class PostgresCollectionReader implements CollectionReader {
  constructor(private readonly pool: Pool, private readonly options: { nftMinting?: NftMintingMode } = {}) {}

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
           entitlement.status AS entitlement_status,
           job.id AS mint_job_id,
           job.status AS mint_job_status,
           job.recipient_address,
           asset.chain_id AS asset_chain_id,
           asset.contract_address AS asset_contract_address,
           asset.token_id::text AS asset_token_id,
           CASE WHEN acquisition.entitlement_id IS NULL THEN NULL ELSE jsonb_build_object(
             'projectId', acquisition.snapshot->'projectId', 'publicationId', acquisition.snapshot->'publicationId',
             'gradeId', acquisition.snapshot->'gradeId', 'gradeName', acquisition.snapshot->'gradeName',
             'shape', acquisition.snapshot->'shape', 'theme', acquisition.snapshot->'theme',
             'name', acquisition.snapshot->'name', 'thumbnailDataUrl', acquisition.snapshot->'thumbnailDataUrl'
           ) END AS artwork
         FROM reward_entitlements AS entitlement
         JOIN campaigns AS campaign ON campaign.id = entitlement.campaign_id
         JOIN merchants AS merchant ON merchant.id = campaign.merchant_id
         JOIN campaign_goals AS goal
           ON goal.campaign_id = entitlement.campaign_id
          AND goal.target_visit_count = entitlement.target_visit_count
         LEFT JOIN mint_jobs AS job ON job.entitlement_id = entitlement.id
         LEFT JOIN nft_assets AS asset ON asset.mint_job_id = job.id
         LEFT JOIN collectible_acquisitions AS acquisition ON acquisition.entitlement_id = entitlement.id
         WHERE entitlement.customer_account_id = $1
           AND entitlement.status IN ('GRANTED', 'MINT_REQUESTED', 'FULFILLED')
         ORDER BY entitlement.target_visit_count DESC, entitlement.id DESC`,
        [accountId],
      ),
    ]);

    return {
      visits: visits.rows.map(mapVisit),
      collectibles: collectibles.rows.map(mapCollectible),
      ...(this.options.nftMinting === 'PREPARING' ? { nftMinting: 'PREPARING' as const } : {}),
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
    ...(row.artwork ? { artwork: row.artwork } : {}),
    mintJobId: row.mint_job_id,
    recipient: row.recipient_address,
    nftStatus: nftStatusFor(row),
    nft:
      row.asset_chain_id !== null &&
      row.asset_contract_address !== null &&
      row.asset_token_id !== null
        ? {
            chainId: row.asset_chain_id,
            contractAddress: row.asset_contract_address,
            tokenId: row.asset_token_id,
          }
        : null,
  };
}

function nftStatusFor(row: CollectibleRow): CollectionCollectible['nftStatus'] {
  if (row.entitlement_status === 'GRANTED') return 'NOT_REQUESTED';
  if (row.mint_job_status === 'FINALIZED' && row.asset_token_id !== null) return 'FINALIZED';
  if (row.mint_job_status === 'SUBMITTED' || row.mint_job_status === 'CONFIRMING') {
    return 'CONFIRMING';
  }
  if (
    row.mint_job_status === 'QUEUED' ||
    row.mint_job_status === 'PREPARED' ||
    row.mint_job_status === 'RETRYABLE'
  ) {
    return 'QUEUED';
  }
  return 'REVIEW_REQUIRED';
}
