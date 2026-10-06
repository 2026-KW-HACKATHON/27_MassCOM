import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNaverWebSdk } from './naver-web-sdk';

const sdk = { Map: class {}, LatLng: class {}, Marker: class {}, Polyline: class {}, Event: { addListener() {}, removeListener() {} } };
function browserStub() {
  let script: { src: string; onerror: (() => void) | null; removed: boolean; remove: () => void } | undefined;
  const browser = {} as Window & { naver?: { maps: typeof sdk }; navermap_authFailure?: () => void };
  const doc = { createElement: () => (script = { src: '', onerror: null, removed: false, remove() { this.removed = true; } }), head: { appendChild: () => undefined } };
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: browser, document: doc });
  return { browser, script: () => script!, restore: () => Object.assign(globalThis, previous) };
}

test('NAVER loader waits for official callback and cleans global hooks', async () => {
  const stub = browserStub();
  try {
    const first = loadNaverWebSdk('test-client');
    assert.equal(loadNaverWebSdk('test-client'), first);
    const url = new URL(stub.script().src);
    assert.equal(url.origin + url.pathname, 'https://oapi.map.naver.com/openapi/v3/maps.js');
    assert.equal(url.searchParams.get('ncpKeyId'), 'test-client');
    const callback = url.searchParams.get('callback')!;
    assert.equal(typeof (stub.browser as unknown as Record<string, unknown>)[callback], 'function');
    stub.browser.naver = { maps: sdk };
    ((stub.browser as unknown as Record<string, unknown>)[callback] as () => void)();
    assert.equal(await first, sdk);
    assert.equal((stub.browser as unknown as Record<string, unknown>)[callback], undefined);
    assert.equal(stub.browser.navermap_authFailure, undefined);
  } finally { stub.restore(); }
});

test('NAVER auth failure and deferred callback fail cleanly and permit retry', async () => {
  const stub = browserStub();
  try {
    const failed = loadNaverWebSdk('auth-failure');
    stub.browser.navermap_authFailure?.();
    await assert.rejects(failed, /NAVER SDK unavailable/);
    assert.equal(stub.script().removed, true);
    const delayed = loadNaverWebSdk('deferred', 5);
    const oldCallback = new URL(stub.script().src).searchParams.get('callback')!;
    await assert.rejects(delayed, /NAVER SDK unavailable/);
    assert.equal((stub.browser as unknown as Record<string, unknown>)[oldCallback], undefined);
    assert.equal(stub.script().removed, true);
    const retried = loadNaverWebSdk('deferred');
    const callback = new URL(stub.script().src).searchParams.get('callback')!;
    stub.browser.naver = { maps: sdk };
    ((stub.browser as unknown as Record<string, unknown>)[callback] as () => void)();
    assert.equal(await retried, sdk);
  } finally { stub.restore(); }
});

test('NAVER script error restores an existing auth hook', async () => {
  const stub = browserStub();
  const previous = () => undefined;
  stub.browser.navermap_authFailure = previous;
  try {
    const loading = loadNaverWebSdk('script-error');
    stub.script().onerror?.();
    await assert.rejects(loading, /NAVER SDK unavailable/);
    assert.equal(stub.browser.navermap_authFailure, previous);
  } finally { stub.restore(); }
});
