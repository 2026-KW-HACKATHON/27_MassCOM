export type RevealStage = 'opening' | 'revealed';

export type RevealPlayDeps = {
  setAudioMode: () => Promise<void>;
  seekToStart: () => Promise<void>;
  startPlayback: () => void;
};

export type RevealLifecycleCallbacks = {
  /** Called once, synchronously from start(), when the opening animation should actually run. */
  onAnimateOpening: () => void;
  /**
   * Called when the stage completes, whether by the timer elapsing or a lifecycle change forcing it early. Always
   * deferred a tick (never called synchronously from setForeground/setMotionAllowed/start), so a caller driving
   * this from a React effect never calls a state setter synchronously inside that effect's own execution.
   */
  onStageComplete: () => void;
};

/**
 * Owns the collectible reveal's opening→revealed stage transition and the audio play generation, so that a mute,
 * background, or unmount that happens while play() is waiting on its own awaits (setAudioMode/seekToStart) cannot
 * still reach startPlayback() afterwards. Framework-agnostic: driven by real setTimeout/AppState in the component,
 * and by node:test's mock timers + deferred promises in tests (see reveal-lifecycle.test.ts).
 *
 * Motion (reduce-motion) and foreground are tracked separately because they gate different things: motion only
 * decides whether the *opening animation* plays or jumps straight to its end state, while foreground additionally
 * gates *audio* (playing a greeting while backgrounded makes no sense, reduce-motion has nothing to do with it).
 */
export class RevealLifecycle {
  stage: RevealStage = 'opening';
  #foreground: boolean;
  #motionAllowed: boolean;
  #muted = false;
  #playGeneration = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  #completing = false;

  constructor(
    private readonly callbacks: RevealLifecycleCallbacks,
    private readonly openingDurationMs: number,
    initial: { foreground: boolean; motionAllowed: boolean },
  ) {
    this.#foreground = initial.foreground;
    this.#motionAllowed = initial.motionAllowed;
  }

  #moving(): boolean {
    return this.#foreground && this.#motionAllowed;
  }

  /** Starts the opening animation/timer if conditions allow, or completes immediately otherwise. Call once, from an effect (never from render, since it may schedule a real timer). */
  start(): void {
    if (this.#started || this.stage !== 'opening') return;
    this.#started = true;
    if (!this.#moving()) {
      this.#complete();
      return;
    }
    this.callbacks.onAnimateOpening();
    this.#timer = setTimeout(() => this.#complete(), this.openingDurationMs);
  }

  #complete(): void {
    if (this.stage === 'revealed' || this.#completing) return;
    this.#completing = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    setTimeout(() => {
      this.stage = 'revealed';
      this.callbacks.onStageComplete();
    }, 0);
  }

  /** Background/foreground transitions. Going to the background stops any playing/pending audio and, mid-opening, completes the stage immediately (see class doc). */
  setForeground(foreground: boolean): void {
    this.#foreground = foreground;
    if (!foreground) {
      this.pause();
      if (this.stage === 'opening') this.#complete();
    }
  }

  /** Reduce-motion toggling. Turning it on mid-opening completes the stage immediately; it never touches audio. */
  setMotionAllowed(motionAllowed: boolean): void {
    this.#motionAllowed = motionAllowed;
    if (!motionAllowed && this.stage === 'opening') this.#complete();
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    if (muted) this.pause();
  }

  /** Invalidates any in-flight play() so its startPlayback() never fires, and stops anything already playing. */
  pause(): void {
    this.#playGeneration += 1;
  }

  /**
   * Plays the greeting if not muted and in the foreground. Waits on the caller's own async setup (setAudioMode,
   * seekToStart) before calling startPlayback — but only if nothing invalidated this specific attempt (mute,
   * background, another play(), or dispose) while it was waiting.
   */
  async play(deps: RevealPlayDeps): Promise<'played' | 'skipped'> {
    if (this.#muted || !this.#foreground) return 'skipped';
    const generation = ++this.#playGeneration;
    try {
      await deps.setAudioMode();
      await deps.seekToStart();
      if (generation !== this.#playGeneration) return 'skipped';
      deps.startPlayback();
      return 'played';
    } catch {
      return 'skipped';
    }
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.pause();
  }
}
