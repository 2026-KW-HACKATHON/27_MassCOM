import { RealWorldError, type Bounds, type LocationCandidate, type PlacePage } from './real-world-contract.js';
import type { NaverProvider } from './naver-provider.js';
import type { TmapProvider } from './tmap-provider.js';

const fallbackCodes = new Set(['MAP_NOT_CONFIGURED', 'MAP_AUTH_FAILED', 'MAP_TIMEOUT', 'MAP_RATE_LIMITED',
  'MAP_QUOTA_EXCEEDED', 'MAP_UPSTREAM_FAILED', 'MAP_INVALID_RESPONSE']);

export class MapProvider {
  constructor(private readonly tmap: TmapProvider, private readonly naver: NaverProvider) {}

  configuredGeocode() { return this.tmap.configured() || this.naver.configuredGeocode(); }
  configuredPlaces() { return this.tmap.configured() || this.naver.configuredPlaces(); }

  async geocode(address: string): Promise<LocationCandidate[]> {
    if (!this.tmap.configured()) return this.naver.geocode(address);
    try { return await this.tmap.geocode(address); }
    catch (error) {
      if (!(error instanceof RealWorldError) || !fallbackCodes.has(error.code) || !this.naver.configuredGeocode()) throw error;
      return this.naver.geocode(address);
    }
  }

  async places(input: { query: string; bounds?: Bounds; cursor?: string }): Promise<PlacePage> {
    if (!this.tmap.configured()) return this.naver.places(input);
    try { return await this.tmap.places(input); }
    catch (error) {
      if (!(error instanceof RealWorldError) || !fallbackCodes.has(error.code) || !this.naver.configuredPlaces() || input.cursor !== undefined) throw error;
      return this.naver.places(input);
    }
  }
}
