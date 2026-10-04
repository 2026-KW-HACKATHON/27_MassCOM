import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresAdminService } from './postgres/admin.js';
import { runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = testUrl && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');

test('campaign extension preserves states, revives dated endings, enforces CAS and the annual cap, and audits', {
  skip: safeTestTarget ? false : 'requires a disposable _test PostgreSQL database',
}, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const admin = new PostgresAdminService(pool, 'campaign-extension-test-hmac-secret-32-bytes');
  const accountId = `acct_${randomUUID()}`;
  const merchantId = randomUUID();
  const campaigns = Array.from({ length: 6 }, () => randomUUID());
  try {
    await runMigrations(pool);
    await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
      VALUES ('google', $1, $2, now())`, [`campaign-extension-${randomUUID()}`, accountId]);
    await pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [accountId]);
    await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, status, is_demo)
      VALUES ($1, '기간 연장 점포', '', '서울', 0, 'ACTIVE', false)`, [merchantId]);
    const now = Date.now();
    const at = (days: number) => new Date(now + days * 86_400_000).toISOString();
    const seed = async (index: number, status: string, publicValue: boolean, endsAt: string) => {
      await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 10)`,
      [campaigns[index], merchantId, `기간 연장 ${index}`, at(-20), endsAt, status, publicValue]);
    };
    await seed(0, 'ACTIVE', true, at(10));
    await seed(1, 'PAUSED', false, at(-1));
    await seed(2, 'ENDED', false, at(-1));
    await seed(3, 'DRAFT', false, at(10));
    await seed(4, 'PAUSED', false, at(350));
    const listed = await admin.listCampaigns(accountId);
    const activeBefore = listed.find(row => row.id === campaigns[0])!;
    await assert.rejects(admin.extendCampaign('not-admin', campaigns[0]!, 30, activeBefore.endsAt), /ADMIN_FORBIDDEN/);
    await assert.rejects(admin.extendCampaign(accountId, campaigns[0]!, 30, at(11)), /ADMIN_VERSION_CONFLICT/);
    await assert.rejects(admin.extendCampaign(accountId, campaigns[0]!, 30, 'bad date'), /ADMIN_INVALID_INPUT/);
    await assert.rejects(admin.extendCampaign(accountId, campaigns[0]!, 31 as 30, activeBefore.endsAt), /ADMIN_INVALID_INPUT/);
    await assert.rejects(admin.extendCampaign(accountId, campaigns[3]!, 30, at(11)), /ADMIN_VERSION_CONFLICT/);
    const draftEnd = (await pool.query<{ ends_at: Date }>('SELECT ends_at FROM campaigns WHERE id = $1', [campaigns[3]])).rows[0]!.ends_at.toISOString();
    await assert.rejects(admin.extendCampaign(accountId, campaigns[3]!, 30, draftEnd), /ADMIN_CAMPAIGN_NOT_EXTENDABLE/);
    const farEnd = (await pool.query<{ ends_at: Date }>('SELECT ends_at FROM campaigns WHERE id = $1', [campaigns[4]])).rows[0]!.ends_at.toISOString();
    await assert.rejects(admin.extendCampaign(accountId, campaigns[4]!, 30, farEnd), /ADMIN_CAMPAIGN_EXTENSION_LIMIT/);

    const active = await admin.extendCampaign(accountId, campaigns[0]!, 30, activeBefore.endsAt);
    assert.equal(active.status, 'ACTIVE');
    assert.equal(active.public, true);
    assert.equal(Date.parse(active.endsAt), Date.parse(activeBefore.endsAt) + 30 * 86_400_000);
    assert.deepEqual((await admin.listCampaigns(accountId)).find(row => row.id === campaigns[0]), active);
    await assert.rejects(admin.extendCampaign(accountId, campaigns[0]!, 30, activeBefore.endsAt), /ADMIN_VERSION_CONFLICT/);

    const pausedBefore = (await pool.query<{ ends_at: Date }>('SELECT ends_at FROM campaigns WHERE id = $1', [campaigns[1]])).rows[0]!.ends_at.toISOString();
    const paused = await admin.extendCampaign(accountId, campaigns[1]!, 90, pausedBefore);
    assert.equal(paused.status, 'PAUSED');
    assert.equal(paused.public, false);
    assert.ok(Date.parse(paused.endsAt) >= Date.now() + 90 * 86_400_000 - 5_000);

    const endedBefore = (await pool.query<{ ends_at: Date }>('SELECT ends_at FROM campaigns WHERE id = $1', [campaigns[2]])).rows[0]!.ends_at.toISOString();
    await assert.rejects(admin.extendCampaign(accountId, campaigns[2]!, 30, endedBefore), /ADMIN_CAMPAIGN_ACTIVE_EXISTS/);
    await pool.query(`UPDATE campaigns SET status = 'PAUSED', is_public = false WHERE id = $1`, [campaigns[0]]);
    await seed(5, 'ACTIVE', true, at(-1));
    const datedBefore = (await pool.query<{ ends_at: Date }>('SELECT ends_at FROM campaigns WHERE id = $1', [campaigns[5]])).rows[0]!.ends_at.toISOString();
    const dated = await admin.extendCampaign(accountId, campaigns[5]!, 30, datedBefore);
    assert.equal(dated.status, 'ACTIVE');
    assert.equal(dated.public, true);
    assert.ok(Date.parse(dated.endsAt) >= Date.now() + 30 * 86_400_000 - 5_000);
    await pool.query(`UPDATE campaigns SET status = 'PAUSED', is_public = false WHERE id = $1`, [campaigns[5]]);
    const revived = await admin.extendCampaign(accountId, campaigns[2]!, 30, endedBefore);
    assert.equal(revived.status, 'ACTIVE');
    assert.equal(revived.public, true);
    assert.ok(Date.parse(revived.endsAt) >= Date.now() + 30 * 86_400_000 - 5_000);

    const audits = await pool.query<{
      action: string; target_account_id: string | null;
      before_state: { campaignId: string; endsAt: string };
      after_state: { campaignId: string; endsAt: string };
    }>(
      `SELECT action, target_account_id, before_state, after_state FROM platform_admin_audit
       WHERE merchant_id = $1 AND action = 'CAMPAIGN_EXTENDED' ORDER BY created_at, id`, [merchantId]);
    assert.equal(audits.rowCount, 4);
    assert.ok(audits.rows.some(row => row.before_state.endsAt === activeBefore.endsAt && row.after_state.endsAt === active.endsAt));
    assert.ok(audits.rows.some(row => row.before_state.endsAt === endedBefore && row.after_state.endsAt === revived.endsAt));
    for (const [campaignId, oldEnd, newEnd] of [
      [campaigns[0], activeBefore.endsAt, active.endsAt],
      [campaigns[1], pausedBefore, paused.endsAt],
      [campaigns[5], datedBefore, dated.endsAt],
      [campaigns[2], endedBefore, revived.endsAt],
    ]) {
      const audit = audits.rows.find(row => row.before_state.campaignId === campaignId);
      assert.ok(audit);
      assert.equal(audit.action, 'CAMPAIGN_EXTENDED');
      assert.equal(audit.target_account_id, null);
      // 감사 상태에는 캠페인 식별자와 종료 시각만 남기고 개인정보를 추가하지 않는다.
      assert.deepEqual(audit.before_state, { campaignId, endsAt: oldEnd });
      assert.deepEqual(audit.after_state, { campaignId, endsAt: newEnd });
    }
  } finally { await pool.end(); }
});
