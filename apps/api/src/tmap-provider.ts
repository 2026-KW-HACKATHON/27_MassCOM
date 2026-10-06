import { createHash } from 'node:crypto';
import { RealWorldError, type Bounds, type ExternalPlace, type LocationCandidate, type PlacePage, type Point, type WalkingLeg } from './real-world-contract.js';

const BASE = 'https://apis.openapi.sk.com/tmap';
const TTL = 3_600_000;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const num = (v: unknown): number => typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
const str = (v: unknown): string => typeof v === 'string' ? v : '';
const point = (lat: unknown, lon: unknown): Point | null => {
  const latitude = num(lat), longitude = num(lon);
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
};
const invalid = (): never => { throw new RealWorldError('MAP_INVALID_RESPONSE', 502, true); };
export function toTmapPoint(p: Point) { if (!point(p.latitude, p.longitude)) throw new RealWorldError('INVALID_POINT'); return { x: p.longitude, y: p.latitude }; }
export function parseWalkingResponse(value: unknown): WalkingLeg {
  const root = obj(value);
  if (root.type !== 'FeatureCollection' || !Array.isArray(root.features)) return invalid();
  const features = root.features.map(obj);
  const start = features.find(f => obj(f.properties).pointType === 'SP');
  if (!start || !features.some(f => obj(f.properties).pointType === 'EP')) return invalid();
  const properties = obj(start.properties), travelMeters = num(properties.totalDistance), travelSeconds = num(properties.totalTime);
  if (!Number.isFinite(travelMeters) || travelMeters < 0 || !Number.isFinite(travelSeconds) || travelSeconds < 0) return invalid();
  const coordinates = features.filter(f => obj(f.geometry).type === 'LineString').map(f => {
    const raw = obj(f.geometry).coordinates;
    if (!Array.isArray(raw) || raw.length < 2) return invalid();
    return raw.map((pair: unknown) => {
      if (!Array.isArray(pair) || pair.length < 2 || !point(pair[1], pair[0])) return invalid();
      return [num(pair[0]), num(pair[1])];
    });
  });
  if (!coordinates.length) return invalid();
  return { mode: 'WALK', provider: 'TMAP', geometry: { type: 'MultiLineString', coordinates }, travelSeconds, travelMeters,
    fetchedAt: '', expiresAt: '', attribution: 'TMAP' };
}
export class TmapProvider {
  private key: string;
  private fetcher: typeof fetch;
  private now: () => Date;
  private timeoutMs: number;
  private limit: number;
  private quotaDay = '';
  private used = 0;
  private cache = new Map<string, { expires: number; data: unknown; fetchedAt: string }>();
  constructor(options: { appKey?: string; fetch?: typeof fetch; now?: () => Date; timeoutMs?: number; dailyLimit?: number } = {}) {
    this.key = options.appKey?.trim() ?? '';
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.limit = options.dailyLimit ?? 900;
    if (!Number.isInteger(this.limit) || this.limit < 1 || !Number.isFinite(this.timeoutMs) || this.timeoutMs < 1) throw Error('Invalid TMAP limits');
  }
  configured() { return !!this.key; }
  private stamp(fetchedAt: string) { return { fetchedAt, expiresAt: new Date(Date.parse(fetchedAt) + TTL).toISOString() }; }
  private async request(path: string, cacheKey: string, init?: RequestInit): Promise<{ data: unknown; fetchedAt: string }> {
    if (!this.configured()) throw new RealWorldError('MAP_NOT_CONFIGURED', 503);
    const now = this.now().getTime(), cached = this.cache.get(cacheKey);
    if (cached && cached.expires > now) return { data: cached.data, fetchedAt: cached.fetchedAt };
    const day = this.now().toISOString().slice(0, 10);
    if (day !== this.quotaDay) { this.quotaDay = day; this.used = 0; }
    if (this.used >= this.limit) throw new RealWorldError('MAP_QUOTA_EXCEEDED', 429, true);
    this.used++;
    try {
      const response = await this.fetcher(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Accept: 'application/json', appKey: this.key, ...init?.headers } });
      if (response.status === 429) throw new RealWorldError('MAP_RATE_LIMITED', 503, true);
      if (response.status === 401 || response.status === 403) throw new RealWorldError('MAP_AUTH_FAILED', 503);
      if (!response.ok) throw new RealWorldError('MAP_UPSTREAM_FAILED', 502, response.status >= 500);
      const data: unknown = await response.json();
      const fetchedAt = this.now().toISOString();
      this.cache.set(cacheKey, { data, fetchedAt, expires: now + TTL });
      if (this.cache.size > 200) for (const [k, entry] of this.cache) if (entry.expires <= now || this.cache.size > 200) this.cache.delete(k);
      return { data, fetchedAt };
    } catch (e) {
      if (e instanceof RealWorldError) throw e;
      throw new RealWorldError(e instanceof Error && e.name === 'TimeoutError' ? 'MAP_TIMEOUT' : 'MAP_UPSTREAM_FAILED', 503, true);
    }
  }
  async places({ query, bounds, cursor }: { query: string; bounds?: Bounds; cursor?: string }): Promise<PlacePage> {
    const keyword = query.trim(), page = cursor === undefined ? 1 : Number(cursor);
    if (!keyword || keyword.length > 100) throw new RealWorldError('INVALID_QUERY');
    if (!Number.isInteger(page) || page < 1 || page > 10) throw new RealWorldError('INVALID_CURSOR');
    if (bounds && (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite) || bounds.west > bounds.east || bounds.south > bounds.north)) throw new RealWorldError('INVALID_BOUNDS');
    const params = new URLSearchParams({ version: '1', searchKeyword: keyword, searchType: 'all', page: String(page), count: '20', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', multiPoint: 'N', searchtypCd: 'A' });
    const response = await this.request(`/pois?${params}`, `poi:${params}`);
    const info = obj(obj(response.data).searchPoiInfo), rawRows = obj(info.pois).poi;
    const rows = rawRows == null && num(info.totalCount) === 0 ? [] : rawRows;
    if (!Array.isArray(rows)) return invalid();
    const stamp = this.stamp(response.fetchedAt);
    const places = rows.flatMap((raw: unknown): ExternalPlace[] => {
      const row = obj(raw), location = point(row.noorLat ?? row.frontLat, row.noorLon ?? row.frontLon), entrance = point(row.frontLat, row.frontLon);
      if (!location || !str(row.id) || !str(row.name) || bounds && (location.longitude < bounds.west || location.longitude > bounds.east || location.latitude < bounds.south || location.latitude > bounds.north)) return [];
      return [{ id: str(row.id), provider: 'TMAP', participation: 'EXTERNAL_PLACE', name: str(row.name),
        roadAddress: [row.upperAddrName, row.middleAddrName, row.roadName, row.firstBuildNo].map(str).filter(Boolean).join(' '),
        point: location, entrance, ...stamp }];
    });
    return { places, nextCursor: page * 20 < num(info.totalCount) && page < 10 ? String(page + 1) : null, ...stamp, attribution: 'TMAP' };
  }
  async geocode(address: string): Promise<LocationCandidate[]> {
    const fullAddr = address.trim();
    if (!fullAddr || fullAddr.length > 200) throw new RealWorldError('INVALID_ADDRESS');
    const params = new URLSearchParams({ version: '1', fullAddr, addressFlag: 'F00', coordType: 'WGS84GEO', page: '1', count: '20' });
    const response = await this.request(`/geo/fullAddrGeo?${params}`, `geo:${params}`);
    const info = obj(obj(response.data).coordinateInfo);
    const coordinates = info.coordinate == null && num(info.totalCount) === 0 ? [] : info.coordinate;
    if (!Array.isArray(coordinates)) return invalid();
    const stamp = this.stamp(response.fetchedAt);
    return coordinates.flatMap((raw: unknown, index: number): LocationCandidate[] => {
      const row = obj(raw), location = point(row.newLat, row.newLon) ?? point(row.lat, row.lon);
      if (!location) return [];
      const entrance = point(row.newLatEntr, row.newLonEntr) ?? point(row.latEntr, row.lonEntr);
      const id = `address:${createHash('sha256').update(fullAddr).digest('hex').slice(0, 12)}:${index + 1}`;
      return [{ id, candidateId: id, provider: 'TMAP', participation: 'EXTERNAL_PLACE', name: str(row.newBuildingName) || fullAddr,
        roadAddress: [row.city_do, row.gu_gun, row.newRoadName, row.newBuildingIndex].map(str).filter(Boolean).join(' ') || fullAddr,
        point: location, entrance, ...stamp }];
    });
  }
  async walk(origin: Point, destination: Point): Promise<WalkingLeg> {
    const start = toTmapPoint(origin), end = toTmapPoint(destination);
    const body = { startX: start.x, startY: start.y, endX: end.x, endY: end.y, startName: '출발지', endName: '도착지', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', searchOption: '0', sort: 'index' };
    const response = await this.request('/routes/pedestrian?version=1', `walk:${JSON.stringify(body)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { ...parseWalkingResponse(response.data), ...this.stamp(response.fetchedAt) };
  }
}
