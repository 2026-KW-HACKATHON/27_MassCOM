import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { validateBuildEnvironment } from './build-environment';

const mobileRoot = resolve(__dirname, '../..');
const expoCli = require.resolve('expo/bin/cli');
const buildEnvironmentKeys = [
  'APP_VARIANT',
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_DEMO_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID',
  'EXPO_PUBLIC_DEMO_MERCHANT_ID',
  'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
] as const;

type EvaluatedExpoConfig = {
  scheme?: string;
  android?: {
    package?: string;
    blockedPermissions?: string[];
  };
  plugins?: (string | [string, ...unknown[]])[];
};

test('production build environment accepts a non-loopback HTTPS API without DEMO settings', () => {
  assert.doesNotThrow(() =>
    validateBuildEnvironment('production', {
      EXPO_PUBLIC_API_URL: 'https://api.example.test',
    }),
  );
});

test('production build environment rejects local API host variants', () => {
  for (const apiUrl of [
    'https://localhost',
    'https://LOCALHOST.',
    'https://api.localhost',
    'https://127.0.0.1',
    'https://127.255.255.254',
    'https://127.1',
    'https://0.0.0.0',
    'https://0',
    'https://[::1]',
    'https://[0:0:0:0:0:0:0:1]',
    'https://[::]',
    'https://[::ffff:127.0.0.1]',
    'https://[::ffff:127.255.255.254]',
    'https://[::ffff:0.0.0.0]',
    'https://[::ffff:10.0.2.2]',
    'https://10.0.2.2',
  ]) {
    assert.throws(
      () => validateBuildEnvironment('production', { EXPO_PUBLIC_API_URL: apiUrl }),
      /production API must use non-loopback HTTPS/,
      apiUrl,
    );
  }
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

test('production build environment rejects a false DEMO reauthentication setting', () => {
  assert.throws(
    () =>
      validateBuildEnvironment('production', {
        EXPO_PUBLIC_API_URL: 'https://api.example.test',
        EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION: 'false',
      }),
    /EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION/,
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

test('actual Expo production config preserves release identity, plugins, and blocked permissions', () => {
  const result = evaluateExpoConfig({
    APP_VARIANT: 'production',
    EXPO_PUBLIC_API_URL: 'https://api.example.test',
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout) as EvaluatedExpoConfig;
  assert.equal(config.android?.package, 'kr.masscom.wolgye');
  assert.equal(config.scheme, 'masscom');
  assert.deepEqual(pluginNames(config), ['expo-router', 'expo-camera', 'expo-splash-screen']);
  assert.deepEqual(config.android?.blockedPermissions, ['android.permission.SYSTEM_ALERT_WINDOW']);
});

test('actual Expo production config rejects local API host variants', () => {
  for (const apiUrl of [
    'https://127.0.0.2',
    'https://0.0.0.0',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
  ]) {
    const result = evaluateExpoConfig({
      APP_VARIANT: 'production',
      EXPO_PUBLIC_API_URL: apiUrl,
    });

    assert.notEqual(result.status, 0, apiUrl);
    assert.match(result.stderr, /production API must use non-loopback HTTPS/, apiUrl);
  }
});

test('actual Expo production config rejects a stray false DEMO setting', () => {
  const result = evaluateExpoConfig({
    APP_VARIANT: 'production',
    EXPO_PUBLIC_API_URL: 'https://api.example.test',
    EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION: 'false',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION/);
});

test('actual Expo development config preserves local DEMO identity, plugins, and permissions', () => {
  const result = evaluateExpoConfig({
    APP_VARIANT: 'development',
    EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3000',
    EXPO_PUBLIC_DEMO_ACCOUNT_ID: 'customer-1',
    EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID: 'staff-1',
    EXPO_PUBLIC_DEMO_MERCHANT_ID: 'merchant-1',
    EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION: 'false',
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout) as EvaluatedExpoConfig;
  assert.equal(config.android?.package, 'kr.masscom.wolgye.dev');
  assert.equal(config.scheme, 'masscom-dev');
  assert.deepEqual(pluginNames(config), [
    'expo-router',
    'expo-dev-client',
    'expo-camera',
    'expo-splash-screen',
  ]);
  assert.deepEqual(config.android?.blockedPermissions, []);
});

function evaluateExpoConfig(overrides: Record<string, string>) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    CI: '1',
    EXPO_NO_DOTENV: '1',
    FORCE_COLOR: '0',
  };
  for (const key of buildEnvironmentKeys) delete environment[key];
  Object.assign(environment, overrides);

  return spawnSync(process.execPath, [expoCli, 'config', '--type', 'public', '--json'], {
    cwd: mobileRoot,
    encoding: 'utf8',
    env: environment,
  });
}

function pluginNames(config: EvaluatedExpoConfig): string[] {
  return (config.plugins ?? []).map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
}
