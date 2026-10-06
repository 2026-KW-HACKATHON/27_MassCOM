import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTmapWebSdk } from './tmap-web-sdk';

test('web SDK loader uses official vector JS URL, one script, and reports missing SDK', async () => {
  let inserted = 0;
  let script: { src: string; onload?: () => void; onerror?: () => void } | undefined;
  const browser = {} as Window & { Tmapv3?: object };
  const documentStub = {
    createElement: () => (script = { src: '' }),
    head: { appendChild: () => { inserted++; } },
  };
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  Object.assign(globalThis, { window: browser, document: documentStub });
  try {
    const first = loadTmapWebSdk('public key');
    const second = loadTmapWebSdk('public key');
    assert.equal(first, second);
    assert.equal(inserted, 1);
    assert.match(script!.src, /^https:\/\/apis\.openapi\.sk\.com\/tmap\/vectorjs\?version=1&appKey=public%20key$/);
    script!.onload?.();
    await assert.rejects(first, /SDK unavailable/);
    const retried = loadTmapWebSdk('public key');
    assert.equal(inserted, 2);
    browser.Tmapv3 = { Map: class {} };
    script!.onload?.();
    assert.equal(await retried, browser.Tmapv3);
  } finally {
    Object.assign(globalThis, { window: previousWindow, document: previousDocument });
  }
});
