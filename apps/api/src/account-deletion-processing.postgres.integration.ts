import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';

import { Pool } from 'pg';

import { AccountDeletionIntakeError, type DeletionIntakeStatusView } from './account-deletion-intake.js';
import { AdminError } from './postgres/admin.js';
import { runAccountDeletionCommand } from './postgres/account-deletion-command.js';
import { PostgresAccountDeletionIntakeService } from './postgres/account-deletion-intake.js';
import { PostgresAccountDeletionProcessingService } from './postgres/account-deletion-processing.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { isMigrationFilename, runMigrations } from './postgres/migrate.js';

const testUrl = process.env.TEST_DATABASE_URL;
const safeTestTarget = testUrl && decodeURIComponent(new URL(testUrl).pathname.slice(1)).endsWith('_test');
const skip = safeTestTarget ? false : 'requires a disposable _test PostgreSQL database';
const hmacSecret = 'processing-test-account-deletion-secret-32-bytes';
const t0 = new Date('2026-10-01T00:00:00.000Z');
const hour = 60 * 60 * 1000;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);
const migrations = new URL('../migrations/', import.meta.url);

type Fixture = {
  pool: Pool;
  clock: { now: Date };
  web: PostgresAccountDeletionIntakeService;
  showcase: PostgresAccountDeletionIntakeService;
  processing: PostgresAccountDeletionProcessingService;
};

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const pool = new Pool({ connectionString: testUrl });
  try {
    await runMigrations(pool);
    const clock = { now: t0 };
    const now = () => clock.now;
    await run({
      pool, clock,
      web: new PostgresAccountDeletionIntakeService(pool, hmacSecret, { now }),
      showcase: new PostgresAccountDeletionIntakeService(pool, hmacSecret, { source: 'SHOWCASE_APP', now }),
      processing: new PostgresAccountDeletionProcessingService(pool, {
        hmacSecret, policyVersion: 'account-deletion-v1', now,
      }),
    });
  } finally {
    await pool.end();
  }
}

async function seedAccount(pool: Pool, label = 'user'): Promise<string> {
  const accountId = `acct_${randomUUID()}`;
  await pool.query(
    `INSERT INTO auth_identities(provider, subject, account_id, created_at) VALUES ('google', $1, $2, now())`,
    [`${label}-${randomUUID()}`, accountId],
  );
  return accountId;
}

async function seedAdmin(pool: Pool): Promise<string> {
  const accountId = await seedAccount(pool, 'admin');
  await pool.query('INSERT INTO platform_admins(account_id) VALUES ($1)', [accountId]);
  return accountId;
}

async function seedSession(pool: Pool, accountId: string): Promise<void> {
  await pool.query(
    `INSERT INTO auth_sessions (id, account_id, token_hash, created_at, expires_at, last_authenticated_at)
     VALUES ($1, $2, decode($3, 'hex'), now(), now() + interval '1 day', now())`,
    [randomUUID(), accountId, randomBytes(32).toString('hex')],
  );
}

async function intakeIdOf(pool: Pool, accountId: string): Promise<string> {
  return (await pool.query<{ id: string }>(
    'SELECT id FROM account_deletion_intake_requests WHERE account_id = $1', [accountId],
  )).rows[0]!.id;
}

async function intakeRow(pool: Pool, id: string): Promise<Record<string, unknown> & { as_text: string }> {
  return (await pool.query(
    'SELECT i.*, row_to_json(i)::text AS as_text FROM account_deletion_intake_requests AS i WHERE id = $1', [id],
  )).rows[0];
}

async function has(pool: Pool, sql: string, params: unknown[]): Promise<boolean> {
  return (await pool.query(sql, params)).rowCount === 1;
}

// A submitted (transaction hash set) mint job keeps the deletion ledger at WAITING_FOR_MINT_FINALITY.
async function seedSubmittedMint(pool: Pool, accountId: string): Promise<string> {
  const merchant = `merchant-${randomUUID()}`;
  const campaign = `campaign-${randomUUID()}`;
  const series = `series-${randomUUID()}`;
  const [slot, visit, entitlement, binding, job] = Array.from({ length: 5 }, () => randomUUID()) as
    [string, string, string, string, string];
  const hex = () => randomBytes(32).toString('hex');
  const address = `0x${randomBytes(20).toString('hex')}`;
  const contract = `0x${randomBytes(20).toString('hex')}`;
  await pool.query(
    `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ($1, '삭제 처리 시험 식당', '', '서울', 0, 'ACTIVE', true)`, [merchant]);
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status) VALUES ($1, $2, 'STAFF', 'ACTIVE')`,
    [merchant, accountId]);
  await pool.query(
    `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ($1, $2, '삭제 처리 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 10)`,
    [campaign, merchant]);
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ($1, 1, '1회'), ($1, 3, '3회'), ($1, 5, '5회')`, [campaign]);
  await pool.query(
    `INSERT INTO nft_series (id, campaign_id, target_visit_count, chain_id, contract_address,
       contract_address_normalized, series_key, max_ever_minted, status)
     VALUES ($1, $2, 1, 31337, $3, $3, decode($4, 'hex'), 10, 'ACTIVE')`, [series, campaign, contract, hex()]);
  await pool.query(
    `INSERT INTO claim_slots (id, merchant_id, customer_account_id, merchant_reference_hash, created_by_account_id,
       token_hash, status, expires_at, claimed_at, created_at, updated_at)
     VALUES ($1, $2, $3, decode($4, 'hex'), $3, decode($5, 'hex'), 'CLAIMED',
       '2026-09-11T03:15:00Z', '2026-09-11T03:00:00Z', '2026-09-11T02:55:00Z', '2026-09-11T03:00:00Z')`,
    [slot, merchant, accountId, hex(), hex()]);
  await pool.query(
    `INSERT INTO visit_events (id, claim_slot_id, merchant_id, campaign_id, customer_account_id, occurred_at,
       business_date, verification_level, status, progress_counted)
     VALUES ($1, $2, $3, $4, $5, '2026-09-11T03:00:00Z', '2026-09-11', 'MERCHANT_CONFIRMED', 'VALID', true)`,
    [visit, slot, merchant, campaign, accountId]);
  await pool.query(
    `INSERT INTO reward_entitlements (id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
       status, policy_version, earned_at, claim_expires_at)
     VALUES ($1, $2, $3, 1, $4, 'MINT_REQUESTED', 'fixed-1', '2026-09-11T03:00:00Z', '2026-12-11T03:00:00Z')`,
    [entitlement, accountId, campaign, visit]);
  await pool.query(
    `INSERT INTO wallet_bindings (id, account_id, address_checksum, address_normalized, chain_id, binding_version,
       status, verified_at, created_at, updated_at)
     VALUES ($1, $2, $3, $3, 31337, 1, 'VERIFIED', '2026-09-11T03:00:00Z', '2026-09-11T03:00:00Z', '2026-09-11T03:00:00Z')`,
    [binding, accountId, address]);
  await pool.query(
    `INSERT INTO mint_jobs (id, entitlement_id, account_id, nft_series_id, reward_key, wallet_binding_id,
       binding_version, recipient_address, recipient_address_normalized, chain_id, contract_address,
       contract_address_normalized, series_key, consent_version, idempotency_key, request_fingerprint, status,
       transaction_hash, created_at, updated_at)
     VALUES ($1, $2, $3, $4, decode($5, 'hex'), $6, 1, $7, $7, 31337, $8, $8, decode($9, 'hex'),
       'nft-mint-v1', $10, decode($11, 'hex'), 'SUBMITTED', $12, '2026-09-11T03:00:00Z', '2026-09-11T03:00:00Z')`,
    [job, entitlement, accountId, series, hex(), binding, address, contract, hex(), `idem-${randomUUID()}`, hex(),
      `0x${hex()}`]);
  return job;
}

const viewKeys = ['cancelUntil', 'cancelledAt', 'deletion', 'dueAt', 'processedAt', 'rejectReason', 'requestedAt', 'status'];

function assertPublicView(view: DeletionIntakeStatusView, ...forbidden: string[]): void {
  assert.deepEqual(Object.keys(view).sort(), viewKeys);
  const text = JSON.stringify(view);
  for (const value of forbidden) assert.equal(text.includes(value), false, `the view must not contain ${value}`);
  assert.doesNotMatch(text, /acct_|@|account/i);
}

test('filing returns a receipt once, stores only its hash, answers by receipt and cancels inside 24 hours', { skip }, async () => {
  await withFixture(async ({ pool, clock, web }) => {
    const accountId = await seedAccount(pool);
    const other = await seedAccount(pool);
    const filed = await web.request(accountId);
    assert.equal(filed.receiptIssued, true);
    assert.match(filed.receipt!, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    assert.equal(filed.requestedAt, t0.toISOString());
    assert.equal(filed.cancelUntil, at(t0, 24 * hour).toISOString());
    assert.equal(filed.dueAt, at(t0, 7 * 24 * hour).toISOString());

    const id = await intakeIdOf(pool, accountId);
    const row = await intakeRow(pool, id);
    assert.equal(row.status, 'REQUESTED');
    assert.equal(row.source, 'WEB');
    assert.equal((row.receipt_hash as Buffer).length, 32);
    const compact = filed.receipt!.replaceAll('-', '');
    assert.equal(row.as_text.includes(filed.receipt!) || row.as_text.includes(compact), false,
      'the raw receipt must never be stored');
    assert.equal(await has(pool, `SELECT 1 FROM account_deletion_intake_requests
      WHERE position($1 in encode(receipt_hash, 'escape')) > 0`, [compact]), false);

    const byReceipt = await web.status(filed.receipt!);
    assertPublicView(byReceipt, accountId, other);
    assert.equal(byReceipt.status, 'REQUESTED');
    assert.equal(byReceipt.deletion, null);
    assert.deepEqual(await web.status(filed.receipt!.toLowerCase().replaceAll('-', ' ')), byReceipt);
    assert.equal((await web.current(accountId))?.status, 'REQUESTED');
    assert.equal(await web.current(other), null);

    clock.now = at(t0, 24 * hour - 1);
    assert.deepEqual(await web.cancel(accountId), { status: 'CANCELLED' });
    const cancelled = await intakeRow(pool, id);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.account_id, null);
    assert.equal((cancelled.cancelled_at as Date).toISOString(), clock.now.toISOString());
    assert.equal((await web.status(filed.receipt!)).status, 'CANCELLED');
    assert.equal(await has(pool, 'SELECT 1 FROM auth_identities WHERE account_id = $1', [accountId]), true);
    await assert.rejects(web.cancel(accountId), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_NO_ACTIVE_REQUEST');

    const again = await web.request(accountId);
    assert.equal(again.receiptIssued, true);
    assert.notEqual(again.receipt, filed.receipt);
    assert.equal((await web.status(filed.receipt!)).status, 'CANCELLED');
    assert.equal((await web.status(again.receipt!)).status, 'REQUESTED');
  });
});

test('cancel is refused after 24 hours and processing is refused until then, exactly at the boundary too', { skip }, async () => {
  await withFixture(async ({ pool, clock, web, processing }) => {
    const admin = await seedAdmin(pool);
    const operator = { kind: 'admin' as const, accountId: admin };
    const late = await seedAccount(pool);
    const edge = await seedAccount(pool);
    const after = await seedAccount(pool);
    const lateReceipt = (await web.request(late)).receipt!;
    await web.request(edge);
    await web.request(after);
    const [lateId, edgeId, afterId] = await Promise.all([late, edge, after].map((id) => intakeIdOf(pool, id)));

    clock.now = t0;
    await assert.rejects(processing.process(operator, lateId!), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_COOLING_OFF');
    assert.equal(await has(pool, 'SELECT 1 FROM auth_identities WHERE account_id = $1', [late]), true);
    assert.equal((await pool.query('SELECT 1 FROM account_deletion_requests WHERE deleted_account_alias = $1',
      [`deleted:${new PostgresAccountLifecycle({ hmacSecret }).referenceHash(late).toString('hex')}`])).rowCount, 0);

    clock.now = at(t0, 24 * hour);
    await assert.rejects(processing.process(operator, edgeId!), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_COOLING_OFF');
    assert.deepEqual(await web.cancel(edge), { status: 'CANCELLED' });

    clock.now = at(t0, 24 * hour + 1);
    await assert.rejects(web.cancel(late), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_CANCEL_WINDOW_CLOSED');
    assert.equal((await web.status(lateReceipt)).status, 'REQUESTED');
    assert.equal((await intakeRow(pool, lateId!)).account_id, late);
    assert.equal((await processing.process(operator, afterId!)).status, 'PROCESSED');
  });
});

test('processing forgets the account in one transaction, links the ledger and still answers by receipt afterwards', { skip }, async () => {
  await withFixture(async ({ pool, clock, web, processing }) => {
    const admin = await seedAdmin(pool);
    const target = await seedAccount(pool);
    await seedSession(pool, target);
    const receipt = (await web.request(target)).receipt!;
    const id = await intakeIdOf(pool, target);

    const stranger = await seedAccount(pool);
    clock.now = at(t0, 25 * hour);
    await assert.rejects(processing.process({ kind: 'admin', accountId: stranger }, id),
      (error: unknown) => error instanceof AdminError && error.code === 'ADMIN_FORBIDDEN');
    assert.equal((await intakeRow(pool, id)).status, 'REQUESTED');

    const done = await processing.process({ kind: 'admin', accountId: admin }, id);
    assert.equal(done.status, 'PROCESSED');
    assert.equal(done.canProcess, false);
    assert.equal(done.accountLabel, null);
    assert.equal(done.processedBy, 'admin-web');
    assert.equal(done.deletion?.status, 'COMPLETED');

    assert.equal(await has(pool, 'SELECT 1 FROM auth_identities WHERE account_id = $1', [target]), false);
    assert.equal((await pool.query('SELECT revoked_at FROM auth_sessions WHERE account_id = $1', [target]))
      .rows.every((row: { revoked_at: Date | null }) => row.revoked_at !== null), true);
    const alias = `deleted:${new PostgresAccountLifecycle({ hmacSecret }).referenceHash(target).toString('hex')}`;
    const ledger = (await pool.query<{ id: string; status: string }>(
      'SELECT id, status FROM account_deletion_requests WHERE deleted_account_alias = $1', [alias])).rows[0]!;
    assert.equal(ledger.status, 'COMPLETED');

    const row = await intakeRow(pool, id);
    assert.equal(row.status, 'PROCESSED');
    assert.equal(row.account_id, null);
    assert.equal(row.deletion_request_id, ledger.id);
    assert.equal(row.processed_by, 'admin-web');
    assert.equal(row.as_text.includes(target), false);

    const audit = (await pool.query<{ actor_account_id: string; merchant_id: string | null; after_state: object }>(
      `SELECT actor_account_id, merchant_id, after_state FROM platform_admin_audit
       WHERE action = 'ACCOUNT_DELETION_PROCESSED' AND actor_account_id = $1`, [admin])).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.merchant_id, null);
    assert.equal(JSON.stringify(audit[0]!.after_state).includes(target), false);
    assert.match(JSON.stringify(audit[0]!.after_state), new RegExp(id));

    const afterwards = await web.status(receipt);
    assertPublicView(afterwards, target);
    assert.equal(afterwards.status, 'PROCESSED');
    assert.equal(afterwards.deletion?.status, 'COMPLETED');
    assert.equal(afterwards.processedAt, clock.now.toISOString());
    await assert.rejects(web.request(target), /WEB_SESSION_INVALID/);
    await assert.rejects(processing.process({ kind: 'admin', accountId: admin }, id), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_INTAKE_NOT_PENDING');
  });
});

test('rejecting keeps the account, records a reason and allows filing again', { skip }, async () => {
  await withFixture(async ({ pool, clock, web, processing }) => {
    const admin = await seedAdmin(pool);
    const operator = { kind: 'admin' as const, accountId: admin };
    const target = await seedAccount(pool);
    const receipt = (await web.request(target)).receipt!;
    const id = await intakeIdOf(pool, target);
    for (const bad of ['', '   ', 'x'.repeat(201), 'line\nbreak', 'nul\u0000']) {
      await assert.rejects(processing.reject(operator, id, bad), (error: unknown) =>
        error instanceof AccountDeletionIntakeError && error.code === 'DELETION_REJECT_REASON_INVALID', JSON.stringify(bad));
    }
    assert.equal((await intakeRow(pool, id)).status, 'REQUESTED');
    // Rejection does not wait for the cancellation window.
    const rejected = await processing.reject(operator, id, '  본인 확인이 되지 않는 요청  ');
    assert.equal(rejected.status, 'REJECTED');
    assert.equal(rejected.rejectReason, '본인 확인이 되지 않는 요청');
    assert.equal(await has(pool, 'SELECT 1 FROM auth_identities WHERE account_id = $1', [target]), true);
    assert.equal((await intakeRow(pool, id)).account_id, null);
    const view = await web.status(receipt);
    assert.equal(view.status, 'REJECTED');
    assert.equal(view.rejectReason, '본인 확인이 되지 않는 요청');
    assert.equal(view.deletion, null);
    await assert.rejects(processing.reject(operator, id, 'again'), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_INTAKE_NOT_PENDING');
    await assert.rejects(processing.process(operator, id), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_INTAKE_NOT_PENDING');
    assert.equal((await pool.query(
      `SELECT 1 FROM platform_admin_audit WHERE action = 'ACCOUNT_DELETION_REJECTED' AND actor_account_id = $1`,
      [admin])).rowCount, 1);
    assert.equal((await web.request(target)).receiptIssued, true);
    clock.now = t0;
    await assert.rejects(processing.process(operator, 'not-a-uuid'), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_INTAKE_NOT_FOUND');
    await assert.rejects(processing.process(operator, randomUUID()), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_INTAKE_NOT_FOUND');
  });
});

test('an administrator can neither process nor reject their own filing, but another administrator can', { skip }, async () => {
  await withFixture(async ({ pool, clock, web, processing }) => {
    const self = await seedAdmin(pool);
    const colleague = await seedAdmin(pool);
    await web.request(self);
    const id = await intakeIdOf(pool, self);
    clock.now = at(t0, 25 * hour);
    for (const attempt of [
      () => processing.process({ kind: 'admin', accountId: self }, id),
      () => processing.reject({ kind: 'admin', accountId: self }, id, '내 요청'),
    ]) {
      await assert.rejects(attempt(), (error: unknown) =>
        error instanceof AccountDeletionIntakeError && error.code === 'DELETION_SELF_PROCESSING_REFUSED');
    }
    assert.equal((await intakeRow(pool, id)).status, 'REQUESTED');
    assert.equal(await has(pool, 'SELECT 1 FROM auth_identities WHERE account_id = $1', [self]), true);
    assert.equal((await processing.process({ kind: 'admin', accountId: colleague }, id)).status, 'PROCESSED');
    assert.equal(await has(pool, 'SELECT 1 FROM platform_admins WHERE account_id = $1', [self]), false);
  });
});

test('a repeat filing returns the same request without a new receipt and a deliberate re-issue replaces the old one', { skip }, async () => {
  await withFixture(async ({ pool, web, showcase }) => {
    const accountId = await seedAccount(pool);
    const results = await Promise.all(Array.from({ length: 10 }, () => web.request(accountId)));
    assert.equal(results.filter((result) => result.receiptIssued).length, 1);
    assert.equal(new Set(results.map((result) => result.dueAt)).size, 1);
    assert.equal((await pool.query('SELECT 1 FROM account_deletion_intake_requests WHERE account_id = $1', [accountId]))
      .rowCount, 1);
    const receipt = results.find((result) => result.receipt)!.receipt!;

    const repeat = await web.request(accountId);
    assert.equal(repeat.receiptIssued, false);
    assert.equal(repeat.receipt, undefined);
    const viaShowcase = await showcase.request(accountId);
    assert.equal(viaShowcase.receiptIssued, false);
    assert.equal((await pool.query<{ source: string }>(
      'SELECT source FROM account_deletion_intake_requests WHERE account_id = $1', [accountId])).rows[0]!.source, 'WEB');
    assert.equal((await web.status(receipt)).status, 'REQUESTED');

    const replaced = await web.request(accountId, { reissue: true });
    assert.equal(replaced.receiptIssued, true);
    assert.notEqual(replaced.receipt, receipt);
    await assert.rejects(web.status(receipt), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_RECEIPT_NOT_FOUND');
    assert.equal((await web.status(replaced.receipt!)).status, 'REQUESTED');
    assert.equal((await pool.query('SELECT 1 FROM account_deletion_intake_requests WHERE account_id = $1', [accountId]))
      .rowCount, 1);

    // A re-issue never starts a filing: without an active request it is refused and nothing is written.
    const idle = await seedAccount(pool);
    await assert.rejects(web.request(idle, { reissue: true }), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_NO_ACTIVE_REQUEST');
    assert.equal((await pool.query('SELECT 1 FROM account_deletion_intake_requests WHERE account_id = $1', [idle]))
      .rowCount, 0);
  });
});

test('one person cannot cancel, read or guess another person\'s filing', { skip }, async () => {
  await withFixture(async ({ pool, web }) => {
    const [alice, bob] = [await seedAccount(pool, 'alice'), await seedAccount(pool, 'bob')];
    const aliceReceipt = (await web.request(alice)).receipt!;
    const bobReceipt = (await web.request(bob)).receipt!;
    assert.deepEqual(await web.cancel(bob), { status: 'CANCELLED' });
    assert.equal((await web.current(alice))?.status, 'REQUESTED');
    assert.equal((await web.status(aliceReceipt)).status, 'REQUESTED');
    assert.equal((await web.status(bobReceipt)).status, 'CANCELLED');
    assertPublicView(await web.status(aliceReceipt), alice, bob);

    const flipped = `${aliceReceipt.slice(0, -1)}${aliceReceipt.endsWith('0') ? '1' : '0'}`;
    const misses: unknown[] = [];
    for (const guess of [flipped, 'AAAA-AAAA-AAAA-AAAA', '', 'not a receipt', 'x'.repeat(500), aliceReceipt.slice(0, 14)]) {
      misses.push(await web.status(guess).then(() => undefined, (error: unknown) => error));
    }
    for (const miss of misses) {
      assert.ok(miss instanceof AccountDeletionIntakeError);
      assert.equal(miss.code, 'DELETION_RECEIPT_NOT_FOUND');
      assert.equal(miss.message, 'DELETION_RECEIPT_NOT_FOUND');
    }
  });
});

test('reconcile advances a ledger left at WAITING_FOR_MINT_FINALITY without the deleted account\'s session', { skip }, async () => {
  await withFixture(async ({ pool, clock, web, processing }) => {
    const admin = await seedAdmin(pool);
    const operator = { kind: 'admin' as const, accountId: admin };
    const target = await seedAccount(pool);
    const jobId = await seedSubmittedMint(pool, target);
    const receipt = (await web.request(target)).receipt!;
    clock.now = at(t0, 25 * hour);
    const done = await processing.process(operator, await intakeIdOf(pool, target));
    assert.equal(done.deletion?.status, 'WAITING_FOR_MINT_FINALITY');
    const waiting = await web.status(receipt);
    assert.equal(waiting.status, 'PROCESSED');
    assert.equal(waiting.deletion?.status, 'WAITING_FOR_MINT_FINALITY');
    assert.equal(waiting.deletion?.pendingMintJobs, 1);
    assert.equal(waiting.deletion?.completedAt, null);

    const stillWaiting = await processing.reconcile(operator);
    assert.ok(stillWaiting.checked >= 1);
    assert.equal((await web.status(receipt)).deletion?.status, 'WAITING_FOR_MINT_FINALITY');

    await pool.query(
      `UPDATE mint_jobs SET status = 'FINALIZED', token_id = 1, finalized_at = $2, updated_at = $2 WHERE id = $1`,
      [jobId, clock.now]);
    clock.now = at(t0, 26 * hour);
    const result = await processing.reconcile(operator);
    assert.ok(result.completed >= 1);
    const completed = await web.status(receipt);
    assert.equal(completed.deletion?.status, 'COMPLETED');
    assert.equal(completed.deletion?.completedAt, clock.now.toISOString());
    assert.equal(completed.deletion?.pendingMintJobs, 0);
    assert.equal(completed.deletion?.retainedFinalizedNfts, 1);
    assert.equal((await pool.query(
      `SELECT 1 FROM platform_admin_audit WHERE action = 'ACCOUNT_DELETION_RECONCILED' AND actor_account_id = $1`,
      [admin])).rowCount, 1);
    await assert.rejects(processing.reconcile({ kind: 'admin', accountId: await seedAccount(pool) }),
      (error: unknown) => error instanceof AdminError && error.code === 'ADMIN_FORBIDDEN');
  });
});

test('a showcase filing is processed through the CLI service with cooling-off, audit and cli:<operator>', { skip }, async () => {
  await withFixture(async ({ pool, clock, showcase, processing }) => {
    const target = await seedAccount(pool);
    const rejected = await seedAccount(pool);
    await showcase.request(target);
    await showcase.request(rejected);
    const id = await intakeIdOf(pool, target);
    const rejectedId = await intakeIdOf(pool, rejected);
    assert.equal((await intakeRow(pool, id)).source, 'SHOWCASE_APP');

    const listed = (await runAccountDeletionCommand(processing, 'tester', ['list'])).join('\n');
    assert.match(listed, new RegExp(`${id}\\tREQUESTED\\tSHOWCASE_APP`));
    assert.match(listed, /COOLING_OFF/);
    assert.equal(listed.includes(target), false);
    await assert.rejects(runAccountDeletionCommand(processing, 'tester', ['process', id]), (error: unknown) =>
      error instanceof AccountDeletionIntakeError && error.code === 'DELETION_COOLING_OFF');
    assert.equal(await has(pool, 'SELECT 1 FROM auth_identities WHERE account_id = $1', [target]), true);

    clock.now = at(t0, 25 * hour);
    assert.match((await runAccountDeletionCommand(processing, 'tester', ['list'])).join('\n'), /READY/);
    assert.deepEqual(await runAccountDeletionCommand(processing, 'tester', ['process', id]),
      [`PROCESSED\t${id}\tledger=COMPLETED`]);
    assert.deepEqual(await runAccountDeletionCommand(processing, 'tester', ['reject', rejectedId, '중복 접수']),
      [`REJECTED\t${rejectedId}`]);
    assert.match((await runAccountDeletionCommand(processing, 'tester', ['reconcile']))[0]!, /^RECONCILED\tchecked=\d+\tcompleted=\d+\twaiting=\d+$/);
    const row = await intakeRow(pool, id);
    assert.equal(row.processed_by, 'cli:tester');
    assert.equal(row.account_id, null);
    assert.equal(await has(pool, 'SELECT 1 FROM auth_identities WHERE account_id = $1', [target]), false);
    assert.equal((await pool.query(
      `SELECT 1 FROM platform_admin_audit
       WHERE action = 'ACCOUNT_DELETION_PROCESSED' AND actor_account_id = 'cli:tester' AND after_state->>'intakeId' = $1`,
      [id])).rowCount, 1);
    await assert.rejects(processing.list({ kind: 'cli', operator: 'bad operator' }), /DELETION_OPERATOR_INVALID/);
  });
});

test('two operators processing one filing at once delete the account exactly once', { skip }, async () => {
  await withFixture(async ({ pool, clock, web, processing }) => {
    const admin = await seedAdmin(pool);
    const target = await seedAccount(pool);
    await web.request(target);
    const id = await intakeIdOf(pool, target);
    clock.now = at(t0, 25 * hour);
    const results = await Promise.allSettled([
      processing.process({ kind: 'admin', accountId: admin }, id),
      processing.process({ kind: 'cli', operator: 'one' }, id),
      processing.process({ kind: 'cli', operator: 'two' }, id),
      processing.reject({ kind: 'cli', operator: 'three' }, id, '동시 거절'),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    for (const result of results) {
      if (result.status === 'rejected') {
        assert.ok(result.reason instanceof AccountDeletionIntakeError);
        assert.equal(result.reason.code, 'DELETION_INTAKE_NOT_PENDING');
      }
    }
    const alias = `deleted:${new PostgresAccountLifecycle({ hmacSecret }).referenceHash(target).toString('hex')}`;
    assert.equal(((await pool.query('SELECT 1 FROM account_deletion_requests WHERE deleted_account_alias = $1', [alias]))
      .rowCount ?? 0) <= 1, true);
    assert.notEqual((await intakeRow(pool, id)).status, 'REQUESTED');
  });
});

test('the admin list shows pending filings first by deadline with masked labels and never an ID or email', { skip }, async () => {
  await withFixture(async ({ pool, clock, web, processing }) => {
    const admin = await seedAdmin(pool);
    const operator = { kind: 'admin' as const, accountId: admin };
    const [first, second, third] = [await seedAccount(pool), await seedAccount(pool), await seedAccount(pool)];
    clock.now = at(t0, 2 * hour);
    await web.request(second);
    clock.now = t0;
    await web.request(first);
    clock.now = at(t0, hour);
    await web.request(third);
    const [firstId, secondId] = await Promise.all([first, second].map((id) => intakeIdOf(pool, id)));
    clock.now = at(t0, 3 * hour);
    await web.cancel(third);
    clock.now = at(t0, 50 * hour);
    const list = await processing.list(operator);
    const order = list.map((item) => item.id);
    assert.ok(order.indexOf(firstId!) < order.indexOf(secondId!));
    const firstPending = list.findIndex((item) => item.status !== 'REQUESTED');
    if (firstPending >= 0) {
      assert.equal(list.slice(firstPending).some((item) => item.status === 'REQUESTED'), false,
        'pending filings come before finished ones');
    }
    const mine = list.find((item) => item.id === firstId)!;
    assert.match(mine.accountLabel!, /^acct_[0-9a-f]{4}…[0-9a-f]{4}$/);
    assert.equal(mine.accountLabel!.includes(first), false);
    assert.equal(mine.canProcess, true);
    assert.equal(mine.source, 'WEB');
    const text = JSON.stringify(list);
    for (const account of [first, second, third, admin]) assert.equal(text.includes(account), false);
    assert.doesNotMatch(text, /@/);
  });
});

test('the statements of the deployed API f1bba2d still work on the migrated schema and legacy rows can get a receipt', { skip }, async () => {
  await withFixture(async ({ pool, web, processing }) => {
    const accountId = await seedAccount(pool);
    const operator = { kind: 'admin' as const, accountId: await seedAdmin(pool) };
    const insert = `INSERT INTO account_deletion_intake_requests (account_id) VALUES ($1)
                    ON CONFLICT (account_id) DO NOTHING`;
    assert.equal((await pool.query(insert, [accountId])).rowCount, 1);
    assert.equal((await pool.query(insert, [accountId])).rowCount, 0);
    const legacy = (await pool.query(
      'SELECT id, status, source, receipt_hash, requested_at, cancel_until, due_at FROM account_deletion_intake_requests WHERE account_id = $1',
      [accountId])).rows[0]!;
    assert.equal(legacy.status, 'REQUESTED');
    assert.equal(legacy.source, 'WEB');
    assert.equal(legacy.receipt_hash, null);
    assert.equal(legacy.cancel_until.getTime() - legacy.requested_at.getTime(), 24 * hour);
    assert.equal(legacy.due_at.getTime() - legacy.requested_at.getTime(), 7 * 24 * hour);

    const legacyId = legacy.id as string;
    assert.equal((await processing.list(operator)).find((item) => item.id === legacyId)!.hasReceipt, false,
      'the operator list marks a filing that has no receipt number');
    const issued = await web.request(accountId);
    assert.equal(issued.receiptIssued, true, 'a legacy row has no receipt yet, so filing again issues one');
    assert.equal((await processing.list(operator)).find((item) => item.id === legacyId)!.hasReceipt, true);
    assert.equal((await pool.query('SELECT 1 FROM account_deletion_intake_requests WHERE account_id = $1', [accountId]))
      .rowCount, 1);
    assert.equal((await web.request(accountId)).receiptIssued, false);
    assert.equal((await pool.query('DELETE FROM account_deletion_intake_requests WHERE account_id = $1', [accountId]))
      .rowCount, 1);
  });
});

test('migration 0031 keeps existing filings as REQUESTED with computed deadlines and frees account_id after processing', { skip }, async () => {
  const bootstrap = new Pool({ connectionString: testUrl });
  const schema = `deletion_processing_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: testUrl, options: `-c search_path=${schema}` });
    await pool.query(`CREATE TABLE schema_migrations (
      filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const before = (await readdir(migrations)).filter((file) =>
      isMigrationFilename(file) && Number(file.slice(0, 4)) < 31).sort();
    for (const file of before) {
      await pool.query(await readFile(new URL(file, migrations), 'utf8'));
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    }
    // Two filings from the deployed API: one whose 24 hours ran out long ago, one made an hour ago.
    await pool.query(
      `INSERT INTO account_deletion_intake_requests (account_id, requested_at) VALUES
         ('legacy-a', now() - interval '10 days'), ('legacy-recent', now() - interval '1 hour')`);
    await runMigrations(pool);
    const row = (await pool.query(
      `SELECT id, status, source, receipt_hash, requested_at, cancel_until, due_at,
              cancel_until > now() + interval '23 hours' AND cancel_until <= now() + interval '24 hours' AS full_window
       FROM account_deletion_intake_requests WHERE account_id = 'legacy-a'`)).rows[0]!;
    assert.match(row.id, /^[0-9a-f-]{36}$/);
    assert.equal(row.status, 'REQUESTED');
    assert.equal(row.source, 'WEB');
    assert.equal(row.receipt_hash, null);
    // 옛 접수는 접수 24시간이 이미 지났어도 마이그레이션 시각부터 24시간의 취소 기간을 새로 받는다.
    assert.equal(row.full_window, true, 'a legacy filing gets a full 24 hour window counted from the migration');
    assert.equal(row.due_at.getTime(), row.cancel_until.getTime(),
      'a due date already past is lifted to the end of the window instead of ending before it');
    const recent = (await pool.query(
      `SELECT requested_at, cancel_until, due_at,
              cancel_until > now() + interval '23 hours' AND cancel_until <= now() + interval '24 hours' AS full_window
       FROM account_deletion_intake_requests WHERE account_id = 'legacy-recent'`)).rows[0]!;
    assert.equal(recent.full_window, true);
    assert.equal(recent.due_at.getTime() - recent.requested_at.getTime(), 7 * 24 * hour,
      'a due date still in the future keeps the 7 days from filing that was promised');
    // Not processable right after the migration, and the operator list says why there is no receipt number.
    const operatorId = await seedAdmin(pool);
    const migrated = new PostgresAccountDeletionProcessingService(pool, {
      hmacSecret, policyVersion: 'account-deletion-v1',
    });
    const operator = { kind: 'admin' as const, accountId: operatorId };
    const listed = await migrated.list(operator);
    const legacyItem = listed.find((item) => item.accountLabel === '…-a')!;
    assert.ok(legacyItem, 'the legacy filing is listed');
    assert.equal(legacyItem.hasReceipt, false);
    assert.equal(legacyItem.canProcess, false);
    await assert.rejects(migrated.process(operator, legacyItem.id),
      (error: unknown) => error instanceof AccountDeletionIntakeError && error.code === 'DELETION_COOLING_OFF');
    assert.equal((await migrated.list(operator)).find((item) => item.id === legacyItem.id)!.status, 'REQUESTED');
    const primaryKey = await pool.query(
      `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = 'account_deletion_intake_requests'::regclass AND i.indisprimary`);
    assert.deepEqual(primaryKey.rows.map((r: { attname: string }) => r.attname), ['id']);
    // The unique index keeps one active row per account, and account_id may only be NULL once the filing has ended.
    await assert.rejects(pool.query(
      `INSERT INTO account_deletion_intake_requests (account_id, requested_at) VALUES ('legacy-a', now())`),
      /account_deletion_intake_account_key/);
    await assert.rejects(pool.query(
      `INSERT INTO account_deletion_intake_requests (account_id, status, cancelled_at) VALUES ('legacy-b', 'CANCELLED', now())`),
      /account_deletion_intake_account_link_check/);
    await assert.rejects(pool.query(
      `INSERT INTO account_deletion_intake_requests (account_id) VALUES (NULL)`),
      /account_deletion_intake_account_link_check/);
    await pool.query(
      `INSERT INTO account_deletion_intake_requests (account_id, status, cancelled_at) VALUES (NULL, 'CANCELLED', now()), (NULL, 'CANCELLED', now())`);
    await assert.rejects(pool.query(
      `INSERT INTO account_deletion_intake_requests (account_id, source) VALUES ('legacy-c', 'MAIL')`),
      /account_deletion_intake_source_check/);
    await assert.rejects(pool.query(
      `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, after_state)
       VALUES (gen_random_uuid(), 'x', NULL, 'MERCHANT_CREATED', '{}')`),
      /platform_admin_audit_subject_check/);
  } finally {
    await pool?.end();
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await bootstrap.end();
  }
});

test('the audit action CHECK accepts the actions of every migration so 0030 and 0031 may be applied in either order', { skip }, async () => {
  await withFixture(async ({ pool }) => {
    const merchant = `merchant-${randomUUID()}`;
    await pool.query(
      `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
       VALUES ($1, '감사 기록 시험 식당', '', '서울', 0, 'ACTIVE', true)`, [merchant]);
    const storeActions = ['MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED', 'COUPON_VOIDED'];
    const deletionActions = ['ACCOUNT_DELETION_PROCESSED', 'ACCOUNT_DELETION_REJECTED', 'ACCOUNT_DELETION_RECONCILED'];
    const actor = `audit-check-${randomUUID()}`;
    const insert = `INSERT INTO platform_admin_audit(id, actor_account_id, merchant_id, action, after_state)
                    VALUES (gen_random_uuid(), '${actor}', $1, $2, '{}')`;
    for (const action of storeActions) await pool.query(insert, [merchant, action]);
    for (const action of deletionActions) await pool.query(insert, [null, action]);
    await assert.rejects(pool.query(insert, [merchant, 'MERCHANT_DELETED']), /platform_admin_audit_action_check/);
    await assert.rejects(pool.query(insert, [null, 'ACCOUNT_DELETION_UNKNOWN']), /platform_admin_audit_action_check/);
    assert.equal((await pool.query(
      `SELECT count(*)::int AS n FROM platform_admin_audit WHERE actor_account_id = $1`, [actor])).rows[0].n,
      storeActions.length + deletionActions.length);
  });
});
