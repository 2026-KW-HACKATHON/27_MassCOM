export type NaverLatLng = { lat(): number; lng(): number };
export type NaverMap = {
  getBounds(): { getSW(): NaverLatLng; getNE(): NaverLatLng };
  getCenter(): NaverLatLng; getZoom(): number;
  setCenter(point: NaverLatLng): void; setZoom(zoom: number): void;
  autoResize(): void; destroy(): void;
};
export type NaverOverlay = { setMap(map: NaverMap | null): void };
export type NaverMaps = {
  Map: new (id: string, options: { center: NaverLatLng; zoom: number }) => NaverMap;
  LatLng: new (latitude: number, longitude: number) => NaverLatLng;
  Marker: new (options: { position: NaverLatLng; map: NaverMap; title: string; icon: string }) => NaverOverlay;
  Polyline: new (options: { path: NaverLatLng[]; strokeColor: string; strokeWeight: number; map: NaverMap }) => NaverOverlay;
  Event: {
    addListener(target: object, eventName: string, callback: () => void): object;
    removeListener(listener: object): void;
  };
};
type Browser = Window & { naver?: { maps?: NaverMaps }; navermap_authFailure?: () => void };
const validMaps = (value: NaverMaps | undefined): value is NaverMaps => !!value &&
  typeof value.Map === 'function' && typeof value.LatLng === 'function' &&
  typeof value.Marker === 'function' && typeof value.Polyline === 'function' &&
  typeof value.Event?.addListener === 'function' && typeof value.Event.removeListener === 'function';
let loading: Promise<NaverMaps> | null = null;
let loadingKey: string | null = null;
let callbackIndex = 0;

export function loadNaverWebSdk(clientId: string, timeoutMs = 10_000): Promise<NaverMaps> {
  if (loading && loadingKey === clientId) return loading;
  loadingKey = clientId;
  const request = new Promise<NaverMaps>((resolve, reject) => {
    const browser = window as Browser;
    if (validMaps(browser.naver?.maps)) { resolve(browser.naver.maps); return; }
    const script = document.createElement('script');
    const callbackName = `__masscomNaverReady${++callbackIndex}`;
    const globals = browser as unknown as Record<string, unknown>;
    const previousAuthFailure = browser.navermap_authFailure;
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}&callback=${callbackName}`;
    script.async = true;
    let settled = false;
    let callbackFired = false;
    let scriptLoaded = false;
    const cleanup = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      delete globals[callbackName];
      if (browser.navermap_authFailure === authFailure) browser.navermap_authFailure = previousAuthFailure;
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      reject(Error('NAVER SDK unavailable'));
    };
    const authFailure = () => { try { previousAuthFailure?.(); } finally { fail(); } };
    const finish = () => {
      if (settled || !callbackFired || !scriptLoaded) return;
      const maps = browser.naver?.maps;
      if (!validMaps(maps)) { fail(); return; }
      settled = true;
      cleanup();
      resolve(maps);
    };
    globals[callbackName] = () => { callbackFired = true; finish(); };
    browser.navermap_authFailure = authFailure;
    const timer = setTimeout(fail, timeoutMs);
    script.onload = () => { scriptLoaded = true; finish(); };
    script.onerror = fail;
    try { document.head.appendChild(script); } catch { fail(); }
  });
  const cached = request.catch(error => {
    if (loading === cached) { loading = null; loadingKey = null; }
    throw error;
  });
  loading = cached;
  return cached;
}
