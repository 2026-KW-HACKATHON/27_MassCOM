import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { ReversalError } from './reversal.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresReversalService } from './postgres/reversal.js';

// 첫 질의(BEGIN 다음)에서 주어진 SQLSTATE로 실패하는 가짜 풀. DB 없이 오류 변환만 시험한다.
function failingPool(code: string): Pool {
  const client = {
    query: async (sql: string) => {
      if (/^(BEGIN|ROLLBACK)/u.test(sql)) return { rows: [], rowCount: 0 };
      throw Object.assign(new Error(`simulated ${code}`), { code });
    },
    release: () => undefined,
  };
  return { connect: async () => client } as unknown as Pool;
}

function serviceOver(pool: Pool): PostgresReversalService {
  return new PostgresReversalService(pool, {
    labelHmacSecret: 'unit-test-label-secret-at-least-32-bytes',
    accountLifecycle: new PostgresAccountLifecycle({ hmacSecret: 'unit-test-lifecycle-secret-at-least-32-bytes' }),
  });
}

const cancelInput = { merchantId: 'shop', staffAccountId: 'staff', visitEventId: randomUUID(), reason: 'OTHER' };

test('a deadlock or a lock that cannot be taken means a mint may be in progress', async () => {
  for (const code of ['40P01', '55P03']) {
    await assert.rejects(
      serviceOver(failingPool(code)).cancelVisit(cancelInput),
      (error: unknown) => error instanceof ReversalError && error.code === 'VISIT_REWARD_MINT_IN_PROGRESS',
      code,
    );
  }
});

test('other database failures are not disguised as a mint in progress', async () => {
  await assert.rejects(
    serviceOver(failingPool('23505')).cancelVisit(cancelInput),
    (error: unknown) => !(error instanceof ReversalError) && (error as { code?: string }).code === '23505',
  );
});
