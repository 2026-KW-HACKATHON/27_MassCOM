import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { seedQaCollectible } from './qa-collectible-seed.js';

test('a non-local or override showcase URL is refused before any pool is opened', async () => {
  let opened = 0;
  const openPool = (): Pool => {
    opened += 1;
    throw new Error('must not open a pool');
  };
  for (const raw of [
    undefined,
    'postgresql://postgres@api.masscom.kr/masscom_showcase_test',
    'postgresql://postgres@127.0.0.1/masscom',
    'postgresql://postgres@127.0.0.1/masscom_showcase_test?host=api.masscom.kr',
  ]) {
    await assert.rejects(seedQaCollectible(raw, openPool), { message: 'SHOWCASE_LOCAL_DATABASE_REQUIRED' });
  }
  assert.equal(opened, 0);
});

test('the actual connected database name is checked before touching the collectible service, and the pool always ends', async () => {
  let ended = 0;
  const wrongPool = {
    query: async () => ({ rows: [{ name: 'masscom' }] }),
    end: async () => { ended += 1; },
  } as unknown as Pool;
  await assert.rejects(
    seedQaCollectible('postgresql://postgres@127.0.0.1/masscom_showcase_test', () => wrongPool),
    /SHOWCASE_LOCAL_DATABASE_REQUIRED/,
  );
  assert.equal(ended, 1);
});

test('direct CLI reports only its fixed error, never the supplied URL', () => {
  const command = fileURLToPath(new URL('./qa-collectible-seed.ts', import.meta.url));
  const result = spawnSync(process.execPath, ['--import', 'tsx', command], {
    env: {
      ...process.env,
      SHOWCASE_TEST_DATABASE_URL: 'postgresql://TOP_SECRET_SENTINEL@api.masscom.kr/masscom_showcase_test',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /QA_COLLECTIBLE_SEED_FAILED/);
  assert.doesNotMatch(result.stderr, /TOP_SECRET_SENTINEL/);
  assert.doesNotMatch(result.stdout, /TOP_SECRET_SENTINEL/);
});
