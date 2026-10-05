import { setGlobalHapticMode } from './ui-sound-state';

export const UI_SOUND_NAMES = ['tap', 'navigate', 'success', 'error', 'open', 'flip', 'close'] as const;
export type UiSoundName = (typeof UI_SOUND_NAMES)[number];
export type MusicSoundName = 'drawIntro' | 'drawLoop';
export type HapticMode = 'OFF' | 'DRAW_ONLY' | 'ALL';

export const UI_SOUND_STORAGE_KEY = 'masscom:ui-sounds:v1';
export const UI_SOUND_STORAGE_ERROR = '소리와 진동 설정을 이 기기에 저장하지 못했어요. 다음 실행에서 다시 설정해 주세요.';

export type UiSoundSettings = {
  /** Backwards-compatible alias for soundEffectsEnabled. */
  enabled: boolean;
  ready: boolean;
  setEnabled: (enabled: boolean) => void;
  soundEffectsEnabled: boolean;
  setSoundEffectsEnabled: (enabled: boolean) => void;
  soundEffectsVolume: number;
  setSoundEffectsVolume: (volume: number) => void;
  bgmEnabled: boolean;
  setBgmEnabled: (enabled: boolean) => void;
  bgmVolume: number;
  setBgmVolume: (volume: number) => void;
  hapticMode: HapticMode;
  setHapticMode: (mode: HapticMode) => void;
  reset: () => void;
  persistenceError?: string;
};

export type SoundPlayer = {
  readonly isLoaded: boolean;
  volume?: number;
  loop?: boolean;
  seekTo(seconds: number): Promise<void>;
  play(): void;
  pause(): void;
  remove(): void;
  addListener?: (event: 'playbackStatusUpdate', listener: (status: { didJustFinish?: boolean }) => void) => { remove(): void };
};

export type SoundBackend = {
  prepare(): Promise<void>;
  createPlayer(name: UiSoundName): SoundPlayer;
  createMusicPlayer?(name: MusicSoundName): SoundPlayer;
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

type PersistedSoundSettings = {
  soundEffectsEnabled: boolean;
  soundEffectsVolume: number;
  bgmEnabled: boolean;
  bgmVolume: number;
  hapticMode: HapticMode;
};

const DEFAULT_SETTINGS: PersistedSoundSettings = {
  soundEffectsEnabled: true,
  soundEffectsVolume: 0.3,
  bgmEnabled: true,
  bgmVolume: 0.3,
  hapticMode: 'ALL',
};
const MUSIC_NAMES: MusicSoundName[] = ['drawIntro', 'drawLoop'];

function clampVolume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function parseHapticMode(value: unknown, fallback: HapticMode): HapticMode {
  return value === 'OFF' || value === 'DRAW_ONLY' || value === 'ALL' ? value : fallback;
}

function parseSettings(stored: string | null): PersistedSoundSettings {
  if (stored === null) return DEFAULT_SETTINGS;
  if (stored === 'false') return { ...DEFAULT_SETTINGS, soundEffectsEnabled: false };
  if (stored === 'true') return { ...DEFAULT_SETTINGS, soundEffectsEnabled: true };
  try {
    const parsed = JSON.parse(stored) as Partial<PersistedSoundSettings>;
    return {
      soundEffectsEnabled: typeof parsed.soundEffectsEnabled === 'boolean' ? parsed.soundEffectsEnabled : DEFAULT_SETTINGS.soundEffectsEnabled,
      soundEffectsVolume: clampVolume(parsed.soundEffectsVolume, DEFAULT_SETTINGS.soundEffectsVolume),
      bgmEnabled: typeof parsed.bgmEnabled === 'boolean' ? parsed.bgmEnabled : DEFAULT_SETTINGS.bgmEnabled,
      bgmVolume: clampVolume(parsed.bgmVolume, DEFAULT_SETTINGS.bgmVolume),
      hapticMode: parseHapticMode(parsed.hapticMode, DEFAULT_SETTINGS.hapticMode),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function serializeSettings(settings: PersistedSoundSettings): string {
  return JSON.stringify(settings);
}

function settingsSnapshot(settings: PersistedSoundSettings) {
  return { ...settings, enabled: settings.soundEffectsEnabled };
}

/** One root-owned controller; callbacks are deliberately fire-and-forget. */
export function createUiSoundController({ backend, storage, now = Date.now }: Dependencies) {
  let mounted = false;
  let foreground = false;
  let generation = 0;
  let lifecycle = 0;
  let preferenceVersion = 0;
  let writeQueue: Promise<void> = Promise.resolve();
  let settings = { ...settingsSnapshot(DEFAULT_SETTINGS), ready: false, persistenceError: undefined as string | undefined };
  const players = new Map<UiSoundName, SoundPlayer>();
  const musicPlayers = new Map<MusicSoundName, SoundPlayer>();
  const musicSubscriptions: { remove(): void }[] = [];
  const seeking = new Map<UiSoundName, SoundPlayer>();
  const musicSeeking = new Map<MusicSoundName, SoundPlayer>();
  const lastTap = { at: Number.NEGATIVE_INFINITY };
  const subscribers = new Set<() => void>();
  let drawMusicFocused = false;
  let musicActivated = false;
  let musicState: 'idle' | 'intro' | 'loop' = 'idle';

  function publish(next: typeof settings) {
    settings = { ...next, enabled: next.soundEffectsEnabled };
    setGlobalHapticMode(settings.hapticMode);
    snapshot = {
      ...settings,
      setEnabled,
      setSoundEffectsEnabled: setEnabled,
      setSoundEffectsVolume,
      setBgmEnabled,
      setBgmVolume,
      setHapticMode,
      reset,
    };
    subscribers.forEach((listener) => listener());
  }

  function persisted(): PersistedSoundSettings {
    return {
      soundEffectsEnabled: settings.soundEffectsEnabled,
      soundEffectsVolume: settings.soundEffectsVolume,
      bgmEnabled: settings.bgmEnabled,
      bgmVolume: settings.bgmVolume,
      hapticMode: settings.hapticMode,
    };
  }

  function pauseMusic() {
    musicSeeking.clear();
    for (const player of musicPlayers.values()) {
      try { player.pause(); } catch { /* Audio is optional. */ }
    }
  }

  function pauseAll() {
    for (const player of players.values()) {
      try { player.pause(); } catch { /* Audio is optional. */ }
    }
    pauseMusic();
  }

  function removePlayer(player: SoundPlayer) {
    try { player.remove(); } catch { /* A failed native player must not affect UI. */ }
  }

  function discardPlayers() {
    pauseAll();
    for (const subscription of musicSubscriptions.splice(0)) {
      try { subscription.remove(); } catch { /* Listener cleanup is best effort. */ }
    }
    for (const player of players.values()) removePlayer(player);
    for (const player of musicPlayers.values()) removePlayer(player);
    players.clear();
    musicPlayers.clear();
    seeking.clear();
    musicSeeking.clear();
    musicActivated = false;
    musicState = 'idle';
  }

  function applyEffectVolume() {
    for (const player of players.values()) {
      try { player.volume = settings.soundEffectsVolume; } catch { /* Volume is optional on old clients. */ }
    }
  }

  function applyMusicVolume() {
    for (const player of musicPlayers.values()) {
      try { player.volume = settings.bgmVolume; } catch { /* Volume is optional on old clients. */ }
    }
  }

  function queuePersist(version: number) {
    const value = serializeSettings(persisted());
    writeQueue = writeQueue.catch(() => undefined).then(async () => {
      try {
        await storage.setItem(UI_SOUND_STORAGE_KEY, value);
        if (version === preferenceVersion && settings.persistenceError) {
          publish({ ...settings, persistenceError: undefined });
        }
      } catch {
        if (version === preferenceVersion) {
          publish({ ...settings, persistenceError: UI_SOUND_STORAGE_ERROR });
        }
      }
    });
  }

  function commitPreference(next: Partial<PersistedSoundSettings>) {
    preferenceVersion += 1;
    const nextSettings = { ...settings, ...next, persistenceError: undefined };
    if (next.soundEffectsEnabled === false) {
      generation += 1;
      for (const player of players.values()) {
        try { player.pause(); } catch { /* Optional. */ }
      }
    }
    publish(nextSettings);
    if (next.soundEffectsVolume !== undefined) applyEffectVolume();
    if (next.bgmVolume !== undefined) applyMusicVolume();
    if (next.bgmEnabled !== undefined) {
      generation += 1;
      if (!next.bgmEnabled) pauseMusic();
      else applyMusicIntent(false);
    }
    queuePersist(preferenceVersion);
  }

  async function hydrate(epoch: number, version: number) {
    try {
      const stored = await storage.getItem(UI_SOUND_STORAGE_KEY);
      if (!mounted || lifecycle !== epoch) return;
      const hydrated = parseSettings(stored);
      publish({
        ...settings,
        ...(preferenceVersion === version ? settingsSnapshot(hydrated) : settingsSnapshot(persisted())),
        ready: true,
      });
      applyEffectVolume();
      applyMusicVolume();
      applyMusicIntent(false);
    } catch {
      if (!mounted || lifecycle !== epoch) return;
      publish({
        ...settings,
        ...(preferenceVersion === version
          ? settingsSnapshot({ ...persisted(), soundEffectsEnabled: false, bgmEnabled: false, hapticMode: 'OFF' })
          : settingsSnapshot(persisted())),
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
          player.volume = settings.soundEffectsVolume;
          if (!mounted || lifecycle !== epoch) {
            removePlayer(player);
            return;
          }
          players.set(name, player);
        } catch { /* A missing sound leaves other sounds usable. */ }
      }
      for (const name of MUSIC_NAMES) {
        try {
          const player = backend.createMusicPlayer?.(name);
          if (!player) continue;
          player.volume = settings.bgmVolume;
          if (name === 'drawLoop') player.loop = true;
          if (!mounted || lifecycle !== epoch) {
            removePlayer(player);
            return;
          }
          if (name === 'drawIntro') {
            const subscription = player.addListener?.('playbackStatusUpdate', (status) => {
              if (status.didJustFinish) handleIntroFinished(epoch);
            });
            if (subscription) musicSubscriptions.push(subscription);
          }
          musicPlayers.set(name, player);
        } catch { /* BGM is optional. */ }
      }
      applyMusicIntent(false);
    } catch { /* Old clients may not include expo-audio. */ }
  }

  function canPlayMusic() {
    return mounted && foreground && settings.ready && settings.bgmEnabled;
  }

  function playMusic(name: MusicSoundName, restart: boolean) {
    if (!canPlayMusic() || musicSeeking.has(name)) return;
    const player = musicPlayers.get(name);
    if (!player?.isLoaded) return;
    const epoch = generation;
    const startedAt = now();
    pauseMusic();
    musicState = name === 'drawIntro' ? 'intro' : 'loop';
    if (!restart) {
      try { player.play(); } catch { /* Optional. */ }
      return;
    }
    musicSeeking.set(name, player);
    try {
      void Promise.resolve(player.seekTo(0)).then(() => {
        if (canPlayMusic() && generation === epoch && musicPlayers.get(name) === player && player.isLoaded && now() - startedAt <= 500) {
          player.play();
        }
      }).catch(() => undefined).finally(() => {
        if (musicSeeking.get(name) === player) musicSeeking.delete(name);
      });
    } catch {
      if (musicSeeking.get(name) === player) musicSeeking.delete(name);
    }
  }

  function applyMusicIntent(restartIntro: boolean) {
    if (!canPlayMusic()) {
      pauseMusic();
      return;
    }
    if (drawMusicFocused) {
      musicActivated = true;
      if (musicState === 'intro') playMusic('drawIntro', restartIntro);
      else if (musicState === 'loop') playMusic('drawLoop', false);
      else playMusic('drawIntro', true);
      return;
    }
    if (!musicActivated) {
      pauseMusic();
      return;
    }
    playMusic('drawLoop', musicState !== 'loop');
  }

  function handleIntroFinished(epoch: number) {
    if (!mounted || lifecycle !== epoch || !drawMusicFocused || musicState !== 'intro') return;
    generation += 1;
    playMusic('drawLoop', true);
  }

  const setEnabled = (enabled: boolean) => {
    if (settings.soundEffectsEnabled === enabled && settings.ready && !settings.persistenceError) return;
    commitPreference({ soundEffectsEnabled: enabled });
  };

  const setSoundEffectsVolume = (volume: number) => {
    const next = clampVolume(volume, settings.soundEffectsVolume);
    if (next === settings.soundEffectsVolume && settings.ready && !settings.persistenceError) return;
    commitPreference({ soundEffectsVolume: next });
  };

  const setBgmEnabled = (enabled: boolean) => {
    if (settings.bgmEnabled === enabled && settings.ready && !settings.persistenceError) return;
    commitPreference({ bgmEnabled: enabled });
  };

  const setBgmVolume = (volume: number) => {
    const next = clampVolume(volume, settings.bgmVolume);
    if (next === settings.bgmVolume && settings.ready && !settings.persistenceError) return;
    commitPreference({ bgmVolume: next });
  };

  const setHapticMode = (mode: HapticMode) => {
    if (settings.hapticMode === mode && settings.ready && !settings.persistenceError) return;
    commitPreference({ hapticMode: mode });
  };

  const reset = () => {
    preferenceVersion += 1;
    generation += 1;
    publish({ ...settings, ...settingsSnapshot(DEFAULT_SETTINGS), persistenceError: undefined });
    applyEffectVolume();
    applyMusicVolume();
    applyMusicIntent(false);
    queuePersist(preferenceVersion);
  };

  let snapshot: UiSoundSettings = {
    ...settings,
    setEnabled,
    setSoundEffectsEnabled: setEnabled,
    setSoundEffectsVolume,
    setBgmEnabled,
    setBgmVolume,
    setHapticMode,
    reset,
  };
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
        drawMusicFocused = false;
        musicActivated = false;
        discardPlayers();
        publish({ ...settings, ready: false });
      };
    },
    setForeground(active: boolean) {
      if (!mounted) return;
      foreground = active;
      generation += 1;
      if (!active) {
        pauseAll();
        return;
      }
      applyMusicIntent(false);
    },
    setDrawMusicFocused(active: boolean) {
      if (!mounted || drawMusicFocused === active) return;
      drawMusicFocused = active;
      generation += 1;
      if (active) {
        musicActivated = true;
        musicState = 'idle';
        applyMusicIntent(true);
        return;
      }
      applyMusicIntent(true);
    },
    setEnabled,
    setSoundEffectsVolume,
    setBgmEnabled,
    setBgmVolume,
    setHapticMode,
    reset,
    play(name: UiSoundName): void {
      if (!mounted || !foreground || !settings.ready || !settings.soundEffectsEnabled) return;
      const player = players.get(name);
      if (!player?.isLoaded || seeking.has(name)) return;
      const timestamp = now();
      if (name === 'tap' && timestamp - lastTap.at < 100) return;
      if (name === 'tap') lastTap.at = timestamp;
      const epoch = generation;
      seeking.set(name, player);
      try {
        void Promise.resolve(player.seekTo(0)).then(() => {
          if (mounted && foreground && settings.ready && settings.soundEffectsEnabled && generation === epoch && players.get(name) === player && player.isLoaded && now() - timestamp <= 250) {
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
