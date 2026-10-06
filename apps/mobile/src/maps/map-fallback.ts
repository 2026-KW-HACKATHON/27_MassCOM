import type { TmapMapProps } from './tmap-view';

export type MapProvider = 'TMAP' | 'NAVER';
export type MapSnapshot = Pick<TmapMapProps, 'camera' | 'markers' | 'selectedId' | 'route'>;
export type MapSession = { update(snapshot: MapSnapshot): void; resize(): void; emitViewport(): void; dispose(): void };
type StartSession = (provider: MapProvider, ready: () => void, failed: () => void, isCurrent: () => boolean) => Promise<MapSession>;

/** One attempt at a time; stale SDK callbacks cannot replace a successful fallback. */
export class MapFallback {
  private generation = 0;
  private session: MapSession | null = null;
  private stopped = false;
  constructor(private readonly tmapKey: string | undefined, private readonly naverKey: string | undefined,
    private readonly startSession: StartSession, private readonly onReady: (provider: MapProvider) => void,
    private readonly onError: (code: string) => void, private readonly clearMap: () => void) {}

  start(): void {
    if (this.tmapKey) void this.attempt('TMAP');
    else if (this.naverKey) void this.attempt('NAVER');
    else this.onError('MAP_NOT_CONFIGURED');
  }
  private async attempt(provider: MapProvider): Promise<void> {
    const generation = ++this.generation;
    try {
      const session = await this.startSession(provider,
        () => { if (!this.stopped && generation === this.generation) this.onReady(provider); },
        () => this.fail(provider, generation),
        () => !this.stopped && generation === this.generation);
      if (this.stopped || generation !== this.generation) session.dispose();
      else this.session = session;
    } catch { this.fail(provider, generation); }
  }
  private fail(provider: MapProvider, generation: number): void {
    if (this.stopped || generation !== this.generation) return;
    this.session?.dispose();
    this.session = null;
    if (provider === 'TMAP' && this.naverKey) {
      this.clearMap();
      void this.attempt('NAVER');
    } else {
      ++this.generation;
      this.clearMap();
      this.onError('MAP_WEB_SDK_UNAVAILABLE');
    }
  }
  update(snapshot: MapSnapshot): void { this.session?.update(snapshot); }
  resize(): void { this.session?.resize(); }
  emitViewport(): void { this.session?.emitViewport(); }
  dispose(): void { this.stopped = true; ++this.generation; this.session?.dispose(); this.session = null; }
}
