import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectionShareNotice,
  createImageLoadGate,
  performCollectionShare,
  type CollectionShareDeps,
} from './collection-share-flow';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function baseDeps(overrides: Partial<CollectionShareDeps> = {}): CollectionShareDeps {
  return {
    nextFrame: async () => {},
    imagesReady: async () => {},
    settle: async () => {},
    captureViewAsPng: async () => 'file://card.png',
    shareImageFile: async () => true,
    isAlive: () => true,
    ...overrides,
  };
}

test('a normal share captures the card and opens the share sheet', async () => {
  const calls: string[] = [];
  const outcome = await performCollectionShare(baseDeps({
    nextFrame: async () => { calls.push('frame'); },
    imagesReady: async () => { calls.push('images'); },
    settle: async () => { calls.push('settle'); },
    captureViewAsPng: async () => { calls.push('capture'); return 'file://card.png'; },
    shareImageFile: async (uri) => { calls.push(`share:${uri}`); return true; },
  }));
  assert.equal(outcome, 'shared');
  // 그림이 다 불러와진 뒤에 찍는다.
  assert.deepEqual(calls, ['frame', 'images', 'settle', 'capture', 'share:file://card.png']);
});

test('an unavailable share sheet is reported as unavailable, not as a failure', async () => {
  assert.equal(await performCollectionShare(baseDeps({ shareImageFile: async () => false })), 'unavailable');
});

test('a card that never mounted (nothing to capture) fails without opening the sheet', async () => {
  let shareCalls = 0;
  const outcome = await performCollectionShare(baseDeps({
    captureViewAsPng: async () => undefined,
    shareImageFile: async () => { shareCalls += 1; return true; },
  }));
  assert.equal(outcome, 'failed');
  assert.equal(shareCalls, 0);
});

test('a capture or share error resolves to failed instead of throwing', async () => {
  assert.equal(await performCollectionShare(baseDeps({ captureViewAsPng: async () => { throw new Error('capture failed'); } })), 'failed');
  assert.equal(await performCollectionShare(baseDeps({ shareImageFile: async () => { throw new Error('share failed'); } })), 'failed');
});

test('a screen that unmounted before the capture stops the job there', async () => {
  let alive = true;
  let captureCalls = 0;
  const outcome = await performCollectionShare(baseDeps({
    isAlive: () => alive,
    settle: async () => { alive = false; },
    captureViewAsPng: async () => { captureCalls += 1; return 'file://card.png'; },
  }));
  assert.equal(outcome, 'stopped');
  assert.equal(captureCalls, 0);
});

test('a screen that unmounted while capturing never reaches the share sheet', async () => {
  let alive = true;
  const capture = deferred<string | undefined>();
  const captureStarted = deferred<void>();
  let shareCalls = 0;
  const running = performCollectionShare(baseDeps({
    isAlive: () => alive,
    captureViewAsPng: () => { captureStarted.resolve(); return capture.promise; },
    shareImageFile: async () => { shareCalls += 1; return true; },
  }));
  await captureStarted.promise;
  alive = false;
  capture.resolve('file://card.png');
  assert.equal(await running, 'stopped');
  assert.equal(shareCalls, 0);
});

test('isAlive is handed to the share step so it can re-check right before the sheet opens', async () => {
  let handedOver: (() => boolean) | undefined;
  await performCollectionShare(baseDeps({ shareImageFile: async (_uri, isAlive) => { handedOver = isAlive; return true; } }));
  assert.equal(typeof handedOver, 'function');
});

test('a share step that declined because the screen went away is stopped, not "unavailable"', async () => {
  let alive = true;
  const outcome = await performCollectionShare(baseDeps({
    isAlive: () => alive,
    shareImageFile: async () => { alive = false; return false; },
  }));
  assert.equal(outcome, 'stopped');
});

test('the notice is Korean and only shown when the person still needs to know', () => {
  assert.match(collectionShareNotice('unavailable') ?? '', /이 기기에서는 이미지 공유 창을 열 수 없어요/);
  assert.match(collectionShareNotice('failed') ?? '', /도감 카드를 만들지 못했어요/);
  assert.equal(collectionShareNotice('shared'), undefined);
  assert.equal(collectionShareNotice('stopped'), undefined);
});

test('the image gate opens once every expected picture reported in', async () => {
  const gate = createImageLoadGate(2);
  let opened = false;
  const waiting = gate.wait(1000).then(() => { opened = true; });
  gate.markLoaded();
  await Promise.resolve();
  assert.equal(opened, false);
  gate.markLoaded();
  await waiting;
  assert.equal(opened, true);
});

test('the image gate does not wait when no picture is expected', async () => {
  await createImageLoadGate(0).wait(1000);
});

test('the image gate gives up after its timeout so a broken picture cannot hold the share forever', async () => {
  const started = Date.now();
  await createImageLoadGate(3).wait(20);
  assert.ok(Date.now() - started < 500);
});

test('extra load reports after the gate opened change nothing', async () => {
  const gate = createImageLoadGate(1);
  gate.markLoaded();
  gate.markLoaded();
  await gate.wait(1000);
});
