import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresCustomerIdentityService } from './postgres/customer-identity.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresMerchantAccessControl } from './postgres/merchant-access.js';
import { createApiServer } from './server.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

test('customer identity is bound read-only and consumed atomically with one claim slot', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE account_deletion_requests, customer_identity_tokens, claim_slots, merchant_members, merchants CASCADE');
  await pool.query(`INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
    VALUES ('identity-merchant', 'Test', 'Test', 'Test', 0, 'ACTIVE', true),
           ('other-merchant', 'Test', 'Test', 'Test', 0, 'ACTIVE', true)`);
  await pool.query(`INSERT INTO merchant_members (merchant_id, account_id, role, status)
    VALUES ('identity-merchant', 'staff-a', 'STAFF', 'ACTIVE'),
           ('identity-merchant', 'staff-b', 'STAFF', 'ACTIVE'),
           ('other-merchant', 'staff-a', 'STAFF', 'ACTIVE')`);

  let now = new Date('2026-09-28T00:00:00Z');
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes' });
  const identityTokens = [
    'identity-token-abcdefghijklmnopqrstuvwxyz012345',
    'identity-token-abcdefghijklmnopqrstuvwxyz012346',
    'identity-token-abcdefghijklmnopqrstuvwxyz012347',
    'identity-token-abcdefghijklmnopqrstuvwxyz012348',
  ];
  const identity = new PostgresCustomerIdentityService(pool, {
    now: () => now,
    nextToken: () => identityTokens.shift()!,
    accountLifecycle: lifecycle,
  });
  const created = await identity.create('customer-a');
  assert.equal(created.expiresAt, '2026-09-28T00:02:00.000Z');
  const stored = await pool.query('SELECT token_hash, customer_account_id FROM customer_identity_tokens');
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0]!.token_hash.length, 32);
  assert.notEqual(stored.rows[0]!.token_hash.toString(), created.token);

  await assert.rejects(identity.resolve({ token: created.token, merchantId: 'identity-merchant', staffAccountId: 'outsider' }), { code: 'MERCHANT_ACCESS_DENIED' });
  const resolved = await identity.resolve({ token: created.token, merchantId: 'identity-merchant', staffAccountId: 'staff-a' });
  assert.equal(resolved.customerAccountId, 'customer-a');
  await assert.rejects(identity.resolve({ token: created.token, merchantId: 'identity-merchant', staffAccountId: 'staff-b' }), { code: 'CUSTOMER_IDENTITY_UNAVAILABLE' });
  await assert.rejects(identity.resolve({ token: created.token, merchantId: 'other-merchant', staffAccountId: 'staff-a' }), { code: 'CUSTOMER_IDENTITY_UNAVAILABLE' });
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM claim_slots')).rows[0]!.count, 0);

  const claims = new PostgresClaimSlotService(pool, { now: () => now,
    referenceHmacSecret: 'test-reference-hmac-secret-32-bytes', accountLifecycle: lifecycle });
  const input = { merchantId: 'identity-merchant', customerIdentityToken: created.token, merchantReference: 'order-a', createdByAccountId: 'staff-a' };
  const race = await Promise.allSettled([claims.issue(input), claims.issue(input)]);
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 2);
  const results = race.map((result) => { if (result.status !== 'fulfilled') throw result.reason; return result.value; });
  assert.equal(results[0]!.claimSlotId, results[1]!.claimSlotId);
  assert.equal(results[0]!.tokenVersion, 1);
  assert.equal(results[1]!.tokenVersion, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM claim_slots')).rows[0]!.count, 1);
  await assert.rejects(claims.issue({ ...input, merchantReference: 'order-b' }), { code: 'CUSTOMER_IDENTITY_UNAVAILABLE' });

  const expiring = await identity.create('customer-b');
  now = new Date(expiring.expiresAt);
  await assert.rejects(identity.resolve({ token: expiring.token, merchantId: 'identity-merchant', staffAccountId: 'staff-a' }), { code: 'CUSTOMER_IDENTITY_EXPIRED' });

  const rollbackToken = await identity.create('customer-a');
  await identity.resolve({ token: rollbackToken.token, merchantId: 'identity-merchant', staffAccountId: 'staff-a' });
  await assert.rejects(claims.issue({ ...input, customerIdentityToken: rollbackToken.token }), { code: 'CLAIM_SLOT_ALREADY_EXISTS' });
  const rolledBack = await pool.query('SELECT consumed_at FROM customer_identity_tokens WHERE token_hash = $1', [createHash('sha256').update(rollbackToken.token).digest()]);
  assert.equal(rolledBack.rows[0]!.consumed_at, null);
  await claims.issue({ ...input, customerIdentityToken: rollbackToken.token, merchantReference: 'order-c' });

  const revoked = await identity.create('customer-b');
  await identity.revoke({ token: revoked.token, accountId: 'customer-b' });
  await assert.rejects(identity.resolve({ token: revoked.token, merchantId: 'identity-merchant', staffAccountId: 'staff-a' }), { code: 'CUSTOMER_IDENTITY_UNAVAILABLE' });

  const deletionIdentity = new PostgresCustomerIdentityService(pool, { now: () => now, accountLifecycle: lifecycle });
  const beforeDeletion = await deletionIdentity.create('customer-delete');
  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'test-only-account-deletion-secret-at-least-32-bytes',
    policyVersion: 'account-deletion-v1', now: () => now, accountLifecycle: lifecycle,
  });
  await deletion.requestDeletion({ accountId: 'customer-delete', confirmation: 'DELETE MY ACCOUNT' });
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM customer_identity_tokens WHERE customer_account_id = $1', ['customer-delete'])).rows[0]!.count, 0);
  await assert.rejects(deletionIdentity.create('customer-delete'), { code: 'ACCOUNT_DELETED' });
  await assert.rejects(deletionIdentity.resolve({ token: beforeDeletion.token, merchantId: 'identity-merchant', staffAccountId: 'staff-a' }), { code: 'CUSTOMER_IDENTITY_UNAVAILABLE' });

  const httpIdentity = new PostgresCustomerIdentityService(pool, { now: () => now, accountLifecycle: lifecycle });
  const server = createApiServer(
    new WalletChallengeService({ store: new InMemoryChallengeStore(), domain: 'api.masscom.local',
      uri: 'https://api.masscom.local/wallet/verify', chainId: 84532, ttlMs: 300_000 }),
    (request) => String(request.headers['x-account-id'] ?? ''),
    undefined, new PostgresMerchantAccessControl(pool), claims,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    false, undefined, false, httpIdentity,
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const request = (path: string, accountId: string, body: object) => fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-account-id': accountId },
    body: JSON.stringify(body),
  });
  const createResponse = await request('/customer/identity-tokens', 'customer-http', {});
  assert.equal(createResponse.status, 201);
  const { token: httpToken } = await createResponse.json() as { token: string };
  const resolvePath = '/merchant/merchants/identity-merchant/customer-identities/resolve';
  const resolveResponse = await request(resolvePath, 'staff-a', { customerIdentityToken: httpToken });
  assert.equal(resolveResponse.status, 200);
  assert.equal((await resolveResponse.json() as { customerAccountId: string }).customerAccountId, 'customer-http');
  const issuePath = '/merchant/merchants/identity-merchant/claim-slots';
  const invalidIssue = await request(issuePath, 'staff-a', { customerIdentityToken: httpToken,
    customerAccountId: 'attacker-chosen', merchantReference: 'http-order', useConfirmed: true });
  assert.equal(invalidIssue.status, 400);
  const missingToken = await request(issuePath, 'staff-a', { customerAccountId: 'attacker-chosen',
    merchantReference: 'http-order', useConfirmed: true });
  assert.equal(missingToken.status, 400);
  const issueResponse = await request(issuePath, 'staff-a', { customerIdentityToken: httpToken,
    merchantReference: 'http-order', useConfirmed: true });
  assert.equal(issueResponse.status, 201);
  const issuedBody = await issueResponse.json() as { claimSlotId: string };
  const retryResponse = await request(issuePath, 'staff-a', { customerIdentityToken: httpToken,
    merchantReference: 'http-order', useConfirmed: true });
  assert.equal(retryResponse.status, 200);
  const retryBody = await retryResponse.json() as { claimSlotId: string; tokenVersion: number; token?: string };
  assert.equal(retryBody.claimSlotId, issuedBody.claimSlotId);
  assert.equal(retryBody.tokenVersion, 1);
  assert.equal(retryBody.token, undefined);
  const reissueResponse = await request(`${issuePath}/${retryBody.claimSlotId}/reissue`, 'staff-a',
    { expectedTokenVersion: retryBody.tokenVersion });
  assert.equal(reissueResponse.status, 200);
  const reissuedBody = await reissueResponse.json() as { claimSlotId: string; token: string; tokenVersion: number };
  assert.equal(reissuedBody.claimSlotId, issuedBody.claimSlotId);
  assert.equal(reissuedBody.tokenVersion, 2);
  assert.ok(reissuedBody.token);
});
