import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

import buildSourceCommitPlugin from '../../plugins/with-build-source-commit.cjs';
import { validateBuildEnvironment } from './build-environment';

const mobileRoot = resolve(__dirname, '../..');
const expoCli = require.resolve('expo/bin/cli');
const buildSourceCommit = 'a'.repeat(40);
const buildEnvironmentKeys = [
  'APP_VARIANT',
  'MASSCOM_BUILD_SOURCE_COMMIT',
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  'EXPO_PUBLIC_REOWN_PROJECT_ID',
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
    intentFilters?: {
      action?: string;
      autoVerify?: boolean;
      category?: string[];
      data?: { scheme?: string; host?: string; pathPrefix?: string }[];
    }[];
  };
  plugins?: (string | [string, ...unknown[]])[];
};

test('production build environment accepts a non-loopback HTTPS API without DEMO settings', () => {
  assert.doesNotThrow(() =>
    validateBuildEnvironment('production', {
      EXPO_PUBLIC_API_URL: 'https://api.masscom.kr',
      MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
    }),
  );
});

test('showcase accepts only its exact HTTPS API origin', () => {
  assert.doesNotThrow(() => validateBuildEnvironment('showcase', {
    EXPO_PUBLIC_API_URL: 'https://demo-api.masscom.kr',
    MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
  }));
  for (const apiUrl of [
    'https://api.masscom.kr',
    'https://demo-api.masscom.kr.evil.example',
    'https://demo-api.masscom.kr:444',
    'https://user@demo-api.masscom.kr',
    'https://demo-api.masscom.kr/collection',
    'https://demo-api.masscom.kr?source=prod',
    'https://demo-api.masscom.kr/#section',
    'http://demo-api.masscom.kr',
    'http://127.0.0.1:3000',
  ]) {
    assert.throws(() => validateBuildEnvironment('showcase', {
      EXPO_PUBLIC_API_URL: apiUrl,
      MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
    }), /showcase API must use https:\/\/demo-api\.masscom\.kr/, apiUrl);
  }
});

test('production rejects demo API and URL override components', () => {
  for (const apiUrl of [
    'https://demo-api.masscom.kr',
    'https://api.masscom.kr.evil.example',
    'https://api.masscom.kr:444',
    'https://user@api.masscom.kr',
    'https://api.masscom.kr/collection',
    'https://api.masscom.kr?host=demo-api.masscom.kr',
    'https://api.masscom.kr/#section',
  ]) {
    assert.throws(() => validateBuildEnvironment('production', {
      EXPO_PUBLIC_API_URL: apiUrl,
      MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
    }), /production API must use https:\/\/api\.masscom\.kr/, apiUrl);
  }
});

test('unknown build variants fail closed rather than silently becoming development', () => {
  assert.throws(() => validateBuildEnvironment('prodction', {}), /UNSUPPORTED_APP_VARIANT/);
});

test('showcase requires a source commit and refuses inherited auth or wallet project IDs', () => {
  assert.throws(() => validateBuildEnvironment('showcase', {
    EXPO_PUBLIC_API_URL: 'https://demo-api.masscom.kr',
  }), /showcase build source commit is required/);
  for (const key of ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', 'EXPO_PUBLIC_REOWN_PROJECT_ID'] as const) {
    assert.throws(() => validateBuildEnvironment('showcase', {
      EXPO_PUBLIC_API_URL: 'https://demo-api.masscom.kr',
      MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
      [key]: 'production-public-id',
    }), new RegExp(`showcase build rejects ${key}`));
  }
});

test('showcase refuses every insecure development DEMO variable, including false', () => {
  for (const key of [
    'EXPO_PUBLIC_DEMO_ACCOUNT_ID',
    'EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID',
    'EXPO_PUBLIC_DEMO_MERCHANT_ID',
    'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION',
  ] as const) {
    assert.throws(() => validateBuildEnvironment('showcase', {
      EXPO_PUBLIC_API_URL: 'https://demo-api.masscom.kr',
      MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
      [key]: 'false',
    }), new RegExp(`showcase build rejects ${key}`));
  }
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
      () =>
        validateBuildEnvironment('production', {
          EXPO_PUBLIC_API_URL: apiUrl,
          MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
        }),
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
          EXPO_PUBLIC_API_URL: 'https://api.masscom.kr',
          MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
          [key]: key === 'EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION' ? 'true' : 'demo-value',
        }),
      new RegExp(key),
    );
  });
}

test('production build environment requires the API URL', () => {
  assert.throws(
    () =>
      validateBuildEnvironment('production', {
        MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
      }),
    /production EXPO_PUBLIC_API_URL is required/,
  );
});

test('production build environment requires a 40-hex source commit', () => {
  assert.throws(
    () =>
      validateBuildEnvironment('production', {
        EXPO_PUBLIC_API_URL: 'https://api.masscom.kr',
      }),
    /production build source commit is required/,
  );
  assert.throws(
    () =>
      validateBuildEnvironment('production', {
        EXPO_PUBLIC_API_URL: 'https://api.masscom.kr',
        MASSCOM_BUILD_SOURCE_COMMIT: 'not-a-commit',
      }),
    /production build source commit must be 40 hexadecimal characters/,
  );
});

test('production build environment rejects a false DEMO reauthentication setting', () => {
  assert.throws(
    () =>
      validateBuildEnvironment('production', {
        EXPO_PUBLIC_API_URL: 'https://api.masscom.kr',
        MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
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
    EXPO_PUBLIC_API_URL: 'https://api.masscom.kr',
    MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout) as EvaluatedExpoConfig;
  assert.equal(config.android?.package, 'kr.masscom.wolgye');
  assert.equal(config.scheme, 'masscom');
  assert.deepEqual(pluginNames(config), [
    'expo-router',
    'expo-camera',
    'expo-splash-screen',
    'expo-secure-store',
    './plugins/with-build-source-commit.cjs',
  ]);
  assert.deepEqual(config.android?.blockedPermissions, ['android.permission.SYSTEM_ALERT_WINDOW']);
  assert.deepEqual(config.android?.intentFilters, [
    {
      action: 'VIEW',
      autoVerify: true,
      category: ['BROWSABLE', 'DEFAULT'],
      data: [{ scheme: 'https', host: 'masscom.kr', pathPrefix: '/open' }],
    },
  ]);
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
      MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
    });

    assert.notEqual(result.status, 0, apiUrl);
    assert.match(result.stderr, /production API must use non-loopback HTTPS/, apiUrl);
  }
});

test('actual Expo production config rejects a stray false DEMO setting', () => {
  const result = evaluateExpoConfig({
    APP_VARIANT: 'production',
    EXPO_PUBLIC_API_URL: 'https://api.masscom.kr',
    MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
    EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION: 'false',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EXPO_PUBLIC_ALLOW_INSECURE_DEMO_REAUTHENTICATION/);
});

test('actual Expo production config rejects a missing source commit', () => {
  const result = evaluateExpoConfig({
    APP_VARIANT: 'production',
    EXPO_PUBLIC_API_URL: 'https://api.masscom.kr',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production build source commit is required/);
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
    'expo-secure-store',
  ]);
  assert.deepEqual(config.android?.blockedPermissions, []);
  assert.deepEqual(config.android?.intentFilters, []);
});

test('local production plugin writes the source commit into Android manifest metadata', () => {
  const { applyBuildSourceCommit, BUILD_SOURCE_COMMIT_KEY } = buildSourceCommitPlugin as unknown as {
    BUILD_SOURCE_COMMIT_KEY: string;
    applyBuildSourceCommit: (manifest: Record<string, unknown>, commit: string) => Record<string, unknown>;
  };
  const manifest = {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      queries: [],
      application: [{ $: { 'android:name': '.MainApplication' } }],
    },
  };

  applyBuildSourceCommit(manifest, buildSourceCommit.toUpperCase());

  const application = manifest.manifest.application[0] as (typeof manifest.manifest.application)[number] & {
    'meta-data': unknown[];
  };
  assert.deepEqual(application['meta-data'], [
    {
      $: {
        'android:name': BUILD_SOURCE_COMMIT_KEY,
        'android:value': buildSourceCommit,
      },
    },
  ]);
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
