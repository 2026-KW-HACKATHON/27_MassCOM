import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { transpileModule } from 'typescript';
import { createUiSoundController, type SoundPlayer } from './sound/ui-sound-controller';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function gestureHarness() {
  const sounds = source('./sound/ui-sounds.ts');
  const gestureSource = sounds.slice(sounds.indexOf('function onFirstGesture'), sounds.indexOf('/** Call once'));
  const listeners = new Map<string, (event: { isTrusted: boolean }) => void>();
  const onFirstGesture = runInNewContext(`${transpileModule(gestureSource, {}).outputText}; onFirstGesture`, {
    document: {
      addEventListener(name: string, listener: (event: { isTrusted: boolean }) => void) { listeners.set(name, listener); },
      removeEventListener(name: string) { listeners.delete(name); },
    },
  }) as (controller: Pick<ReturnType<typeof createUiSoundController>, 'loadUiPlayers' | 'needsMusicGesture' | 'subscribe'>) => () => void;
  return { listeners, onFirstGesture };
}

test('web first-input loading uses trusted pointer, keyboard and touch and removes all listeners after success or cleanup', () => {
  const { listeners, onFirstGesture } = gestureHarness();
  for (const event of ['pointerdown', 'keydown', 'touchstart']) {
    let inputs = 0;
    const stop = onFirstGesture({ loadUiPlayers: () => { inputs += 1; }, needsMusicGesture: () => inputs === 0, subscribe: () => () => undefined });
    assert.deepEqual([...listeners.keys()], ['pointerdown', 'keydown', 'touchstart']);
    listeners.get(event)!({ isTrusted: false });
    assert.equal(inputs, 0);
    assert.equal(listeners.size, 3);
    listeners.get(event)!({ isTrusted: true });
    assert.equal(inputs, 1);
    assert.equal(listeners.size, 0);
    stop();
    assert.equal(inputs, 1);
  }
  const stop = onFirstGesture({ loadUiPlayers: () => assert.fail('unmounted input must not activate sound'), needsMusicGesture: () => true, subscribe: () => () => undefined });
  stop();
  assert.equal(listeners.size, 0);
  assert.match(source('./sound/ui-sounds.ts'), /onFirstGesture\(controller\)/);
});

async function webMusicFixture(loaded = true) {
  const listeners = new Map<string, (status: { playing: boolean }) => void>();
  let playResult = () => Promise.resolve();
  let attempts = 0;
  const controller = createUiSoundController({
    deferUiPlayers: true,
    storage: { getItem: async () => null, setItem: async () => undefined },
    backend: {
      prepare: async () => undefined,
      createPlayer: () => { throw Error('unused effects'); },
      createMusicPlayer: (name): SoundPlayer => ({
        get isLoaded() { return loaded; },
        seekTo: async () => assert.fail('gesture playback must not wait for seekTo'),
        play: () => { attempts += 1; return playResult(); },
        pause: () => undefined,
        remove: () => undefined,
        addListener: (_event, listener) => { listeners.set(name, listener); return { remove: () => { listeners.delete(name); } }; },
      }),
    },
  });
  const stop = controller.start(true);
  const gestures = gestureHarness();
  const stopGestures = gestures.onFirstGesture(controller);
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { controller, ...gestures, attempts: () => attempts, load: () => { loaded = true; },
    setPlay: (next: typeof playResult) => { playResult = next; },
    status: (playing: boolean) => listeners.get('drawLoop')?.({ playing }),
    unmount: stop,
    stop: () => { stopGestures(); stop(); } };
}

test('cold web loading keeps gestures armed and the next gesture plays synchronously', async () => {
  const fixture = await webMusicFixture(false);
  fixture.listeners.get('pointerdown')!({ isTrusted: true });
  assert.equal(fixture.attempts(), 0);
  assert.equal(fixture.listeners.size, 3);
  fixture.load();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.attempts(), 0, 'loading alone must not consume the gesture retry');
  fixture.listeners.get('touchstart')!({ isTrusted: true });
  assert.equal(fixture.attempts(), 1, 'play is called inside the gesture, before any microtasks');
  assert.equal(fixture.listeners.size, 3, 'an attempt is not yet successful playback');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.listeners.size, 0);
  fixture.stop();
});

test('web play promise rejection keeps gestures armed until a later gesture succeeds', async () => {
  const fixture = await webMusicFixture();
  fixture.setPlay(() => Promise.reject(Error('NotAllowedError')));
  fixture.listeners.get('keydown')!({ isTrusted: true });
  assert.equal(fixture.attempts(), 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.listeners.size, 3);
  fixture.setPlay(() => Promise.resolve());
  fixture.listeners.get('pointerdown')!({ isTrusted: true });
  assert.equal(fixture.attempts(), 2);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(fixture.listeners.size, 0);
  fixture.stop();
});

test('web playing status removes gestures and rejection status rearms them', async () => {
  const fixture = await webMusicFixture();
  fixture.setPlay(() => new Promise<void>(() => undefined));
  fixture.listeners.get('pointerdown')!({ isTrusted: true });
  assert.equal(fixture.listeners.size, 3);
  fixture.status(true);
  assert.equal(fixture.listeners.size, 0);
  fixture.status(false);
  assert.equal(fixture.listeners.size, 3);
  fixture.listeners.get('keydown')!({ isTrusted: true });
  assert.equal(fixture.attempts(), 2);
  fixture.status(true);
  assert.equal(fixture.listeners.size, 0);
  fixture.stop();
});

test('mute, logout and unmount remove music listeners and stale playback cannot restore them', async () => {
  const fixture = await webMusicFixture();
  let resolve!: () => void;
  fixture.setPlay(() => new Promise<void>((done) => { resolve = done; }));
  fixture.listeners.get('pointerdown')!({ isTrusted: true });
  fixture.controller.setBgmEnabled(false);
  assert.equal(fixture.listeners.size, 0);
  fixture.controller.setBgmEnabled(true);
  assert.equal(fixture.listeners.size, 3);
  fixture.controller.setMusicSessionActive(false);
  assert.equal(fixture.listeners.size, 0);
  resolve();
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(fixture.listeners.size, 0);
  fixture.controller.setMusicSessionActive(true);
  assert.equal(fixture.listeners.size, 3, 'a new session needs its own confirmed playback');
  fixture.unmount();
  assert.equal(fixture.listeners.size, 0);
  fixture.stop();
});

test('reset and newer gestures invalidate stale playback promises without losing the retry', async () => {
  for (const invalidate of ['reset', 'gesture'] as const) {
    const fixture = await webMusicFixture();
    let resolve!: () => void;
    fixture.setPlay(() => new Promise<void>((done) => { resolve = done; }));
    fixture.listeners.get('pointerdown')!({ isTrusted: true });
    if (invalidate === 'reset') fixture.controller.reset();
    else {
      fixture.setPlay(() => Promise.reject(Error('NotAllowedError')));
      fixture.listeners.get('keydown')!({ isTrusted: true });
    }
    resolve();
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(fixture.listeners.size, 3, `${invalidate}: stale success must not remove the current retry`);
    fixture.setPlay(() => Promise.resolve());
    fixture.listeners.get('touchstart')!({ isTrusted: true });
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(fixture.listeners.size, 0);
    fixture.stop();
  }
});

test('effects still load on trusted input with muted BGM or a logged-out session', async () => {
  for (const inactive of ['muted', 'loggedOut'] as const) {
    let effects = 0;
    const controller = createUiSoundController({
      deferUiPlayers: true,
      storage: { getItem: async () => inactive === 'muted' ? JSON.stringify({ bgmEnabled: false }) : null, setItem: async () => undefined },
      backend: { prepare: async () => undefined, createPlayer: () => {
        effects += 1;
        return { isLoaded: true, seekTo: async () => undefined, play: () => undefined, pause: () => undefined, remove: () => undefined };
      }, createMusicPlayer: () => { assert.fail('muted or logged-out music must not be downloaded'); } },
    });
    const stop = controller.start(true);
    if (inactive === 'loggedOut') controller.setMusicSessionActive(false);
    const music = gestureHarness();
    const stopMusic = music.onFirstGesture(controller);
    const ui = gestureHarness();
    const stopUi = ui.onFirstGesture({
      loadUiPlayers: () => controller.loadUiPlayers(false), needsMusicGesture: controller.needsUiGesture, subscribe: controller.subscribe,
    });
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(music.listeners.size, 0);
    assert.equal(ui.listeners.size, 3);
    assert.equal(effects, 0);
    ui.listeners.get('pointerdown')!({ isTrusted: false });
    assert.equal(effects, 0);
    ui.listeners.get('pointerdown')!({ isTrusted: true });
    assert.equal(effects, 7);
    assert.equal(ui.listeners.size, 0);
    assert.equal(music.listeners.size, 0);
    stopUi(); stopMusic(); stop();
  }
  assert.match(source('./sound/ui-sounds.ts'), /needsMusicGesture: controller\.needsUiGesture/);
  assert.match(source('./app/_layout.tsx'), /setUiSoundSessionActive\(Boolean\(auth\.accountId\)\)/);
});

test('installed web audio emits autoplay rejection status and the version-pinned patch preserves that fix', async () => {
  const installed = source('../node_modules/expo-audio/build/AudioPlayer.web.js');
  const body = installed.match(/\n    play\(\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(body, 'exercise the installed player implementation');
  const play = runInNewContext(`(function () {${body}})`, {
    isAudioActive: true, PLAYBACK_STATUS_UPDATE: 'playbackStatusUpdate', getStatusFromMedia: () => ({ isLoaded: true }),
  }) as (this: unknown) => void;
  let attempts = 0;
  let sampling = 0;
  const statuses: { event: string; playing: boolean }[] = [];
  const player = {
    media: { play() { attempts += 1; return Promise.reject<void>(new Error('NotAllowedError')); } },
    isPlaying: false,
    startSampling() { sampling += 1; },
    stopSampling() { sampling -= 1; },
    emit(event: string, status: { playing: boolean }) { statuses.push({ event, playing: status.playing }); },
  };
  assert.doesNotThrow(() => play.call(player));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(attempts, 1);
  assert.equal(player.isPlaying, false, 'rejected playback is not reported as playing');
  assert.equal(sampling, 0);
  assert.deepEqual(statuses, [{ event: 'playbackStatusUpdate', playing: false }], 'the controller can observe rejection and rearm');
  player.media.play = () => { attempts += 1; return Promise.resolve(); };
  play.call(player);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(player.isPlaying, true, 'successful playback keeps the upstream behavior');
  assert.equal(sampling, 1);
  const { version } = JSON.parse(source('../node_modules/expo-audio/package.json')) as { version: string };
  const patch = source(`../patches/expo-audio+${version}.patch`);
  for (const file of ['src/AudioPlayer.web.ts', 'build/AudioPlayer.web.js']) {
    assert.ok(patch.includes(`node_modules/expo-audio/${file}`));
  }
  assert.match(patch, /\+\s+void this\.media\.play\(\)\.catch\(\(\) => \{/);
  assert.equal(patch.match(/\+\s+this\.emit\(PLAYBACK_STATUS_UPDATE, .*playing: false/g)?.length, 2);
});

test('owner greetings and UI sounds preserve the same foreground audio session policy', () => {
  for (const path of ['./sound/ui-sounds.ts', './screens/collection/collectible-detail.tsx']) {
    const code = source(path);
    assert.match(code, /setAudioModeAsync\(foregroundAudioMode\)/);
    assert.doesNotMatch(code, /setAudioModeAsync\(\{/);
  }
  const mode = source('./sound/playback-audio-mode.ts');
  assert.match(mode, /playsInSilentMode: false/);
  assert.match(mode, /interruptionMode: 'mixWithOthers'/);
});

test('shared controls play tap only from enabled press handlers and tab navigation respects prevention', () => {
  for (const path of ['./ui/bounce-button.tsx', './ui/floating-card.tsx']) {
    assert.match(source(path), /onPress=\{\(\) => \{ void lightHaptic\(\); playUiSound\('tap'\); onPress\(\); \}\}/);
  }
  const tabs = source('./navigation/floating-tab-bar.tsx');
  assert.match(tabs, /if \(!selected && !event\.defaultPrevented\) \{\s*void lightHaptic\(\); playUiSound\('navigate'\); navigation\.navigate/);
  assert.doesNotMatch(tabs, /playUiSound\('navigate'\)[\s\S]*const event = navigation\.emit/);
});

test('account setting is accessible, waits for persisted state, and describes its device scope', () => {
  const layout = source('./app/_layout.tsx');
  const settings = source('./screens/account-settings/index.tsx');
  const volume = source('./screens/account-settings/settings-volume.tsx');
  assert.match(layout, /useEffect\(\(\) => initializeUiSounds\(\), \[\]\)/);
  assert.match(settings, /<SettingsVolume settings=\{soundSettings\} styles=\{styles\} palette=\{palette\} \/>/);
  assert.match(volume, /accessibilityLabel="효과음"/);
  assert.match(volume, /disabled=\{!settings\.ready\}/);
  assert.match(volume, /onValueChange=\{settings\.setEnabled\}/);
  assert.match(volume, /버튼·화면 이동·보상 획득 효과음\. 이 기기에 저장돼요\./);
  assert.match(volume, /accessibilityLabel="배경음악"/);
  assert.match(volume, /label: '뽑기만'/);
  assert.match(volume, /소리·진동 초기화/);
  assert.match(settings, /soundSettings\.persistenceError/);
});

test('draw music and draw haptics are owned by the gacha modal without changing root initialization', () => {
  const sounds = source('./sound/ui-sounds.ts');
  const gacha = source('./screens/shop/gacha-machine.tsx');
  const stampStage = source('./screens/shop/stamp-draw-stage.tsx');
  const stampMedia = source('./screens/shop/stamp-draw-media.ts');
  const effects = source('./gamification/native-effects.ts');
  assert.match(sounds, /export function useDrawMusic\(enabled = true\)/);
  assert.match(sounds, /controller\.setDrawMusicFocused\(true\)/);
  assert.match(sounds, /controller\.setDrawMusicFocused\(false\)/);
  assert.match(gacha, /import \{ playUiSound, useDrawMusic \} from '@\/sound\/ui-sounds'/);
  assert.match(gacha, /useDrawMusic\(\)/);
  assert.match(gacha, /void drawHaptic\(\)/);
  assert.match(stampStage, /useUiSoundSettings\(\)/);
  assert.match(stampMedia, /muted: !opening \|\| !active \|\| !sound\.soundEffectsEnabled/);
  assert.match(effects, /export async function drawHaptic\(\)/);
  assert.match(effects, /mode !== 'DRAW_ONLY' && mode !== 'ALL'/);
});

test('claim and reward success sounds require fresh server results', () => {
  const claim = source('./screens/claim-redeem/index.tsx');
  const redeem = claim.slice(claim.indexOf('async function redeem()'), claim.indexOf('async function findGrantedArtwork'));
  assert.match(redeem, /await api\.redeemClaim\(target\);\s*if \(!redeemGate\.isCurrent\(request\)\) return;\s*(?:if \(securePending\) void pendingStore\.clearIfMatches\(accountId, pending\)\.catch\(\(\) => undefined\);\s*)?if \(!result\.replayed\) playUiSound\('success'\)/);
  assert.match(redeem, /catch \(error\) \{\s*if \(!redeemGate\.isCurrent\(request\)\) return;\s*playUiSound\('error'\)/);
  assert.doesNotMatch(claim.slice(claim.indexOf('function handleScanned'), claim.indexOf('async function inspect')), /playUiSound\('error'\)/);

  const box = source('./gamification/reward-box.tsx');
  assert.match(box, /catch \(caught\) \{\s*if \(!isCurrent\(\)\) return;\s*box\.current\?\.settle\(\);[\s\S]*?playUiSound\('error'\);\s*const code/);

  const reveal = source('./gamification/reward-reveal.tsx');
  assert.match(reveal, /!result\.replayed && celebratedCoupon\.current !== result\.coupon\.couponId/);
  assert.match(reveal, /celebratedCoupon\.current = result\.coupon\.couponId;\s*void successHaptic\(\);\s*playUiSound\('success'\)/);
});

test('envelope cues follow opening, foreground completion, and actual card changes', () => {
  const envelope = source('./screens/collection/envelope/envelope-reveal.tsx');
  const open = envelope.slice(envelope.indexOf('function openEnvelope'), envelope.indexOf('function goTo'));
  const step = envelope.slice(envelope.indexOf('function goTo'), envelope.indexOf('const panResponder'));
  assert.match(open, /setUiStage\('tearing'\);\s*playUiSound\('open'\)/);
  assert.match(open, /onStageComplete:[\s\S]*AppState\.currentState === 'active'\) playUiSound\('success'\)/);
  assert.match(step, /return current\.stage === 'end' \? \(next\.stage === 'end' \? current : next\)/);
  assert.match(envelope, /previous\.stage !== cardStep\.stage \|\| \(previous\.stage === 'cards' && cardStep\.stage === 'cards' && previous\.index !== cardStep\.index\)/);
  assert.match(envelope, /playUiSound\('flip'\)/);
  assert.doesNotMatch(step, /playUiSound/);
});
