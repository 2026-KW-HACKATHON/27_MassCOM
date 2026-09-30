import type { Pool } from 'pg';

import type { NftMetadataReader } from '../nft-metadata.js';

export class PostgresNftMetadataReader implements NftMetadataReader {
  constructor(private readonly pool: Pool) {}

  async findTokenMetadata(seriesId: string, tokenId: string): Promise<string | null> {
    const found = await this.pool.query<{ metadata_json: string }>(
      `SELECT metadata.metadata_json FROM nft_token_metadata AS metadata
       WHERE metadata.nft_series_id = $1 AND metadata.token_id = $2::numeric
         AND NOT EXISTS (SELECT 1 FROM nft_metadata_takedowns AS takedown
                         WHERE takedown.target = 'asset:' || metadata.nft_asset_id::text)`,
      [seriesId, tokenId],
    );
    return found.rows[0]?.metadata_json ?? null;
  }

  async findImage(sha256: string): Promise<Buffer | null> {
    const found = await this.pool.query<{ image: Buffer }>(
      `SELECT image FROM nft_metadata_images
       WHERE sha256 = $1
         AND NOT EXISTS (SELECT 1 FROM nft_metadata_takedowns WHERE target = 'image:' || $1)`,
      [sha256],
    );
    return found.rows[0]?.image ?? null;
  }
}
