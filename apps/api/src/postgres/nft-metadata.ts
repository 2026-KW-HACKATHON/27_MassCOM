import type { Pool } from 'pg';

import type { NftMetadataReader } from '../nft-metadata.js';

export class PostgresNftMetadataReader implements NftMetadataReader {
  constructor(private readonly pool: Pool) {}

  async findTokenMetadata(seriesId: string, tokenId: string): Promise<string | null> {
    const found = await this.pool.query<{ metadata_json: string }>(
      'SELECT metadata_json FROM nft_token_metadata WHERE nft_series_id = $1 AND token_id = $2::numeric',
      [seriesId, tokenId],
    );
    return found.rows[0]?.metadata_json ?? null;
  }

  async findImage(sha256: string): Promise<Buffer | null> {
    const found = await this.pool.query<{ image: Buffer }>(
      'SELECT image FROM nft_metadata_images WHERE sha256 = $1',
      [sha256],
    );
    return found.rows[0]?.image ?? null;
  }
}
