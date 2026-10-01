import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { performShare, type ShareFlowDeps } from './collectible-share-flow';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function baseDeps(overrides: Partial<ShareFlowDeps> = {}): ShareFlowDeps {
  return {
    nextFrame: async () => {},
    settle: async () => {},
    captureViewAsPng: async () => 'file://capture.png',
    shareImageFile: async () => true,
    shareText: async () => {},
    isAlive: () => true,
    ...overrides,
  };
}

test('a normal share captures and opens the image share sheet', async () => {
  assert.equal(await performShare(baseDeps()), 'image');
});

test('no offscreen card yet (capture resolves undefined) falls straight to the text share', async () => {
  let shareTextCalls = 0;
  const outcome = await performShare(baseDeps({
    captureViewAsPng: async () => undefined,
    shareText: async () => { shareTextCalls += 1; },
  }));
  assert.equal(outcome, 'text');
  assert.equal(shareTextCalls, 1);
});

test('an unavailable image share sheet falls back to the text share', async () => {
  assert.equal(await performShare(baseDeps({ shareImageFile: async () => false })), 'text');
});

test('a capture failure falls back to the text share instead of throwing', async () => {
  assert.equal(await performShare(baseDeps({ captureViewAsPng: async () => { throw new Error('capture failed'); } })), 'text');
});

test('a text share failure resolves to failed rather than throwing', async () => {
  assert.equal(await performShare(baseDeps({ shareImageFile: async () => false, shareText: async () => { throw new Error('no share sheet'); } })), 'failed');
});

// Regression: the screen (and its offscreen capture card) can unmount mid-flight on an account switch. Every one of
// these must stop the flow before it reaches a share sheet with the previous account's collectible.
test('going stale during the initial frame/settle wait skips the capture entirely', async () => {
  const wait = deferred<void>();
  let captureCalls = 0;
  let alive = true;
  const result = performShare(baseDeps({
    nextFrame: () => wait.promise,
    captureViewAsPng: async () => { captureCalls += 1; return 'file://capture.png'; },
    isAlive: () => alive,
  }));
  alive = false;
  wait.resolve();
  assert.equal(await result, 'failed');
  assert.equal(captureCalls, 0);
});

test('going stale during the capture skips the image share sheet', async () => {
  const capture = deferred<string>();
  let shareImageCalls = 0;
  let alive = true;
  const result = performShare(baseDeps({
    captureViewAsPng: () => capture.promise,
    shareImageFile: async () => { shareImageCalls += 1; return true; },
    isAlive: () => alive,
  }));
  alive = false;
  capture.resolve('file://capture.png');
  assert.equal(await result, 'failed');
  assert.equal(shareImageCalls, 0);
});

// This is the exact gap a plain "isAlive check before calling shareImageFile" leaves open: shareImageFile itself
// awaits (checking availability) before it would open the sheet, and can go stale during those awaits too. isAlive
// must reach all the way into shareImageFile's own decision, not just gate the call from the outside.
test('going stale during shareImageFile\'s own internal awaits still prevents the sheet from opening', async () => {
  const internalWait = deferred<void>();
  let openedSheet = false;
  let alive = true;
  const result = performShare(baseDeps({
    shareImageFile: async (_uri, isAlive) => {
      await internalWait.promise; // simulates shareImageFile's own `await Sharing.isAvailableAsync()`
      if (!isAlive()) return false;
      openedSheet = true;
      return true;
    },
    isAlive: () => alive,
  }));
  alive = false;
  internalWait.resolve();
  assert.equal(await result, 'failed');
  assert.equal(openedSheet, false);
});

test('going stale right before the text fallback skips it too', async () => {
  const capture = deferred<string | undefined>();
  let shareTextCalls = 0;
  let alive = true;
  const result = performShare(baseDeps({
    captureViewAsPng: () => capture.promise,
    shareImageFile: async () => false,
    shareText: async () => { shareTextCalls += 1; },
    isAlive: () => alive,
  }));
  alive = false;
  capture.resolve(undefined);
  assert.equal(await result, 'failed');
  assert.equal(shareTextCalls, 0);
});

// Light checks that the real shareImageFile helper (native-effects.ts) actually re-checks isAlive right before
// opening the sheet, and that the hook threads the real isAlive through rather than a no-op — the native module
// itself (expo-sharing) cannot be exercised under plain node:test.
test('native-effects.shareImageFile checks isAlive immediately before opening the share sheet', () => {
  const source = readFileSync(new URL('../../gamification/native-effects.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(!isAlive\(\)\) return false;\s*\n\s*await Sharing\.shareAsync/);
});

test('the hook wires its own alive flag through performShare and into shareImageFile', () => {
  const source = readFileSync(new URL('./collectible-share.tsx', import.meta.url), 'utf8');
  const hook = source.slice(source.indexOf('export function useCollectibleShare'));
  assert.match(hook, /isAlive: \(\) => alive\.current/);
  assert.match(hook, /shareImageFile: \(uri, isAlive\) => shareImageFile\(uri, '수집품 공유', isAlive\)/);
});
