import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getAuthConfiguration } from './auth-config';

test('reports the exact missing Google Web client setting', () => {
  assert.deepEqual(getAuthConfiguration({}), {
    available: false,
    missing: ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'],
  });
  assert.deepEqual(getAuthConfiguration({ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '   ' }), {
    available: false,
    missing: ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'],
  });
});

test('trims the Google Web client ID before exposing auth configuration', () => {
  assert.deepEqual(
    getAuthConfiguration({ EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: ' web-client.apps.googleusercontent.com ' }),
    {
      available: true,
      webClientId: 'web-client.apps.googleusercontent.com',
    },
  );
});
