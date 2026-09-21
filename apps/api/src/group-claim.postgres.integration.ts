import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { runMigrations } from './postgres/migrate.js';

test('Q04 one order shared by a group keeps every person slot independent', async (t) => {
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
  await pool.query(
    'TRUNCATE reward_entitlements, visit_events, claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE',
  );
  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ('merchant-a', 'A 데모 식당', '단체 수령 시험용 가상 점포입니다.', '서울 노원구 데모로 1', 10000, 'ACTIVE', true)`,
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
     VALUES ('campaign-a', 1, '첫 방문 마스코트')`,
  );

  let currentTime = new Date('2026-09-18T03:00:00.000Z');
  const service = new PostgresClaimSlotService(pool, {
    now: () => currentTime,
    ttlMs: 15 * 60 * 1000,
    referenceHmacSecret: 'test-reference-hmac-secret-32-bytes',
  });
  const issue = (customerAccountId: string) =>
    service.issue({
      merchantId: 'merchant-a',
      customerAccountId,
      merchantReference: 'group-order-1',
      createdByAccountId: 'staff-a',
    });

  const [first, second, third] = [
    await issue('customer-1'),
    await issue('customer-2'),
    await issue('customer-3'),
  ];
  await assert.rejects(issue('customer-1'), { code: 'CLAIM_SLOT_ALREADY_EXISTS' });

  const shared = await pool.query<{ slots: number; refs: number }>(
    `SELECT count(*)::integer AS slots,
            count(DISTINCT merchant_reference_hash)::integer AS refs
     FROM claim_slots`,
  );
  assert.deepEqual(shared.rows[0], { slots: 3, refs: 1 });

  // Another member of the group cannot take this person's slot, and trying leaves it untouched.
  await assert.rejects(service.redeem({ accountId: 'customer-2', token: first.token }), {
    code: 'CLAIM_TOKEN_UNAVAILABLE',
  });

  const results = await Promise.allSettled([
    service.redeem({ accountId: 'customer-1', token: first.token }),
    service.redeem({ accountId: 'customer-1', token: first.token }),
    service.redeem({ accountId: 'customer-2', token: second.token }),
  ]);
  const firstOutcomes = results.slice(0, 2);
  assert.equal(firstOutcomes.filter((result) => result.status === 'fulfilled').length, 2);
  assert.equal(
    firstOutcomes.filter(
      (result) => result.status === 'fulfilled' && result.value.replayed === false,
    ).length,
    1,
  );
  assert.equal(
    firstOutcomes.filter(
      (result) => result.status === 'fulfilled' && result.value.replayed === true,
    ).length,
    1,
  );
  assert.equal(results[2]!.status, 'fulfilled');
  for (const result of results) {
    if (result.status === 'fulfilled') {
      assert.deepEqual(
        result.value.grantedRewards.map((reward) => reward.targetVisitCount),
        [1],
      );
    }
  }

  const slotStates = async () =>
    (
      await pool.query<{ customer_account_id: string; status: string; token_version: number }>(
        `SELECT customer_account_id, status, token_version
         FROM claim_slots ORDER BY customer_account_id`,
      )
    ).rows;
  assert.deepEqual(await slotStates(), [
    { customer_account_id: 'customer-1', status: 'CLAIMED', token_version: 1 },
    { customer_account_id: 'customer-2', status: 'CLAIMED', token_version: 1 },
    { customer_account_id: 'customer-3', status: 'ISSUED', token_version: 1 },
  ]);

  // The person who has not claimed yet still holds a working QR of their own.
  const preview = await service.preview({ accountId: 'customer-3', token: third.token });
  assert.equal(preview.claimSlotId, third.claimSlotId);

  currentTime = new Date('2026-09-18T03:16:00.000Z');
  await assert.rejects(service.redeem({ accountId: 'customer-3', token: third.token }), {
    code: 'CLAIM_TOKEN_EXPIRED',
  });
  assert.deepEqual(
    (await slotStates()).map((slot) => slot.status),
    ['CLAIMED', 'CLAIMED', 'EXPIRED'],
  );

  const effects = await pool.query<{ customer_account_id: string; visits: number; rewards: number }>(
    `SELECT account.id AS customer_account_id,
            (SELECT count(*)::integer FROM visit_events
             WHERE customer_account_id = account.id) AS visits,
            (SELECT count(*)::integer FROM reward_entitlements
             WHERE customer_account_id = account.id) AS rewards
     FROM (VALUES ('customer-1'), ('customer-2'), ('customer-3')) AS account(id)
     ORDER BY account.id`,
  );
  assert.deepEqual(effects.rows, [
    { customer_account_id: 'customer-1', visits: 1, rewards: 1 },
    { customer_account_id: 'customer-2', visits: 1, rewards: 1 },
    { customer_account_id: 'customer-3', visits: 0, rewards: 0 },
  ]);
});
