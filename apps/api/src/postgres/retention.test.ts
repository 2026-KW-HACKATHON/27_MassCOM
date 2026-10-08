import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { PostgresAccountLifecycle } from './account-lifecycle.js';
import { PostgresRetentionService } from './retention.js';

const now = new Date('2026-10-04T12:00:00.000Z');
const secret = 'test-only-account-deletion-secret-at-least-32-bytes';

function reportedSql() {
  const statements: string[] = [];
  const pool = { query: async (sql: string) => { statements.push(sql); return { rows: [{ count: 0 }] }; } } as unknown as Pool;
  return { statements, report: () => new PostgresRetentionService(pool, { now: () => now }).report() };
}

test('discovery event dedupe expires after 23 hours', async () => {
  const { statements, report } = reportedSql();
  await report();
  assert.match(statements[0]!, /FROM discovery_event_dedupe WHERE created_at < .*interval '23 hours'/);
});

test('merchant reports expire after 90 days', async () => {
  const { statements, report } = reportedSql();
  await report();
  assert.match(statements[1]!, /FROM merchant_real_world_reports WHERE created_at < .*interval '90 days'/);
});

test('soft-deleted photo rows are pruned before unreferenced media', async () => {
  const { statements, report } = reportedSql();
  await report();
  assert.match(statements[2]!, /FROM merchant_real_world_photos WHERE deleted_at < .*interval '1 day'/);
  assert.match(statements[3]!, /FROM merchant_real_world_media WHERE .*NOT EXISTS \(SELECT 1 FROM merchant_real_world_photos photo WHERE photo.digest = merchant_real_world_media.digest\)/);
});

// Keep the database boundary fake, including OFFSET/keyset, candidate disappearance and transactional progress.
function candidatePool(records: string[], deletedAccounts: string[] = []) {
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const hashes = deletedAccounts.map((account) => lifecycle.referenceHash(account));
  const pages: string[][] = [];
  const cursors: (string | null)[] = [];
  const offsets: bigint[] = [];
  let position = 0n;
  let snapshot: { records: string[]; position: bigint } | undefined;
  let failProgressSave = false;
  const query = async (sql: string, values?: unknown[]) => {
    if (sql === 'BEGIN') snapshot = { records: [...records], position };
    if (sql === 'ROLLBACK' && snapshot) {
      records.splice(0, records.length, ...snapshot.records);
      position = snapshot.position;
      snapshot = undefined;
    }
    if (sql === 'COMMIT') snapshot = undefined;
    if (sql.startsWith('SELECT position FROM retention_scan_progress')) return { rows: [{ position: position.toString() }] };
    if (sql.startsWith('INSERT INTO retention_scan_progress')) {
      if (failProgressSave) { failProgressSave = false; throw new Error('progress write failed'); }
      position = BigInt(values?.[1] as string);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('DELETE FROM play_records')) {
      const removed = records.filter((account) => (values?.[0] as string[]).includes(account))
        .slice(0, values?.[1] as number);
      for (const account of removed) records.splice(records.indexOf(account), 1);
      return { rowCount: removed.length, rows: [] };
    }
    if (sql.includes(') candidates ORDER BY account_id')) {
      const cursor = values?.[0] as string | null;
      const offset = BigInt(values?.[2] as string);
      cursors.push(cursor);
      offsets.push(offset);
      const page = [...new Set(records.filter((account) => cursor === null || account > cursor))].sort()
        .slice(Number(offset), Number(offset) + (values?.[1] as number));
      pages.push(page);
      return { rows: page.map((account_id) => ({ account_id })) };
    }
    if (sql.includes('FROM account_deletion_requests')) return {
      rows: hashes.filter((hash) => (values?.[0] as Buffer[]).some((value) => value.equals(hash)))
        .map((account_reference_hash) => ({ account_reference_hash })),
    };
    if (sql.startsWith('SELECT account_id FROM play_runs')) return {
      rows: [...new Set(records.filter((account) => (values?.[0] as string[]).includes(account)))]
        .map((account_id) => ({ account_id })),
    };
    return { rows: [], rowCount: 0 };
  };
  const pool = {
    connect: async () => ({ query, release: () => undefined }),
    query,
  } as unknown as Pool;
  return { pool, pages, cursors, offsets, position: () => position, failNextProgressSave: () => { failProgressSave = true; } };
}

test('live-only pages stop at the scan budget and later runs reach deleted data in a dense UUID prefix', async () => {
  const live = Array.from({ length: 240 }, (_, i) => `acct_6b86b273-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const gone = 'acct_6b86b273-0000-4000-8000-000000000240';
  const records = [...live, gone];
  const { pool, pages, position, offsets, cursors } = candidatePool(records, [gone]);
  const clock = new Date('1970-01-01T12:00:00.000Z');
  const service = new PostgresRetentionService(pool, { now: () => clock, playBatchSize: 2, playMaxBatches: 2 });
  let runs = 0;
  const first = await service.run({ hmacSecret: secret });
  runs++;
  assert.deepEqual(first.failed, []);
  assert.deepEqual(first.counts.find(({ step }) => step === 'deleted_play_data'),
    { step: 'deleted_play_data', count: 0, scanCapHit: true });
  assert.equal(pages.length, 100, 'live-only pages consume the fixed page budget');
  assert.equal(pages.flat().includes(gone), false);
  assert.equal(records.includes(gone), true);
  assert.equal(position(), 200n);
  assert.equal(offsets[0], 0n);
  assert.ok(offsets.slice(1).every((offset) => offset === 0n), 'later pages use keysets, not repeated offsets');
  assert.equal(cursors[1], live[1]);

  pages.length = 0;
  const second = await service.run({ hmacSecret: secret });
  runs++;
  assert.deepEqual(second.failed, []);
  assert.equal(second.counts.find(({ step }) => step === 'deleted_play_data')?.count, 1);
  assert.equal(records.includes(gone), false);
  assert.deepEqual(records, live, 'live best records remain untouched');
  assert.ok(pages.length <= 100);
  assert.equal(new Set(pages.flat()).size, pages.flat().length);
  assert.equal(offsets[100], 200n, 'the next run resumes the persisted count');
  assert.equal(position(), 0n, 'a completed sweep resets');
  assert.ok(runs <= Math.ceil(241 / 200) + 1, 'reachability uses at most the bounded number of runs');
  pages.length = 0;
  await service.run({ hmacSecret: secret });
  assert.deepEqual(pages[0], live.slice(0, 2), 'the next sweep starts at the beginning');
  assert.ok(position() >= 0n && position() <= BigInt(records.length));
});

test('candidate disappearance reduces the persisted offset without skipping the next unprocessed account', async () => {
  const accounts = Array.from({ length: 241 }, (_, i) => `acct_dense_${String(i).padStart(3, '0')}`);
  const [firstGone, laterGone] = [accounts[0]!, accounts[200]!];
  const live = accounts.filter((id) => id !== firstGone && id !== laterGone);
  const records = [...accounts];
  const { pool, position, pages } = candidatePool(records, [firstGone, laterGone]);
  const service = new PostgresRetentionService(pool, { now: () => now, playBatchSize: 2, playMaxBatches: 2 });
  const first = await service.run({ hmacSecret: secret });
  assert.deepEqual(first.failed, []);
  assert.deepEqual(first.counts.find(({ step }) => step === 'deleted_play_data'),
    { step: 'deleted_play_data', count: 1, scanCapHit: true });
  assert.equal(position(), 199n);
  pages.length = 0;
  const second = await service.run({ hmacSecret: secret });
  assert.deepEqual(second.failed, []);
  assert.equal(second.counts.find(({ step }) => step === 'deleted_play_data')?.count, 1);
  assert.equal(pages[0]![0], laterGone);
  assert.deepEqual(records, live);
  assert.equal(position(), 0n);
});

test('a partial page retains its offset when one deleted account disappears but another still has rows', async () => {
  const live = ['acct_0_live', 'acct_1_live', 'acct_4_live'];
  const gone = ['acct_2_gone', 'acct_3_gone'];
  const records = [live[0]!, live[1]!, gone[0]!, gone[1]!, gone[1]!, gone[1]!, live[2]!];
  const { pool, position, pages } = candidatePool(records, gone);
  const service = new PostgresRetentionService(pool, { now: () => now, playBatchSize: 2, playMaxBatches: 1 });
  const first = await service.run({ hmacSecret: secret });
  assert.deepEqual(first.failed, []);
  assert.deepEqual(first.counts.find(({ step }) => step === 'deleted_play_data'),
    { step: 'deleted_play_data', count: 2, capHit: true });
  assert.equal(position(), 2n);
  assert.equal(records.includes(gone[0]!), false);
  assert.equal(records.filter((id) => id === gone[1]).length, 2);
  pages.length = 0;
  const second = await service.run({ hmacSecret: secret });
  assert.deepEqual(second.failed, []);
  assert.equal(second.counts.find(({ step }) => step === 'deleted_play_data')?.count, 2);
  assert.deepEqual(pages[0], [gone[1], live[2]], 'retry includes the still-unprocessed account');
  assert.deepEqual(records, live);
  assert.equal(position(), 3n);
  await service.run({ hmacSecret: secret });
  assert.equal(position(), 0n);
});

test('a progress write failure rolls back that page deletion and the retry still reaches the account', async () => {
  const gone = 'acct_0_gone';
  const live = 'acct_1_live';
  const records = [gone, live];
  const { pool, position, failNextProgressSave } = candidatePool(records, [gone]);
  const service = new PostgresRetentionService(pool, { now: () => now, playBatchSize: 2 });
  failNextProgressSave();
  const first = await service.run({ hmacSecret: secret });
  assert.deepEqual(first.failed, ['deleted_play_data']);
  assert.equal(first.counts.find(({ step }) => step === 'deleted_play_data'), undefined);
  assert.deepEqual(records, [gone, live], 'deletion and offset must both roll back');
  assert.equal(position(), 0n);
  const retry = await service.run({ hmacSecret: secret });
  assert.deepEqual(retry.failed, []);
  assert.equal(retry.counts.find(({ step }) => step === 'deleted_play_data')?.count, 1);
  assert.deepEqual(records, [live]);
  assert.equal(position(), 0n);
});

test('an empty resume after external candidate removal resets a stale position for the next sweep', async () => {
  const records = Array.from({ length: 240 }, (_, i) => `acct_live_${String(i).padStart(3, '0')}`);
  const { pool, position, pages } = candidatePool(records);
  const service = new PostgresRetentionService(pool, { now: () => now, playBatchSize: 2 });
  await service.run({ hmacSecret: secret });
  assert.equal(position(), 200n);
  records.splice(10);
  pages.length = 0;
  const result = await service.run({ hmacSecret: secret });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(pages, [[]]);
  assert.equal(position(), 0n);
  await service.run({ hmacSecret: secret });
  assert.deepEqual(pages[1], records.slice(0, 2));
  assert.equal(position(), 0n);
});

test('a complete small sweep covers each candidate once, resets position and has no cap report', async () => {
  const live = ['acct_10000000-live', 'acct_6b86b273-ff34-fce1-9d6b-804eff5a3f57', 'acct_f0000000-live'];
  const gone = 'acct_90000000-deleted';
  const records = [...live, gone];
  const { pool, pages, position } = candidatePool(records, [gone]);
  const service = new PostgresRetentionService(pool, {
    now: () => new Date('1970-01-02T12:00:00.000Z'), playBatchSize: 2, playMaxBatches: 2,
  });
  const result = await service.run({ hmacSecret: secret });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.counts.find(({ step }) => step === 'deleted_play_data'),
    { step: 'deleted_play_data', count: 1 });
  assert.deepEqual(pages.flat().sort(), [...live, gone].sort());
  assert.deepEqual(pages[0], live.slice(0, 2), 'the sweep starts with the first sorted candidates');
  assert.equal(new Set(pages.flat()).size, pages.flat().length, 'keysets prevent revisits');
  assert.deepEqual(records, live);
  assert.equal(position(), 0n);
  pages.length = 0;
  const retry = await service.run({ hmacSecret: secret });
  assert.deepEqual(retry.counts.find(({ step }) => step === 'deleted_play_data'),
    { step: 'deleted_play_data', count: 0 });
  assert.deepEqual(pages.flat().sort(), [...live].sort());
  assert.equal(position(), 0n);
});

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
  const live = ['acct_00_live', 'acct_01_live'];
  const gone = 'acct_10_deleted';
  const records = [...live, gone];
  const { pool, cursors } = candidatePool(records, [gone]);
  const service = new PostgresRetentionService(pool, {
    now: () => now, playBatchSize: 2, playMaxBatches: 2,
  });
  const result = await service.run({ hmacSecret: secret });

  assert.deepEqual(result.failed, []);
  assert.equal(result.counts.find(({ step }) => step === 'deleted_play_data')?.count, 1);
  assert.deepEqual(cursors, [null, live[1]]);
  assert.deepEqual(records, live);
});

test('deleted play rows share one cap across runs, records, and studios', async () => {
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const account = 'acct_deleted';
  const rows: Record<'play_runs' | 'play_records' | 'studios', number> = {
    play_runs: 1, play_records: 3, studios: 1,
  };
  let deleted = 0;
  let position = '0';
  const pages: string[][] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
      if (sql.startsWith('INSERT INTO retention_scan_progress')) position = values?.[1] as string;
      if (sql.startsWith('SELECT account_id FROM play_runs')) return {
        rows: Object.values(rows).some((count) => count > 0) ? [{ account_id: account }] : [],
      };
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
      if (sql.startsWith('SELECT position FROM retention_scan_progress')) return { rows: [{ position }] };
      if (sql.startsWith('INSERT INTO retention_scan_progress')) position = values?.[1] as string;
      if (sql.includes(') candidates ORDER BY account_id')) {
        const cursor = values?.[0] as string | null;
        const page = Object.values(rows).some((count) => count > 0)
          && (cursor === null || account > cursor) && values?.[2] === '0' ? [account] : [];
        pages.push(page);
        return { rows: page.map((account_id) => ({ account_id })) };
      }
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
  assert.equal(position, '0', 'a partially purged page must not advance');
  pages.length = 0;
  const retry = await service.run({ hmacSecret: secret });
  assert.deepEqual(retry.failed, []);
  assert.equal(retry.counts.find(({ step }) => step === 'deleted_play_data')?.count, 1);
  assert.notEqual(retry.counts.find(({ step }) => step === 'deleted_play_data')?.capHit, true);
  assert.deepEqual(rows, { play_runs: 0, play_records: 0, studios: 0 });
  assert.deepEqual(pages[0], [account], 'the next run reprocesses the partial page');
  assert.equal(position, '0', 'the completed sweep resets');
  assert.equal((await service.run({ hmacSecret: secret })).counts
    .find(({ step }) => step === 'deleted_play_data')?.count, 0);
  // A rollback image can leave another small backlog; a short final batch is natural completion, not a cap stop.
  Object.assign(rows, { play_runs: 1, play_records: 1, studios: 1 });
  const smallBacklog = await service.run({ hmacSecret: secret });
  assert.equal(smallBacklog.counts.find(({ step }) => step === 'deleted_play_data')?.count, 3);
  assert.notEqual(smallBacklog.counts.find(({ step }) => step === 'deleted_play_data')?.capHit, true);
});

test('deleted-account repair discovers and deletes orphaned course unlocks within its row budget', async () => {
  const account = 'deleted-course-user';
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  let remaining = 1;
  const seen: string[] = [];
  const query = async (sql: string, values?: unknown[]) => {
    seen.push(sql);
    if (sql.includes(') candidates ORDER BY account_id')) return { rows: remaining ? [{ account_id: account }] : [] };
    if (sql.includes('FROM account_deletion_requests')) return {
      rows: [{ account_reference_hash: lifecycle.referenceHash(account) }],
    };
    if (sql.startsWith('DELETE FROM course_unlocks')) {
      assert.equal((values?.[0] as string[])[0], account);
      assert.match(sql, /WHERE \(account_id, course_id\) IN \(\s*SELECT account_id, course_id/);
      remaining = 0;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT account_id FROM play_runs')) return { rows: remaining ? [{ account_id: account }] : [] };
    if (sql.startsWith('SELECT position FROM retention_scan_progress')) return { rows: [{ position: '0' }] };
    return { rows: [{ count: 0 }], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  const result = await new PostgresRetentionService(pool, { now: () => now }).run({ hmacSecret: secret });
  assert.equal(result.counts.find(({ step }) => step === 'deleted_play_data')?.count, 1);
  assert.equal(remaining, 0);
  assert.ok(seen.some(sql => sql.includes('SELECT account_id FROM course_unlocks')));
});

test('invalid play retention limits fail before a database connection', () => {
  const pool = { connect: () => { throw new Error('database accessed'); } } as unknown as Pool;
  for (const options of [{ playBatchSize: 0 }, { playMaxBatches: 0 },
    { playBatchSize: 501 }, { playMaxBatches: 11 }, { playBatchSize: 1.5 }]) {
    assert.throws(() => new PostgresRetentionService(pool, options), /RETENTION_LIMIT_INVALID/);
  }
});
