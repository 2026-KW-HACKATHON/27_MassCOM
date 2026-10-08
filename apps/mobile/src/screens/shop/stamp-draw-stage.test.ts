import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  STAMP_REVEAL_DURATION_MS,
  markStampOpeningComplete,
  stampOpeningWatchdogMs,
  stampPlaybackConfig,
  stampReducedMotionCompletionDelay,
} from './stamp-draw-media';

test('stamp playback keeps idle looping muted and opens with enabled effect volume only while active', () => {
  assert.deepEqual(stampPlaybackConfig('idle', true, { ready: true, soundEffectsEnabled: true, soundEffectsVolume: 0.7 }), {
    media: 'idle',
    loop: true,
    muted: true,
    volume: 0,
    playing: true,
  });
  assert.deepEqual(stampPlaybackConfig('opening', true, { ready: true, soundEffectsEnabled: true, soundEffectsVolume: 0.7 }), {
    media: 'opening',
    loop: false,
    muted: false,
    volume: 0.7,
    playing: true,
  });
  assert.equal(stampPlaybackConfig('opening', false, { ready: true, soundEffectsEnabled: true, soundEffectsVolume: 0.7 }).playing, false);
  assert.equal(stampPlaybackConfig('opening', true, { ready: true, soundEffectsEnabled: false, soundEffectsVolume: 0.7 }).muted, true);
  assert.equal(stampPlaybackConfig('opening', true, { ready: true, soundEffectsEnabled: true, soundEffectsVolume: 0.7 }, true).playing, false);
});

test('opening animation stays silent until saved sound settings are ready', () => {
  const loading = stampPlaybackConfig('opening', true, { ready: false, soundEffectsEnabled: true, soundEffectsVolume: 0.7 });
  assert.equal(loading.playing, true);
  assert.equal(loading.muted, true);
  assert.equal(loading.volume, 0);
  const disabled = stampPlaybackConfig('opening', true, { ready: true, soundEffectsEnabled: false, soundEffectsVolume: 0.7 });
  assert.equal(disabled.muted, true);
  assert.equal(disabled.volume, 0);
  const zeroVolume = stampPlaybackConfig('opening', true, { ready: true, soundEffectsEnabled: true, soundEffectsVolume: 0 });
  assert.equal(zeroVolume.muted, true);
  assert.equal(zeroVolume.volume, 0);
});

test('reduced motion completes opening immediately and watchdog stays bounded beyond the reveal duration', () => {
  assert.equal(stampReducedMotionCompletionDelay('idle', false), null);
  assert.equal(stampReducedMotionCompletionDelay('opening', false), 0);
  assert.equal(stampReducedMotionCompletionDelay('opening', true), null);
  assert.ok(stampOpeningWatchdogMs() > STAMP_REVEAL_DURATION_MS);
  assert.ok(stampOpeningWatchdogMs() <= 12_000);
});

test('completion latch allows only the first ended error or watchdog race to finish opening', () => {
  const latch = { current: false };
  assert.equal(markStampOpeningComplete(latch), true);
  assert.equal(markStampOpeningComplete(latch), false);
  assert.equal(markStampOpeningComplete(latch), false);
});

test('supplied stamp media fits the app budget and the reveal carries the effect audio track', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../assets/videos/gacha-stamp-audio-manifest.json', import.meta.url), 'utf8'));
  for (const item of Object.values(manifest.outputs) as { file: string; sha256: string; bytes: number }[]) {
    const bytes = readFileSync(new URL(`../../../assets/videos/${item.file}`, import.meta.url));
    assert.ok(bytes.length <= 3 * 1024 * 1024, `${item.file} exceeds 3 MiB`);
    assert.equal(bytes.length, item.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
  }
  const idle = readFileSync(new URL('../../../assets/videos/gacha-stamp-idle.mp4', import.meta.url));
  const reveal = readFileSync(new URL('../../../assets/videos/gacha-stamp-reveal.mp4', import.meta.url));
  assert.equal(idle.includes(Buffer.from('mp4a')), false);
  assert.equal(reveal.includes(Buffer.from('mp4a')), true);
  assert.equal(STAMP_REVEAL_DURATION_MS, 5040);
});

test('stage owns lifecycle guards without letting callback rerenders restart opening', () => {
  const stage = readFileSync(new URL('./stamp-draw-stage.tsx', import.meta.url), 'utf8');
  assert.match(stage, /const completeRef = useRef\(onComplete\)/);
  assert.match(stage, /const finishedOpeningLatch = useRef\(false\)/);
  assert.match(stage, /completeRef\.current = onComplete/);
  assert.match(stage, /<StampDrawStageContent key=\{phase\} phase=\{phase\}/);
  assert.match(stage, /if \(!markStampOpeningComplete\(finishedOpeningLatch\)\) return/);
  assert.match(stage, /if \(phase !== 'opening' \|\| !motionEnabled \|\| !active \|\| finishedOpening\) return/);
  assert.match(stage, /onError=\{phase === 'opening' \? completeOnce : undefined\}/);
});

test('web video retries sound on trusted input and handles autoplay rejection without unhandled promises', () => {
  const web = readFileSync(new URL('./stamp-video.web.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(web, /Image\.resolveAssetSource/);
  assert.match(web, /Asset\.fromModule\(source as number\)/);
  assert.match(web, /if \(element && uri && element\.getAttribute\('src'\) !== uri\) element\.setAttribute\('src', uri\)/);
  assert.match(web, /playbackGeneration\.current \+= 1;\s*element\.pause\(\);\s*element\.removeAttribute\('src'\);\s*element\.load\(\)/);
  assert.match(web, /playbackGeneration\.current !== generation/);
  assert.match(web, /TRUSTED_RETRY_EVENTS = \['pointerdown', 'keydown', 'touchstart'\]/);
  assert.match(web, /result\.catch\(\(error: unknown\) => \{/);
  assert.match(web, /element\.muted = true/);
  assert.match(web, /element\.play\(\)\?\.catch\(\(\) => undefined\)/);
  assert.match(web, /event\.isTrusted/);
});
