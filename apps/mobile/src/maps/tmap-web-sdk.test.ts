import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { loadTmapWebSdk } from './tmap-web-sdk';

const bootstrap = 'var domian="topopentile1";var e="/scriptSDKV3/";c=["tmapjs3.min.js?version=20231206"];h="vsm.css";document.write(d.join(""));';
const sdk = { Map: class {}, LatLng: class {}, Marker: class {}, Polyline: class {} };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function browserStub(body = bootstrap, status = 200) {
  type Element = { tag: string; src: string; href: string; rel: string; async: boolean; onload: (() => void) | null; onerror: (() => void) | null; removed: boolean; remove: () => void };
  const elements: Element[] = [];
  const browser = {} as Window & { Tmapv3?: typeof sdk };
  const doc = {
    createElement: (tag: string) => ({ tag, src: '', href: '', rel: '', async: false, onload: null, onerror: null,
      removed: false, remove() { this.removed = true; } }),
    head: { appendChild: (element: Element) => { elements.push(element); } },
    write: () => { throw Error('document.write must never run'); },
  };
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const requested: string[] = [];
  Object.assign(globalThis, { window: browser, document: doc, fetch: async (input: string) => {
    requested.push(input);
    return new Response(body, { status });
  } });
  return { browser, elements, requested, restore: () => Object.assign(globalThis, previous) };
}

test('authenticated bootstrap is read as data; allowlisted CSS and SDK load without document.write', async () => {
  const stub = browserStub();
  try {
    const first = loadTmapWebSdk('public key');
    assert.equal(loadTmapWebSdk('public key'), first);
    await tick();
    assert.equal(stub.requested.length, 1);
    assert.match(stub.requested[0]!, /^https:\/\/apis\.openapi\.sk\.com\/tmap\/vectorjs\?version=1&appKey=public%20key$/);
    assert.deepEqual(stub.elements.map(item => item.tag), ['link']);
    assert.equal(stub.elements[0]!.href, 'https://topopentile1.tmap.co.kr/scriptSDKV3/vsm.css');
    stub.elements[0]!.onload?.();
    assert.deepEqual(stub.elements.map(item => item.tag), ['link', 'script']);
    assert.match(stub.elements[1]!.src, /^https:\/\/topopentile1\.tmap\.co\.kr\/scriptSDKV3\/tmapjs3\.min\.js\?version=20231206&appKey=public%20key$/);
    stub.browser.Tmapv3 = sdk;
    stub.elements[1]!.onload?.();
    assert.equal(await first, sdk);
    assert.equal(stub.elements[0]!.removed, false);
  } finally { stub.restore(); }
});

test('auth failure and malformed bootstrap reject before any CDN asset is inserted', async () => {
  for (const [name, body, status] of [['auth', 'unauthorized', 401], ['unknown-assets', 'document.write("malicious")', 200]] as const) {
    const stub = browserStub(body, status);
    try {
      await assert.rejects(loadTmapWebSdk(name), /SDK unavailable/);
      assert.equal(stub.elements.length, 0);
    } finally { stub.restore(); }
  }
});

test('deferred CDN script times out, removes script and style, then retries', async () => {
  const stub = browserStub();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = loadTmapWebSdk('deferred', 10);
    const rejected = assert.rejects(pending, /SDK unavailable/);
    await tick();
    stub.elements[0]!.onload?.();
    mock.timers.tick(10);
    await rejected;
    assert.equal(stub.elements[0]!.removed, true);
    assert.equal(stub.elements[1]!.removed, true);
    assert.equal(stub.elements[1]!.onload, null);
    const retried = loadTmapWebSdk('deferred', 100);
    await tick();
    stub.elements[2]!.onload?.();
    stub.browser.Tmapv3 = sdk;
    stub.elements[3]!.onload?.();
    assert.equal(await retried, sdk);
    assert.equal(stub.requested.length, 2);
  } finally { mock.timers.reset(); stub.restore(); }
});

test('stylesheet failure cleans its tag and does not leave the SDK pending', async () => {
  const stub = browserStub();
  try {
    const pending = loadTmapWebSdk('style-failure');
    await tick();
    stub.elements[0]!.onerror?.();
    await assert.rejects(pending, /SDK unavailable/);
    assert.equal(stub.elements[0]!.removed, true);
    assert.equal(stub.elements.length, 1);
  } finally { stub.restore(); }
});
