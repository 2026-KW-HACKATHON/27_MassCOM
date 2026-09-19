import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getPublicApiConfig } from './public-api';

test('keeps public browsing unavailable only when the API URL is missing', () => {
  assert.deepEqual(getPublicApiConfig({}), {
    available: false,
    missing: ['EXPO_PUBLIC_API_URL'],
  });
});

test('normalizes a configured HTTPS API URL', () => {
  assert.deepEqual(
    getPublicApiConfig({ EXPO_PUBLIC_API_URL: ' https://api.example.test/ ' }),
    {
      available: true,
      apiUrl: 'https://api.example.test',
    },
  );
});

test('allows loopback HTTP for local Android development', () => {
  assert.deepEqual(
    getPublicApiConfig({ EXPO_PUBLIC_API_URL: 'http://10.0.2.2:3000/' }),
    {
      available: true,
      apiUrl: 'http://10.0.2.2:3000',
    },
  );
});

test('rejects non-HTTPS production-like API URLs', () => {
  assert.throws(
    () => getPublicApiConfig({ EXPO_PUBLIC_API_URL: 'http://api.example.test' }),
    /HTTPS/,
  );
});
