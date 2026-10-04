import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import {
  ConsentError,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  type ConsentRecordInput,
} from './account-consent.js';
import { PostgresAccountConsentService } from './postgres/account-consent.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { runMigrations } from './postgres/migrate.js';

const hmacSecret = 'test-only-account-deletion-secret-at-least-32-bytes';

async function setup(t: TestContext) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE account_consents, account_deletion_requests CASCADE');
  const state = { now: new Date('2026-10-04T01:00:00.000Z') };
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  const consent = new PostgresAccountConsentService(pool, {
    accountLifecycle: lifecycle, appSource: 'ANDROID', now: () => state.now,
  });
  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret, policyVersion: 'account-deletion-v1', now: () => state.now, accountLifecycle: lifecycle,
  });
  return { pool, state, consent, deletion };
}

const agree = (accountId: string, overrides: Partial<ConsentRecordInput> = {}): ConsentRecordInput => ({
  accountId,
  source: 'ANDROID',
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
  ageConfirmed: true,
  termsAccepted: true,
  privacyAccepted: true,
  ...overrides,
});

async function rows(pool: Pool, accountId: string) {
  return (await pool.query<{ terms_version: string; privacy_version: string; source: string; agreed_at: Date }>(
    `SELECT terms_version, privacy_version, source, agreed_at FROM account_consents
     WHERE account_id = $1 ORDER BY agreed_at, terms_version`,
    [accountId],
  )).rows;
}

test('a new account is asked, agreeing records versions, time and source, and a repeat changes nothing', async (t) => {
  const { pool, state, consent } = await setup(t);
  assert.deepEqual(await consent.status('customer-1'), {
    required: true, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION,
  });

  assert.deepEqual(await consent.record(agree('customer-1')), {
    required: false, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION,
  });
  assert.equal((await consent.status('customer-1')).required, false);
  assert.equal((await consent.status('customer-2')).required, true, 'consent belongs to one account');
  const [first] = await rows(pool, 'customer-1');
  assert.deepEqual(
    { terms: first!.terms_version, privacy: first!.privacy_version, source: first!.source, at: first!.agreed_at.toISOString() },
    { terms: 'terms-2026-09-30', privacy: 'privacy-2026-10-04', source: 'ANDROID', at: '2026-10-04T01:00:00.000Z' },
  );

  // Agreeing again, even through another route later, keeps the first time and route (idempotent).
  state.now = new Date('2026-10-05T05:00:00.000Z');
  assert.equal((await consent.record(agree('customer-1', { source: 'WEB' }))).required, false);
  const repeated = await rows(pool, 'customer-1');
  assert.equal(repeated.length, 1);
  assert.equal(repeated[0]!.source, 'ANDROID');
  assert.equal(repeated[0]!.agreed_at.toISOString(), '2026-10-04T01:00:00.000Z');
});

test('the route is whatever the server says and only the three known routes are stored', async (t) => {
  const { pool, consent } = await setup(t);
  for (const source of ['WEB', 'ANDROID', 'SHOWCASE_APP'] as const) {
    await consent.record(agree(`customer-${source}`, { source }));
    assert.equal((await rows(pool, `customer-${source}`))[0]!.source, source);
  }
  await assert.rejects(
    pool.query(
      `INSERT INTO account_consents (account_id, terms_version, privacy_version, age_confirmed, source)
       VALUES ('x', 't', 'p', true, 'IOS')`,
    ),
    /account_consents_source_check/,
  );
});

test('every one of the three required answers must be yes, and nothing is stored otherwise', async (t) => {
  const { pool, consent } = await setup(t);
  for (const missing of ['ageConfirmed', 'termsAccepted', 'privacyAccepted'] as const) {
    await assert.rejects(
      consent.record(agree('customer-1', { [missing]: false })),
      (error) => error instanceof ConsentError && error.code === 'CONSENT_INCOMPLETE',
      missing,
    );
  }
  assert.deepEqual(await rows(pool, 'customer-1'), []);
  assert.equal((await consent.status('customer-1')).required, true);
  // The table itself refuses a row that says the age was not confirmed.
  await assert.rejects(
    pool.query(
      `INSERT INTO account_consents (account_id, terms_version, privacy_version, age_confirmed, source)
       VALUES ('customer-1', 't', 'p', false, 'WEB')`,
    ),
    /account_consents_age_confirmed_check/,
  );
});

test('agreeing to a version other than the current ones is refused so an old screen cannot consent to new text', async (t) => {
  const { pool, consent } = await setup(t);
  for (const overrides of [
    { termsVersion: 'terms-2026-01-01' },
    { privacyVersion: 'privacy-2026-01-01' },
    { privacyVersion: 'privacy-2026-10-01' },
    { termsVersion: '' },
  ]) {
    await assert.rejects(
      consent.record(agree('customer-1', overrides)),
      (error) => error instanceof ConsentError && error.code === 'CONSENT_VERSION_MISMATCH',
      JSON.stringify(overrides),
    );
  }
  assert.deepEqual(await rows(pool, 'customer-1'), []);
});

test('when either version changes the account is asked again and the older agreement stays as history', async (t) => {
  const { pool, state, consent } = await setup(t);
  // Agreed to older texts before: neither an old terms row nor an old privacy row satisfies the current pair.
  await pool.query(
    `INSERT INTO account_consents (account_id, terms_version, privacy_version, age_confirmed, source, agreed_at)
     VALUES ('customer-1', 'terms-old', 'privacy-old', true, 'WEB', '2026-08-01T00:00:00Z'),
            ('customer-2', $1, 'privacy-old', true, 'WEB', '2026-08-01T00:00:00Z'),
            ('customer-3', 'terms-old', $2, true, 'WEB', '2026-08-01T00:00:00Z'),
            ('customer-4', $1, 'privacy-2026-10-01', true, 'WEB', '2026-10-01T00:00:00Z')`,
    [CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION],
  );
  for (const account of ['customer-1', 'customer-2', 'customer-3', 'customer-4']) {
    assert.equal((await consent.status(account)).required, true, account);
  }
  await assert.rejects(consent.record(agree('customer-4', { privacyVersion: 'privacy-2026-10-01' })),
    (error) => error instanceof ConsentError && error.code === 'CONSENT_VERSION_MISMATCH');
  await consent.record(agree('customer-4'));
  assert.equal((await consent.status('customer-4')).required, false);
  assert.deepEqual((await rows(pool, 'customer-4')).map((row) => row.privacy_version),
    ['privacy-2026-10-01', CURRENT_PRIVACY_VERSION]);
  await consent.record(agree('customer-1'));
  assert.equal((await consent.status('customer-1')).required, false);
  assert.deepEqual(
    (await rows(pool, 'customer-1')).map((row) => [row.terms_version, row.privacy_version]),
    [['terms-old', 'privacy-old'], ['terms-2026-09-30', 'privacy-2026-10-04']],
  );
  assert.equal(state.now.toISOString(), '2026-10-04T01:00:00.000Z');
});

test('concurrent agreements from the app and the web leave one row', async (t) => {
  const { pool, consent } = await setup(t);
  await Promise.all(Array.from({ length: 10 }, (_, index) =>
    consent.record(agree('customer-1', { source: index % 2 ? 'WEB' : 'ANDROID' }))));
  assert.equal((await rows(pool, 'customer-1')).length, 1);
});

test('deleting an account removes its consent rows, keeps others, and blocks later consent for that account', async (t) => {
  const { pool, consent, deletion } = await setup(t);
  await consent.record(agree('leaving'));
  await consent.record(agree('staying'));
  await pool.query(
    `INSERT INTO account_consents (account_id, terms_version, privacy_version, age_confirmed, source)
     VALUES ('leaving', 'terms-old', 'privacy-old', true, 'WEB')`,
  );
  assert.equal((await rows(pool, 'leaving')).length, 2);

  await deletion.requestDeletion({ accountId: 'leaving', confirmation: 'DELETE MY ACCOUNT' });
  assert.deepEqual(await rows(pool, 'leaving'), [], 'no raw account id is left in the consent table');
  assert.equal((await rows(pool, 'staying')).length, 1);
  const alias = (await pool.query<{ deleted_account_alias: string }>(
    'SELECT deleted_account_alias FROM account_deletion_requests',
  )).rows[0]!.deleted_account_alias;
  assert.equal(
    (await pool.query('SELECT 1 FROM account_consents WHERE account_id = $1', [alias])).rowCount,
    0,
    'consent is deleted, not kept under the pseudonym',
  );

  await assert.rejects(
    consent.record(agree('leaving')),
    (error) => error instanceof ConsentError && error.code === 'ACCOUNT_DELETED',
  );
  assert.deepEqual(await rows(pool, 'leaving'), []);
});
