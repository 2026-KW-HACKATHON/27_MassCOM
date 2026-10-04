import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { PostgresAdminService } from './postgres/admin.js';

const hmacSecret = 'campaign-extension-test-hmac-secret-32-bytes';

function fixture(status: 'ACTIVE' | 'PAUSED' | 'ENDED' | 'DRAFT', endsAt: Date,
  otherActive = false, merchantStatus: 'ACTIVE' | 'PAUSED' = 'ACTIVE') {
  const calls: { sql: string; params: unknown[] | undefined }[] = [];
  const row = {
    id: 'campaign-1', merchant_id: 'merchant-1', merchant_name: '상점', title: '방문',
    starts_at: new Date('2025-01-01T00:00:00.000Z'), ends_at: endsAt,
    enrollment_capacity: 10, enrolled_count: 0, reward_goals: [], status, is_public: status === 'ACTIVE',
  };
  const client = {
    release() {},
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM account_deletion_requests')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM platform_admins')) return { rows: [{}], rowCount: 1 };
      if (sql.includes('SELECT campaign.merchant_id FROM campaigns')) {
        return { rows: [{ merchant_id: row.merchant_id }], rowCount: 1 };
      }
      if (sql.includes('SELECT status FROM merchants')) return { rows: [{ status: merchantStatus }], rowCount: 1 };
      if (sql.includes('FOR UPDATE OF campaign')) return { rows: [row], rowCount: 1 };
      if (sql.includes('SELECT 1 FROM campaigns WHERE merchant_id')) {
        return { rows: otherActive ? [{}] : [], rowCount: otherActive ? 1 : 0 };
      }
      if (sql.includes('UPDATE campaigns SET ends_at')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO platform_admin_audit')) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const pool = { async connect() { return client; } } as unknown as Pool;
  return { service: new PostgresAdminService(pool, hmacSecret), calls, row };
}

test('campaign extension uses merchant-before-campaign locks, exact end arithmetic, and a minimal audit', async () => {
  const before = new Date(Date.now() + 10 * 86_400_000);
  const { service, calls } = fixture('ACTIVE', before);
  const result = await service.extendCampaign('admin', 'campaign-1', 30, before.toISOString());
  assert.equal(result.endsAt, new Date(before.getTime() + 30 * 86_400_000).toISOString());
  assert.equal(result.status, 'ACTIVE');
  const merchantLock = calls.findIndex(call => call.sql.includes('SELECT status FROM merchants'));
  const campaignLock = calls.findIndex(call => call.sql.includes('FOR UPDATE OF campaign'));
  assert.ok(merchantLock >= 0 && campaignLock > merchantLock);
  const update = calls.find(call => call.sql.includes('UPDATE campaigns SET ends_at'))!;
  assert.equal((update.params?.[1] as Date).toISOString(), result.endsAt);
  const audit = calls.find(call => call.sql.includes('INSERT INTO platform_admin_audit'))!;
  assert.equal(audit.params?.[3], 'CAMPAIGN_EXTENDED');
  assert.deepEqual(JSON.parse(audit.params?.[4] as string), { campaignId: 'campaign-1', endsAt: before.toISOString() });
  assert.deepEqual(JSON.parse(audit.params?.[5] as string), { campaignId: 'campaign-1', endsAt: result.endsAt });
});

test('campaign extension rejects invalid input, stale end, draft, annual cap, and revival conflict', async () => {
  const before = new Date(Date.now() + 10 * 86_400_000);
  const invalid = fixture('ACTIVE', before);
  await assert.rejects(invalid.service.extendCampaign('admin', 'campaign-1', 31 as 30, before.toISOString()),
    /ADMIN_INVALID_INPUT/);
  await assert.rejects(invalid.service.extendCampaign('admin', 'campaign-1', 30, '2026-13-01T00:00:00.000Z'),
    /ADMIN_INVALID_INPUT/);
  assert.equal(invalid.calls.length, 0);
  await assert.rejects(invalid.service.extendCampaign('admin', 'campaign-1', 30, new Date(before.getTime() + 1).toISOString()),
    /ADMIN_VERSION_CONFLICT/);
  await assert.rejects(fixture('DRAFT', before).service.extendCampaign('admin', 'campaign-1', 30, before.toISOString()),
    /ADMIN_CAMPAIGN_NOT_EXTENDABLE/);
  const far = new Date(Date.now() + 350 * 86_400_000);
  await assert.rejects(fixture('PAUSED', far).service.extendCampaign('admin', 'campaign-1', 30, far.toISOString()),
    /ADMIN_CAMPAIGN_EXTENSION_LIMIT/);
  const boundary = new Date(Date.now() + 335 * 86_400_000);
  const atCap = await fixture('PAUSED', boundary).service.extendCampaign('admin', 'campaign-1', 30, boundary.toISOString());
  assert.equal(atCap.endsAt, new Date(boundary.getTime() + 30 * 86_400_000).toISOString());
  assert.equal(atCap.status, 'PAUSED');
  const ended = new Date(Date.now() - 86_400_000);
  await assert.rejects(fixture('ENDED', ended, true).service.extendCampaign('admin', 'campaign-1', 30, ended.toISOString()),
    /ADMIN_CAMPAIGN_ACTIVE_EXISTS/);
  const revived = await fixture('ENDED', ended, false, 'PAUSED').service.extendCampaign('admin', 'campaign-1', 30, ended.toISOString());
  assert.equal(revived.status, 'ACTIVE');
  assert.equal(revived.public, true);
  const beforeCall = Date.now();
  const expired = await fixture('ACTIVE', ended).service.extendCampaign('admin', 'campaign-1', 30, ended.toISOString());
  const afterCall = Date.now();
  assert.ok(Date.parse(expired.endsAt) >= beforeCall + 30 * 86_400_000);
  assert.ok(Date.parse(expired.endsAt) <= afterCall + 30 * 86_400_000);
  const paused = await fixture('PAUSED', ended).service.extendCampaign('admin', 'campaign-1', 90, ended.toISOString());
  assert.equal(paused.status, 'PAUSED');
  assert.equal(paused.public, false);
  assert.ok(Date.parse(paused.endsAt) >= afterCall + 90 * 86_400_000);
});
