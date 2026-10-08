import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { withLocationTimeout } from './gps-timeout';

test('a pending native position request settles with a retry message and cannot replace a manual origin later', async () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function requestGps()'), source.indexOf('async function findManualOrigin()'));
  let resolvePosition!: (value: unknown) => void;
  const position = new Promise((resolve) => { resolvePosition = resolve; });
  const origin = { latitude: 37.62, longitude: 127.05, basis: 'MANUAL' };
  let currentOrigin: unknown = origin;
  let message = '';
  const generation = { current: 0 };
  const requestGps = new Function('Location', 'locationGeneration', 'setGpsMessage', 'withLocationTimeout',
    'routeGate', 'discoveryState', 'setRoute', `${body}; return requestGps;`)(
    { Accuracy: { Balanced: 1 }, hasServicesEnabledAsync: async () => true,
      requestForegroundPermissionsAsync: async () => ({ status: 'granted' }), getCurrentPositionAsync: () => position },
    generation, (value: string) => { message = value; },
    (value: Promise<unknown>) => withLocationTimeout(value, 10), { invalidate() {} },
    { setOrigin(value: unknown) { currentOrigin = value; } }, () => {}) as () => Promise<void>;
  await requestGps();
  assert.match(message, /다시 확인|다시 시도/);
  assert.strictEqual(currentOrigin, origin);
  resolvePosition({ timestamp: Date.now(), coords: { latitude: 37.61, longitude: 127.04, accuracy: 10 } });
  await Promise.resolve();
  assert.strictEqual(currentOrigin, origin);
});

test('service off and denied permission finish without querying location or changing origin', async () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function requestGps()'), source.indexOf('async function findManualOrigin()'));
  for (const [services, permission] of [[false, 'granted'], [true, 'denied']] as const) {
    let prompts = 0;
    let positions = 0;
    let message = '';
    const requestGps = new Function('Location', 'locationGeneration', 'setGpsMessage', 'withLocationTimeout',
      'routeGate', 'discoveryState', 'setRoute', `${body}; return requestGps;`)(
      { Accuracy: { Balanced: 1 }, hasServicesEnabledAsync: async () => services,
        requestForegroundPermissionsAsync: async () => { prompts++; return { status: permission }; },
        getCurrentPositionAsync: async () => { positions++; throw new Error('unexpected position request'); } },
      { current: 0 }, (value: string) => { message = value; },
      withLocationTimeout, { invalidate() {} }, { setOrigin() { throw new Error('unexpected origin change'); } }, () => {}) as () => Promise<void>;
    await requestGps();
    assert.equal(prompts, services ? 1 : 0);
    assert.equal(positions, 0);
    assert.match(message, services ? /거부/ : /꺼져/);
  }
});

test('the map keeps the manual origin visible during GPS loading and timeout', () => {
  const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
  assert.match(source, /const locationSummary=state\.origin\?\.basis==='MANUAL'[\s\S]*?`직접 선택한 출발지 사용 중 · \$\{gpsMessage\}`/);
  assert.match(source, /<Fold title="출발지·위치 선택" summary=\{locationSummary\}>/);
  assert.match(source, /<Text accessibilityLiveRegion="polite" style=\{styles\.muted\}>\{gpsMessage\}<\/Text>/);
  assert.match(source, /const chooseManual=useCallback\([\s\S]*?locationGeneration\.current\+\+;setGpsMessage\('내 위치를 사용하지 않습니다'\)/);
});
