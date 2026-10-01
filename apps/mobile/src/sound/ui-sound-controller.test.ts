import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createUiSoundController,
  UI_SOUND_NAMES,
  UI_SOUND_STORAGE_ERROR,
  UI_SOUND_STORAGE_KEY,
  type SoundPlayer,
} from './ui-sound-controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function fixture(options: { stored?: string | null; prepare?: () => Promise<void>; read?: () => Promise<string | null> } = {}) {
  const events: string[] = [];
  const players = new Map<string, SoundPlayer>();
  const writes: { key: string; value: string }[] = [];
  let clock = 1000;
  const controller = createUiSoundController({
    backend: {
      prepare: options.prepare ?? (async () => undefined),
      createPlayer(name) {
        const player: SoundPlayer = {
          isLoaded: true,
          async seekTo(seconds) { events.push(`${name}:seek:${seconds}`); },
          play() { events.push(`${name}:play`); },
          pause() { events.push(`${name}:pause`); },
          remove() { events.push(`${name}:remove`); },
        };
        players.set(name, player);
        return player;
      },
    },
    storage: {
      getItem: options.read ?? (async () => options.stored ?? null),
      async setItem(key, value) { writes.push({ key, value }); },
    },
    now: () => clock,
  });
  return { controller, events, players, writes, advance: (ms: number) => { clock += ms; } };
}

test('hydrates saved false before any sound and never auto-plays on startup', async () => {
  const pending = deferred<string | null>();
  const { controller, events } = fixture({ read: () => pending.promise });
  const stop = controller.start(true);
  await flush();
  controller.play('success');
  assert.equal(events.some((event) => event.endsWith(':play')), false);
  pending.resolve('false');
  await flush();
  assert.deepEqual({ enabled: controller.getSnapshot().enabled, ready: controller.getSnapshot().ready }, { enabled: false, ready: true });
  controller.play('success');
  assert.equal(events.some((event) => event.endsWith(':play')), false);
  stop();
});

test('reuses seven bounded players, rewinds before replay, and debounces rapid taps', async () => {
  const { controller, events, players, advance } = fixture();
  const stop = controller.start(true);
  await flush();
  assert.equal(players.size, UI_SOUND_NAMES.length);
  controller.play('tap');
  await flush();
  controller.play('tap');
  await flush();
  assert.equal(events.filter((event) => event === 'tap:play').length, 1);
  advance(101);
  controller.play('tap');
  await flush();
  assert.equal(events.filter((event) => event === 'tap:play').length, 2);
  assert.deepEqual(events.filter((event) => event.startsWith('tap:seek') || event === 'tap:play'), [
    'tap:seek:0', 'tap:play', 'tap:seek:0', 'tap:play',
  ]);
  stop();
  assert.equal(events.filter((event) => event.endsWith(':remove')).length, UI_SOUND_NAMES.length);
});

test('mute, background and teardown cancel sounds waiting on seek', async () => {
  const { controller, events, players } = fixture();
  const stop = controller.start(true);
  await flush();
  const seek = deferred<void>();
  players.get('open')!.seekTo = () => seek.promise;
  controller.play('open');
  controller.setEnabled(false);
  seek.resolve();
  await flush();
  assert.equal(events.includes('open:play'), false);
  controller.setEnabled(true);
  controller.play('close');
  controller.setForeground(false);
  await flush();
  assert.equal(events.includes('close:play'), false);
  controller.setForeground(true);
  const secondSeek = deferred<void>();
  players.get('flip')!.seekTo = () => secondSeek.promise;
  controller.play('flip');
  stop();
  secondSeek.resolve();
  await flush();
  assert.equal(events.includes('flip:play'), false);
});

test('unloaded players are silent until a later explicit play', async () => {
  const { controller, events, players } = fixture();
  const stop = controller.start(true);
  await flush();
  const player = players.get('navigate')!;
  Object.defineProperty(player, 'isLoaded', { value: false, configurable: true });
  controller.play('navigate');
  Object.defineProperty(player, 'isLoaded', { value: true });
  await flush();
  assert.equal(events.includes('navigate:play'), false);
  controller.play('navigate');
  await flush();
  assert.equal(events.includes('navigate:play'), true);
  stop();
});

test('late backend readiness and failed backend never play after teardown', async () => {
  const pending = deferred<void>();
  const { controller, players } = fixture({ prepare: () => pending.promise });
  const stop = controller.start(true);
  stop();
  pending.resolve();
  await flush();
  assert.equal(players.size, 0);
  const failed = fixture({ prepare: async () => { throw Error('native module absent'); } });
  const end = failed.controller.start(true);
  await flush();
  assert.doesNotThrow(() => failed.controller.play('tap'));
  end();
});

test('failed storage shows a notice; rapid setting writes preserve their order', async () => {
  const firstWrite = deferred<void>();
  const writes: string[] = [];
  const controller = createUiSoundController({
    backend: { prepare: async () => undefined, createPlayer: () => { throw Error('unavailable'); } },
    storage: {
      getItem: async () => { throw Error('read failed'); },
      setItem: async (key, value) => {
        assert.equal(key, UI_SOUND_STORAGE_KEY);
        writes.push(value);
        if (writes.length === 1) await firstWrite.promise;
      },
    },
  });
  const stop = controller.start(true);
  await flush();
  assert.equal(controller.getSnapshot().persistenceError, UI_SOUND_STORAGE_ERROR);
  assert.equal(controller.getSnapshot().enabled, false);
  controller.setEnabled(false);
  controller.setEnabled(true);
  await flush();
  assert.deepEqual(writes, ['false']);
  firstWrite.resolve();
  await flush();
  assert.deepEqual(writes, ['false', 'true']);
  assert.equal(controller.getSnapshot().persistenceError, undefined);
  stop();
});

test('a late preference read cannot override a user toggle', async () => {
  const pending = deferred<string | null>();
  const { controller, writes } = fixture({ read: () => pending.promise });
  const stop = controller.start(true);
  controller.setEnabled(false);
  pending.resolve(null);
  await flush();
  assert.equal(controller.getSnapshot().enabled, false);
  assert.equal(controller.getSnapshot().ready, true);
  assert.deepEqual(writes, [{ key: UI_SOUND_STORAGE_KEY, value: 'false' }]);
  stop();
});

test('a failed write reports the problem and a later successful toggle clears it', async () => {
  const values: string[] = [];
  const controller = createUiSoundController({
    backend: { prepare: async () => undefined, createPlayer: () => { throw Error('unavailable'); } },
    storage: {
      getItem: async () => null,
      setItem: async (_key, value) => {
        values.push(value);
        if (value === 'false') throw Error('disk full');
      },
    },
  });
  const stop = controller.start(true);
  await flush();
  controller.setEnabled(false);
  await flush();
  assert.equal(controller.getSnapshot().persistenceError, UI_SOUND_STORAGE_ERROR);
  controller.setEnabled(true);
  await flush();
  assert.deepEqual(values, ['false', 'true']);
  assert.equal(controller.getSnapshot().persistenceError, undefined);
  stop();
});

test('seek failure and native playback exceptions never escape the sound call', async () => {
  const { controller, players, events } = fixture();
  const stop = controller.start(true);
  await flush();
  players.get('error')!.seekTo = async () => { throw Error('seek failed'); };
  assert.doesNotThrow(() => controller.play('error'));
  await flush();
  assert.equal(events.includes('error:play'), false);
  players.get('success')!.play = () => { throw Error('native playback failed'); };
  assert.doesNotThrow(() => controller.play('success'));
  await flush();
  stop();
});

test('a rewind taking longer than 250 ms cannot play stale audio', async () => {
  const { controller, players, events, advance } = fixture();
  const stop = controller.start(true);
  await flush();
  const seek = deferred<void>();
  players.get('open')!.seekTo = () => seek.promise;
  controller.play('open');
  advance(251);
  seek.resolve();
  await flush();
  assert.equal(events.includes('open:play'), false);
  stop();
});
