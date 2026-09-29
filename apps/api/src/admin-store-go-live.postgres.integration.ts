// Issue #246: 관리자 웹의 점포 공개·점주 올리기·보상 혜택·캠페인 공개를 실제 PostgreSQL에서 확인한다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool, type PoolClient } from 'pg';

import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAdminService, type AdminMerchant, type AdminRewardOfferInput } from './postgres/admin.js';
import { PostgresBadgeRewardService } from './postgres/badge-rewards.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = testUrl && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
const skip = safeTestTarget ? false : 'requires a disposable _test PostgreSQL database';
const hmacSecret = 'store-go-live-test-account-deletion-hmac-secret';
const fullConsent = { benefit: true, ownerPaysCost: true, validity: true, issuanceCap: true, duplicateUse: true };

async function makeAdmin(pool: Pool, service: PostgresAdminService): Promise<string> {
  const subject = `admin-${randomUUID()}`;
  const accountId = `acct_${randomUUID()}`;
  await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
    VALUES ('google', $1, $2, now())`, [subject, accountId]);
  await service.grant(subject);
  return accountId;
}

async function makeAccount(pool: Pool): Promise<string> {
  const accountId = `acct_${randomUUID()}`;
  await pool.query(`INSERT INTO auth_identities(provider, subject, account_id, created_at)
    VALUES ('google', $1, $2, now())`, [`user-${randomUUID()}`, accountId]);
  return accountId;
}

async function readyMerchant(service: PostgresAdminService, admin: string): Promise<AdminMerchant> {
  return service.createMerchant(admin, {
    name: `공개 준비 점포 ${randomUUID()}`, story: '실제 점포', roadAddress: '서울 노원구 월계로 1',
    minimumSpendWon: 5000, menuItems: [{ name: '김밥', priceWon: 4500 }], businessHours: '월–금 10:00–20:00',
  });
}

async function publishedMerchant(service: PostgresAdminService, admin: string): Promise<AdminMerchant> {
  const ready = await readyMerchant(service, admin);
  return service.publishMerchant(admin, ready.id, ready.version, 'CS-2609-01');
}

async function addMember(pool: Pool, merchantId: string, accountId: string,
  role: 'OWNER' | 'STAFF' = 'STAFF', status: 'ACTIVE' | 'REVOKED' = 'ACTIVE'): Promise<void> {
  await pool.query(`INSERT INTO merchant_members(merchant_id, account_id, role, status, revoked_at)
    VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'REVOKED' THEN now() END)`, [merchantId, accountId, role, status]);
}

function offerInput(merchantId: string, overrides: Partial<AdminRewardOfferInput> = {}): AdminRewardOfferInput {
  return { merchantId, milestone: 1, title: '김밥 한 줄 무료', detail: '다른 할인과 함께 쓸 수 없어요.', validDays: 30,
    issuanceCap: 100, consentDocumentRef: 'OF-2609-01', consent: fullConsent, ...overrides };
}

// 다른 연결이 이 점포 행을 지금 잠그고 있는지(NOWAIT가 55P03으로 실패하는지) 본다.
async function merchantRowLocked(pool: Pool, merchantId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM merchants WHERE id = $1 FOR UPDATE NOWAIT', [merchantId]);
    return false;
  } catch (error) {
    if ((error as { code?: string }).code === '55P03') return true;
    throw error;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('condition was not reached in time');
}

test('store publish needs menu, hours, address and a clean consent reference, and audits publish and hide', { skip }, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    const admin = await makeAdmin(pool, service);
    const bare = await service.createMerchant(admin, {
      name: `빈 점포 ${randomUUID()}`, story: '', roadAddress: '서울', minimumSpendWon: 0,
    });
    assert.equal(bare.consentDocumentRef, null);
    assert.equal(bare.publishedAt, null);
    await assert.rejects(service.publishMerchant(admin, bare.id, bare.version, 'CS-2609-01'), /ADMIN_MERCHANT_NOT_READY/);
    // 메뉴만 채우고 영업시간이 비어 있어도 공개하지 않는다.
    const menuOnly = await service.updateMerchant(admin, bare.id, bare.version, {
      name: bare.name, story: '', roadAddress: '서울', minimumSpendWon: 0, menuItems: [{ name: '라면', priceWon: 5000 }],
      businessHours: '   ',
    });
    await assert.rejects(service.publishMerchant(admin, bare.id, menuOnly.version, 'CS-2609-01'), /ADMIN_MERCHANT_NOT_READY/);
    for (const personal of ['123-45-67890', '010-1234-5678', 'owner@example.com', 'CS-20260930-01', '', undefined]) {
      await assert.rejects(service.publishMerchant(admin, bare.id, menuOnly.version, personal), /ADMIN_DOCUMENT_REF_INVALID/);
    }
    const ready = await service.updateMerchant(admin, bare.id, menuOnly.version, {
      name: bare.name, story: '', roadAddress: '서울', minimumSpendWon: 0, businessHours: '매일 11:00–21:00',
    });
    const outsider = await makeAccount(pool);
    await assert.rejects(service.publishMerchant(outsider, bare.id, ready.version, 'CS-2609-01'), /ADMIN_FORBIDDEN/);
    await assert.rejects(service.publishMerchant(admin, bare.id, ready.version - 1, 'CS-2609-01'), /ADMIN_VERSION_CONFLICT/);
    const published = await service.publishMerchant(admin, bare.id, ready.version, ' CS-2609-01 ');
    assert.equal(published.status, 'ACTIVE');
    assert.equal(published.consentDocumentRef, 'CS-2609-01');
    assert.ok(published.publishedAt && Date.parse(published.publishedAt) > 0);
    assert.equal(published.version, ready.version + 1);
    await assert.rejects(service.publishMerchant(admin, bare.id, published.version, 'CS-2609-02'),
      /ADMIN_MERCHANT_ALREADY_ACTIVE/);
    const audit = await pool.query<{ action: string; actor_account_id: string; after_state: AdminMerchant; target_account_id: string | null }>(
      `SELECT action, actor_account_id, after_state, target_account_id FROM platform_admin_audit
       WHERE merchant_id = $1 ORDER BY created_at, action`, [bare.id]);
    assert.deepEqual(audit.rows.map(row => row.action),
      ['MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_UPDATED', 'MERCHANT_PUBLISHED']);
    const publishAudit = audit.rows.at(-1)!;
    assert.equal(publishAudit.actor_account_id, admin);
    assert.equal(publishAudit.after_state.consentDocumentRef, 'CS-2609-01');
    assert.equal(publishAudit.after_state.status, 'ACTIVE');
    assert.equal(publishAudit.target_account_id, null);

    // 숨김은 지금처럼 활성 혜택을 멈추고 감사 기록을 남긴다. 다시 공개하면 참조 번호를 다시 받는다.
    await pool.query(`UPDATE badge_reward_offers SET status = 'PAUSED' WHERE status = 'ACTIVE'`);
    const created = await service.createRewardOffer(admin, offerInput(bare.id, { milestone: 3 }));
    const hidden = await service.hideMerchant(admin, bare.id, published.version);
    assert.equal(hidden.status, 'PAUSED');
    assert.equal(hidden.consentDocumentRef, 'CS-2609-01');
    const offerStatus = await pool.query('SELECT status FROM badge_reward_offers WHERE id = $1', [created.id]);
    assert.equal(offerStatus.rows[0].status, 'PAUSED');
    const republished = await service.publishMerchant(admin, bare.id, hidden.version, 'CS-2610-01');
    assert.equal(republished.consentDocumentRef, 'CS-2610-01');
    const offerAfter = await pool.query('SELECT status FROM badge_reward_offers WHERE id = $1', [created.id]);
    assert.equal(offerAfter.rows[0].status, 'PAUSED', 'publishing does not resume paused offers');
    const actions = await pool.query<{ action: string }>(
      'SELECT action FROM platform_admin_audit WHERE merchant_id = $1 ORDER BY created_at', [bare.id]);
    assert.deepEqual(actions.rows.map(row => row.action).slice(-3), ['REWARD_OFFER_CREATED', 'MERCHANT_HIDDEN', 'MERCHANT_PUBLISHED']);

    // 시연 점포는 대상이 아니고, DB CHECK도 전화번호 모양 참조 번호를 막는다.
    const demoId = randomUUID();
    await pool.query(`INSERT INTO merchants(id, name, story, road_address, minimum_spend_won, menu_items, business_hours,
      status, is_demo) VALUES ($1, '시연', '', '가상', 0, '[{"name":"가상","priceWon":1}]', '가상', 'PAUSED', true)`, [demoId]);
    await assert.rejects(service.publishMerchant(admin, demoId, 1, 'CS-2609-01'), /ADMIN_MERCHANT_NOT_FOUND/);
    await assert.rejects(pool.query(`UPDATE merchants SET consent_document_ref = '010-1234-5678' WHERE id = $1`, [bare.id]),
      (error: { code?: string }) => error.code === '23514');
    await assert.rejects(pool.query(`UPDATE merchants SET consent_document_ref = 'CS2026093001' WHERE id = $1`, [bare.id]),
      (error: { code?: string }) => error.code === '23514');
  } finally { await pool.end(); }
});

test('owner promotion needs verified active staff, refuses self and non-members, and audits only a reference', { skip }, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    const admin = await makeAdmin(pool, service);
    const ready = await readyMerchant(service, admin);
    const staff = await makeAccount(pool);
    const revoked = await makeAccount(pool);
    const stranger = await makeAccount(pool);
    await addMember(pool, ready.id, staff);
    await addMember(pool, ready.id, revoked, 'STAFF', 'REVOKED');
    await addMember(pool, ready.id, admin);
    await assert.rejects(service.promoteOwner(admin, ready.id, staff, 'OWN-2609-01'), /ADMIN_MERCHANT_NOT_ACTIVE/);
    await service.publishMerchant(admin, ready.id, ready.version, 'CS-2609-01');
    await assert.rejects(service.promoteOwner(admin, ready.id, admin, 'OWN-2609-01'), /ADMIN_SELF_ROLE_CHANGE/);
    await assert.rejects(service.demoteOwner(admin, ready.id, admin,
      { reason: 'OTHER', verificationDocumentRef: 'OWN-2609-01' }), /ADMIN_SELF_ROLE_CHANGE/);
    for (const personal of ['123-45-67890', '010-1234-5678', 'owner@example.com']) {
      await assert.rejects(service.promoteOwner(admin, ready.id, staff, personal), /ADMIN_DOCUMENT_REF_INVALID/);
    }
    await assert.rejects(service.promoteOwner(admin, ready.id, stranger, 'OWN-2609-01'), /ADMIN_MEMBER_NOT_FOUND/);
    await assert.rejects(service.promoteOwner(admin, ready.id, revoked, 'OWN-2609-01'), /ADMIN_MEMBER_NOT_FOUND/);
    await assert.rejects(service.promoteOwner(staff, ready.id, revoked, 'OWN-2609-01'), /ADMIN_FORBIDDEN/);
    await assert.rejects(service.promoteOwner(admin, `missing-${randomUUID()}`, staff, 'OWN-2609-01'),
      /ADMIN_MERCHANT_NOT_FOUND/);

    assert.deepEqual(await service.promoteOwner(admin, ready.id, staff, 'OWN-2609-01'), { accountId: staff, role: 'OWNER' });
    await assert.rejects(service.promoteOwner(admin, ready.id, staff, 'OWN-2609-02'), /ADMIN_ALREADY_OWNER/);
    const owners = await service.listOwners(admin, ready.id);
    assert.deepEqual(owners.map(owner => [owner.accountId, owner.role]), [[staff, 'OWNER']]);
    const member = await pool.query('SELECT role, status FROM merchant_members WHERE merchant_id = $1 AND account_id = $2',
      [ready.id, staff]);
    assert.deepEqual(member.rows[0], { role: 'OWNER', status: 'ACTIVE' });
    const granted = await pool.query<{ actor_account_id: string; target_account_id: string; before_state: unknown; after_state: unknown }>(
      `SELECT actor_account_id, target_account_id, before_state, after_state FROM platform_admin_audit
       WHERE merchant_id = $1 AND action = 'MERCHANT_OWNER_GRANTED'`, [ready.id]);
    assert.equal(granted.rowCount, 1);
    assert.equal(granted.rows[0]!.actor_account_id, admin);
    assert.equal(granted.rows[0]!.target_account_id, staff);
    assert.deepEqual(granted.rows[0]!.before_state, { role: 'STAFF' });
    assert.deepEqual(granted.rows[0]!.after_state, { role: 'OWNER', verificationDocumentRef: 'OWN-2609-01' });
    assert.doesNotMatch(JSON.stringify(granted.rows[0]!.after_state), new RegExp(staff));

    await assert.rejects(service.demoteOwner(admin, ready.id, staff,
      { reason: 'BECAUSE', verificationDocumentRef: 'OWN-2609-03' }), /ADMIN_INVALID_INPUT/);
    await assert.rejects(service.demoteOwner(admin, ready.id, staff,
      { reason: 'OWNER_REQUEST', verificationDocumentRef: '010 1234 5678' }), /ADMIN_DOCUMENT_REF_INVALID/);
    await assert.rejects(service.demoteOwner(admin, ready.id, revoked,
      { reason: 'OWNER_REQUEST', verificationDocumentRef: 'OWN-2609-03' }), /ADMIN_MEMBER_NOT_FOUND/);
    // 숨긴 점포에서도 내릴 수 있다.
    const current = (await service.listMerchants(admin)).find(row => row.id === ready.id)!;
    await service.hideMerchant(admin, ready.id, current.version);
    assert.deepEqual(await service.demoteOwner(admin, ready.id, staff,
      { reason: 'OWNERSHIP_CHANGED', verificationDocumentRef: 'OWN-2609-03' }), { accountId: staff, role: 'STAFF' });
    const after = await pool.query('SELECT role, status FROM merchant_members WHERE merchant_id = $1 AND account_id = $2',
      [ready.id, staff]);
    assert.deepEqual(after.rows[0], { role: 'STAFF', status: 'ACTIVE' });
    const revokedAudit = await pool.query<{ target_account_id: string; after_state: unknown }>(
      `SELECT target_account_id, after_state FROM platform_admin_audit
       WHERE merchant_id = $1 AND action = 'MERCHANT_OWNER_REVOKED'`, [ready.id]);
    assert.equal(revokedAudit.rows[0]!.target_account_id, staff);
    assert.deepEqual(revokedAudit.rows[0]!.after_state,
      { role: 'STAFF', reason: 'OWNERSHIP_CHANGED', verificationDocumentRef: 'OWN-2609-03' });
    assert.deepEqual(await service.listOwners(admin, ready.id), []);
  } finally { await pool.end(); }
});

test('concurrent promotions never leave more than two active owners on a store', { skip }, async () => {
  const pool = new Pool({ connectionString: testUrl, max: 12 });
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    const admin = await makeAdmin(pool, service);
    const merchant = await publishedMerchant(service, admin);
    const staff = await Promise.all(Array.from({ length: 5 }, () => makeAccount(pool)));
    for (const accountId of staff) await addMember(pool, merchant.id, accountId);
    // 관리자마다 따로 올려 계정 advisory 잠금이 서로 겹치지 않게 한다: 점포 행 잠금만이 이 경쟁을 직렬화한다.
    const admins = await Promise.all(staff.map(() => makeAdmin(pool, service)));
    const first = await Promise.allSettled(staff.map((accountId, index) =>
      service.promoteOwner(admins[index]!, merchant.id, accountId, `OWN-A0${index}`)));
    assert.equal(first.filter(result => result.status === 'fulfilled').length, 2);
    const rejections = first.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.equal(rejections.length, 3);
    for (const rejection of rejections) assert.match(String(rejection.reason), /ADMIN_OWNER_LIMIT/);
    const count = async () => (await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM merchant_members WHERE merchant_id = $1 AND role = 'OWNER' AND status = 'ACTIVE'`,
      [merchant.id])).rows[0]!.count;
    assert.equal(await count(), 2);

    // 한 명을 내린 뒤 남은 세 명을 동시에 올려도 한 명만 된다.
    const owner = (await service.listOwners(admin, merchant.id))[0]!.accountId;
    await service.demoteOwner(admin, merchant.id, owner, { reason: 'OWNER_REQUEST', verificationDocumentRef: 'OWN-B01' });
    const remaining = staff.filter(accountId => accountId !== owner);
    const second = await Promise.allSettled(remaining.map((accountId, index) =>
      service.promoteOwner(admins[index]!, merchant.id, accountId, `OWN-C0${index}`)));
    // 이미 OWNER인 한 명은 ALREADY_OWNER, 나머지 STAFF 셋 중 한 명만 올라간다.
    assert.equal(second.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(await count(), 2);
    const grants = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM platform_admin_audit WHERE merchant_id = $1 AND action = 'MERCHANT_OWNER_GRANTED'`,
      [merchant.id]);
    assert.equal(grants.rows[0]!.count, 3);
  } finally { await pool.end(); }
});

test('owner changes, offer pause and campaign changes lock the store row before the member, offer or campaign row', { skip }, async () => {
  const pool = new Pool({ connectionString: testUrl, max: 8 });
  const service = new PostgresAdminService(pool, hmacSecret);
  let holder: PoolClient | undefined;
  try {
    await runMigrations(pool);
    const admin = await makeAdmin(pool, service);
    const merchant = await publishedMerchant(service, admin);
    const staff = await makeAccount(pool);
    await addMember(pool, merchant.id, staff);

    const holdRowThenCheck = async (lockSql: string, params: unknown[], action: () => Promise<unknown>) => {
      holder = await pool.connect();
      await holder.query('BEGIN');
      await holder.query(lockSql, params);
      let settled = false;
      const running = action().finally(() => { settled = true; });
      // 행 잠금을 기다리는 동안 이 동작은 이미 점포 행을 잡고 있어야 한다(점포 → 행 순서).
      await waitFor(() => merchantRowLocked(pool, merchant.id));
      assert.equal(settled, false);
      await holder.query('ROLLBACK');
      holder.release();
      holder = undefined;
      return running;
    };

    await holdRowThenCheck('SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 FOR UPDATE',
      [merchant.id, staff], () => service.promoteOwner(admin, merchant.id, staff, 'OWN-L01'));
    await holdRowThenCheck('SELECT 1 FROM merchant_members WHERE merchant_id = $1 AND account_id = $2 FOR UPDATE',
      [merchant.id, staff], () => service.demoteOwner(admin, merchant.id, staff,
        { reason: 'OTHER', verificationDocumentRef: 'OWN-L02' }));

    await pool.query(`UPDATE badge_reward_offers SET status = 'PAUSED' WHERE status = 'ACTIVE'`);
    const offer = await service.createRewardOffer(admin, offerInput(merchant.id, { milestone: 2 }));
    await holdRowThenCheck('SELECT 1 FROM badge_reward_offers WHERE id = $1 FOR UPDATE', [offer.id],
      () => service.pauseRewardOffer(admin, offer.id));

    const draft = await service.createCampaignDraft(admin, {
      merchantId: merchant.id, title: '잠금 순서 캠페인', startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), enrollmentCapacity: 10,
      rewardGoals: [{ targetVisitCount: 1, displayName: '첫 방문' }, { targetVisitCount: 3, displayName: '세 번째' },
        { targetVisitCount: 5, displayName: '다섯 번째' }],
    });
    await holdRowThenCheck('SELECT 1 FROM campaigns WHERE id = $1 FOR UPDATE', [draft.id],
      () => service.publishCampaign(admin, draft.id));
    await holdRowThenCheck('SELECT 1 FROM campaigns WHERE id = $1 FOR UPDATE', [draft.id],
      () => service.pauseCampaign(admin, draft.id));

    // 같은 점포에 여러 관리자 동작이 겹쳐도 교착(40P01) 없이 끝난다.
    await service.publishCampaign(admin, draft.id);
    const other = await makeAccount(pool);
    await addMember(pool, merchant.id, other);
    for (let round = 0; round < 5; round += 1) {
      const version = (await service.listMerchants(admin)).find(row => row.id === merchant.id)!.version;
      const results = await Promise.allSettled([
        service.promoteOwner(admin, merchant.id, other, `OWN-R0${round}`),
        service.pauseCampaign(admin, draft.id),
        service.hideMerchant(admin, merchant.id, version),
        service.pauseRewardOffer(admin, offer.id),
      ]);
      for (const result of results) {
        if (result.status === 'rejected') assert.doesNotMatch(String((result.reason as { code?: string }).code), /40P01/);
      }
      const now = (await service.listMerchants(admin)).find(row => row.id === merchant.id)!;
      if (now.status === 'PAUSED') await service.publishMerchant(admin, merchant.id, now.version, 'CS-2609-01');
      await service.publishCampaign(admin, draft.id).catch(() => undefined);
      await service.demoteOwner(admin, merchant.id, other, { reason: 'OTHER', verificationDocumentRef: 'OWN-R99' })
        .catch(() => undefined);
    }
  } finally {
    if (holder) { await holder.query('ROLLBACK').catch(() => undefined); holder.release(); }
    await pool.end();
  }
});

test('reward offers need all five owner consents, a cap, an active store and a free milestone', { skip }, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    // 상자 번호당 활성 혜택은 전체에서 하나라서 앞 시험이 남긴 활성 혜택을 먼저 멈춘다.
    await pool.query(`UPDATE badge_reward_offers SET status = 'PAUSED' WHERE status = 'ACTIVE'`);
    const admin = await makeAdmin(pool, service);
    const paused = await readyMerchant(service, admin);
    await assert.rejects(service.createRewardOffer(admin, offerInput(paused.id)), /ADMIN_MERCHANT_NOT_ACTIVE/);
    const merchant = await publishedMerchant(service, admin);
    for (const key of Object.keys(fullConsent)) {
      await assert.rejects(service.createRewardOffer(admin, offerInput(merchant.id, { consent: { ...fullConsent, [key]: false } })),
        /ADMIN_CONSENT_INCOMPLETE/, key);
    }
    await assert.rejects(service.createRewardOffer(admin, offerInput(merchant.id, { consent: undefined })),
      /ADMIN_CONSENT_INCOMPLETE/);
    for (const issuanceCap of [undefined, null, 0, 10_001, 1.5, '100']) {
      await assert.rejects(service.createRewardOffer(admin, offerInput(merchant.id, { issuanceCap })), /ADMIN_INVALID_INPUT/);
    }
    for (const bad of [{ milestone: 4 }, { validDays: 0 }, { validDays: 366 }, { title: ' ' }, { title: 'x'.repeat(41) },
      { detail: 'x'.repeat(121) }]) {
      await assert.rejects(service.createRewardOffer(admin, offerInput(merchant.id, bad)), /ADMIN_INVALID_INPUT/);
    }
    for (const consentDocumentRef of ['123-45-67890', '010-1234-5678', 'owner@example.com', undefined]) {
      await assert.rejects(service.createRewardOffer(admin, offerInput(merchant.id, { consentDocumentRef })),
        /ADMIN_DOCUMENT_REF_INVALID/);
    }
    const outsider = await makeAccount(pool);
    await assert.rejects(service.createRewardOffer(outsider, offerInput(merchant.id)), /ADMIN_FORBIDDEN/);
    const before = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM badge_reward_offers WHERE merchant_id = $1',
      [merchant.id]);
    assert.equal(before.rows[0]!.count, 0, 'refused offers never reach the table');

    const created = await service.createRewardOffer(admin, offerInput(merchant.id, { issuanceCap: 10_000 }));
    assert.equal(created.status, 'ACTIVE');
    assert.equal(created.issuanceCap, 10_000);
    assert.equal(created.issuedCount, 0);
    assert.equal(created.consentDocumentRef, 'OF-2609-01');
    const stored = await pool.query<{ consent_note: string; consent_checklist_version: string }>(
      'SELECT consent_note, consent_checklist_version FROM badge_reward_offers WHERE id = $1', [created.id]);
    assert.match(stored.rows[0]!.consent_note, /OF-2609-01/);
    assert.match(stored.rows[0]!.consent_note, /owner-offer-consent-v1/);
    assert.equal(stored.rows[0]!.consent_checklist_version, 'owner-offer-consent-v1');
    await assert.rejects(service.createRewardOffer(admin, offerInput(merchant.id)), /ADMIN_OFFER_MILESTONE_TAKEN/);

    // 기존 고객 화면(상자)이 새 혜택을 그대로 읽는다.
    const customer = await makeAccount(pool);
    const badges = new PostgresBadgeRewardService(pool, { accountLifecycle: new PostgresAccountLifecycle({ hmacSecret }) });
    const snapshot = await badges.getBadges(customer);
    assert.equal(snapshot.rewards.find(reward => reward.milestone === 1)?.offer?.title, '김밥 한 줄 무료');

    // 서로 다른 점포가 같은 상자를 동시에 만들어도 한 건만 된다(점포 잠금이 달라 부분 유일 색인 경쟁까지 가도 같은 코드).
    const racers = await Promise.all([1, 2, 3].map(() => publishedMerchant(service, admin)));
    const race = await Promise.allSettled(racers.map(racer =>
      service.createRewardOffer(admin, offerInput(racer.id, { milestone: 2 }))));
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    for (const result of race) {
      if (result.status === 'rejected') assert.match(String(result.reason), /ADMIN_OFFER_MILESTONE_TAKEN/);
    }

    const pausedOffer = await service.pauseRewardOffer(admin, created.id);
    assert.equal(pausedOffer.replayed, false);
    assert.equal(pausedOffer.offer.status, 'PAUSED');
    assert.equal((await service.pauseRewardOffer(admin, created.id)).replayed, true);
    await assert.rejects(service.pauseRewardOffer(admin, randomUUID()), /ADMIN_OFFER_NOT_FOUND/);
    await assert.rejects(service.pauseRewardOffer(admin, 'not-a-uuid'), /ADMIN_OFFER_NOT_FOUND/);
    const listed = await service.listRewardOffers(admin);
    assert.equal(listed.find(row => row.id === created.id)?.status, 'PAUSED');
    const audit = await pool.query<{ action: string; after_state: Record<string, unknown> }>(
      `SELECT action, after_state FROM platform_admin_audit WHERE merchant_id = $1 AND action LIKE 'REWARD_OFFER_%'
       ORDER BY created_at`, [merchant.id]);
    assert.deepEqual(audit.rows.map(row => row.action), ['REWARD_OFFER_CREATED', 'REWARD_OFFER_PAUSED']);
    assert.deepEqual(audit.rows[0]!.after_state.consent, fullConsent);
    assert.equal(audit.rows[0]!.after_state.consentDocumentRef, 'OF-2609-01');
  } finally { await pool.end(); }
});

test('campaign publish and pause respect store status, goals, end date and one public campaign per store', { skip }, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const service = new PostgresAdminService(pool, hmacSecret);
  const day = 86_400_000;
  const goals = [{ targetVisitCount: 1 as const, displayName: '첫 방문' }, { targetVisitCount: 3 as const, displayName: '세 번째' },
    { targetVisitCount: 5 as const, displayName: '다섯 번째' }];
  try {
    await runMigrations(pool);
    const admin = await makeAdmin(pool, service);
    const draftFor = (merchantId: string, title: string) => service.createCampaignDraft(admin, {
      merchantId, title, startsAt: new Date(Date.now() - day).toISOString(),
      endsAt: new Date(Date.now() + 30 * day).toISOString(), enrollmentCapacity: 20, rewardGoals: goals,
    });
    const hiddenStore = await readyMerchant(service, admin);
    const hiddenDraft = await draftFor(hiddenStore.id, '비공개 점포 캠페인');
    await assert.rejects(service.publishCampaign(admin, hiddenDraft.id), /ADMIN_MERCHANT_NOT_ACTIVE/);

    const merchant = await publishedMerchant(service, admin);
    const first = await draftFor(merchant.id, '첫 캠페인');
    const second = await draftFor(merchant.id, '둘째 캠페인');
    await assert.rejects(service.pauseCampaign(admin, first.id), /ADMIN_CAMPAIGN_NOT_PAUSABLE/);
    const outsider = await makeAccount(pool);
    await assert.rejects(service.publishCampaign(outsider, first.id), /ADMIN_FORBIDDEN/);
    const published = await service.publishCampaign(admin, first.id);
    assert.equal(published.replayed, false);
    assert.equal(published.campaign.status, 'ACTIVE');
    assert.equal(published.campaign.public, true);
    assert.deepEqual(published.campaign.rewardGoals, goals);
    assert.equal((await service.publishCampaign(admin, first.id)).replayed, true);
    await assert.rejects(service.publishCampaign(admin, second.id), /ADMIN_CAMPAIGN_ACTIVE_EXISTS/);
    const paused = await service.pauseCampaign(admin, first.id);
    assert.deepEqual([paused.campaign.status, paused.campaign.public, paused.replayed], ['PAUSED', false, false]);
    assert.equal((await service.pauseCampaign(admin, first.id)).replayed, true);
    assert.equal((await service.publishCampaign(admin, second.id)).campaign.status, 'ACTIVE');
    await assert.rejects(service.publishCampaign(admin, first.id), /ADMIN_CAMPAIGN_ACTIVE_EXISTS/);
    await service.pauseCampaign(admin, second.id);
    // 멈춘 캠페인을 같은 캠페인으로 다시 연다(고객 진행이 캠페인 단위라서).
    assert.equal((await service.publishCampaign(admin, first.id)).campaign.status, 'ACTIVE');
    const row = await pool.query('SELECT status, is_public FROM campaigns WHERE id = $1', [first.id]);
    assert.deepEqual(row.rows[0], { status: 'ACTIVE', is_public: true });

    // 목표가 없거나 이미 끝난 캠페인은 공개하지 않는다.
    const noGoals = randomUUID();
    const ended = randomUUID();
    await pool.query(`INSERT INTO campaigns(id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
      VALUES ($1, $3, '목표 없음', now() - interval '1 day', now() + interval '1 day', 'DRAFT', false, 5),
        ($2, $3, '끝난 캠페인', now() - interval '3 day', now() - interval '1 day', 'DRAFT', false, 5)`,
    [noGoals, ended, merchant.id]);
    await pool.query(`INSERT INTO campaign_goals(campaign_id, target_visit_count, display_name) VALUES ($1, 1, '첫 방문')`, [ended]);
    await service.pauseCampaign(admin, first.id);
    await assert.rejects(service.publishCampaign(admin, noGoals), /ADMIN_CAMPAIGN_NOT_PUBLISHABLE/);
    await assert.rejects(service.publishCampaign(admin, ended), /ADMIN_CAMPAIGN_NOT_PUBLISHABLE/);
    await assert.rejects(service.publishCampaign(admin, `missing-${randomUUID()}`), /ADMIN_CAMPAIGN_NOT_FOUND/);

    const listed = await service.listCampaigns(admin);
    const mine = listed.filter(campaign => campaign.merchantId === merchant.id);
    assert.deepEqual(mine.map(campaign => campaign.id).sort(), [first.id, second.id].sort());
    assert.ok(mine.every(campaign => campaign.status === 'PAUSED' && !campaign.public));
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM platform_admin_audit WHERE merchant_id = $1 AND action LIKE 'CAMPAIGN_%' ORDER BY created_at`,
      [merchant.id]);
    assert.deepEqual(audit.rows.map(entry => entry.action), ['CAMPAIGN_DRAFT_CREATED', 'CAMPAIGN_DRAFT_CREATED',
      'CAMPAIGN_PUBLISHED', 'CAMPAIGN_PAUSED', 'CAMPAIGN_PUBLISHED', 'CAMPAIGN_PAUSED', 'CAMPAIGN_PUBLISHED', 'CAMPAIGN_PAUSED']);
  } finally { await pool.end(); }
});

test('D-023: a visit earns the reward without any campaign enrollment even when the shown capacity is full', { skip }, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    const admin = await makeAdmin(pool, service);
    const merchant = await publishedMerchant(service, admin);
    const staff = await makeAccount(pool);
    const customer = await makeAccount(pool);
    await addMember(pool, merchant.id, staff);
    const draft = await service.createCampaignDraft(admin, {
      merchantId: merchant.id, title: '정원 1명 캠페인', startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), enrollmentCapacity: 1,
      rewardGoals: [{ targetVisitCount: 1, displayName: '첫 방문' }, { targetVisitCount: 3, displayName: '세 번째' },
        { targetVisitCount: 5, displayName: '다섯 번째' }],
    });
    await service.publishCampaign(admin, draft.id);
    // 보이는 참여자 수를 가득 채운다. 이 고객은 참여 등록을 하지 않았다.
    await pool.query('UPDATE campaigns SET enrolled_count = enrollment_capacity WHERE id = $1', [draft.id]);
    const claims = new PostgresClaimSlotService(pool, { referenceHmacSecret: 'store-go-live-reference-hmac-secret-32' });
    const issued = await claims.issue({ merchantId: merchant.id, customerAccountId: customer,
      merchantReference: `order-${randomUUID()}`, createdByAccountId: staff });
    const redeemed = await claims.redeem({ accountId: customer, token: issued.token });
    assert.equal(redeemed.status, 'CLAIMED');
    assert.deepEqual(redeemed.grantedRewards.map(reward => reward.targetVisitCount), [1]);
    const enrollments = await pool.query('SELECT 1 FROM campaign_enrollments WHERE campaign_id = $1', [draft.id]);
    assert.equal(enrollments.rowCount, 0);
    const counts = await pool.query('SELECT enrolled_count, enrollment_capacity FROM campaigns WHERE id = $1', [draft.id]);
    assert.deepEqual(counts.rows[0], { enrolled_count: 1, enrollment_capacity: 1 });
    const rights = await pool.query(`SELECT status FROM reward_entitlements WHERE customer_account_id = $1 AND campaign_id = $2`,
      [customer, draft.id]);
    assert.deepEqual(rights.rows, [{ status: 'GRANTED' }]);
  } finally { await pool.end(); }
});

test('0032 keeps the deployed API statements working and accepts exactly the fifteen audit actions', { skip }, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const client = await pool.connect();
  try {
    await runMigrations(pool);
    await client.query('BEGIN');
    const merchantId = randomUUID();
    // 02cb7e7의 createMerchant 문장(새 열을 모른다).
    const created = await client.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, menu_items, business_hours, status, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PAUSED', false)
       RETURNING id, name, story, road_address, minimum_spend_won, menu_items, business_hours, status, is_demo, version`,
      [merchantId, '옛 API 점포', '', '서울', 0, '[]', ''],
    );
    assert.equal(created.rows[0].version, 1);
    // 02cb7e7의 감사 문장(대상 계정 열을 모른다).
    for (const action of ['MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED', 'COUPON_VOIDED']) {
      await client.query(
        `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, before_state, after_state)
         VALUES ($1, $2, $3, $4, NULL, '{}')`, [randomUUID(), 'old-api-admin', merchantId, action]);
    }
    for (const action of ['ACCOUNT_DELETION_PROCESSED', 'ACCOUNT_DELETION_REJECTED', 'ACCOUNT_DELETION_RECONCILED']) {
      await client.query(
        `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, before_state, after_state)
         VALUES ($1, $2, NULL, $3, NULL, '{}')`, [randomUUID(), 'old-api-admin', action]);
    }
    // 시연 seed와 같은 모양의 혜택 INSERT(참조 번호 열 없이).
    await client.query(
      `INSERT INTO badge_reward_offers (id, milestone, merchant_id, title, detail, valid_days, status, consent_note)
       VALUES ($1, 1, $2, '옛 혜택', '', 30, 'PAUSED', '점주 동의 기록')`, [randomUUID(), merchantId]);
    for (const action of ['MERCHANT_PUBLISHED', 'REWARD_OFFER_CREATED', 'REWARD_OFFER_PAUSED', 'CAMPAIGN_PUBLISHED',
      'CAMPAIGN_PAUSED']) {
      await client.query(
        `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, after_state)
         VALUES ($1, 'new-admin', $2, $3, '{}')`, [randomUUID(), merchantId, action]);
    }
    for (const action of ['MERCHANT_OWNER_GRANTED', 'MERCHANT_OWNER_REVOKED']) {
      await client.query(
        `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, after_state, target_account_id)
         VALUES ($1, 'new-admin', $2, $3, '{}', 'member-1')`, [randomUUID(), merchantId, action]);
    }
    const reject = async (sql: string, params: unknown[]) => {
      await client.query('SAVEPOINT refused');
      await assert.rejects(client.query(sql, params), (error: { code?: string }) => error.code === '23514');
      await client.query('ROLLBACK TO SAVEPOINT refused');
    };
    await reject(`INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, after_state)
      VALUES ($1, 'x', $2, 'MERCHANT_OWNER_GRANTED', '{}')`, [randomUUID(), merchantId]);
    await reject(`INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, after_state, target_account_id)
      VALUES ($1, 'x', $2, 'MERCHANT_UPDATED', '{}', 'member-1')`, [randomUUID(), merchantId]);
    await reject(`INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, after_state)
      VALUES ($1, 'x', $2, 'MERCHANT_DELETED', '{}')`, [randomUUID(), merchantId]);
    await reject(`INSERT INTO badge_reward_offers (id, milestone, merchant_id, title, detail, valid_days, status, consent_note,
      consent_document_ref) VALUES ($1, 1, $2, '전화', '', 30, 'PAUSED', '기록', '010-1234-5678')`, [randomUUID(), merchantId]);
    const check = await client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'platform_admin_audit_action_check'`);
    assert.equal((check.rows[0]!.definition.match(/'[A-Z_]+'::text/g) ?? []).length, 15);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});

test('account deletion pseudonymizes the owner-change target and actor without leaving the raw id in audit JSON', { skip }, async () => {
  const pool = new Pool({ connectionString: testUrl });
  const service = new PostgresAdminService(pool, hmacSecret);
  try {
    await runMigrations(pool);
    const admin = await makeAdmin(pool, service);
    const merchant = await publishedMerchant(service, admin);
    const member = await makeAccount(pool);
    await addMember(pool, merchant.id, member);
    await service.promoteOwner(admin, merchant.id, member, 'OWN-D01');
    await service.demoteOwner(admin, merchant.id, member, { reason: 'OTHER', verificationDocumentRef: 'OWN-D02' });
    const deletion = new PostgresAccountDeletionService(pool, { hmacSecret, policyVersion: 'store-go-live-test-v1' });
    assert.equal((await deletion.requestDeletion({ accountId: member, confirmation: 'DELETE MY ACCOUNT' })).status, 'COMPLETED');
    const rows = await pool.query<{ target_account_id: string; actor_account_id: string; states: string }>(
      `SELECT target_account_id, actor_account_id, coalesce(before_state::text, '') || after_state::text AS states
       FROM platform_admin_audit WHERE merchant_id = $1 AND action LIKE 'MERCHANT_OWNER_%'`, [merchant.id]);
    assert.equal(rows.rowCount, 2);
    for (const row of rows.rows) {
      assert.match(row.target_account_id, /^deleted:[0-9a-f]{64}$/);
      assert.equal(row.actor_account_id, admin);
      assert.doesNotMatch(row.states, new RegExp(member));
    }
    // 삭제된 계정은 다시 올릴 수 없다(멤버 행도 없다).
    await assert.rejects(service.promoteOwner(admin, merchant.id, member, 'OWN-D03'), /ADMIN_MEMBER_NOT_FOUND/);
    assert.equal((await deletion.requestDeletion({ accountId: admin, confirmation: 'DELETE MY ACCOUNT' })).status, 'COMPLETED');
    const actors = await pool.query<{ actor_account_id: string }>(
      `SELECT DISTINCT actor_account_id FROM platform_admin_audit WHERE merchant_id = $1`, [merchant.id]);
    assert.ok(actors.rows.every(row => /^deleted:[0-9a-f]{64}$/.test(row.actor_account_id)));
  } finally { await pool.end(); }
});
