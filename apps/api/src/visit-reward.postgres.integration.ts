import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { runMigrations } from './postgres/migrate.js';

test('Q01 R01 R03 redeem creates one visit effect per QR and grants fixed goals once on Korean dates', async (t) => {
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
     VALUES ('merchant-a', 'A 데모 식당', '방문·보상 시험용 가상 점포입니다.', '서울 노원구 데모로 1', 10000, 'ACTIVE', true)`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ('merchant-a', 'staff-a', 'STAFF', 'ACTIVE')`,
  );
  await pool.query(
    `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES (
       'campaign-a',
       'merchant-a',
       '가을 방문 도감',
       '2026-09-01T00:00:00Z',
       '2026-10-31T23:59:59Z',
       'ACTIVE',
       true,
       100
     )`,
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES
       ('campaign-a', 1, '첫 방문 마스코트'),
       ('campaign-a', 3, '세 번째 방문 마스코트'),
       ('campaign-a', 5, '다섯 번째 방문 마스코트')`,
  );

  let currentTime = new Date('2026-09-18T03:00:00.000Z');
  const tokens = Array.from(
    { length: 8 },
    (_, index) => `visit-token-${index + 1}-abcdefghijklmnopqrstuvwxyz`,
  );
  const claimSlotIds = Array.from(
    { length: 8 },
    (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const visitEventIds = Array.from(
    { length: 7 },
    (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const entitlementIds = Array.from(
    { length: 3 },
    (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const service = new PostgresClaimSlotService(pool, {
    now: () => currentTime,
    nextToken: () => tokens.shift()!,
    nextId: () => claimSlotIds.shift()!,
    nextVisitEventId: () => visitEventIds.shift()!,
    nextEntitlementId: () => entitlementIds.shift()!,
    ttlMs: 15 * 60 * 1000,
    referenceHmacSecret: 'test-reference-hmac-secret-32-bytes',
  });

  const issue = async (merchantReference: string) =>
    service.issue({
      merchantId: 'merchant-a',
      customerAccountId: 'customer-1',
      merchantReference,
      createdByAccountId: 'staff-a',
    });

  const issueAndRedeem = async (merchantReference: string) => {
    const issued = await issue(merchantReference);
    return service.redeem({ accountId: 'customer-1', token: issued.token });
  };

  const firstSlot = await issue('demo-order-1');
  const firstRace = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      service.redeem({ accountId: 'customer-1', token: firstSlot.token }),
    ),
  );
  const firstSuccesses = firstRace.filter((result) => result.status === 'fulfilled');
  const firstRejections = firstRace
    .filter((result) => result.status === 'rejected')
    .map((result) =>
      result.reason instanceof Error
        ? `${result.reason.name}: ${result.reason.message}`
        : String(result.reason),
    );
  assert.equal(firstSuccesses.length, 20, firstRejections.join('\n'));
  assert.equal(firstRace.filter((result) => result.status === 'rejected').length, 0);
  const first = firstSuccesses.find((result) => result.value.replayed === false)?.value;
  assert.ok(first);
  assert.deepEqual(first, {
    claimSlotId: firstSlot.claimSlotId,
    merchantId: 'merchant-a',
    merchantName: 'A 데모 식당',
    campaignTitle: '가을 방문 도감',
    status: 'CLAIMED',
    replayed: false,
    visit: {
      visitEventId: '10000000-0000-4000-8000-000000000001',
      campaignId: 'campaign-a',
      businessDate: '2026-09-18',
      verificationLevel: 'MERCHANT_CONFIRMED',
      progressCounted: true,
      progressVisitCount: 1,
    },
    grantedRewards: [
      {
        entitlementId: '20000000-0000-4000-8000-000000000001',
        targetVisitCount: 1,
        status: 'GRANTED',
        claimExpiresAt: '2026-12-17T03:00:00.000Z',
      },
    ],
    // #412: 목적 행이 없는 옛 캠페인은 혜택 시간대 조건이 없다는 뜻의 NONE만 더해진다.
    benefit: { state: 'NONE' },
  });
  const recovered = await service.redeem({ accountId: 'customer-1', token: firstSlot.token });
  assert.equal(recovered.replayed, true);
  assert.equal(recovered.claimSlotId, first.claimSlotId);
  assert.equal(recovered.visit.visitEventId, first.visit.visitEventId);
  assert.deepEqual(recovered.grantedRewards, first.grantedRewards);
  await pool.query(
    `UPDATE reward_entitlements
     SET status = 'MINT_REQUESTED', updated_at = now()
     WHERE source_visit_event_id = $1`,
    [first.visit.visitEventId],
  );
  const recoveredAfterMintRequest = await service.redeem({
    accountId: 'customer-1',
    token: firstSlot.token,
  });
  assert.equal(recoveredAfterMintRequest.replayed, true);
  assert.deepEqual(recoveredAfterMintRequest.grantedRewards, first.grantedRewards);
  await pool.query(
    `UPDATE reward_entitlements
     SET status = 'GRANTED', updated_at = now()
     WHERE source_visit_event_id = $1`,
    [first.visit.visitEventId],
  );
  await assert.rejects(
    service.redeem({ accountId: 'different-customer', token: firstSlot.token }),
    { code: 'CLAIM_TOKEN_UNAVAILABLE' },
  );
  const responseLossCounts = await pool.query<{
    claim_count: number;
    visit_count: number;
    entitlement_count: number;
  }>(
    `SELECT
       (SELECT count(*)::integer FROM claim_slots WHERE id = $1) AS claim_count,
       (SELECT count(*)::integer FROM visit_events WHERE claim_slot_id = $1) AS visit_count,
       (SELECT count(*)::integer FROM reward_entitlements WHERE source_visit_event_id = $2) AS entitlement_count`,
    [first.claimSlotId, first.visit.visitEventId],
  );
  assert.deepEqual(responseLossCounts.rows[0], {
    claim_count: 1,
    visit_count: 1,
    entitlement_count: 1,
  });

  currentTime = new Date('2026-09-18T14:59:59.999Z');
  const sameKoreanDate = await issueAndRedeem('demo-order-2');
  assert.equal(sameKoreanDate.visit.businessDate, '2026-09-18');
  assert.equal(sameKoreanDate.visit.progressCounted, false);
  assert.equal(sameKoreanDate.visit.progressVisitCount, 1);
  assert.deepEqual(sameKoreanDate.grantedRewards, []);

  currentTime = new Date('2026-09-18T15:00:00.000Z');
  const nextKoreanDate = await issueAndRedeem('demo-order-3');
  assert.equal(nextKoreanDate.visit.businessDate, '2026-09-19');
  assert.equal(nextKoreanDate.visit.progressCounted, true);
  assert.equal(nextKoreanDate.visit.progressVisitCount, 2);
  assert.deepEqual(nextKoreanDate.grantedRewards, []);

  currentTime = new Date('2026-09-19T15:00:00.000Z');
  const thirdVisit = await issueAndRedeem('demo-order-4');
  assert.equal(thirdVisit.visit.businessDate, '2026-09-20');
  assert.equal(thirdVisit.visit.progressVisitCount, 3);
  assert.deepEqual(
    thirdVisit.grantedRewards.map((reward) => reward.targetVisitCount),
    [3],
  );

  currentTime = new Date('2026-09-20T15:00:00.000Z');
  const fourthVisit = await issueAndRedeem('demo-order-5');
  assert.equal(fourthVisit.visit.progressVisitCount, 4);
  assert.deepEqual(fourthVisit.grantedRewards, []);

  currentTime = new Date('2026-09-21T15:00:00.000Z');
  const fifthVisit = await issueAndRedeem('demo-order-6');
  assert.equal(fifthVisit.visit.businessDate, '2026-09-22');
  assert.equal(fifthVisit.visit.progressVisitCount, 5);
  assert.deepEqual(
    fifthVisit.grantedRewards.map((reward) => reward.targetVisitCount),
    [5],
  );

  currentTime = new Date('2026-09-22T10:00:00.000Z');
  const repeatedEvaluation = await issueAndRedeem('demo-order-7');
  assert.equal(repeatedEvaluation.visit.businessDate, '2026-09-22');
  assert.equal(repeatedEvaluation.visit.progressCounted, false);
  assert.equal(repeatedEvaluation.visit.progressVisitCount, 5);
  assert.deepEqual(repeatedEvaluation.grantedRewards, []);

  const counts = await pool.query<{
    claim_count: number;
    visit_count: number;
    progress_count: number;
    entitlement_count: number;
  }>(
    `SELECT
       (SELECT count(*)::integer FROM claim_slots WHERE status = 'CLAIMED') AS claim_count,
       (SELECT count(*)::integer FROM visit_events WHERE status = 'VALID') AS visit_count,
       (SELECT count(*)::integer FROM visit_events WHERE progress_counted) AS progress_count,
       (SELECT count(*)::integer FROM reward_entitlements WHERE status = 'GRANTED') AS entitlement_count`,
  );
  assert.deepEqual(counts.rows[0], {
    claim_count: 7,
    visit_count: 7,
    progress_count: 5,
    entitlement_count: 3,
  });

  const goals = await pool.query<{ target_visit_count: number }>(
    `SELECT target_visit_count
     FROM reward_entitlements
     WHERE customer_account_id = 'customer-1' AND campaign_id = 'campaign-a'
     ORDER BY target_visit_count`,
  );
  assert.deepEqual(
    goals.rows.map((row) => row.target_visit_count),
    [1, 3, 5],
  );

  await pool.query("UPDATE campaigns SET status = 'PAUSED' WHERE id = 'campaign-a'");
  const noCampaignSlot = await issue('demo-order-8');
  await assert.rejects(
    service.redeem({ accountId: 'customer-1', token: noCampaignSlot.token }),
    { code: 'CLAIM_CAMPAIGN_UNAVAILABLE' },
  );
  const rolledBack = await pool.query<{
    slot_status: string;
    visit_count: number;
    entitlement_count: number;
  }>(
    `SELECT
       (SELECT status FROM claim_slots WHERE id = $1) AS slot_status,
       (SELECT count(*)::integer FROM visit_events) AS visit_count,
       (SELECT count(*)::integer FROM reward_entitlements) AS entitlement_count`,
    [noCampaignSlot.claimSlotId],
  );
  assert.deepEqual(rolledBack.rows[0], {
    slot_status: 'ISSUED',
    visit_count: 7,
    entitlement_count: 3,
  });
});
