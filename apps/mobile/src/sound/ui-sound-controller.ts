export const UI_SOUND_NAMES = ['tap', 'navigate', 'success', 'error', 'open', 'flip', 'close'] as const;
export type UiSoundName = (typeof UI_SOUND_NAMES)[number];

export const UI_SOUND_STORAGE_KEY = 'masscom:ui-sounds:v1';
export const UI_SOUND_STORAGE_ERROR = '효과음 설정을 이 기기에 저장하지 못했어요. 다음 실행에서 다시 설정해 주세요.';

export type UiSoundSettings = {
  enabled: boolean;
  ready: boolean;
  setEnabled: (enabled: boolean) => void;
  persistenceError?: string;
};

export type SoundPlayer = {
  readonly isLoaded: boolean;
  seekTo(seconds: number): Promise<void>;
  play(): void;
  pause(): void;
  remove(): void;
};

export type SoundBackend = {
  prepare(): Promise<void>;
  createPlayer(name: UiSoundName): SoundPlayer;
};

export type SoundPreferenceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

type Dependencies = {
  backend: SoundBackend;
  storage: SoundPreferenceStorage;
  now?: () => number;
};

/** One root-owned controller; callbacks are deliberately fire-and-forget. */
export function createUiSoundController({ backend, storage, now = Date.now }: Dependencies) {
  let mounted = false;
  let foreground = false;
  let generation = 0;
  let lifecycle = 0;
  let preferenceVersion = 0;
  let writeQueue: Promise<void> = Promise.resolve();
  let settings: Omit<UiSoundSettings, 'setEnabled'> = { enabled: true, ready: false };
  const players = new Map<UiSoundName, SoundPlayer>();
  const seeking = new Map<UiSoundName, SoundPlayer>();
  const lastTap = { at: Number.NEGATIVE_INFINITY };
  const subscribers = new Set<() => void>();

  function publish(next: Omit<UiSoundSettings, 'setEnabled'>) {
    settings = next;
    snapshot = { ...next, setEnabled };
    subscribers.forEach((listener) => listener());
  }

  function pauseAll() {
    for (const player of players.values()) {
      try { player.pause(); } catch { /* Audio is optional. */ }
    }
  }

  function discardPlayers() {
    pauseAll();
    for (const player of players.values()) {
      try { player.remove(); } catch { /* A failed native player must not affect UI. */ }
    }
    players.clear();
    seeking.clear();
  }

  async function hydrate(epoch: number, version: number) {
    try {
      const stored = await storage.getItem(UI_SOUND_STORAGE_KEY);
      if (!mounted || lifecycle !== epoch) return;
      publish({
        ...settings,
        enabled: preferenceVersion === version ? stored !== 'false' : settings.enabled,
        ready: true,
      });
    } catch {
      if (!mounted || lifecycle !== epoch) return;
      publish({
        ...settings,
        enabled: preferenceVersion === version ? false : settings.enabled,
        ready: true,
        persistenceError: UI_SOUND_STORAGE_ERROR,
      });
    }
  }

  async function prepare(epoch: number) {
    try {
      await backend.prepare();
      if (!mounted || lifecycle !== epoch) return;
      for (const name of UI_SOUND_NAMES) {
        try {
          const player = backend.createPlayer(name);
          if (!mounted || lifecycle !== epoch) {
            player.remove();
            return;
          }
          players.set(name, player);
        } catch { /* A missing sound leaves other sounds usable. */ }
      }
    } catch { /* Old clients may not include expo-audio. */ }
  }

  const setEnabled = (enabled: boolean) => {
    if (settings.enabled === enabled && settings.ready && !settings.persistenceError) return;
    preferenceVersion += 1;
    if (!enabled) {
      generation += 1;
      pauseAll();
    }
    publish({ enabled, ready: settings.ready });
    const version = preferenceVersion;
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      try {
        await storage.setItem(UI_SOUND_STORAGE_KEY, String(enabled));
        if (version === preferenceVersion && settings.persistenceError) {
          publish({ ...settings, persistenceError: undefined });
        }
      } catch {
        if (version === preferenceVersion) {
          publish({ ...settings, persistenceError: UI_SOUND_STORAGE_ERROR });
        }
      }
    });
  };

  let snapshot: UiSoundSettings = { ...settings, setEnabled };
  const getSnapshot = (): UiSoundSettings => snapshot;

  return {
    getSnapshot,
    subscribe(listener: () => void) {
      subscribers.add(listener);
      return () => { subscribers.delete(listener); };
    },
    start(active: boolean) {
      if (mounted) return () => undefined;
      mounted = true;
      foreground = active;
      const epoch = ++lifecycle;
      generation += 1;
      publish({ ...settings, ready: false });
      void hydrate(epoch, preferenceVersion);
      void prepare(epoch);
      return () => {
        if (!mounted || lifecycle !== epoch) return;
        mounted = false;
        foreground = false;
        lifecycle += 1;
        generation += 1;
        discardPlayers();
        publish({ ...settings, ready: false });
      };
    },
    setForeground(active: boolean) {
      if (!mounted) return;
      foreground = active;
      if (!active) {
        generation += 1;
        pauseAll();
      }
    },
    setEnabled,
    play(name: UiSoundName): void {
      if (!mounted || !foreground || !settings.ready || !settings.enabled) return;
      const player = players.get(name);
      if (!player?.isLoaded || seeking.has(name)) return;
      const timestamp = now();
      if (name === 'tap' && timestamp - lastTap.at < 100) return;
      if (name === 'tap') lastTap.at = timestamp;
      const epoch = generation;
      seeking.set(name, player);
      try {
        void Promise.resolve(player.seekTo(0)).then(() => {
          if (mounted && foreground && settings.ready && settings.enabled && generation === epoch && players.get(name) === player && player.isLoaded && now() - timestamp <= 250) {
            player.play();
          }
        }).catch(() => undefined).finally(() => {
          if (seeking.get(name) === player) seeking.delete(name);
        });
      } catch {
        if (seeking.get(name) === player) seeking.delete(name);
      }
    },
  };
}
