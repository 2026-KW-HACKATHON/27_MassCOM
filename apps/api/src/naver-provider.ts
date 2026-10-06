import { createHash } from 'node:crypto';
import { RealWorldError, type Bounds, type ExternalPlace, type LocationCandidate, type PlacePage, type Point } from './real-world-contract.js';

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const str = (value: unknown): string => typeof value === 'string' ? value : '';
const num = (value: unknown): number => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
const point = (latitude: unknown, longitude: unknown): Point | null => {
  const lat = num(latitude), lon = num(longitude);
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180 ? { latitude: lat, longitude: lon } : null;
};
const invalid = (): never => { throw new RealWorldError('MAP_INVALID_RESPONSE', 502, true); };
const TTL = 3_600_000;

export class NaverProvider {
  private readonly mapsId: string;
  private readonly mapsSecret: string;
  private readonly searchId: string;
  private readonly searchSecret: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly dailyLimit: number;
  private day = '';
  private used = 0;

  constructor(options: { mapsId?: string; mapsSecret?: string; searchId?: string; searchSecret?: string;
    fetch?: typeof fetch; now?: () => Date; timeoutMs?: number; dailyLimit?: number } = {}) {
    this.mapsId = options.mapsId?.trim() ?? '';
    this.mapsSecret = options.mapsSecret?.trim() ?? '';
    this.searchId = options.searchId?.trim() ?? '';
    this.searchSecret = options.searchSecret?.trim() ?? '';
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.dailyLimit = options.dailyLimit ?? 900;
    if (!Number.isInteger(this.dailyLimit) || this.dailyLimit < 1 || !Number.isFinite(this.timeoutMs) || this.timeoutMs < 1) throw Error('Invalid NAVER limits');
  }

  configuredGeocode() { return !!this.mapsId && !!this.mapsSecret; }
  configuredPlaces() { return !!this.searchId && !!this.searchSecret; }

  private stamp() {
    const fetchedAt = this.now().toISOString();
    return { fetchedAt, expiresAt: new Date(Date.parse(fetchedAt) + TTL).toISOString() };
  }

  private async request(url: string, headers: Record<string, string>): Promise<unknown> {
    const day = this.now().toISOString().slice(0, 10);
    if (day !== this.day) { this.day = day; this.used = 0; }
    if (this.used >= this.dailyLimit) throw new RealWorldError('MAP_QUOTA_EXCEEDED', 429, true);
    this.used++;
    try {
      const response = await this.fetcher(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.status === 429) throw new RealWorldError('MAP_RATE_LIMITED', 503, true);
      if (response.status === 401 || response.status === 403) throw new RealWorldError('MAP_AUTH_FAILED', 503);
      if (!response.ok) throw new RealWorldError('MAP_UPSTREAM_FAILED', 502, response.status >= 500);
      return await response.json() as unknown;
    } catch (error) {
      if (error instanceof RealWorldError) throw error;
      throw new RealWorldError(error instanceof Error && error.name === 'TimeoutError' ? 'MAP_TIMEOUT' : 'MAP_UPSTREAM_FAILED', 503, true);
    }
  }

  async geocode(address: string): Promise<LocationCandidate[]> {
    const query = address.trim();
    if (!query || query.length > 200) throw new RealWorldError('INVALID_ADDRESS');
    if (!this.configuredGeocode()) throw new RealWorldError('MAP_NOT_CONFIGURED', 503);
    const params = new URLSearchParams({ query, page: '1', count: '20' });
    const data = obj(await this.request(`https://maps.apigw.ntruss.com/map-geocode/v2/geocode?${params}`, {
      'x-ncp-apigw-api-key-id': this.mapsId, 'x-ncp-apigw-api-key': this.mapsSecret,
    }));
    if (data.status !== 'OK' || !Array.isArray(data.addresses)) return invalid();
    const stamp = this.stamp();
    return data.addresses.flatMap((value: unknown, index: number): LocationCandidate[] => {
      const row = obj(value), location = point(row.y, row.x);
      if (!location) return [];
      const id = `address:${createHash('sha256').update(`${query}:${index}`).digest('hex').slice(0, 12)}`;
      return [{ id, candidateId: id, provider: 'NAVER', participation: 'EXTERNAL_PLACE',
        name: str(row.roadAddress) || str(row.jibunAddress) || query,
        roadAddress: str(row.roadAddress) || str(row.jibunAddress) || query,
        point: location, entrance: null, ...stamp }];
    });
  }

  async places({ query, bounds, cursor }: { query: string; bounds?: Bounds; cursor?: string }): Promise<PlacePage> {
    const keyword = query.trim();
    if (!keyword || keyword.length > 100) throw new RealWorldError('INVALID_QUERY');
    if (cursor !== undefined) throw new RealWorldError('INVALID_CURSOR');
    if (bounds && (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) ||
      Math.abs(bounds.west) > 180 || Math.abs(bounds.east) > 180 || Math.abs(bounds.south) > 90 || Math.abs(bounds.north) > 90 ||
      bounds.west > bounds.east || bounds.south > bounds.north)) throw new RealWorldError('INVALID_BOUNDS');
    if (!this.configuredPlaces()) throw new RealWorldError('MAP_NOT_CONFIGURED', 503);
    const params = new URLSearchParams({ query: keyword, display: '5' });
    const data = obj(await this.request(`https://openapi.naver.com/v1/search/local.json?${params}`, {
      'X-Naver-Client-Id': this.searchId, 'X-Naver-Client-Secret': this.searchSecret,
    }));
    if (!Array.isArray(data.items)) return invalid();
    const stamp = this.stamp();
    const places = data.items.flatMap((value: unknown): ExternalPlace[] => {
      const row = obj(value), x = num(row.mapx), y = num(row.mapy);
      const location = Number.isInteger(x) && Number.isInteger(y) ? point(y / 10_000_000, x / 10_000_000) : null;
      const name = str(row.title).replace(/<[^>]*>/g, '').trim();
      if (!location || !name || bounds && (location.longitude < bounds.west || location.longitude > bounds.east ||
        location.latitude < bounds.south || location.latitude > bounds.north)) return [];
      const roadAddress = str(row.roadAddress) || str(row.address);
      const id = `place:${createHash('sha256').update(`${name}:${x}:${y}:${roadAddress}`).digest('hex').slice(0, 16)}`;
      return [{ id, provider: 'NAVER', participation: 'EXTERNAL_PLACE', name, roadAddress,
        point: location, entrance: null, ...stamp }];
    });
    return { places, nextCursor: null, ...stamp, attribution: 'NAVER' };
  }
}
