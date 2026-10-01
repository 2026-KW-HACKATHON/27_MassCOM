import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { RevealLifecycle, type RevealPlayDeps } from './reveal-lifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function playDeps(overrides: Partial<RevealPlayDeps> = {}): RevealPlayDeps & { startCalls: number } {
  const state = { startCalls: 0 };
  return {
    get startCalls() { return state.startCalls; },
    setAudioMode: overrides.setAudioMode ?? (async () => {}),
    seekToStart: overrides.seekToStart ?? (async () => {}),
    startPlayback: overrides.startPlayback ?? (() => { state.startCalls += 1; }),
  };
}

function lifecycle(events: string[], durationMs = 700, initial = { foreground: true, motionAllowed: true }) {
  return new RevealLifecycle(
    { onAnimateOpening: () => events.push('animate'), onStageComplete: () => events.push('complete') },
    durationMs,
    initial,
  );
}

test('start() animates and completes via its own timer, not before', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const events: string[] = [];
    const control = lifecycle(events);
    control.start();
    assert.deepEqual(events, ['animate']);
    assert.equal(control.stage, 'opening');

    mock.timers.tick(699);
    assert.equal(control.stage, 'opening');
    assert.deepEqual(events, ['animate']);

    mock.timers.tick(1);
    assert.equal(control.stage, 'revealed');
    assert.deepEqual(events, ['animate', 'complete']);
  } finally {
    mock.timers.reset();
  }
});

test('start() completes immediately, without animating, when not moving from the start', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const events: string[] = [];
    const control = lifecycle(events, 700, { foreground: false, motionAllowed: true });
    control.start();
    assert.deepEqual(events, []); // deferred a tick
    mock.timers.tick(0);
    assert.equal(control.stage, 'revealed');
    assert.deepEqual(events, ['complete']);
  } finally {
    mock.timers.reset();
  }
});

// Regression: backgrounding mid-opening used to leave the opening timer running and the screen stuck showing the
// animation forever, since nothing forced the stage forward.
test('backgrounding mid-opening cancels the timer and completes immediately, once', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const events: string[] = [];
    const control = lifecycle(events);
    control.start();
    mock.timers.tick(300);

    control.setForeground(false);
    mock.timers.tick(0);
    assert.equal(control.stage, 'revealed');
    assert.deepEqual(events, ['animate', 'complete']);

    // The original 700ms timer must not still be pending and fire a second completion.
    mock.timers.tick(1000);
    assert.deepEqual(events, ['animate', 'complete']);
  } finally {
    mock.timers.reset();
  }
});

// Regression: turning on reduce-motion mid-opening used to leave stage stuck at 'opening' forever (the effect
// guarded on motionAllowed but never advanced the stage), so the greeting/detail button never appeared.
test('turning on reduce-motion mid-opening completes immediately', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const events: string[] = [];
    const control = lifecycle(events);
    control.start();
    mock.timers.tick(300);

    control.setMotionAllowed(false);
    mock.timers.tick(0);
    assert.equal(control.stage, 'revealed');
    assert.deepEqual(events, ['animate', 'complete']);
  } finally {
    mock.timers.reset();
  }
});

test('muted or backgrounded play() is skipped immediately without touching any dependency', async () => {
  const events: string[] = [];
  const control = lifecycle(events);
  control.setMuted(true);
  const deps = playDeps({ setAudioMode: async () => { throw new Error('should not be called'); } });
  assert.equal(await control.play(deps), 'skipped');
  assert.equal(deps.startCalls, 0);

  const control2 = lifecycle(events, 700, { foreground: false, motionAllowed: true });
  assert.equal(await control2.play(deps), 'skipped');
  assert.equal(deps.startCalls, 0);
});

// The core race this controller exists for: mute() arriving after play() has already started its own awaits must
// still stop startPlayback from ever firing once those awaits resolve.
test('a pending play() invalidated by mute() before its awaits resolve never starts playback', async () => {
  const events: string[] = [];
  const control = lifecycle(events);
  const audioMode = deferred<void>();
  const seek = deferred<void>();
  const deps = playDeps({ setAudioMode: () => audioMode.promise, seekToStart: () => seek.promise });

  const result = control.play(deps);
  control.setMuted(true); // arrives while play() is still awaiting setAudioMode
  audioMode.resolve();
  seek.resolve();

  assert.equal(await result, 'skipped');
  assert.equal(deps.startCalls, 0);
});

test('a pending play() invalidated by backgrounding before its awaits resolve never starts playback', async () => {
  const events: string[] = [];
  const control = lifecycle(events);
  const audioMode = deferred<void>();
  const seek = deferred<void>();
  const deps = playDeps({ setAudioMode: () => audioMode.promise, seekToStart: () => seek.promise });

  const result = control.play(deps);
  control.setForeground(false); // background arrives mid-flight
  audioMode.resolve();
  seek.resolve();

  assert.equal(await result, 'skipped');
  assert.equal(deps.startCalls, 0);
});

test('an explicit pause() invalidates a pending play() the same way', async () => {
  const events: string[] = [];
  const control = lifecycle(events);
  const audioMode = deferred<void>();
  const deps = playDeps({ setAudioMode: () => audioMode.promise });

  const result = control.play(deps);
  control.pause();
  audioMode.resolve();

  assert.equal(await result, 'skipped');
  assert.equal(deps.startCalls, 0);
});

test('dispose() invalidates a pending play() and cancels the opening timer', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const events: string[] = [];
    const control = lifecycle(events);
    control.start();
    const audioMode = deferred<void>();
    const deps = playDeps({ setAudioMode: () => audioMode.promise });
    const result = control.play(deps);

    control.dispose();
    audioMode.resolve();
    assert.equal(await result, 'skipped');
    assert.equal(deps.startCalls, 0);

    // The opening timer was disposed; it must never fire a completion after the fact.
    mock.timers.tick(10_000);
    assert.deepEqual(events, ['animate']);
  } finally {
    mock.timers.reset();
  }
});

test('a second play() call invalidates the first; only the latest may reach startPlayback', async () => {
  const events: string[] = [];
  const control = lifecycle(events);
  const firstAudioMode = deferred<void>();
  const first = control.play(playDeps({ setAudioMode: () => firstAudioMode.promise }));

  const second = control.play(playDeps());
  firstAudioMode.resolve();

  assert.equal(await first, 'skipped');
  assert.equal(await second, 'played');
});

test('an unmuted, foregrounded play() with no interruption reaches startPlayback', async () => {
  const events: string[] = [];
  const control = lifecycle(events);
  const deps = playDeps();
  assert.equal(await control.play(deps), 'played');
  assert.equal(deps.startCalls, 1);
});
