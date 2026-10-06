import assert from 'node:assert/strict';
import test from 'node:test';
import { MapFallback, type MapSession, type MapProvider } from './map-fallback';

const session = (onDispose: () => void): MapSession => ({ update() {}, resize() {}, emitViewport() {}, dispose: onDispose });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('TMAP failure starts NAVER and only NAVER readiness reaches consumer', async () => {
  const attempts: MapProvider[] = [], ready: MapProvider[] = [], errors: string[] = [];
  let firstFailed: (() => void) | undefined, firstReady: (() => void) | undefined;
  let removed = 0, cleared = 0;
  const flow = new MapFallback('t-key', 'n-key', async (provider, onReady, failed) => {
    attempts.push(provider);
    if (provider === 'TMAP') { firstFailed = failed; firstReady = onReady; return session(() => { removed++; }); }
    onReady(); return session(() => { removed++; });
  }, provider => ready.push(provider), code => errors.push(code), () => { cleared++; });
  flow.start(); await tick();
  firstFailed?.(); await tick();
  firstReady?.();
  assert.deepEqual(attempts, ['TMAP', 'NAVER']);
  assert.deepEqual(ready, ['NAVER']);
  assert.deepEqual(errors, []);
  assert.equal(cleared, 1);
  flow.dispose();
  assert.equal(removed, 2);
});

test('both providers failing reports one terminal error; missing keys report config error', async () => {
  const errors: string[] = [], attempts: MapProvider[] = [];
  let cleared = 0;
  const flow = new MapFallback('t', 'n', async provider => { attempts.push(provider); throw Error('sensitive upstream detail'); },
    () => { throw Error('unexpected ready'); }, code => errors.push(code), () => { cleared++; });
  flow.start(); await tick(); await tick();
  assert.deepEqual(attempts, ['TMAP', 'NAVER']);
  assert.deepEqual(errors, ['MAP_WEB_SDK_UNAVAILABLE']);
  assert.equal(cleared, 2);
  flow.dispose();
  const noKeys = new MapFallback(undefined, undefined, async () => { throw Error('called'); },
    () => undefined, code => errors.push(code), () => undefined);
  noKeys.start();
  assert.equal(errors.at(-1), 'MAP_NOT_CONFIGURED');
});

test('late loader result after unmount is disposed and cannot signal ready', async () => {
  let resolve!: (value: MapSession) => void;
  let staleReady: (() => void) | undefined, disposed = 0, ready = 0;
  const pending = new Promise<MapSession>(done => { resolve = done; });
  const flow = new MapFallback('t', 'n', async (_provider, onReady) => { staleReady = onReady; return pending; },
    () => { ready++; }, () => undefined, () => undefined);
  flow.start();
  flow.dispose();
  resolve(session(() => { disposed++; }));
  await tick();
  staleReady?.();
  assert.equal(disposed, 1);
  assert.equal(ready, 0);
});

test('configured TMAP success never starts NAVER; NAVER alone starts directly', async () => {
  const attempts: MapProvider[] = [], ready: MapProvider[] = [];
  const start = async (provider: MapProvider, onReady: () => void) => {
    attempts.push(provider);
    onReady();
    return session(() => undefined);
  };
  const primary = new MapFallback('t', 'n', start, provider => ready.push(provider), () => undefined, () => undefined);
  primary.start(); await tick();
  assert.deepEqual(attempts, ['TMAP']);
  assert.deepEqual(ready, ['TMAP']);
  primary.dispose();
  const secondary = new MapFallback(undefined, 'n', start, provider => ready.push(provider), () => undefined, () => undefined);
  secondary.start(); await tick();
  assert.deepEqual(attempts, ['TMAP', 'NAVER']);
  assert.deepEqual(ready, ['TMAP', 'NAVER']);
  secondary.dispose();
});


test('deferred SDK completion after unmount cannot construct a map session', async () => {
  let resolve!: () => void;
  const pending = new Promise<void>(done => { resolve = done; });
  let constructed = 0, ready = 0, errors = 0;
  const flow = new MapFallback('t', 'n', async (_provider, _ready, _failed, isCurrent) => {
    await pending;
    if (!isCurrent()) throw Error('cancelled');
    constructed++;
    return session(() => undefined);
  }, () => { ready++; }, () => { errors++; }, () => undefined);
  flow.start();
  flow.dispose();
  resolve();
  await tick();
  assert.equal(constructed, 0);
  assert.equal(ready, 0);
  assert.equal(errors, 0);
});

test('late TMAP SDK after provider switch cannot touch the NAVER map', async () => {
  let resolve!: () => void, failTmap: (() => void) | undefined;
  const pending = new Promise<void>(done => { resolve = done; });
  const constructed: MapProvider[] = [], ready: MapProvider[] = [];
  const flow = new MapFallback('t', 'n', async (provider, onReady, failed, isCurrent) => {
    if (provider === 'TMAP') { failTmap = failed; await pending; }
    if (!isCurrent()) throw Error('stale');
    constructed.push(provider);
    onReady();
    return session(() => undefined);
  }, provider => ready.push(provider), () => undefined, () => undefined);
  flow.start();
  failTmap?.();
  await tick();
  resolve();
  await tick();
  assert.deepEqual(constructed, ['NAVER']);
  assert.deepEqual(ready, ['NAVER']);
  flow.dispose();
});
