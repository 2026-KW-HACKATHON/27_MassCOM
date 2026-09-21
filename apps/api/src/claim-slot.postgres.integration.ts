import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresMerchantAccessControl } from './postgres/merchant-access.js';
import { runMigrations } from './postgres/migrate.js';
import { createApiServer } from './server.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

test('one-person claim slots keep only hashes, reissue in place, and consume once under concurrency', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  }
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }

  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE');
  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ('merchant-a', 'A 데모 식당', 'QR 시험용 가상 점포입니다.', '서울 노원구 데모로 1', 10000, 'ACTIVE', true)`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ('merchant-a', 'staff-a', 'STAFF', 'ACTIVE')`,
  );
  await pool.query(
    `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES (
       'campaign-a', 'merchant-a', '가을 방문 도감',
       '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 100
     )`,
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES
       ('campaign-a', 1, '첫 방문 마스코트'),
       ('campaign-a', 3, '세 번째 방문 마스코트'),
       ('campaign-a', 5, '다섯 번째 방문 마스코트')`,
  );

  assert.throws(
    () => new PostgresClaimSlotService(pool, { referenceHmacSecret: 'too-short' }),
    /referenceHmacSecret must be at least 32 bytes/,
  );

  let currentTime = new Date('2026-09-18T03:00:00.000Z');
  const tokens = [
    'token-1-abcdefghijklmnopqrstuvwxyz012345',
    'token-2-abcdefghijklmnopqrstuvwxyz012345',
    'token-3-abcdefghijklmnopqrstuvwxyz012345',
    'token-4-abcdefghijklmnopqrstuvwxyz012345',
    'token-5-abcdefghijklmnopqrstuvwxyz012345',
    'token-6-abcdefghijklmnopqrstuvwxyz012345',
    'token-7-abcdefghijklmnopqrstuvwxyz012345',
  ];
  const ids = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
  ];
  const service = new PostgresClaimSlotService(pool, {
    now: () => currentTime,
    nextToken: () => tokens.shift()!,
    nextId: () => ids.shift()!,
    ttlMs: 15 * 60 * 1000,
    referenceHmacSecret: 'test-reference-hmac-secret-32-bytes',
  });

  const first = await service.issue({
    merchantId: 'merchant-a',
    customerAccountId: 'customer-1',
    merchantReference: 'demo-order-1',
    createdByAccountId: 'staff-a',
  });
  assert.deepEqual(first, {
    claimSlotId: '00000000-0000-4000-8000-000000000001',
    token: 'token-1-abcdefghijklmnopqrstuvwxyz012345',
    tokenVersion: 1,
    expiresAt: '2026-09-18T03:15:00.000Z',
  });

  const stored = await pool.query<{
    token_hash: string;
    merchant_reference_hash: string;
    token_version: number;
  }>(
    `SELECT encode(token_hash, 'hex') AS token_hash,
            encode(merchant_reference_hash, 'hex') AS merchant_reference_hash,
            token_version
     FROM claim_slots
     WHERE id = $1`,
    [first.claimSlotId],
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0]!.token_hash.length, 64);
  assert.equal(
    stored.rows[0]!.merchant_reference_hash,
    createHmac('sha256', 'test-reference-hmac-secret-32-bytes')
      .update('merchant-a\0demo-order-1')
      .digest('hex'),
  );
  assert.doesNotMatch(JSON.stringify(stored.rows[0]), /token-1|demo-order-1/);
  assert.equal(stored.rows[0]!.token_version, 1);

  await assert.rejects(
    service.issue({
      merchantId: 'merchant-a',
      customerAccountId: 'customer-1',
      merchantReference: 'demo-order-1',
      createdByAccountId: 'staff-a',
    }),
    { code: 'CLAIM_SLOT_ALREADY_EXISTS' },
  );

  const reissueRace = await Promise.allSettled(
    Array.from({ length: 2 }, () =>
      service.reissue({
        merchantId: 'merchant-a',
        claimSlotId: first.claimSlotId,
        expectedTokenVersion: first.tokenVersion,
        requestedByAccountId: 'staff-a',
      }),
    ),
  );
  assert.equal(reissueRace.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(reissueRace.filter((result) => result.status === 'rejected').length, 1);
  const rejectedReissue = reissueRace.find((result) => result.status === 'rejected');
  assert.equal(rejectedReissue?.status, 'rejected');
  if (rejectedReissue?.status === 'rejected') {
    assert.equal(rejectedReissue.reason.code, 'CLAIM_SLOT_NOT_REISSUABLE');
  }
  const successfulReissue = reissueRace.find((result) => result.status === 'fulfilled');
  assert.equal(successfulReissue?.status, 'fulfilled');
  if (successfulReissue?.status !== 'fulfilled') {
    throw new Error('one reissue request must succeed');
  }
  const reissued = successfulReissue.value;
  assert.equal(reissued.claimSlotId, first.claimSlotId);
  assert.equal(reissued.tokenVersion, 2);
  assert.match(reissued.token, /^token-[23]-/);
  assert.equal(reissued.expiresAt, '2026-09-18T03:15:00.000Z');
  const slotCount = await pool.query<{ count: string; token_version: number }>(
    'SELECT count(*)::text AS count, max(token_version)::integer AS token_version FROM claim_slots',
  );
  assert.equal(slotCount.rows[0]!.count, '1');
  assert.equal(slotCount.rows[0]!.token_version, 2);

  await assert.rejects(
    service.redeem({ accountId: 'customer-1', token: first.token }),
    { code: 'CLAIM_TOKEN_UNAVAILABLE' },
  );

  const preview = await service.preview({
    accountId: 'customer-1',
    token: reissued.token,
  });
  assert.deepEqual(preview, {
    claimSlotId: first.claimSlotId,
    merchantId: 'merchant-a',
    merchantName: 'A 데모 식당',
    campaignId: 'campaign-a',
    campaignTitle: '가을 방문 도감',
    expiresAt: '2026-09-18T03:15:00.000Z',
    status: 'AVAILABLE',
  });
  const afterPreview = await pool.query<{ status: string }>(
    'SELECT status FROM claim_slots WHERE id = $1',
    [first.claimSlotId],
  );
  assert.equal(afterPreview.rows[0]!.status, 'ISSUED');

  const concurrent = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      service.redeem({ accountId: 'customer-1', token: reissued.token }),
    ),
  );
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 20);
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 0);
  assert.equal(
    concurrent.filter(
      (result) => result.status === 'fulfilled' && result.value.replayed === false,
    ).length,
    1,
  );
  assert.equal(
    concurrent.filter(
      (result) => result.status === 'fulfilled' && result.value.replayed === true,
    ).length,
    19,
  );
  const claimed = await pool.query<{ status: string; claimed_count: string }>(
    `SELECT status, count(claimed_at)::text AS claimed_count
     FROM claim_slots
     WHERE id = $1
     GROUP BY status`,
    [first.claimSlotId],
  );
  assert.deepEqual(claimed.rows[0], { status: 'CLAIMED', claimed_count: '1' });

  const expiring = await service.issue({
    merchantId: 'merchant-a',
    customerAccountId: 'customer-2',
    merchantReference: 'demo-order-2',
    createdByAccountId: 'staff-a',
  });
  await assert.rejects(
    service.redeem({ accountId: 'different-customer', token: expiring.token }),
    { code: 'CLAIM_TOKEN_UNAVAILABLE' },
  );
  currentTime = new Date(expiring.expiresAt);
  const expiryRace = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      service.redeem({ accountId: 'customer-2', token: expiring.token }),
    ),
  );
  assert.equal(expiryRace.filter((result) => result.status === 'fulfilled').length, 0);
  const expiryCodes = expiryRace.map((result) =>
    result.status === 'rejected' &&
    typeof result.reason === 'object' &&
    result.reason !== null &&
    'code' in result.reason
      ? result.reason.code
      : 'UNKNOWN',
  );
  assert.equal(expiryCodes.filter((code) => code === 'CLAIM_TOKEN_EXPIRED').length, 1);
  assert.equal(expiryCodes.filter((code) => code === 'CLAIM_TOKEN_UNAVAILABLE').length, 19);
  const expired = await pool.query<{ status: string }>(
    'SELECT status FROM claim_slots WHERE id = $1',
    [expiring.claimSlotId],
  );
  assert.equal(expired.rows[0]!.status, 'EXPIRED');

  const apiServer = createApiServer(
    new WalletChallengeService({
      store: new InMemoryChallengeStore(),
      domain: 'api.masscom.local',
      uri: 'https://api.masscom.local/wallet/verify',
      chainId: 84532,
      ttlMs: 5 * 60 * 1000,
    }),
    () => 'staff-a',
    undefined,
    new PostgresMerchantAccessControl(pool),
    service,
  );
  await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    if (!apiServer.listening) return;
    await new Promise<void>((resolve, reject) =>
      apiServer.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const apiAddress = apiServer.address();
  if (!apiAddress || typeof apiAddress === 'string') {
    throw new Error('claim slot integration server did not bind a TCP port');
  }
  const apiBaseUrl = `http://127.0.0.1:${apiAddress.port}`;
  const issueResponse = await fetch(`${apiBaseUrl}/merchant/merchants/merchant-a/claim-slots`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      customerAccountId: 'customer-http',
      merchantReference: 'demo-order-http',
    }),
  });
  assert.equal(issueResponse.status, 201);
  const issuedOverHttp = (await issueResponse.json()) as {
    claimSlotId: string;
    tokenVersion: number;
  };
  const httpReissueRace = await Promise.all(
    Array.from({ length: 2 }, () =>
      fetch(
        `${apiBaseUrl}/merchant/merchants/merchant-a/claim-slots/${issuedOverHttp.claimSlotId}/reissue`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ expectedTokenVersion: issuedOverHttp.tokenVersion }),
        },
      ),
    ),
  );
  assert.deepEqual(
    httpReissueRace.map((response) => response.status).sort(),
    [200, 409],
  );
  const successfulHttpReissue = httpReissueRace.find((response) => response.status === 200);
  const rejectedHttpReissue = httpReissueRace.find((response) => response.status === 409);
  assert.ok(successfulHttpReissue);
  const successfulHttpBody = (await successfulHttpReissue.json()) as {
    claimSlotId: string;
    token: string;
    tokenVersion: number;
    expiresAt: string;
  };
  assert.equal(successfulHttpBody.claimSlotId, issuedOverHttp.claimSlotId);
  assert.match(successfulHttpBody.token, /^token-[67]-/);
  assert.equal(successfulHttpBody.tokenVersion, 2);
  assert.equal(successfulHttpBody.expiresAt, '2026-09-18T03:30:00.000Z');
  assert.ok(rejectedHttpReissue);
  assert.deepEqual(await rejectedHttpReissue.json(), { code: 'CLAIM_SLOT_NOT_REISSUABLE' });
  await new Promise<void>((resolve, reject) =>
    apiServer.close((error) => (error ? reject(error) : resolve())),
  );

  await pool.query(
    `UPDATE merchant_members
     SET status = 'REVOKED', revoked_at = now(), updated_at = now()
     WHERE merchant_id = 'merchant-a' AND account_id = 'staff-a'`,
  );
  await assert.rejects(
    service.issue({
      merchantId: 'merchant-a',
      customerAccountId: 'customer-3',
      merchantReference: 'demo-order-3',
      createdByAccountId: 'staff-a',
    }),
    { code: 'MERCHANT_ACCESS_DENIED' },
  );
});
