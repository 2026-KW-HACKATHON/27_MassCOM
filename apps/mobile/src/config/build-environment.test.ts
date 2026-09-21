import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateBuildEnvironment } from './build-environment';

test('production build environment accepts a non-loopback HTTPS API without DEMO settings', () => {
  assert.doesNotThrow(() =>
    validateBuildEnvironment('production', {
      EXPO_PUBLIC_API_URL: 'https://api.example.test',
    }),
  );
});

test('production build environment rejects a loopback API', () => {
  assert.throws(
    () =>
      validateBuildEnvironment('production', {
        EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3000',
      }),
    /production API must use non-loopback HTTPS/,
  );
});

for (const key of [
  'EXPO_PUBLIC_DEMO_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ID',
  'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
] as const) {
  test(`production build environment rejects ${key}`, () => {
    assert.throws(
      () =>
        validateBuildEnvironment('production', {
          EXPO_PUBLIC_API_URL: 'https://api.example.test',
          [key]: key === 'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION' ? 'true' : 'demo-value',
        }),
      new RegExp(key),
    );
  });
}

test('production build environment requires the API URL', () => {
  assert.throws(
    () => validateBuildEnvironment('production', {}),
    /production EXPO_PUBLIC_API_URL is required/,
  );
});

test('development build environment keeps loopback and DEMO settings available', () => {
  assert.doesNotThrow(() =>
    validateBuildEnvironment('development', {
      EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3000',
      EXPO_PUBLIC_DEMO_ACCOUNT_ID: 'customer-1',
      EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID: 'staff-1',
      EXPO_PUBLIC_DEMO_MERCHANT_ID: 'merchant-1',
    }),
  );
});
