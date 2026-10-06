import type { TmapMapProps } from './tmap-view';
import { groupMapMarkers, markerIcon, selectMarkerGroup } from './tmap-web-cluster';
import type { NaverMap, NaverMaps, NaverOverlay } from './naver-web-sdk';

type Snapshot = Pick<TmapMapProps, 'camera' | 'markers' | 'selectedId' | 'route'>;
type Callbacks = Pick<TmapMapProps, 'onReady' | 'onViewport' | 'onSelect' | 'onCluster'>;

export class NaverWebSession {
  private readonly map: NaverMap;
  private snapshot: Snapshot;
  private applied: Snapshot | null = null;
  private ready = false;
  private disposed = false;
  private markers: NaverOverlay[] = [];
  private lines: NaverOverlay[] = [];
  private listeners: object[] = [];
  private markerListeners: object[] = [];
  private readyTimer: ReturnType<typeof setTimeout>;

  constructor(private readonly sdk: NaverMaps, id: string, snapshot: Snapshot, private readonly callbacks: () => Callbacks,
    private readonly onFailure?: () => void, readyTimeoutMs = 10_000) {
    this.snapshot = snapshot;
    this.map = new sdk.Map(id, { center: new sdk.LatLng(snapshot.camera.latitude, snapshot.camera.longitude), zoom: snapshot.camera.zoom });
    this.readyTimer = setTimeout(() => { this.dispose(); this.onFailure?.(); }, readyTimeoutMs);
    this.listeners.push(sdk.Event.addListener(this.map, 'init', () => {
      if (this.disposed) return;
      clearTimeout(this.readyTimer);
      this.ready = true;
      this.apply();
      this.callbacks().onReady?.();
      this.emitViewport();
    }));
    this.listeners.push(sdk.Event.addListener(this.map, 'idle', () => this.emitViewport()));
  }

  update(snapshot: Snapshot): void { this.snapshot = snapshot; if (this.ready && !this.disposed) this.apply(); }
  private apply(): void {
    const current = this.snapshot, previous = this.applied;
    if (!previous || previous.camera.latitude !== current.camera.latitude || previous.camera.longitude !== current.camera.longitude || previous.camera.zoom !== current.camera.zoom) {
      this.map.setZoom(current.camera.zoom);
      this.map.setCenter(new this.sdk.LatLng(current.camera.latitude, current.camera.longitude));
    }
    if (!previous || previous.markers !== current.markers || previous.selectedId !== current.selectedId) {
      this.markers.forEach(marker => marker.setMap(null));
      this.markerListeners.forEach(listener => this.sdk.Event.removeListener(listener));
      this.markerListeners = [];
      this.markers = groupMapMarkers(current.markers).map(group => {
        const marker = new this.sdk.Marker({ position: new this.sdk.LatLng(group.latitude, group.longitude), map: this.map,
          title: group.title, icon: markerIcon(group, current.selectedId) });
        const listener = this.sdk.Event.addListener(marker, 'click', () =>
          selectMarkerGroup(group, this.callbacks().onSelect, this.callbacks().onCluster));
        this.markerListeners.push(listener);
        return marker;
      });
    }
    if (!previous || previous.route !== current.route) {
      this.lines.forEach(line => line.setMap(null));
      this.lines = current.route?.type === 'MultiLineString' ? current.route.coordinates.map(line =>
        new this.sdk.Polyline({ path: line.map(([lon, lat]) => new this.sdk.LatLng(lat, lon)),
          strokeColor: '#2a70b2', strokeWeight: 5, map: this.map })) : [];
    }
    this.applied = current;
  }

  emitViewport(): void {
    if (!this.ready || this.disposed) return;
    const bounds = this.map.getBounds(), center = this.map.getCenter();
    this.callbacks().onViewport?.({ bounds: { west: bounds.getSW().lng(), south: bounds.getSW().lat(),
      east: bounds.getNE().lng(), north: bounds.getNE().lat() },
      camera: { latitude: center.lat(), longitude: center.lng(), zoom: this.map.getZoom() } });
  }
  resize(): void { if (!this.disposed) this.map.autoResize(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.readyTimer);
    [...this.listeners, ...this.markerListeners].forEach(listener => this.sdk.Event.removeListener(listener));
    this.listeners = [];
    this.markerListeners = [];
    this.markers.forEach(marker => marker.setMap(null));
    this.lines.forEach(line => line.setMap(null));
    this.markers = [];
    this.lines = [];
    this.map.destroy();
  }
}
