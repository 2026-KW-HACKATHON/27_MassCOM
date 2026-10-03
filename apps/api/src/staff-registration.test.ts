import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { PostgresStaffRegistration } from './postgres/staff-registration.js';

test('my active real-store list maps current art hash to the catalog URL or null', async () => {
  const artSha = 'a'.repeat(64);
  let released = false;
  const client = {
    query: async (sql: string, parameters?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 };
      if (sql.includes('account_deletion_requests')) return { rows: [], rowCount: 0 };
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
      assert.match(sql, /LEFT JOIN merchant_art AS art ON art\.merchant_id = merchant\.id/u);
      assert.match(sql, /member\.status = 'ACTIVE' AND merchant\.is_demo = false/u);
      assert.deepEqual(parameters, ['staff-account']);
      return { rows: [
        { id: 'shop-art', name: '그림 점포', role: 'OWNER', art_sha256: artSha },
        { id: 'shop-plain', name: '기본 점포', role: 'STAFF', art_sha256: null },
      ], rowCount: 2 };
    },
    release: () => { released = true; },
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const staff = new PostgresStaffRegistration(pool, 'staff-registration-unit-secret-32-bytes');

  assert.deepEqual(await staff.mine('staff-account'), [
    { id: 'shop-art', name: '그림 점포', role: 'OWNER', artUrl: `/merchant-art/${artSha}.webp` },
    { id: 'shop-plain', name: '기본 점포', role: 'STAFF', artUrl: null },
  ]);
  assert.equal(released, true);
});
