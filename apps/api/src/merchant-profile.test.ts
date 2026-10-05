import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Pool } from 'pg';

import { MerchantAccessError, type MerchantRole } from './merchant-access.js';
import { MerchantProfileError } from './merchant-profile.js';
import type { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresMerchantProfileService } from './postgres/merchant-profile.js';

const valid = {
  story: '가게 소개', businessHours: '매일 10:00–20:00',
  menuItems: [{ name: '국수', priceWon: 8000 }], expectedVersion: 1,
};

// 잘못된 요청은 DB 연결을 얻기 전에 거절한다.
const unreachablePool = { connect: () => { throw new Error('unexpected database access'); } } as unknown as Pool;
const service = new PostgresMerchantProfileService(unreachablePool);
const update = (body: unknown) => service.updateProfile({ accountId: 'owner', merchantId: 'store', body });
const invalid = (error: unknown) => error instanceof MerchantProfileError && error.code === 'MERCHANT_PROFILE_INVALID';

test('merchant profile accepts only the complete strict mutation shape', async () => {
  for (const body of [null, [], {}, { ...valid, category: '한식' },
    { ...valid, expectedVersion: 0 }, { ...valid, expectedVersion: 1.5 },
    { ...valid, businessHours: undefined }, { ...valid, menuItems: undefined },
    { ...valid, menuItems: [{ name: '국수', priceWon: 8000, hidden: true }] }]) {
    await assert.rejects(update(body), invalid);
  }
});

test('merchant profile uses operator text, menu and price limits', async () => {
  for (const body of [
    { ...valid, story: '가'.repeat(4001) },
    { ...valid, businessHours: '가'.repeat(1001) },
    { ...valid, menuItems: Array.from({ length: 31 }, () => ({ name: '국수', priceWon: 8000 })) },
    { ...valid, menuItems: [{ name: ' ', priceWon: 8000 }] },
    { ...valid, menuItems: [{ name: '가'.repeat(201), priceWon: 8000 }] },
    { ...valid, menuItems: [{ name: '국수', priceWon: -1 }] },
    { ...valid, menuItems: [{ name: '국수', priceWon: 1_000_000_001 }] },
    { ...valid, menuItems: [{ name: '국수', priceWon: 0.5 }] },
  ]) await assert.rejects(update(body), invalid);
});

function fakeDatabase(options: {
  role?: MerchantRole;
  isDemo?: boolean;
  trialAccount?: string;
  activeMember?: boolean;
  version?: number;
} = {}) {
  const calls: string[] = [];
  const merchant = {
    id: 'store', name: '원래 이름', road_address: '원래 주소', story: '옛 소개',
    business_hours: '옛 시간', menu_items: [{ name: '옛 메뉴', priceWon: 5000 }],
    version: options.version ?? 1, is_demo: options.isDemo ?? false,
  };
  const query = async (sql: string, parameters: unknown[] = []) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      calls.push(sql);
      return { rows: [] };
    }
    if (sql.includes('FROM merchants WHERE id = $1')) {
      calls.push(sql.includes('FOR UPDATE') ? 'LOCK_MERCHANT' : 'READ_MERCHANT');
      return { rows: [{ ...merchant }] };
    }
    if (sql.includes('FROM merchant_members')) {
      calls.push('READ_MEMBER');
      return { rows: options.activeMember === false ? [] : [{ role: options.role ?? 'OWNER' }] };
    }
    if (sql.includes('FROM showcase_guest_trials')) {
      calls.push('READ_TRIAL');
      return { rows: options.trialAccount ? [{ account_id: options.trialAccount,
        ended_at: null, expires_at: new Date('2027-01-01T00:00:00Z') }] : [] };
    }
    if (sql.startsWith('UPDATE merchants SET')) {
      calls.push('UPDATE_MERCHANT');
      merchant.story = parameters[1] as string;
      merchant.business_hours = parameters[2] as string;
      merchant.menu_items = JSON.parse(parameters[3] as string) as typeof merchant.menu_items;
      merchant.version++;
      return { rows: [{ ...merchant }] };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const client = { query, release: () => { calls.push('RELEASE'); } };
  return { pool: { query, connect: async () => client } as unknown as Pool, calls, merchant };
}

test('merchant profile permission follows OWNER and STAFF flag matrix', async () => {
  for (const role of ['OWNER', 'STAFF'] as const) {
    for (const flag of [false, true]) {
      const db = fakeDatabase({ role });
      const profile = new PostgresMerchantProfileService(db.pool, { staffMayManageArt: flag });
      const canEdit = role === 'OWNER' || flag;
      assert.deepEqual(
        (({ canEdit, readOnlyReason }) => ({ canEdit, readOnlyReason }))
          (await profile.getProfile({ accountId: 'member', merchantId: 'store' })),
        { canEdit, readOnlyReason: canEdit ? null : 'ROLE' },
      );
      const mutation = profile.updateProfile({ accountId: 'member', merchantId: 'store', body: valid });
      if (canEdit) {
        const updated = await mutation;
        assert.equal(updated.version, 2);
        assert.equal(updated.name, '원래 이름');
        assert.equal(updated.roadAddress, '원래 주소');
        assert.deepEqual(updated.menuItems, valid.menuItems);
        assert.ok(db.calls.includes('COMMIT'));
      } else {
        await assert.rejects(mutation, { code: 'MERCHANT_PROFILE_FORBIDDEN' });
        assert.ok(db.calls.includes('ROLLBACK'));
        assert.ok(!db.calls.includes('UPDATE_MERCHANT'));
      }
    }
  }
});

test('shared demo fixtures stay read-only; a personal trial belongs to its active guest', async () => {
  for (const role of ['OWNER', 'STAFF'] as const) {
    for (const flag of [false, true]) {
      const db = fakeDatabase({ role, isDemo: true });
      const profile = new PostgresMerchantProfileService(db.pool, { staffMayManageArt: flag });
      const current = await profile.getProfile({ accountId: 'member', merchantId: 'store' });
      assert.deepEqual({ canEdit: current.canEdit, reason: current.readOnlyReason },
        { canEdit: false, reason: 'SHARED_DEMO_STORE' });
      await assert.rejects(profile.updateProfile({ accountId: 'member', merchantId: 'store', body: valid }),
        { code: 'MERCHANT_PROFILE_READ_ONLY' });
    }
  }
  for (const [accountId, flag, expected] of [
    ['guest', true, 'editable'], ['guest', false, 'MERCHANT_PROFILE_FORBIDDEN'],
    ['another-member', true, 'MERCHANT_PROFILE_READ_ONLY'],
  ] as const) {
    const db = fakeDatabase({ role: 'STAFF', isDemo: true, trialAccount: 'guest' });
    const profile = new PostgresMerchantProfileService(db.pool,
      { staffMayManageArt: flag, now: () => new Date('2026-10-04T00:00:00Z') });
    const mutation = profile.updateProfile({ accountId, merchantId: 'store', body: valid });
    if (expected === 'editable') assert.equal((await mutation).version, 2);
    else await assert.rejects(mutation, { code: expected });
  }
});

test('merchant profile rejects stale version and revoked membership before changing a store', async () => {
  const stale = fakeDatabase({ version: 2 });
  await assert.rejects(new PostgresMerchantProfileService(stale.pool).updateProfile(
    { accountId: 'owner', merchantId: 'store', body: valid }),
  { code: 'MERCHANT_PROFILE_VERSION_CONFLICT' });
  assert.ok(stale.calls.includes('ROLLBACK'));
  assert.ok(!stale.calls.includes('UPDATE_MERCHANT'));

  const revoked = fakeDatabase({ activeMember: false });
  const profile = new PostgresMerchantProfileService(revoked.pool);
  await assert.rejects(profile.getProfile({ accountId: 'owner', merchantId: 'store' }), MerchantAccessError);
  await assert.rejects(profile.updateProfile({ accountId: 'owner', merchantId: 'store', body: valid }),
    MerchantAccessError);
  assert.ok(revoked.calls.includes('ROLLBACK'));
  assert.ok(!revoked.calls.includes('UPDATE_MERCHANT'));
});

test('merchant profile locks the account before the merchant and membership lookup', async () => {
  const db = fakeDatabase();
  const lifecycle = { assertActive: async () => { db.calls.push('LOCK_ACCOUNT'); } } as unknown as PostgresAccountLifecycle;
  const profile = new PostgresMerchantProfileService(db.pool, { accountLifecycle: lifecycle });
  await profile.updateProfile({ accountId: 'owner', merchantId: 'store', body: valid });
  assert.deepEqual(db.calls.slice(0, 4), ['BEGIN', 'LOCK_ACCOUNT', 'LOCK_MERCHANT', 'READ_MEMBER']);
});
