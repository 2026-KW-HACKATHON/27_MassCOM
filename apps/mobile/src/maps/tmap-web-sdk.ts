export type LatLng = { latitude(): number; longitude(): number };
export type WebMap = {
  setCenter(point: LatLng): void; setZoom(zoom: number): void; getCenter(): LatLng;
  getZoom(): number; getBounds(): { getSouthWest(): LatLng; getNorthEast(): LatLng };
  resize(): void; destroy?(): void; on(event: string, callback: () => void): void;
};
export type Overlay = { setMap(map: WebMap | null): void; on?(event: string, callback: () => void): void };
export type Sdk = {
  Map: new (id: string, options: { center: LatLng; zoom: number; width: string; height: string }) => WebMap;
  LatLng: new (latitude: number, longitude: number) => LatLng;
  Marker: new (options: { position: LatLng; map: WebMap; title?: string; icon?: string }) => Overlay;
  Polyline: new (options: { path: LatLng[]; strokeColor: string; strokeWeight: number; map: WebMap }) => Overlay;
};
type Browser = Window & { Tmapv3?: Sdk };
let sdkPromise: Promise<Sdk> | null = null;
let sdkKey: string | null = null;
export function loadTmapWebSdk(key: string): Promise<Sdk> {
  if (sdkPromise && sdkKey === key) return sdkPromise;
  sdkKey = key;
  sdkPromise = new Promise<Sdk>((resolve, reject) => {
    const existing = (window as Browser).Tmapv3;
    if (existing) { resolve(existing); return; }
    const script = document.createElement('script');
    script.src = `https://apis.openapi.sk.com/tmap/vectorjs?version=1&appKey=${encodeURIComponent(key)}`;
    script.async = true;
    script.onload = () => (window as Browser).Tmapv3 ? resolve((window as Browser).Tmapv3!) : reject(Error('SDK unavailable'));
    script.onerror = () => reject(Error('SDK unavailable'));
    document.head.appendChild(script);
  }).catch(error => { sdkPromise = null; throw error; });
  return sdkPromise!;
}
