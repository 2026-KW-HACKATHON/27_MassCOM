import type { AccountCredential } from '@/auth/account-credential';
import { headersForCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import type { DiscoveryEvent, DiscoveryPage, DiscoveryQuery, MerchantDetail, PlacePage, WalkingRoute, WalkingRouteInput } from '../../../api/src/real-world-contract';

export type { DiscoveryPage, DiscoveryQuery, MerchantDetail, MerchantSummary, Point, Bounds, WalkingRoute, WalkingRouteInput } from '../../../api/src/real-world-contract';

export class DiscoveryApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); this.name = 'DiscoveryApiError'; }
}

export function createDiscoveryApiClient(options: { apiUrl: string; credential?: AccountCredential; onSessionInvalid?: () => void | Promise<void>; fetcher?: typeof fetch }) {
  const base = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;
  async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.credential) for (const [key,value] of Object.entries(headersForCredential(options.credential))) headers.set(key,value);
    let response: Response;
    try { response = await fetcher(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal }); }
    catch (error) { if (signal?.aborted) throw error; throw new DiscoveryApiError(0, 'NETWORK_ERROR'); }
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      const code = typeof payload === 'object' && payload !== null && 'code' in payload && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      if (options.credential && shouldInvalidateSession(options.credential,response.status,code)) await options.onSessionInvalid?.();
      throw new DiscoveryApiError(response.status,code);
    }
    if (!payload || typeof payload !== 'object') throw new DiscoveryApiError(response.status,'INVALID_RESPONSE');
    return payload as T;
  }
  return {
    search: async (query: DiscoveryQuery, signal?: AbortSignal) => {
      const page = await request<DiscoveryPage>('/v1/discovery/search',query,signal);
      if (page.schemaVersion !== 1 || !Array.isArray(page.merchants) || !Array.isArray(page.clusters) ||
        !page.merchants.every(item => typeof item?.id === 'string' && typeof item.name === 'string' && typeof item.roadAddress === 'string' && item.business && typeof item.business.state === 'string' &&
          (item.position === null || (Number.isFinite(item.position?.latitude) && Number.isFinite(item.position?.longitude)))) ||
        (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new DiscoveryApiError(200,'INVALID_RESPONSE');
      return page;
    },
    merchant: async (id: string, signal?: AbortSignal) => {
      const payload = await request<{schemaVersion:1;asOf:string;merchant:MerchantDetail}>(`/v1/discovery/merchants/${encodeURIComponent(id)}`,undefined,signal);
      if (payload.schemaVersion !== 1 || !payload.merchant || payload.merchant.id !== id || !Array.isArray(payload.merchant.photos) || !Array.isArray(payload.merchant.menuItems) || !payload.merchant.business) throw new DiscoveryApiError(200,'INVALID_RESPONSE');
      return payload.merchant;
    },
    places: async (query: {query:string;bounds?:DiscoveryQuery['bounds'];cursor?:string}, signal?: AbortSignal) => {
      const page=await request<PlacePage>('/v1/discovery/places/search',query,signal);
      if (!Array.isArray(page.places) || !page.places.every(place=>typeof place?.id==='string' && Number.isFinite(place.point?.latitude) && Number.isFinite(place.point?.longitude) && typeof place.expiresAt==='string')) throw new DiscoveryApiError(200,'INVALID_RESPONSE');
      return page;
    },
    walk: async (input: WalkingRouteInput, signal?: AbortSignal) => {
      const route=await request<WalkingRoute>('/v1/discovery/walking-routes',input,signal);
      if (route.schemaVersion!==1 || route.mode!=='WALK' || route.geometry?.type!=='MultiLineString' || !Array.isArray(route.geometry.coordinates) || !Array.isArray(route.stops) || !Number.isFinite(route.travelMeters) || !Number.isFinite(route.travelSeconds)) throw new DiscoveryApiError(200,'INVALID_RESPONSE');
      return route;
    },
    event: (event: DiscoveryEvent) => request<unknown>('/v1/discovery/events',event),
  };
}

export function publishedPhotoUri(apiUrl: string, path: string): string | null {
  return /^\/v1\/discovery\/photos\/[a-f0-9]{64}$/.test(path) ? `${apiUrl.replace(/\/+$/, '')}${path}` : null;
}
