import { pathToFileURL } from 'node:url';
import { RealWorldError } from './real-world-contract.js';
import { TmapProvider } from './tmap-provider.js';

/** Three read-only requests for public landmarks; no user location, database writes or raw responses. */
export async function runTmapSmoke(provider = new TmapProvider({ appKey: process.env.TMAP_REST_APP_KEY ?? '' })) {
  try {
    const places = await provider.places({ query: '덕수궁 대한문' });
    const addresses = await provider.geocode('서울특별시 중구 세종대로 110');
    const destination = places.places[0], origin = addresses[0];
    if (!destination || !origin) throw new RealWorldError('MAP_EMPTY_RESPONSE');
    const route = await provider.walk(origin.entrance ?? origin.point, destination.entrance ?? destination.point);
    return { status: 'PASS' as const, scope: 'TMAP_REST', poiCount: places.places.length,
      addressCandidateCount: addresses.length, walkingMeters: route.travelMeters,
      walkingSeconds: route.travelSeconds, lineCount: route.geometry.coordinates.length };
  } catch (error) {
    const allowed = ['MAP_NOT_CONFIGURED', 'MAP_EMPTY_RESPONSE', 'MAP_AUTH_FAILED', 'MAP_RATE_LIMITED',
      'MAP_QUOTA_EXCEEDED', 'MAP_UPSTREAM_FAILED', 'MAP_TIMEOUT', 'MAP_INVALID_RESPONSE'];
    return { status: 'FAIL' as const, scope: 'TMAP_REST',
      code: error instanceof RealWorldError && allowed.includes(error.code) ? error.code : 'TMAP_SMOKE_FAILED' };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runTmapSmoke();
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}
