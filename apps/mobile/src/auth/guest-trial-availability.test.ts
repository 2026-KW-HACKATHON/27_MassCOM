import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { isGuestTrialAvailable } from './guest-trial-availability';
import { resolveAuthStartup } from './auth-startup';

const packages = [
  'kr.masscom.wolgye.demo',
  'kr.masscom.wolgye.dev',
  'kr.masscom.wolgye',
] as const;

test('guest trial availability preserves every package, platform, demo, and origin combination', () => {
  for (const packageId of packages) {
    for (const platform of ['web', 'native'] as const) {
      for (const demoAccountInjected of [false, true]) {
        for (const approvedOrigin of [false, true]) {
          const actual = isGuestTrialAvailable({
            packageId,
            platform,
            demoAccountInjected,
            productionAuthAvailable: false,
            publicApiAvailable: true,
            approvedOrigin,
          });
          const expected = approvedOrigin
            && packageId !== 'kr.masscom.wolgye'
            && !(packageId === 'kr.masscom.wolgye.dev' && platform === 'native' && demoAccountInjected);
          assert.equal(actual, expected, `${packageId} ${platform} demo=${demoAccountInjected} origin=${approvedOrigin}`);
        }
      }
    }
  }
});

test('native development demo only takes precedence when production auth is unavailable', () => {
  assert.equal(isGuestTrialAvailable({
    packageId: 'kr.masscom.wolgye.dev', platform: 'native', demoAccountInjected: true,
    productionAuthAvailable: true, publicApiAvailable: true, approvedOrigin: true,
  }), true);
  assert.equal(isGuestTrialAvailable({
    packageId: 'kr.masscom.wolgye.dev', platform: 'native', demoAccountInjected: false,
    productionAuthAvailable: false, publicApiAvailable: false, approvedOrigin: true,
  }), false);
});

test('native development demo starts signed in without creating an auth controller', () => {
  const guestTrialAvailable = isGuestTrialAvailable({
    packageId: 'kr.masscom.wolgye.dev', platform: 'native', demoAccountInjected: true,
    productionAuthAvailable: false, publicApiAvailable: true, approvedOrigin: true,
  });
  const startup = resolveAuthStartup({
    productionAuthAvailable: false, guestTrialAvailable, developmentBuild: true,
    customerAccountId: 'qa-customer', allowInsecureDemoReauthentication: false, isWeb: false,
  });
  assert.equal(startup.createController, false);
  assert.deepEqual(startup.initialState, {
    status: 'demo', accountId: 'qa-customer',
    credential: { kind: 'demo', accountId: 'qa-customer', allowInsecureReauthentication: false },
  });
});

test('native development without an injected demo and web with one still restore approved guest sessions', () => {
  for (const [platform, demoAccountInjected] of [['native', false], ['web', true]] as const) {
    const guestTrialAvailable = isGuestTrialAvailable({
      packageId: 'kr.masscom.wolgye.dev', platform, demoAccountInjected,
      productionAuthAvailable: false, publicApiAvailable: true, approvedOrigin: true,
    });
    const startup = resolveAuthStartup({
      productionAuthAvailable: false, guestTrialAvailable, developmentBuild: true,
      customerAccountId: demoAccountInjected ? 'qa-customer' : undefined,
      allowInsecureDemoReauthentication: false, isWeb: platform === 'web',
    });
    assert.equal(startup.createController, true);
    assert.deepEqual(startup.initialState, { status: 'restoring' });
  }
});

test('provider uses the same startup decision for its initial state and controller creation', () => {
  const provider = readFileSync(new URL('./auth-provider.tsx', import.meta.url), 'utf8');
  assert.match(provider, /const startup = resolveAuthStartup\(/);
  assert.match(provider, /useState<AuthSessionState>\(startup\.initialState\)/);
  assert.match(provider, /if \(!startup\.createController\) return;/);
});
