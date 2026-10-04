import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Pool } from 'pg';

import { MerchantAccessError } from './merchant-access.js';
import { MerchantProfileError } from './merchant-profile.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresMerchantProfileService } from './postgres/merchant-profile.js';

const now = new Date('2026-10-04T00:00:00.000Z');
const body = { story: '새 소개', businessHours: '매일 11:00–21:00',
  menuItems: [{ name: ' 새 국수 ', priceWon: 9000 }], expectedVersion: 1 };

test('merchant profile updates version and public catalog, and serializes competing edits', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE merchant_members, campaign_goals, campaigns, merchants CASCADE');
  await pool.query(
    `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won,
       status, is_demo, business_hours, menu_items, updated_at) VALUES
       ('profile-store', '프로필 가게', '옛 소개', '서울 노원구', 0, 'ACTIVE', false, '옛 시간', '[]', '2020-01-01T00:00:00Z'),
       ('shared-demo', '공유 점포', '시연 고정', '서울 노원구', 0, 'ACTIVE', true, '고정', '[]', now()),
       ('personal-demo', '체험 점포', '나의 가게', '서울 노원구', 0, 'ACTIVE', true, '옛 시간', '[]', now())`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status, revoked_at) VALUES
       ('profile-store', 'owner', 'OWNER', 'ACTIVE', NULL),
       ('profile-store', 'staff', 'STAFF', 'ACTIVE', NULL),
       ('profile-store', 'revoked', 'OWNER', 'REVOKED', now()),
       ('shared-demo', 'demo-owner', 'OWNER', 'ACTIVE', NULL),
       ('personal-demo', 'guest', 'STAFF', 'ACTIVE', NULL)`,
  );
  await pool.query(
    `INSERT INTO showcase_guest_trials (account_id, merchant_id, created_at, expires_at)
     VALUES ('guest', 'personal-demo', $1, $2)`, [now, new Date(now.getTime() + 86_400_000)],
  );
  await pool.query(
    `INSERT INTO campaigns (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ('profile-campaign', 'profile-store', '도감', $1, $2, 'ACTIVE', true, 100)`,
    [new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 86_400_000)],
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ('profile-campaign', 1, '하나'), ('profile-campaign', 3, '셋'), ('profile-campaign', 5, '다섯')`,
  );

  const ownerService = new PostgresMerchantProfileService(pool, { now: () => now });
  const delegatedService = new PostgresMerchantProfileService(pool, { staffMayManageArt: true, now: () => now });
  const owner = await ownerService.getProfile({ accountId: 'owner', merchantId: 'profile-store' });
  assert.deepEqual({ canEdit: owner.canEdit, readOnlyReason: owner.readOnlyReason, version: owner.version },
    { canEdit: true, readOnlyReason: null, version: 1 });
  const staff = await ownerService.getProfile({ accountId: 'staff', merchantId: 'profile-store' });
  assert.deepEqual({ canEdit: staff.canEdit, readOnlyReason: staff.readOnlyReason },
    { canEdit: false, readOnlyReason: 'ROLE' });
  await assert.rejects(ownerService.updateProfile({ accountId: 'staff', merchantId: 'profile-store', body }),
    { code: 'MERCHANT_PROFILE_FORBIDDEN' });
  await assert.rejects(ownerService.getProfile({ accountId: 'revoked', merchantId: 'profile-store' }),
    MerchantAccessError);
  await assert.rejects(ownerService.getProfile({ accountId: 'owner', merchantId: 'shared-demo' }),
    MerchantAccessError);
  const shared = await delegatedService.getProfile({ accountId: 'demo-owner', merchantId: 'shared-demo' });
  assert.deepEqual({ canEdit: shared.canEdit, readOnlyReason: shared.readOnlyReason },
    { canEdit: false, readOnlyReason: 'SHARED_DEMO_STORE' });
  await assert.rejects(delegatedService.updateProfile({ accountId: 'demo-owner', merchantId: 'shared-demo', body }),
    { code: 'MERCHANT_PROFILE_READ_ONLY' });
  const guest = await delegatedService.updateProfile({ accountId: 'guest', merchantId: 'personal-demo', body });
  assert.deepEqual({ canEdit: guest.canEdit, version: guest.version }, { canEdit: true, version: 2 });
  await assert.rejects(ownerService.updateProfile({ accountId: 'guest', merchantId: 'personal-demo', body: { ...body, expectedVersion: 2 } }),
    { code: 'MERCHANT_PROFILE_FORBIDDEN' });

  const updated = await ownerService.updateProfile({ accountId: 'owner', merchantId: 'profile-store', body });
  assert.equal(updated.version, 2);
  assert.equal(updated.story, '새 소개');
  assert.deepEqual(updated.menuItems, [{ name: '새 국수', priceWon: 9000 }]);
  const modified = await pool.query<{ updated_at: Date }>(
    'SELECT updated_at FROM merchants WHERE id = $1', ['profile-store'],
  );
  assert.ok(modified.rows[0]!.updated_at > new Date('2020-01-01T00:00:00Z'));
  const publicStore = (await new PostgresMerchantCatalog(pool, () => now).listPublicMerchants())[0]!;
  assert.equal(publicStore.story, updated.story);
  assert.equal(publicStore.businessHours, updated.businessHours);
  assert.deepEqual(publicStore.menuItems, updated.menuItems);
  await assert.rejects(ownerService.updateProfile({ accountId: 'owner', merchantId: 'profile-store', body }),
    { code: 'MERCHANT_PROFILE_VERSION_CONFLICT' });

  const competing = await Promise.allSettled([
    ownerService.updateProfile({ accountId: 'owner', merchantId: 'profile-store', body: { ...body, expectedVersion: 2 } }),
    delegatedService.updateProfile({ accountId: 'staff', merchantId: 'profile-store', body: { ...body, expectedVersion: 2 } }),
  ]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(competing.filter(result => result.status === 'rejected' &&
    result.reason instanceof MerchantProfileError && result.reason.code === 'MERCHANT_PROFILE_VERSION_CONFLICT').length, 1);
  const version = await pool.query<{ version: number }>('SELECT version FROM merchants WHERE id = $1', ['profile-store']);
  assert.equal(version.rows[0]?.version, 3);
});
