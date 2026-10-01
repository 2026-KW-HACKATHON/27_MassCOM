import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

import { assertLocalShowcaseDatabaseUrl, isPermittedShowcaseDatabaseName } from './local-seed.js';
import { seedConfiguredLocalShowcase } from './seed-command.js';

test('showcase URL accepts only the named loopback database without overrides', () => {
  const expected = 'postgresql://postgres@127.0.0.1:55433/masscom_showcase_test';
  assert.equal(assertLocalShowcaseDatabaseUrl(expected), expected);

  for (const raw of [
    'postgresql://postgres@api.masscom.kr:5432/masscom_showcase_test',
    'postgresql://postgres@127.0.0.1:55433/masscom',
    'postgresql://postgres@127.0.0.1:55433/masscom_test',
    'postgresql://postgres@127.0.0.1:55433/masscom_showcase_test?host=api.masscom.kr',
    'postgresql://postgres@127.0.0.1:55433/masscom_showcase_test#override',
    'https://127.0.0.1/masscom_showcase_test',
    'not a URL',
  ]) {
    assert.throws(() => assertLocalShowcaseDatabaseUrl(raw), {
      message: 'SHOWCASE_LOCAL_DATABASE_REQUIRED',
    });
  }
});

test('showcase URL also accepts a generated per-run CI database name (#294 P1)', () => {
  // grant-approver-command.ts and seed-command.ts both gate on this function; a postgres integration test that
  // wants its own throwaway database (instead of fighting over the one fixed name) needs this to pass too.
  const ciUrl = 'postgresql://postgres@127.0.0.1:55433/masscom_showcase_ci_ab12_test';
  assert.equal(assertLocalShowcaseDatabaseUrl(ciUrl), ciUrl);
  assert.throws(() => assertLocalShowcaseDatabaseUrl('postgresql://postgres@127.0.0.1:55433/masscom_showcase_ci_not-hex_test'), {
    message: 'SHOWCASE_LOCAL_DATABASE_REQUIRED',
  });
});

test('showcase seed only permits its exact CLI database and generated CI databases', () => {
  assert.equal(isPermittedShowcaseDatabaseName('masscom_showcase_test'), true);
  assert.equal(isPermittedShowcaseDatabaseName('masscom_showcase_ci_ab12_test'), true);
  assert.equal(isPermittedShowcaseDatabaseName('masscom_showcase_prod_test'), false);
  assert.equal(isPermittedShowcaseDatabaseName('masscom_test'), false);
});

test('CLI rejects missing, remote, and override URLs before opening a pool', async () => {
  let opened = 0;
  const openPool = (): Pool => { opened++; throw new Error('MUST_NOT_CONNECT'); };
  for (const raw of [
    undefined,
    'postgresql://postgres@api.masscom.kr/masscom_showcase_test',
    'postgresql://postgres@127.0.0.1/masscom_showcase_test?host=api.masscom.kr',
  ]) {
    await assert.rejects(seedConfiguredLocalShowcase(raw, openPool), {
      message: 'SHOWCASE_LOCAL_DATABASE_REQUIRED',
    });
  }
  assert.equal(opened, 0);
});

test('CLI checks actual database before migration and always ends its pool', async () => {
  let migrated = 0;
  let ended = 0;
  const wrongPool = {
    query: async () => ({ rows: [{ name: 'masscom' }] }),
    end: async () => { ended++; },
  } as unknown as Pool;
  await assert.rejects(seedConfiguredLocalShowcase(
    'postgresql://postgres@127.0.0.1/masscom_showcase_test',
    () => wrongPool,
    async () => { migrated++; },
  ), /SHOWCASE_LOCAL_DATABASE_REQUIRED/);
  assert.equal(migrated, 0);
  assert.equal(ended, 1);

  const rightPool = {
    query: async () => ({ rows: [{ name: 'masscom_showcase_test' }] }),
    end: async () => { ended++; },
  } as unknown as Pool;
  await assert.rejects(seedConfiguredLocalShowcase(
    'postgresql://postgres@127.0.0.1/masscom_showcase_test',
    () => rightPool,
    async () => { throw new Error('password=TOP_SECRET_SENTINEL'); },
  ), /TOP_SECRET_SENTINEL/);
  assert.equal(ended, 2);
});

test('direct CLI reports only its fixed error, never the supplied URL', () => {
  const command = fileURLToPath(new URL('./seed-command.ts', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', 'tsx', command], {
    env: {
      ...process.env,
      SHOWCASE_TEST_DATABASE_URL: 'postgresql://TOP_SECRET_SENTINEL@api.masscom.kr/masscom_showcase_test',
    },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHOWCASE_LOCAL_SEED_FAILED/);
  assert.doesNotMatch(result.stderr, /TOP_SECRET_SENTINEL/);
});
