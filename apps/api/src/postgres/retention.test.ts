import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { PostgresAccountLifecycle } from './account-lifecycle.js';
import { PostgresRetentionService } from './retention.js';

const now = new Date('2026-10-04T12:00:00.000Z');
const secret = 'test-only-account-deletion-secret-at-least-32-bytes';

test('a later play prune failure preserves the earlier committed batch and reports its count', async () => {
  let remaining = 3;
  let pending = 0;
  let pruneAttempts = 0;
  const transactions: string[] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql === 'BEGIN') { pending = 0; transactions.push('begin'); return { rowCount: 0, rows: [] }; }
      if (sql === 'COMMIT') { remaining -= pending; transactions.push('commit'); return { rowCount: 0, rows: [] }; }
      if (sql === 'ROLLBACK') { pending = 0; transactions.push('rollback'); return { rowCount: 0, rows: [] }; }
      if (sql.includes('DELETE FROM play_runs WHERE id IN') && values?.[0] instanceof Date) {
        pruneAttempts++;
        if (pruneAttempts === 2) throw new Error('statement timeout');
        pending = Math.min(remaining, values[1] as number);
        return { rowCount: pending, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const service = new PostgresRetentionService(pool, {
    now: () => now, playBatchSize: 2, playMaxBatches: 2,
  });
  const result = await service.run();

  assert.deepEqual(result.failed, ['play_runs']);
  assert.deepEqual(result.counts.find(({ step }) => step === 'play_runs'), { step: 'play_runs', count: 2 });
  assert.equal(remaining, 1);
  assert.deepEqual(transactions.slice(-4), ['begin', 'commit', 'begin', 'rollback']);
  const retry = await service.run();
  assert.deepEqual(retry.failed, []);
  assert.equal(retry.counts.find(({ step }) => step === 'play_runs')?.count, 1);
  assert.equal(remaining, 0);
});

test('deleted-account scan advances through a live-only page before deleting later account data', async () => {
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const live = ['acct_00_live', 'acct_01_live'];
  const gone = 'acct_10_deleted';
  const records = [...live, gone];
  const cursors: (string | null)[] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('DELETE FROM play_records')) {
        const eligible = records.filter((account) => (values?.[0] as string[]).includes(account));
        const removed = eligible.slice(0, values?.[1] as number);
        for (const account of removed) records.splice(records.indexOf(account), 1);
        return { rowCount: removed.length, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => undefined,
  };
  const pool = {
    connect: async () => client,
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes(') candidates ORDER BY account_id')) {
        const cursor = values?.[0] as string | null;
        cursors.push(cursor);
        return { rows: records.filter((account) => cursor === null || account > cursor)
          .slice(0, values?.[1] as number).map((account_id) => ({ account_id })) };
      }
      if (sql.includes('FROM account_deletion_requests')) {
        const hash = lifecycle.referenceHash(gone);
        return { rows: (values?.[0] as Buffer[]).some((candidate) => candidate.equals(hash))
          ? [{ account_reference_hash: hash }] : [] };
      }
      if (sql.includes('FROM platform_admin_audit')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
  const service = new PostgresRetentionService(pool, {
    now: () => now, playBatchSize: 2, playMaxBatches: 2,
  });
  const result = await service.run({ hmacSecret: secret });

  assert.deepEqual(result.failed, []);
  assert.equal(result.counts.find(({ step }) => step === 'deleted_play_data')?.count, 1);
  assert.deepEqual(cursors.slice(0, 2), [null, live[1]]);
  assert.deepEqual(records, live);
});

test('deleted play rows share one cap across runs, records, and studios', async () => {
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const account = 'acct_deleted';
  const rows: Record<'play_runs' | 'play_records' | 'studios', number> = {
    play_runs: 1, play_records: 3, studios: 1,
  };
  let deleted = 0;
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      for (const table of ['play_runs', 'play_records', 'studios'] as const) {
        if (sql.startsWith(`DELETE FROM ${table}`) && Array.isArray(values?.[0])) {
          const count = Math.min(rows[table], values?.[1] as number);
          rows[table] -= count;
          deleted += count;
          return { rowCount: count, rows: [] };
        }
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => undefined,
  };
  const pool = {
    connect: async () => client,
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes(') candidates ORDER BY account_id')) return {
        rows: Object.values(rows).some((count) => count > 0) ? [{ account_id: account }] : [],
      };
      if (sql.includes('FROM account_deletion_requests')) return {
        rows: [{ account_reference_hash: lifecycle.referenceHash(account) }],
      };
      if (sql.includes('FROM platform_admin_audit')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
  const service = new PostgresRetentionService(pool, {
    now: () => now, playBatchSize: 2, playMaxBatches: 2,
  });
  const result = await service.run({ hmacSecret: secret });

  assert.deepEqual(result.failed, []);
  assert.equal(result.counts.find(({ step }) => step === 'deleted_play_data')?.count, 4);
  assert.equal(result.counts.find(({ step }) => step === 'deleted_play_data')?.capHit, true);
  assert.equal(deleted, 4);
  assert.deepEqual(rows, { play_runs: 0, play_records: 0, studios: 1 });
  const retry = await service.run({ hmacSecret: secret });
  assert.deepEqual(retry.failed, []);
  assert.equal(retry.counts.find(({ step }) => step === 'deleted_play_data')?.count, 1);
  assert.notEqual(retry.counts.find(({ step }) => step === 'deleted_play_data')?.capHit, true);
  assert.deepEqual(rows, { play_runs: 0, play_records: 0, studios: 0 });
  assert.equal((await service.run({ hmacSecret: secret })).counts
    .find(({ step }) => step === 'deleted_play_data')?.count, 0);
  // A rollback image can leave another small backlog; a short final batch is natural completion, not a cap stop.
  Object.assign(rows, { play_runs: 1, play_records: 1, studios: 1 });
  const smallBacklog = await service.run({ hmacSecret: secret });
  assert.equal(smallBacklog.counts.find(({ step }) => step === 'deleted_play_data')?.count, 3);
  assert.notEqual(smallBacklog.counts.find(({ step }) => step === 'deleted_play_data')?.capHit, true);
});

test('invalid play retention limits fail before a database connection', () => {
  const pool = { connect: () => { throw new Error('database accessed'); } } as unknown as Pool;
  for (const options of [{ playBatchSize: 0 }, { playMaxBatches: 0 },
    { playBatchSize: 501 }, { playMaxBatches: 11 }, { playBatchSize: 1.5 }]) {
    assert.throws(() => new PostgresRetentionService(pool, options), /RETENTION_LIMIT_INVALID/);
  }
});
