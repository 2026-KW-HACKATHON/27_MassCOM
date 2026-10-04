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
    exportImageFile: async () => 'shared',
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
    exportImageFile: async (uri) => { calls.push(`export:${uri}`); return 'shared'; },
  }));
  assert.equal(outcome, 'shared');
  // 그림이 다 불러와진 뒤에 찍는다.
  assert.deepEqual(calls, ['frame', 'images', 'settle', 'capture', 'export:file://card.png']);
});

test('browser save and platform cancellation are reported accurately', async () => {
  assert.equal(await performCollectionShare(baseDeps({ exportImageFile: async () => 'saved' })), 'saved');
  assert.equal(await performCollectionShare(baseDeps({ exportImageFile: async () => 'cancelled' })), 'cancelled');
  assert.equal(await performCollectionShare(baseDeps({ exportImageFile: async () => 'unavailable' })), 'unavailable');
});

test('a card that never mounted (nothing to capture) fails without opening the sheet', async () => {
  let shareCalls = 0;
  const outcome = await performCollectionShare(baseDeps({
    captureViewAsPng: async () => undefined,
    exportImageFile: async () => { shareCalls += 1; return 'shared'; },
  }));
  assert.equal(outcome, 'failed');
  assert.equal(shareCalls, 0);
});

test('a capture or share error resolves to failed instead of throwing', async () => {
  assert.equal(await performCollectionShare(baseDeps({ captureViewAsPng: async () => { throw new Error('capture failed'); } })), 'failed');
  assert.equal(await performCollectionShare(baseDeps({ exportImageFile: async () => { throw new Error('share failed'); } })), 'failed');
  assert.equal(await performCollectionShare(baseDeps({ imagesReady: async () => { throw new Error('image timeout'); } })), 'failed');
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
    exportImageFile: async () => { shareCalls += 1; return 'shared'; },
  }));
  await captureStarted.promise;
  alive = false;
  capture.resolve('file://card.png');
  assert.equal(await running, 'stopped');
  assert.equal(shareCalls, 0);
});

test('isAlive is handed to the share step so it can re-check right before the sheet opens', async () => {
  let handedOver: (() => boolean) | undefined;
  await performCollectionShare(baseDeps({ exportImageFile: async (_uri, isAlive) => { handedOver = isAlive; return 'shared'; } }));
  assert.equal(typeof handedOver, 'function');
});

test('an export step that ended with account cancellation is stopped', async () => {
  let alive = true;
  const outcome = await performCollectionShare(baseDeps({
    isAlive: () => alive,
    exportImageFile: async () => { alive = false; return 'cancelled'; },
  }));
  assert.equal(outcome, 'stopped');
});

test('a screen that went away during a failed capture is stopped', async () => {
  let alive = true;
  const outcome = await performCollectionShare(baseDeps({
    isAlive: () => alive,
    captureViewAsPng: async () => { alive = false; throw new Error('capture failed'); },
  }));
  assert.equal(outcome, 'stopped');
});

test('the notice is Korean and only shown when the person still needs to know', () => {
  assert.match(collectionShareNotice('unavailable') ?? '', /내보낼 수 없어요/);
  assert.match(collectionShareNotice('saved') ?? '', /이미지를 저장했어요/);
  assert.match(collectionShareNotice('shared') ?? '', /공유 창을 열었어요/);
  assert.match(collectionShareNotice('cancelled') ?? '', /취소했어요/);
  assert.match(collectionShareNotice('failed') ?? '', /도감 카드를 만들지 못했어요/);
  assert.equal(collectionShareNotice('stopped'), undefined);
});

test('the image gate opens once every expected picture reported in', async () => {
  const gate = createImageLoadGate(2);
  let opened = false;
  const waiting = gate.wait(1000).then(() => { opened = true; });
  gate.markLoaded('mascot');
  await Promise.resolve();
  assert.equal(opened, false);
  gate.markLoaded('picture-1');
  await waiting;
  assert.equal(opened, true);
});

test('the image gate does not wait when no picture is expected', async () => {
  await createImageLoadGate(0).wait(1000);
});

test('image failure or timeout rejects before capture', async () => {
  const failed = createImageLoadGate(2);
  const waiting = failed.wait(1000);
  failed.markFailed('picture-1');
  await assert.rejects(waiting, /IMAGE_LOAD_FAILED/);
  const started = Date.now();
  await assert.rejects(createImageLoadGate(3).wait(20), /IMAGE_LOAD_TIMEOUT/);
  assert.ok(Date.now() - started < 500);
});

test('extra load reports after the gate opened change nothing', async () => {
  const gate = createImageLoadGate(1);
  gate.markLoaded('mascot');
  gate.markLoaded('mascot');
  await gate.wait(1000);
});
