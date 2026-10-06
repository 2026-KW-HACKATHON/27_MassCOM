export type LatLng = { latitude(): number; longitude(): number };
export type WebMap = {
  setCenter(point: LatLng): void; setZoom(zoom: number): void; getCenter(): LatLng;
  getZoom(): number; getBounds(): { getSouthWest(): LatLng; getNorthEast(): LatLng };
  resize(): void; on(event: string, callback: () => void): void;
};
export type Overlay = { setMap(map: WebMap | null): void; on?(event: string, callback: () => void): void; off?(event: string): void };
export type Sdk = {
  Map: new (id: string, options: { center: LatLng; zoom: number; width: string; height: string }) => WebMap;
  LatLng: new (latitude: number, longitude: number) => LatLng;
  Marker: new (options: { position: LatLng; map: WebMap; title?: string; icon?: string }) => Overlay;
  Polyline: new (options: { path: LatLng[]; strokeColor: string; strokeWeight: number; map: WebMap }) => Overlay;
};
type Browser = Window & { Tmapv3?: Sdk };
const validSdk = (value: Sdk | undefined): value is Sdk => !!value &&
  typeof value.Map === 'function' && typeof value.LatLng === 'function' &&
  typeof value.Marker === 'function' && typeof value.Polyline === 'function';
let sdkPromise: Promise<Sdk> | null = null;
let sdkKey: string | null = null;

/** The authenticated bootstrap uses document.write, so read it as data and load its allowlisted assets asynchronously. */
export function loadTmapWebSdk(key: string, timeoutMs = 10_000): Promise<Sdk> {
  if (sdkPromise && sdkKey === key) return sdkPromise;
  sdkKey = key;
  const loading = (async () => {
    const existing = (window as Browser).Tmapv3;
    if (validSdk(existing)) return existing;
    const endpoint = `https://apis.openapi.sk.com/tmap/vectorjs?version=1&appKey=${encodeURIComponent(key)}`;
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!response.ok) throw Error('SDK unavailable');
    const bootstrap = await response.text();
    const host = /var domian="(topopentile[123])"/.exec(bootstrap)?.[1];
    const version = /tmapjs3\.min\.js\?version=(\d{8})/.exec(bootstrap)?.[1];
    if (!host || !version || !bootstrap.includes('scriptSDKV3/') || !bootstrap.includes('vsm.css')) throw Error('SDK unavailable');
    const base = `https://${host}.tmap.co.kr/scriptSDKV3/`;
    return new Promise<Sdk>((resolve, reject) => {
      const style = document.createElement('link');
      const script = document.createElement('script');
      style.rel = 'stylesheet';
      style.href = `${base}vsm.css`;
      script.src = `${base}tmapjs3.min.js?version=${version}&appKey=${encodeURIComponent(key)}`;
      script.async = true;
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        style.onload = null; style.onerror = null;
        script.onload = null; script.onerror = null;
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        cleanup();
        script.remove(); style.remove();
        reject(Error('SDK unavailable'));
      };
      const timer = setTimeout(fail, timeoutMs);
      style.onload = () => {
        if (settled) return;
        try { document.head.appendChild(script); } catch { fail(); }
      };
      style.onerror = fail;
      script.onload = () => {
        const sdk = (window as Browser).Tmapv3;
        if (!validSdk(sdk)) { fail(); return; }
        if (settled) return;
        settled = true;
        cleanup();
        resolve(sdk);
      };
      script.onerror = fail;
      try { document.head.appendChild(style); } catch { fail(); }
    });
  })();
  const cached = loading.catch(error => {
    if (sdkPromise === cached) { sdkPromise = null; sdkKey = null; }
    throw error;
  });
  sdkPromise = cached;
  return cached;
}
