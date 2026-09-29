import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { linkVariantFor, openLinkBase, readOpenLink, type LinkVariant } from './link';

// link.ts decides which links a build owns from a package id and a scheme it writes down itself, while app.config.ts is what
// the installed app really registers. This reads the real config of each variant and fails when the two drift apart.

const mobileRoot = resolve(__dirname, '../..');
const expoCli = require.resolve('expo/bin/cli');
const buildSourceCommit = 'a'.repeat(40);

type EvaluatedConfig = {
  scheme?: string;
  android?: {
    package?: string;
    intentFilters?: { data?: { scheme?: string; host?: string; pathPrefix?: string }[] }[];
  };
};

const environments: Record<LinkVariant, Record<string, string>> = {
  production: {
    APP_VARIANT: 'production',
    EXPO_PUBLIC_API_URL: 'https://api.masscom.kr',
    MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
  },
  showcase: {
    APP_VARIANT: 'showcase',
    EXPO_PUBLIC_API_URL: 'https://demo-api.masscom.kr',
    MASSCOM_BUILD_SOURCE_COMMIT: buildSourceCommit,
    MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID: '123-demo.apps.googleusercontent.com',
  },
  development: {
    APP_VARIANT: 'development',
    EXPO_PUBLIC_API_URL: 'http://127.0.0.1:3000',
    EXPO_PUBLIC_DEMO_ACCOUNT_ID: 'customer-1',
    EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID: 'staff-1',
    EXPO_PUBLIC_DEMO_MERCHANT_ID: 'merchant-1',
  },
};

const variants = ['production', 'showcase', 'development'] as const;
const cache = new Map<LinkVariant, { packageId: string; scheme: string; httpsHosts: string[] }>();

/** What the real app.config.ts registers for a variant: its package, its scheme and the https hosts of its Android intent filters. */
function registered(variant: LinkVariant) {
  const known = cache.get(variant);
  if (known) return known;
  const environment: NodeJS.ProcessEnv = { ...process.env, CI: '1', EXPO_NO_DOTENV: '1', FORCE_COLOR: '0' };
  for (const key of Object.keys(environments.production).concat(Object.keys(environments.showcase), Object.keys(environments.development))) {
    delete environment[key];
  }
  Object.assign(environment, environments[variant]);
  const result = spawnSync(process.execPath, [expoCli, 'config', '--type', 'public', '--json'], {
    cwd: mobileRoot,
    encoding: 'utf8',
    env: environment,
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout) as EvaluatedConfig;
  const httpsHosts = (config.android?.intentFilters ?? []).flatMap((filter) =>
    (filter.data ?? []).filter((data) => data.scheme === 'https' && data.pathPrefix === '/open').map((data) => data.host ?? ''));
  assert.ok(config.android?.package, `${variant} has a package`);
  assert.ok(config.scheme, `${variant} has a scheme`);
  const value = { packageId: config.android.package, scheme: config.scheme, httpsHosts };
  cache.set(variant, value);
  return value;
}

test('each build\'s registered package is the one link.ts names for it, and the three stay different', () => {
  for (const variant of variants) assert.equal(linkVariantFor(registered(variant).packageId), variant, variant);
  assert.equal(registered('production').packageId, 'kr.masscom.wolgye');
  assert.equal(registered('showcase').packageId, 'kr.masscom.wolgye.demo');
  assert.equal(registered('development').packageId, 'kr.masscom.wolgye.dev');
  assert.equal(new Set(variants.map((variant) => registered(variant).packageId)).size, 3);
});

test('each build\'s registered scheme opens as that build\'s own link and as another build\'s link elsewhere', () => {
  assert.deepEqual(variants.map((variant) => registered(variant).scheme), ['masscom', 'masscom-demo', 'masscom-dev']);
  for (const owner of variants) {
    const link = `${registered(owner).scheme}://open#friend=K7M2Q9XP`;
    for (const reader of variants) {
      assert.deepEqual(
        readOpenLink(link, reader),
        { ours: reader === owner, fragment: { friend: 'K7M2Q9XP' } },
        `${owner} link read by ${reader}`,
      );
    }
  }
  // The showcase QR is its own scheme link, so it has to be the scheme the showcase app registers.
  assert.equal(openLinkBase('showcase'), `${registered('showcase').scheme}://open`);
});

test('the https hosts each build registers are its own links, and the showcase host belongs to the showcase build alone', () => {
  assert.deepEqual(registered('production').httpsHosts, ['masscom.kr']);
  assert.deepEqual(registered('showcase').httpsHosts, ['demo.masscom.kr']);
  // The development build registers no https link at all: it opens the shared masscom.kr link only by scanner or paste.
  assert.deepEqual(registered('development').httpsHosts, []);
  for (const variant of variants) {
    for (const host of registered(variant).httpsHosts) {
      assert.equal(readOpenLink(`https://${host}/open#friend=K7M2Q9XP`, variant)?.ours, true, `${variant} ${host}`);
    }
  }
  const showcaseHost = registered('showcase').httpsHosts[0]!;
  assert.equal(showcaseHost, 'demo.masscom.kr');
  for (const other of ['production', 'development'] as const) {
    assert.equal(readOpenLink(`https://${showcaseHost}/open`, other)?.ours, false, `${other} does not own ${showcaseHost}`);
  }
  // Production and development share the public link, and the showcase build does not.
  const productionHost = registered('production').httpsHosts[0]!;
  assert.equal(readOpenLink(`https://${productionHost}/open`, 'development')?.ours, true);
  assert.equal(readOpenLink(`https://${productionHost}/open`, 'showcase')?.ours, false);
  assert.equal(openLinkBase('production'), `https://${productionHost}/open`);
  assert.equal(openLinkBase('development'), `https://${productionHost}/open`);
});
