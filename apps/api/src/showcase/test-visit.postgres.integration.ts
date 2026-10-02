// #295: PostgresClaimSlotService.issueShowcaseTestSlot의 핵심 — DB 이름·점포 is_demo 격리, 발급자 멤버 행의 REVOKED
// 불변조건, 그리고 redeem()이 그대로 적용하는 방문·보상 규칙(가상 점포는 일반 방문처럼 진행도에 센다)을 확인한다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { ClaimSlotError } from '../claim-slot-service.js';
import { runMigrations } from '../postgres/migrate.js';
import { PostgresClaimSlotService } from '../postgres/claim-slot-service.js';
import { seedLocalShowcase, SHOWCASE_MERCHANT_ID } from './local-seed.js';

const referenceHmacSecret = 'test-only-test-visit-reference-secret-32-bytes';

/** A fresh masscom_showcase_ci_<uuid>_test database, migrated and seeded with the three local demo merchants (store A included). */
async function withFreshShowcaseDatabase(run: (pool: Pool) => Promise<void>): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const url = new URL(connectionString);
  if (!decodeURIComponent(url.pathname.slice(1)).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must end in _test');
  }
  const admin = new Pool({ connectionString });
  const databaseName = `masscom_showcase_ci_${randomUUID().replaceAll('-', '')}_test`;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    const pool = new Pool({ connectionString: url.toString() });
    try {
      await runMigrations(pool);
      await seedLocalShowcase(pool);
      await run(pool);
    } finally {
      await pool.end();
    }
  } finally {
    try {
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
}

// 같은 영업일(한국 날짜) 판정을 고정하려고 오늘 한국 날짜의 정오(03:00 UTC)를 쓴다. 시드 캠페인은 실제 현재 시각 기준
// (시작 = 지금 - 24시간)이라, 날짜를 하드코딩하면 그 날이 지난 뒤 CLAIM_CAMPAIGN_UNAVAILABLE로 실패한다(#316).
function kstNoonToday(): Date {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 3));
}
// 한 번만 계산한다. 호출마다 다시 계산하면 실행 중 한국 자정을 넘을 때 시계가 하루 뛴다.
const testNow = kstNoonToday();

function service(pool: Pool, now?: () => Date): PostgresClaimSlotService {
  return new PostgresClaimSlotService(pool, { referenceHmacSecret, ...(now ? { now } : {}) });
}

test('a non-showcase database refuses the issue and leaves no claim_slots row', async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!databaseName.endsWith('_test') || databaseName.includes('showcase')) {
    throw new Error('TEST_DATABASE_URL must be a plain (non-showcase) _test database for this test');
  }
  const pool = new Pool({ connectionString });
  try {
    await runMigrations(pool);
    await pool.query('TRUNCATE claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE');
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ('merchant-not-showcase', '데모 식당', '시험용', '서울 노원구 1', 0, 'ACTIVE', true)`,
    );
    await assert.rejects(
      service(pool).issueShowcaseTestSlot({ merchantId: 'merchant-not-showcase', accountId: 'customer-1' }),
      /SHOWCASE_HOST_DATABASE_REQUIRED/,
    );
    const rows = await pool.query('SELECT 1 FROM claim_slots');
    assert.equal(rows.rowCount, 0);
    const members = await pool.query(
      `SELECT 1 FROM merchant_members WHERE account_id = 'showcase-test-visit-issuer'`,
    );
    assert.equal(members.rowCount, 0, 'a refused issue must not even create the lazy issuer row');
  } finally {
    await pool.end();
  }
});

test('a non-demo merchant is refused with SHOWCASE_MERCHANT_NOT_FOUND and no claim_slots row', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ('real-merchant', '실제 가게', '실제 영업점', '서울 노원구 2', 0, 'ACTIVE', false)`,
    );
    await assert.rejects(
      service(pool).issueShowcaseTestSlot({ merchantId: 'real-merchant', accountId: 'customer-1' }),
      (error: unknown) => error instanceof ClaimSlotError && error.code === 'SHOWCASE_MERCHANT_NOT_FOUND',
    );
    await assert.rejects(
      service(pool).issueShowcaseTestSlot({ merchantId: 'no-such-merchant', accountId: 'customer-1' }),
      (error: unknown) => error instanceof ClaimSlotError && error.code === 'SHOWCASE_MERCHANT_NOT_FOUND',
    );
    const rows = await pool.query('SELECT 1 FROM claim_slots');
    assert.equal(rows.rowCount, 0);
  });
});

test('a paused demo merchant is refused with CLAIM_MERCHANT_INACTIVE', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    await pool.query(`UPDATE merchants SET status = 'PAUSED' WHERE id = $1`, [SHOWCASE_MERCHANT_ID]);
    await assert.rejects(
      service(pool).issueShowcaseTestSlot({ merchantId: SHOWCASE_MERCHANT_ID, accountId: 'customer-1' }),
      (error: unknown) => error instanceof ClaimSlotError && error.code === 'CLAIM_MERCHANT_INACTIVE',
    );
    const rows = await pool.query('SELECT 1 FROM claim_slots');
    assert.equal(rows.rowCount, 0);
  });
});

test('a demo-store test visit counts like a normal visit: progress, badge goal 1, and a REVOKED issuer row', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const svc = service(pool, () => testNow);
    const issued = await svc.issueShowcaseTestSlot({ merchantId: SHOWCASE_MERCHANT_ID, accountId: 'customer-1' });
    const redeemed = await svc.redeem({ accountId: 'customer-1', token: issued.token });

    assert.equal(redeemed.merchantId, SHOWCASE_MERCHANT_ID);
    assert.equal(redeemed.visit.progressCounted, true);
    assert.equal(redeemed.visit.progressVisitCount, 1);
    assert.equal(redeemed.visit.progressExcludedReason, undefined);
    assert.equal(redeemed.grantedRewards.length, 1);
    assert.equal(redeemed.grantedRewards[0]!.targetVisitCount, 1);

    const issuer = await pool.query<{ role: string; status: string; revoked_at: Date | null }>(
      `SELECT role, status, revoked_at FROM merchant_members
       WHERE merchant_id = $1 AND account_id = 'showcase-test-visit-issuer'`,
      [SHOWCASE_MERCHANT_ID],
    );
    assert.deepEqual(
      { role: issuer.rows[0]?.role, status: issuer.rows[0]?.status, revoked: issuer.rows[0]?.revoked_at !== null },
      { role: 'STAFF', status: 'REVOKED', revoked: true },
    );
    // merchant-access.ts의 모든 권한 조회는 status='ACTIVE'만 보므로, 발급자 계정은 이 점포에 아무 권한도 갖지 못한다.
    const activeIssuerMembership = await pool.query(
      `SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = 'showcase-test-visit-issuer' AND status = 'ACTIVE'`,
      [SHOWCASE_MERCHANT_ID],
    );
    assert.equal(activeIssuerMembership.rowCount, 0);
  });
});

test('issuing twice the same day counts the second visit but not its progress', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const svc = service(pool, () => testNow);
    const first = await svc.issueShowcaseTestSlot({ merchantId: SHOWCASE_MERCHANT_ID, accountId: 'customer-2' });
    const firstRedeemed = await svc.redeem({ accountId: 'customer-2', token: first.token });
    assert.equal(firstRedeemed.visit.progressCounted, true);

    const second = await svc.issueShowcaseTestSlot({ merchantId: SHOWCASE_MERCHANT_ID, accountId: 'customer-2' });
    const secondRedeemed = await svc.redeem({ accountId: 'customer-2', token: second.token });
    assert.equal(secondRedeemed.visit.progressCounted, false);
    assert.equal(secondRedeemed.grantedRewards.length, 0);
  });
});

test('an issuer row that was somehow promoted to ACTIVE blocks further issuing instead of granting it power', async () => {
  await withFreshShowcaseDatabase(async (pool) => {
    const svc = service(pool, () => testNow);
    // Issue once so the lazy REVOKED issuer row exists, then simulate tampering (should never happen in practice).
    const first = await svc.issueShowcaseTestSlot({ merchantId: SHOWCASE_MERCHANT_ID, accountId: 'customer-4' });
    await svc.redeem({ accountId: 'customer-4', token: first.token });
    await pool.query(
      `UPDATE merchant_members SET status = 'ACTIVE', revoked_at = NULL
       WHERE merchant_id = $1 AND account_id = 'showcase-test-visit-issuer'`,
      [SHOWCASE_MERCHANT_ID],
    );
    const beforeCount = (await pool.query('SELECT count(*)::int AS count FROM claim_slots')).rows[0]!.count;
    await assert.rejects(
      svc.issueShowcaseTestSlot({ merchantId: SHOWCASE_MERCHANT_ID, accountId: 'customer-4' }),
      /SHOWCASE_TEST_VISIT_ISSUER_COMPROMISED/,
    );
    const afterCount = (await pool.query('SELECT count(*)::int AS count FROM claim_slots')).rows[0]!.count;
    assert.equal(afterCount, beforeCount, 'the compromised-issuer refusal must not still insert a claim slot');
  });
});
