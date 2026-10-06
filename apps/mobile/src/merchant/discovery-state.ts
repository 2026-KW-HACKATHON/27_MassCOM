import type { DiscoveryPage, DiscoveryQuery, DistanceOrigin, MerchantSummary, Point } from '../../../api/src/real-world-contract';

export type DiscoveryFilters = { query: string; category: string | null; campaignOnly: boolean; openOnly: boolean; unvisitedOnly: boolean; interestedOnly: boolean };
export type DiscoveryNavigation = { filters: DiscoveryFilters; selectedId: string | null; mode: 'map' | 'list'; manualOrigin: Point | null; manualOriginExpiresAt: string | null };
export type DiscoverySnapshot = DiscoveryNavigation & {
  query: DiscoveryQuery | null; merchants: MerchantSummary[]; clusters: DiscoveryPage['clusters']; nextCursor: string | null;
  unlocatedCount: number; loading: boolean; error: string | null; origin: (Point & { basis: DistanceOrigin }) | null;
};
export type DiscoveryRequest = { generation: number; fingerprint: string; cursor: string | null; query: DiscoveryQuery };
const defaultFilters: DiscoveryFilters = { query: '', category: null, campaignOnly: false, openOnly: false, unvisitedOnly: false, interestedOnly: false };
const navigationDefault: DiscoveryNavigation = { filters: defaultFilters, selectedId: null, mode: 'map', manualOrigin: null, manualOriginExpiresAt: null };

export function restoreDiscoveryNavigation(raw: string | null): DiscoveryNavigation {
  if (!raw) return navigationDefault;
  try {
    const value = JSON.parse(raw) as Partial<DiscoveryNavigation>;
    const filters = value.filters;
    return {
      filters: {
        query: typeof filters?.query === 'string' ? filters.query.slice(0, 100) : '',
        category: typeof filters?.category === 'string' ? filters.category : null,
        campaignOnly: filters?.campaignOnly === true,
        openOnly: filters?.openOnly === true,
        unvisitedOnly: filters?.unvisitedOnly === true,
        interestedOnly: filters?.interestedOnly === true,
      },
      selectedId: typeof value.selectedId === 'string' ? value.selectedId : null,
      mode: value.mode === 'list' ? 'list' : 'map',
      manualOrigin: value.manualOrigin && typeof value.manualOriginExpiresAt === 'string' && Date.parse(value.manualOriginExpiresAt) > Date.now() && Date.parse(value.manualOriginExpiresAt) < Date.now()+86400000 && Number.isFinite(value.manualOrigin.latitude) && Number.isFinite(value.manualOrigin.longitude) && Math.abs(value.manualOrigin.latitude)<=90 && Math.abs(value.manualOrigin.longitude)<=180 ? value.manualOrigin : null,
      manualOriginExpiresAt: typeof value.manualOriginExpiresAt === 'string' ? value.manualOriginExpiresAt : null,
    };
  } catch { return navigationDefault; }
}

export function serializeDiscoveryNavigation(state: DiscoverySnapshot): string {
  return JSON.stringify({ filters: state.filters, selectedId: state.selectedId, mode: state.mode, manualOrigin: state.origin?.basis === 'MANUAL' ? {latitude:state.origin.latitude,longitude:state.origin.longitude} : state.manualOrigin, manualOriginExpiresAt: state.manualOriginExpiresAt });
}

export function createDiscoveryState(initial: DiscoveryNavigation = navigationDefault) {
  let generation = 0;
  let state: DiscoverySnapshot = { ...initial, filters: { ...defaultFilters, ...initial.filters }, query: null, merchants: [], clusters: [], nextCursor: null,
    unlocatedCount: 0, loading: false, error: null, origin: initial.manualOrigin ? {...initial.manualOrigin,basis:'MANUAL'} : null };
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const update = (patch: Partial<DiscoverySnapshot>) => { state = { ...state, ...patch }; notify(); };
  const fingerprint = (query: DiscoveryQuery) => JSON.stringify({ ...query, cursor: undefined, filters: state.filters });
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore(raw: string | null) { const restored = restoreDiscoveryNavigation(raw); generation++; update({ ...restored, merchants: [], clusters: [], nextCursor: null, loading: false, query: null, origin: restored.manualOrigin ? {...restored.manualOrigin,basis:'MANUAL'} : null }); },
    setMode(mode: 'map' | 'list') { update({ mode }); },
    select(selectedId: string | null) { update({ selectedId }); },
    setOrigin(origin: DiscoverySnapshot['origin'], expiresAt?: string) { if (expiresAt && (Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) >= Date.now()+86400000)) return;
      origin = origin && {latitude:origin.latitude,longitude:origin.longitude,basis:origin.basis};
      generation++; update({ origin, manualOrigin: origin?.basis === 'MANUAL' ? {latitude:origin.latitude,longitude:origin.longitude} : state.manualOrigin, manualOriginExpiresAt: origin?.basis === 'MANUAL' ? (expiresAt && Date.parse(expiresAt) > Date.now() && Date.parse(expiresAt) < Date.now()+86400000 ? expiresAt : new Date(Date.now()+23*3600000).toISOString()) : state.manualOriginExpiresAt, merchants: [], clusters: [], nextCursor: null, query: null }); },
    setFilters(patch: Partial<DiscoveryFilters>) {
      const filters = { ...state.filters, ...patch };
      if (JSON.stringify(filters) === JSON.stringify(state.filters)) return;
      generation++; update({ filters, query: null, merchants: [], clusters: [], nextCursor: null, error: null });
    },
    begin(query: DiscoveryQuery): DiscoveryRequest {
      const request = { generation: ++generation, fingerprint: fingerprint(query), cursor: null, query };
      update({ query, loading: true, error: null, merchants: [], clusters: [], nextCursor: null });
      return request;
    },
    beginNext(): DiscoveryRequest | null {
      if (!state.query || !state.nextCursor || state.loading) return null;
      const request = { generation: ++generation, fingerprint: fingerprint(state.query), cursor: state.nextCursor, query: { ...state.query, cursor: state.nextCursor } };
      update({ loading: true, error: null }); return request;
    },
    resolve(request: DiscoveryRequest, page: DiscoveryPage) {
      if (request.generation !== generation || request.fingerprint !== fingerprint(request.query)) return;
      const merchants = request.cursor ? [...state.merchants, ...page.merchants.filter(item => !state.merchants.some(previous => previous.id === item.id))] : page.merchants;
      update({ merchants, clusters: page.clusters, nextCursor: page.nextCursor, unlocatedCount: page.unlocatedCount, loading: false, error: null });
    },
    reject(request: DiscoveryRequest, error: string) { if (request.generation === generation) update({ loading: false, error }); },
    invalidate() { generation++; update({ loading: false }); },
  };
}

export const discoveryState = createDiscoveryState();
