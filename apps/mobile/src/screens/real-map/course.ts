import type { MerchantDetail, MerchantSummary, Point, WalkingRouteInput } from '../../../../api/src/real-world-contract';

export type CourseStop = { merchantId: string; dwellMinutes: number };
export function buildWalkingRouteInput(origin: Point, stops: readonly CourseStop[], departureAt: string): WalkingRouteInput {
  return { origin: { latitude: origin.latitude, longitude: origin.longitude },
    merchantIds: stops.map(stop => stop.merchantId), departureAt, dwellMinutes: stops.map(stop => stop.dwellMinutes) };
}
export async function fetchCourseDetails(stops: readonly CourseStop[], merchant: (id:string,signal?:AbortSignal)=>Promise<MerchantDetail>, signal?:AbortSignal):Promise<MerchantDetail[]> {
  return Promise.all(stops.map(stop=>merchant(stop.merchantId,signal)));
}
export const createCourse = (ids: readonly string[]): CourseStop[] => [...new Set(ids)].slice(0,5).map(merchantId => ({merchantId,dwellMinutes:15}));
export function moveStop(stops: readonly CourseStop[], from: number, to: number): CourseStop[] {
  if (from < 0 || from >= stops.length || to < 0 || to >= stops.length) return [...stops];
  const next=[...stops]; next.splice(to,0,next.splice(from,1)[0]); return next;
}
export function replaceStop(stops: readonly CourseStop[], index: number, id: string): CourseStop[] {
  if (index < 0 || index >= stops.length || stops.some((stop,i)=>i!==index && stop.merchantId===id)) return [...stops];
  return stops.map((stop,i)=>i===index?{...stop,merchantId:id}:stop);
}
export function setDwell(stops: readonly CourseStop[], index: number, minutes: number): CourseStop[] {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 120) return [...stops];
  return stops.map((stop,i)=>i===index?{...stop,dwellMinutes:minutes}:stop);
}
export function recommendStops(merchants: readonly MerchantSummary[], visited: ReadonlySet<string>, interested: ReadonlySet<string>, remaining: ReadonlyMap<string,number|null>=new Map()): MerchantSummary[] {
  return merchants.filter(m=>m.position && m.business.state === 'OPEN')
    .sort((a,b)=> Number(interested.has(b.id))-Number(interested.has(a.id)) ||
      Number(b.campaign?.state==='ACTIVE'&&b.campaign.rewardAvailability==='AVAILABLE')-Number(a.campaign?.state==='ACTIVE'&&a.campaign.rewardAvailability==='AVAILABLE') ||
      Number(b.business.state==='OPEN')-Number(a.business.state==='OPEN') ||
      Number(visited.has(a.id))-Number(visited.has(b.id)) ||
      (remaining.get(a.id)??Infinity)-(remaining.get(b.id)??Infinity) ||
      (a.distance?.meters ?? Infinity)-(b.distance?.meters ?? Infinity)).slice(0,5);
}
export const serializeCourse = (stops: readonly CourseStop[]): string => JSON.stringify(stops.map(({merchantId,dwellMinutes})=>({merchantId,dwellMinutes})));
export function restoreCourse(raw: string | null): CourseStop[] {
  if (!raw) return [];
  try { const value: unknown = JSON.parse(raw); if (!Array.isArray(value)) return [];
    const seen=new Set<string>();
    return value.filter((stop):stop is CourseStop=>{
      if (!stop || typeof stop.merchantId !== 'string' || seen.has(stop.merchantId) || !Number.isInteger(stop.dwellMinutes) || stop.dwellMinutes<5 || stop.dwellMinutes>120) return false;
      seen.add(stop.merchantId);return true;
    }).slice(0,5).map(({merchantId,dwellMinutes})=>({merchantId,dwellMinutes})); }
  catch { return []; }
}
