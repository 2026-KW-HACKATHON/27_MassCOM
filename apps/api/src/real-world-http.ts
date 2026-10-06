import type { IncomingMessage, ServerResponse } from 'node:http';
import { businessStateAt } from './real-world-hours.js';
import { RealWorldError, type DiscoveryEvent, type DiscoveryQuery, type PhotoUploadInput, type Point, type RealWorldProfile, type WalkingRoute } from './real-world-contract.js';
import type { PostgresRealWorldService } from './postgres/real-world.js';
import type { MapProvider } from './map-provider.js';
import type { TmapProvider } from './tmap-provider.js';

type Body = Record<string, unknown>;
type Deps = {
  request: IncomingMessage; response: ServerResponse; path: string;
  realWorld?: PostgresRealWorldService | undefined; tmap?: TmapProvider | undefined; mapProvider?: MapProvider | undefined;
  resolveAccountId(): Promise<string>; resolveWebAccountId(channel: 'merchant' | 'admin'): Promise<string>;
  readBody(maxBytes?: number): Promise<Body>; decode(value: string): string;
  send(status: number, value: unknown): void; consumeEvent(): void; consumeMap?(): void;
};
const fail = (code = 'INVALID_REQUEST', status = 400): never => { throw new RealWorldError(code, status); };
const object = (value: unknown): Body => value && typeof value === 'object' && !Array.isArray(value) ? value as Body : fail();
const keys = (body: Body, allowed: readonly string[]) => {
  if (Object.keys(body).some(key => !allowed.includes(key))) fail();
};
const string = (value: unknown, max = 200): string =>
  typeof value === 'string' && value.trim() && value.length <= max ? value : fail();
const id = (value: unknown): string => string(value, 100);
const point = (value: unknown): Point => {
  const p = object(value);
  keys(p, ['latitude', 'longitude']);
  return typeof p.latitude === 'number' && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 &&
    typeof p.longitude === 'number' && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180
    ? { latitude: p.latitude, longitude: p.longitude } : fail('INVALID_POINT');
};
const ids = (value: unknown, limit: number, allowEmpty = false): string[] => Array.isArray(value) && (allowEmpty || value.length > 0) &&
  value.length <= limit && value.every(item => typeof item === 'string' && !!item && item.length <= 100) &&
  new Set(value).size === value.length ? value as string[] : fail();
const version = (value: unknown): number => Number.isSafeInteger(value) && (value as number) > 0 ? value as number : fail();
const bodyLimit = 5 * 1024 * 1024;

export async function handleRealWorldHttp(d: Deps): Promise<boolean> {
  const { request, response, path, realWorld, tmap, mapProvider } = d;
  if (!path.startsWith('/v1/discovery/') && !path.startsWith('/api/web/v1/')) return false;
  const svc = realWorld ?? fail('REAL_WORLD_NOT_CONFIGURED', 503);
  const method = request.method;
  const web = path.match(/^\/api\/web\/v1\/(merchant|admin)\/merchants\/([^/]+)\/(.+)$/);
  if (web) {
    const channel = web[1] as 'merchant' | 'admin';
    const accountId = await d.resolveWebAccountId(channel);
    const merchantId = id(d.decode(web[2]!));
    const suffix = web[3]!;
    if (suffix === 'real-world-profile') {
      if (method === 'GET') d.send(200, await svc.profile(accountId, merchantId));
      else if (method === 'PUT') {
        const body = await d.readBody(); keys(body, ['expectedVersion', 'profile']);
        d.send(200, await svc.updateProfile(accountId, merchantId,
          { expectedVersion: version(body.expectedVersion), profile: object(body.profile) as RealWorldProfile }));
      } else return false;
      return true;
    }
    if (suffix === 'location-candidates' && method === 'POST') {
      await svc.profile(accountId, merchantId);
      const body = await d.readBody(); keys(body, ['address']);
      const address = string(body.address);
      const map = mapProvider ?? tmap ?? fail('MAP_NOT_CONFIGURED', 503);
      if (!(mapProvider?.configuredGeocode() ?? tmap?.configured())) fail('MAP_NOT_CONFIGURED', 503);
      d.consumeMap?.();
      d.send(200, { candidates: await map.geocode(address) });
      return true;
    }
    if (suffix === 'photos' && method === 'POST') {
      // Confirm current ownership before accepting the only large JSON body.
      await svc.profile(accountId, merchantId);
      const body = await d.readBody(bodyLimit);
      keys(body, ['expectedVersion', 'kind', 'caption', 'rightsConfirmed', 'mimeType', 'base64']);
      if (body.rightsConfirmed !== true || !['STORE', 'MENU', 'ENTRANCE', 'PACKAGING', 'SIGN'].includes(body.kind as string) ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(body.mimeType as string) ||
        !(body.caption === null || typeof body.caption === 'string' && body.caption.length <= 300) ||
        typeof body.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64)) fail('PHOTO_INVALID');
      const bytes = Buffer.from(body.base64 as string, 'base64');
      if (bytes.length < 16 || bytes.length > 8 * 1024 * 1024) fail('PHOTO_INVALID');
      d.send(201, await svc.createPhoto(accountId, merchantId, {
        expectedVersion: version(body.expectedVersion), kind: body.kind, caption: body.caption,
        rightsConfirmed: true, mimeType: body.mimeType, bytes,
      } as PhotoUploadInput));
      return true;
    }
    const privateImage = suffix.match(/^photos\/([^/]+)\/image$/);
    if (privateImage && method === 'GET') {
      const photo = await svc.privatePhoto(accountId, merchantId, d.decode(privateImage[1]!));
      if (photo === null) return fail('PHOTO_NOT_FOUND', 404);
      response.writeHead(200, { 'content-type': photo.mimeType, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }).end(photo.bytes);
      return true;
    }
    const deletePhoto = suffix.match(/^photos\/([^/]+)$/);
    if (deletePhoto && method === 'DELETE') {
      const body = await d.readBody(); keys(body, ['expectedVersion']);
      d.send(200, await svc.deletePhoto(accountId, merchantId, d.decode(deletePhoto[1]!), version(body.expectedVersion)));
      return true;
    }
    if (suffix === 'reports' && method === 'GET') {
      d.send(200, { reports: await svc.reports(accountId, merchantId) }); return true;
    }
    if (suffix === 'discovery-engagement' && method === 'GET') {
      d.send(200, await svc.engagement(accountId, merchantId)); return true;
    }
    const resolve = suffix.match(/^reports\/([^/]+)\/resolve$/);
    if (resolve && method === 'POST') {
      const body = await d.readBody(); keys(body, ['status', 'resolution']);
      d.send(200, await svc.resolveReport(accountId, merchantId, d.decode(resolve[1]!),
        { status: body.status as 'RESOLVED' | 'REJECTED', resolution: string(body.resolution, 1000) }));
      return true;
    }
    return false;
  }
  if (path === '/v1/discovery/search' && method === 'POST') {
    const body = await d.readBody();
    keys(body, ['bounds', 'zoom', 'query', 'category', 'campaignOnly', 'openOnly', 'origin', 'cursor', 'limit']);
    const bounds = object(body.bounds);
    keys(bounds, ['west', 'south', 'east', 'north']);
    if (!['west', 'south', 'east', 'north'].every(k => typeof bounds[k] === 'number' && Number.isFinite(bounds[k]))) fail();
    if (bounds.west! > bounds.east! || bounds.south! > bounds.north! || Math.abs(bounds.west as number) > 180 ||
        Math.abs(bounds.east as number) > 180 || Math.abs(bounds.south as number) > 90 || Math.abs(bounds.north as number) > 90 ||
        typeof body.zoom !== 'number' || !Number.isFinite(body.zoom) || body.zoom < 0 || body.zoom > 24 ||
        body.query !== undefined && (typeof body.query !== 'string' || body.query.length > 100) ||
        body.category !== undefined && (typeof body.category !== 'string' || body.category.length > 80) ||
        body.campaignOnly !== undefined && typeof body.campaignOnly !== 'boolean' ||
        body.openOnly !== undefined && typeof body.openOnly !== 'boolean' ||
        body.cursor !== undefined && (typeof body.cursor !== 'string' || body.cursor.length > 2048) ||
        body.limit !== undefined && (!Number.isInteger(body.limit) || (body.limit as number) < 1 || (body.limit as number) > 100)) fail();
    let origin: DiscoveryQuery['origin'];
    if (body.origin !== undefined) {
      const raw = object(body.origin); keys(raw, ['latitude', 'longitude', 'basis']);
      if (!['MAP_CENTER', 'MANUAL', 'CURRENT_LOCATION'].includes(raw.basis as string)) fail();
      origin = { ...point({ latitude: raw.latitude, longitude: raw.longitude }), basis: raw.basis as 'MAP_CENTER' | 'MANUAL' | 'CURRENT_LOCATION' };
    }
    d.send(200, await svc.search({ ...body, bounds: bounds as DiscoveryQuery['bounds'], origin } as DiscoveryQuery)); return true;
  }
  const publicMerchant = path.match(/^\/v1\/discovery\/merchants\/([^/]+)$/);
  if (publicMerchant && method === 'GET') {
    const merchant = await svc.merchant(id(d.decode(publicMerchant[1]!)));
    d.send(200, { schemaVersion: 1, asOf: new Date().toISOString(), merchant }); return true;
  }
  const publicPhoto = path.match(/^\/v1\/discovery\/photos\/([a-f0-9]{64})$/);
  if (publicPhoto && method === 'GET') {
    const photo = await svc.publicPhoto(publicPhoto[1]!);
    if (photo === null) return fail('PHOTO_NOT_FOUND', 404);
    response.writeHead(200, { 'content-type': photo.mimeType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(photo.bytes);
    return true;
  }
  if (path === '/v1/discovery/places/search' && method === 'POST') {
    const body = await d.readBody(); keys(body, ['query', 'bounds', 'cursor']);
    const bounds = body.bounds === undefined ? undefined : object(body.bounds);
    if (bounds) { keys(bounds, ['west', 'south', 'east', 'north']); if (!['west', 'south', 'east', 'north'].every(k => typeof bounds[k] === 'number' && Number.isFinite(bounds[k]))) fail(); }
    const query = string(body.query, 100);
    const map = mapProvider ?? tmap ?? fail('MAP_NOT_CONFIGURED', 503);
    if (!(mapProvider?.configuredPlaces() ?? tmap?.configured())) fail('MAP_NOT_CONFIGURED', 503);
    d.consumeMap?.();
    d.send(200, await map.places({ query, ...(bounds ? { bounds: bounds as DiscoveryQuery['bounds'] } : {}), ...(body.cursor === undefined ? {} : { cursor: string(body.cursor, 10) }) }));
    return true;
  }
  if (path === '/v1/discovery/walking-routes' && method === 'POST') {
    const body = await d.readBody(); keys(body, ['origin', 'merchantIds', 'departureAt', 'dwellMinutes']);
    const rawOrigin = object(body.origin); keys(rawOrigin, ['latitude', 'longitude', 'basis']);
    if (rawOrigin.basis !== undefined && !['MAP_CENTER', 'MANUAL', 'CURRENT_LOCATION'].includes(rawOrigin.basis as string)) fail('INVALID_POINT');
    const origin = point({ latitude: rawOrigin.latitude, longitude: rawOrigin.longitude }), merchantIds = ids(body.merchantIds, 5);
    if (!Array.isArray(body.dwellMinutes) || body.dwellMinutes.length !== merchantIds.length ||
        body.dwellMinutes.some(n => !Number.isInteger(n) || n < 0 || n > 240)) fail('ROUTE_INVALID');
    const dwellMinutes = body.dwellMinutes as number[];
    const departureAt = string(body.departureAt, 40), start = Date.parse(departureAt);
    if (!Number.isFinite(start) || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(departureAt)) fail('ROUTE_INVALID');
    const map = tmap ?? fail('MAP_NOT_CONFIGURED', 503);
    if (!map.configured()) fail('MAP_NOT_CONFIGURED', 503);
    const details = await Promise.all(merchantIds.map(merchantId => svc.merchant(merchantId)));
    if (details.some(detail => detail.positionBasis !== 'OWNED' || !detail.position ||
        detail.location?.source === undefined)) fail('ROUTE_LOCATION_UNAVAILABLE', 422);
    let current = origin, elapsed = 0, travelMeters = 0, travelSeconds = 0;
    const geometry: number[][][] = [], stops: WalkingRoute['stops'] = [];
    const legs = [];
    for (const [index, detail] of details.entries()) {
      const destination = detail.location!.entrance ?? detail.position!;
      d.consumeMap?.();
      const leg = await map.walk(current, destination);
      legs.push(leg); geometry.push(...leg.geometry.coordinates);
      travelMeters += leg.travelMeters; travelSeconds += leg.travelSeconds; elapsed += leg.travelSeconds;
      const arrival = new Date(start + elapsed * 1000);
      const business = businessStateAt(detail.schedule, arrival, detail.todayOverride);
      const warnings: WalkingRoute['stops'][number]['warnings'] = [];
      if (business.state === 'UNKNOWN') warnings.push('HOURS_UNKNOWN');
      else if (business.state !== 'OPEN') warnings.push('CLOSED_AT_ARRIVAL');
      else if (business.acceptingOrders === false) warnings.push('ORDER_CLOSED');
      if (detail.campaign && (detail.campaign.state !== 'ACTIVE' || detail.campaign.enrollment !== 'OPEN' || detail.campaign.rewardAvailability !== 'AVAILABLE')) warnings.push('CAMPAIGN_UNAVAILABLE');
      elapsed += (dwellMinutes[index]!) * 60;
      stops.push({ merchantId: detail.id, profileVersion: detail.profileVersion,
        arrivalAt: arrival.toISOString(), departureAt: new Date(start + elapsed * 1000).toISOString(), warnings });
      current = destination;
    }
    d.send(200, { schemaVersion: 1, mode: 'WALK', provider: 'TMAP', geometry: { type: 'MultiLineString', coordinates: geometry },
      travelMeters, travelSeconds, dwellSeconds: elapsed - travelSeconds, stops,
      fetchedAt: legs.map(leg => leg.fetchedAt).sort().at(-1), expiresAt: legs.map(leg => leg.expiresAt).sort()[0], attribution: 'TMAP' });
    return true;
  }
  if (path === '/v1/discovery/game-content' && method === 'POST') {
    const body = await d.readBody(); keys(body, ['merchantIds']);
    d.send(200, { schemaVersion: 1, asOf: new Date().toISOString(), contexts: await svc.gameContent(ids(body.merchantIds, 20, true)) }); return true;
  }
  if (path === '/v1/discovery/events' && method === 'POST') {
    d.consumeEvent();
    const body = await d.readBody(); keys(body, ['eventId', 'merchantId', 'event', 'source']);
    await svc.recordEvent(body as DiscoveryEvent); d.send(202, { accepted: true }); return true;
  }
  const report = path.match(/^\/v1\/discovery\/merchants\/([^/]+)\/reports$/);
  if (report && method === 'POST') {
    const accountId = await d.resolveAccountId();
    const body = await d.readBody(); keys(body, ['kind', 'note']);
    d.send(201, await svc.report(accountId, id(d.decode(report[1]!)), { kind: body.kind as 'LOCATION', note: string(body.note, 1000) })); return true;
  }
  return false;
}
