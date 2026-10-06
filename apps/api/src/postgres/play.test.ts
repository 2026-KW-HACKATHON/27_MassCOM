import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool, PoolClient } from 'pg';

import { defaultStudio, PlayError, type Studio } from '../play.js';
import { AccountLifecycleError, PostgresAccountLifecycle } from './account-lifecycle.js';
import { PostgresPlayService } from './play.js';

const secret = 'studio-test-account-secret-at-least-32-bytes';

test('play rejects unsupported rules versions before database access', async () => {
  const pool = { connect: async () => { throw new Error('invalid version reached database'); } } as unknown as Pool;
  const play = new PostgresPlayService(pool, new PostgresAccountLifecycle({ hmacSecret: secret }));
  for (const rulesVersion of [0, 3, 1.5, '2', null, false]) {
    await assert.rejects(() => play.start({ accountId: 'viewer', kind: 'orders', rulesVersion } as
      Parameters<PostgresPlayService['start']>[0]),
    error => error instanceof PlayError && error.code === 'PLAY_KIND_INVALID');
  }
});

test('studio rejects non-string goal kinds and exact-type violations before database access', async () => {
  const pool = { connect: async () => { throw new Error('invalid studio reached database'); } } as unknown as Pool;
  const play = new PostgresPlayService(pool, new PostgresAccountLifecycle({ hmacSecret: secret }));
  const invalid: unknown[] = [];
  for (const kind of [['regular'], 1, {}, null, true]) {
    invalid.push({ ...defaultStudio, goal: { kind, merchantId: 'shop' } });
  }
  for (const [field, string] of [['theme', 'daylight'], ['layout', 'shelf'], ['accent', 'mint']] as const) {
    for (const value of [[string], 1, {}, null, true]) invalid.push({ ...defaultStudio, [field]: value });
  }
  for (const value of [['shop'], 1, {}, null, true]) {
    invalid.push({ ...defaultStudio, goal: { kind: 'regular', merchantId: value } });
  }
  for (const value of [['orders'], 1, {}, null, true]) {
    invalid.push({ ...defaultStudio, goal: { kind: 'play', gameKind: value } });
  }
  for (const slots of ['00000000-0000-4000-8000-000000000001', 1, {}, null, [1], [[]], [{}]]) {
    invalid.push({ ...defaultStudio, slots });
  }
  invalid.push({ ...defaultStudio, goal: [] }, { ...defaultStudio, goal: 1 }, { ...defaultStudio, goal: 'regular' });
  for (const studio of invalid) {
    await assert.rejects(() => play.saveStudio({ accountId: 'viewer', studio: studio as Studio }),
      (error) => error instanceof PlayError && error.code === 'STUDIO_INVALID', JSON.stringify(studio));
  }
});

test('an exact published collectible goal passes shape validation before database lookup', async () => {
  const pool = { connect: async () => { throw new Error('DB_REACHED'); } } as unknown as Pool;
  const play = new PostgresPlayService(pool, new PostgresAccountLifecycle({ hmacSecret: secret }));
  const goal = { kind: 'collectible' as const, merchantId: 'shop', campaignId: 'campaign',
    publicationId: '00000000-0000-4000-8000-000000000001', targetVisitCount: 3 as const };
  await assert.rejects(() => play.saveStudio({ accountId: 'viewer', studio: { ...defaultStudio, goal } }), /DB_REACHED/);
  for (const invalid of [{ ...goal, targetVisitCount: 2 }, { ...goal, publicationId: 'not-a-publication' },
    { ...goal, extra: true }, { ...goal, campaignId: '' }]) {
    await assert.rejects(() => play.saveStudio({ accountId: 'viewer', studio: { ...defaultStudio, goal: invalid } as Studio }),
      (error) => error instanceof PlayError && error.code === 'STUDIO_INVALID');
  }
});

for (const deletedAccount of ['viewer', 'friend']) {
  test(`friend studio deletion race reports the deleted ${deletedAccount} correctly`, async () => {
    const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
    lifecycle.assertAllActive = async (_client, accounts) => {
      if (accounts.includes(deletedAccount)) throw new AccountLifecycleError('ACCOUNT_DELETED');
    };
    const client = {
      query: async (sql: string) => {
        if (sql.includes('FROM friendships')) return { rows: [{ account_low: 'friend', account_high: 'viewer' }], rowCount: 1 };
        if (['BEGIN', 'ROLLBACK', 'COMMIT'].includes(sql)) return { rows: [], rowCount: 0 };
        throw new Error(`unexpected query: ${sql}`);
      },
      release: () => {},
    } as unknown as PoolClient;
    const play = new PostgresPlayService({ connect: async () => client } as unknown as Pool, lifecycle);
    await assert.rejects(() => play.getFriendStudio({ accountId: 'viewer',
      friendshipId: '00000000-0000-4000-8000-000000000001' }),
    (error) => error instanceof PlayError && error.code ===
      (deletedAccount === 'viewer' ? 'ACCOUNT_DELETED' : 'FRIEND_STUDIO_NOT_FOUND'));
  });
}
