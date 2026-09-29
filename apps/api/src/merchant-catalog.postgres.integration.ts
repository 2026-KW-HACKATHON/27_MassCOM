import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { runMigrations } from './postgres/migrate.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

test('GET /merchants reads only active merchants with a public current campaign from PostgreSQL', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests');
  }
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }

  const pool = new Pool({ connectionString });
  await Promise.all([runMigrations(pool), runMigrations(pool)]);
  await pool.query('TRUNCATE campaign_goals, campaigns, merchants CASCADE');

  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo, menu_items, business_hours)
     VALUES
       ('merchant-visible', 'A 실제 국수집', '', '서울 노원구 데모로 1', 10000, 'ACTIVE', false,
         '[{"name":"국수","priceWon":7000}]', '월–금 10:00–18:00'),
       ('merchant-full', 'B 정원 마감 데모 식당', '정원 상태 확인용 예시입니다.', '서울 노원구 데모로 2', 12000, 'ACTIVE', true, '[]', ''),
       ('merchant-paused', 'C 중단된 데모 식당', '공개되면 안 됩니다.', '서울 노원구 데모로 3', 9000, 'PAUSED', true, '[]', ''),
       ('merchant-future', 'D 미래 데모 식당', '캠페인 시작 전입니다.', '서울 노원구 데모로 4', 11000, 'ACTIVE', true, '[]', ''),
       ('merchant-private', 'E 비공개 데모 식당', '비공개 캠페인입니다.', '서울 노원구 데모로 5', 8000, 'ACTIVE', true, '[]', '')`,
  );
  await pool.query(
    `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity, enrolled_count)
     VALUES
       ('campaign-visible', 'merchant-visible', '가을 방문 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 100, 4),
       ('campaign-full', 'merchant-full', '정원 마감 방문 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 4, 4),
       ('campaign-paused-merchant', 'merchant-paused', '중단 점포 캠페인', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 100, 0),
       ('campaign-future', 'merchant-future', '겨울 방문 도감', '2026-12-01T00:00:00Z', '2026-12-31T23:59:59Z', 'ACTIVE', true, 100, 0),
       ('campaign-private', 'merchant-private', '비공개 방문 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', false, 100, 0)`,
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     SELECT campaign_id, target_visit_count,
       CASE target_visit_count
         WHEN 1 THEN '첫 방문 마스코트'
         WHEN 3 THEN '세 번째 방문 마스코트'
         WHEN 5 THEN '다섯 번째 방문 마스코트'
       END
     FROM (
       VALUES
         ('campaign-visible'),
         ('campaign-full'),
         ('campaign-paused-merchant'),
         ('campaign-future'),
         ('campaign-private')
     ) AS selected_campaigns(campaign_id)
     CROSS JOIN (VALUES (1), (3), (5)) AS selected_goals(target_visit_count)`,
  );

  const catalog = new PostgresMerchantCatalog(pool, () => new Date('2026-09-18T00:00:00.000Z'));
  const walletService = new WalletChallengeService({
    store: new InMemoryChallengeStore(),
    domain: 'api.masscom.local',
    uri: 'https://api.masscom.local/wallet/verify',
    chainId: 84532,
    ttlMs: 5 * 60 * 1000,
  });
  const server = createApiServer(walletService, developmentHeaderAccountResolver, catalog);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await pool.end();
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('server did not bind a TCP port');
  }

  const response = await fetch(`http://127.0.0.1:${address.port}/merchants`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    merchants: [
      {
        id: 'merchant-visible',
        name: 'A 실제 국수집',
        story: '',
        roadAddress: '서울 노원구 데모로 1',
        minimumSpendWon: 10_000,
        menuItems: [{ name: '국수', priceWon: 7000 }],
        businessHours: '월–금 10:00–18:00',
        campaign: {
          id: 'campaign-visible',
          title: '가을 방문 도감',
          startsAt: '2026-09-01T00:00:00.000Z',
          endsAt: '2026-10-31T23:59:59.000Z',
          enrollmentStatus: 'OPEN',
          rewardGoals: [
            { targetVisitCount: 1, displayName: '첫 방문 마스코트' },
            { targetVisitCount: 3, displayName: '세 번째 방문 마스코트' },
            { targetVisitCount: 5, displayName: '다섯 번째 방문 마스코트' },
          ],
        },
        demo: false,
        artUrl: null,
      },
      {
        id: 'merchant-full',
        name: 'B 정원 마감 데모 식당',
        story: '정원 상태 확인용 예시입니다.',
        roadAddress: '서울 노원구 데모로 2',
        minimumSpendWon: 12_000,
        menuItems: [],
        businessHours: '',
        campaign: {
          id: 'campaign-full',
          title: '정원 마감 방문 도감',
          startsAt: '2026-09-01T00:00:00.000Z',
          endsAt: '2026-10-31T23:59:59.000Z',
          enrollmentStatus: 'FULL',
          rewardGoals: [
            { targetVisitCount: 1, displayName: '첫 방문 마스코트' },
            { targetVisitCount: 3, displayName: '세 번째 방문 마스코트' },
            { targetVisitCount: 5, displayName: '다섯 번째 방문 마스코트' },
          ],
        },
        demo: true,
        artUrl: null,
      },
    ],
  });
});
