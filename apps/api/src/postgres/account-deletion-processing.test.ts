import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { AccountDeletionIntakeError } from '../account-deletion-intake.js';
import { PostgresAccountDeletionProcessingService } from './account-deletion-processing.js';

const hmacSecret = 'processing-unit-test-account-deletion-secret-32-bytes';
const intakeId = '11111111-1111-4111-8111-111111111111';

/** A pool whose first statement after BEGIN fails with the given database error code; it records what was sent. */
function failingPool(code: string, statements: string[]): Pool {
  const client = {
    async query(sql: string) {
      statements.push(sql.trim().split(/\s+/)[0]!);
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      throw Object.assign(new Error('database error'), { code });
    },
    release() {},
  };
  return { connect: async () => client } as unknown as Pool;
}

test('a database deadlock is reported as DELETION_BUSY after the transaction is rolled back', async () => {
  const statements: string[] = [];
  const service = new PostgresAccountDeletionProcessingService(failingPool('40P01', statements), {
    hmacSecret, policyVersion: 'account-deletion-v1', onRefusal: () => {},
  });
  await assert.rejects(service.process({ kind: 'cli', operator: 'tester' }, intakeId), (error: unknown) =>
    error instanceof AccountDeletionIntakeError && error.code === 'DELETION_BUSY' && error.message === 'DELETION_BUSY');
  assert.equal(statements.at(-1), 'ROLLBACK');
  await assert.rejects(service.reject({ kind: 'cli', operator: 'tester' }, intakeId, '중복 접수'), (error: unknown) =>
    error instanceof AccountDeletionIntakeError && error.code === 'DELETION_BUSY');
});

test('any other database failure is passed on unchanged and is not mistaken for a refusal', async () => {
  const logs: unknown[] = [];
  const service = new PostgresAccountDeletionProcessingService(failingPool('57014', []), {
    hmacSecret, policyVersion: 'account-deletion-v1', onRefusal: (entry) => logs.push(entry),
  });
  await assert.rejects(service.process({ kind: 'cli', operator: 'tester' }, intakeId), (error: unknown) =>
    error instanceof Error && !(error instanceof AccountDeletionIntakeError) &&
    (error as { code?: string }).code === '57014');
  assert.deepEqual(logs, []);
});
