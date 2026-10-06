import type { TmapMapProps } from './tmap-view';
import { groupMapMarkers, markerIcon, selectMarkerGroup } from './tmap-web-cluster';
import type { Overlay, Sdk, WebMap } from './tmap-web-sdk';

type Snapshot = Pick<TmapMapProps, 'camera' | 'markers' | 'selectedId' | 'route'>;
type Callbacks = Pick<TmapMapProps, 'onReady' | 'onViewport' | 'onSelect' | 'onCluster'>;

/** One visible SDK map and its overlays; a new focus interval gets a new session. */
export class TmapWebSession {
  private readonly map: WebMap;
  private snapshot: Snapshot;
  private applied: Snapshot | null = null;
  private ready = false;
  private disposed = false;
  private markers: Overlay[] = [];
  private lines: Overlay[] = [];

  constructor(private readonly sdk: Sdk, id: string, snapshot: Snapshot, private readonly callbacks: () => Callbacks) {
    this.snapshot = snapshot;
    this.map = new sdk.Map(id, { center: new sdk.LatLng(snapshot.camera.latitude, snapshot.camera.longitude),
      zoom: snapshot.camera.zoom, width: '100%', height: '100%' });
    this.map.on('ConfigLoad', () => {
      if (this.disposed) return;
      this.ready = true;
      this.apply();
      this.callbacks().onReady?.();
      this.emitViewport();
    });
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
      this.markers = groupMapMarkers(current.markers).map(group => {
        const item = new this.sdk.Marker({ position: new this.sdk.LatLng(group.latitude, group.longitude), map: this.map,
          title: group.title, icon: markerIcon(group, current.selectedId) });
        item.on?.('Click', () => selectMarkerGroup(group, this.callbacks().onSelect, this.callbacks().onCluster));
        return item;
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
    this.callbacks().onViewport?.({ bounds: { west: bounds.getSouthWest().longitude(), south: bounds.getSouthWest().latitude(),
      east: bounds.getNorthEast().longitude(), north: bounds.getNorthEast().latitude() },
      camera: { latitude: center.latitude(), longitude: center.longitude(), zoom: this.map.getZoom() } });
  }
  resize(): void { if (!this.disposed) this.map.resize(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.markers.forEach(marker => marker.setMap(null));
    this.lines.forEach(line => line.setMap(null));
    this.markers = [];
    this.lines = [];
    this.map.destroy?.();
  }
}
