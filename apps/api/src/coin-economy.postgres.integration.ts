import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Pool } from 'pg';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresBadgeRewardService } from './postgres/badge-rewards.js';
import { PostgresCoinEconomyService } from './postgres/coin-economy.js';
import { PostgresCollectionReader } from './postgres/collection.js';
import { PostgresCustomerIdentityService } from './postgres/customer-identity.js';
import { PostgresMileageShopService } from './postgres/mileage-shop.js';
import { PostgresMintRequestService } from './postgres/mint-request-service.js';
import { PostgresReversalService } from './postgres/reversal.js';
import { PostgresStoreTicketService } from './postgres/store-tickets.js';
import { runMigrations } from './postgres/migrate.js';
import type { PublishCoinPoolInput } from './coin-economy.js';

const date = (day: number) => `2026-10-${String(day).padStart(2,'0')}T00:00:00.000Z`;
const consent = { benefit:true, ownerPaysCost:true, validity:true, issuanceCap:true, duplicateUse:true } as const;

async function setup(t: TestContext) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE account_deletion_requests, customer_identity_tokens, platform_admins, auth_identities, mileage_credits, mileage_spends, coin_reroll_tickets, merchants CASCADE');
  const state = { now: new Date(date(7)) };
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'coin-economy-integration-hmac-secret-at-least-32-bytes' });
  const coin = new PostgresCoinEconomyService(pool, { accountLifecycle: lifecycle, now: () => state.now, randomInt: () => 0 });
  const shop = new PostgresMileageShopService(pool, { accountLifecycle: lifecycle, now: () => state.now, randomInt: () => 0 });
  const badges = new PostgresBadgeRewardService(pool, { accountLifecycle: lifecycle, now: () => state.now });
  const identities = new PostgresCustomerIdentityService(pool, { accountLifecycle: lifecycle, now: () => state.now });
  await pool.query(`INSERT INTO auth_identities(provider,subject,account_id,created_at)
    VALUES ('google',$1,'coin-admin',now())`, [`coin-admin-${randomUUID()}`]);
  await pool.query("INSERT INTO platform_admins(account_id) VALUES ('coin-admin')");
  for (const merchant of ['coin-a','coin-b']) {
    await pool.query(`INSERT INTO merchants(id,name,story,road_address,minimum_spend_won,status,is_demo)
      VALUES ($1,$1,'','서울',0,'ACTIVE',false)`, [merchant]);
    await pool.query(`INSERT INTO campaigns(id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
      VALUES ($1,$2,'시험', $3,$4,'ACTIVE',true,10)`, [`campaign-${merchant}`,merchant,date(1),date(20)]);
  }
  const makePublication = async (merchant: string) => {
    const project = randomUUID(); const publication = randomUUID();
    await pool.query('INSERT INTO collectible_projects(id,merchant_id,lineage_id) VALUES ($1,$2,$1)',[project,merchant]);
    await pool.query(`INSERT INTO collectible_publications(id,project_id,merchant_id,campaign_id,project_version,reward_grades)
      VALUES ($1,$2,$3,$4,1,'{"1":"bronze"}'::jsonb)`,[publication,project,merchant,`campaign-${merchant}`]);
    await pool.query('INSERT INTO campaign_collectible_publications(campaign_id,publication_id) VALUES ($1,$2)',
      [`campaign-${merchant}`,publication]);
    for (const grade of ['bronze','silver','gold','prism']) {
      await pool.query(`INSERT INTO collectible_publication_grades(publication_id,grade_id,summary,detail)
        VALUES ($1,$2,$3::jsonb,$4::jsonb)`,[publication,grade,
          JSON.stringify({ name: `${merchant} ${grade}`, gradeId: grade }),
          JSON.stringify({ imageDataUrl: `data:image/png;base64,${grade}`, backImageDataUrl: `data:image/png;base64,back-${grade}` })]);
    }
    return publication;
  };
  const publicationA = await makePublication('coin-a');
  const publicationB = await makePublication('coin-b');
  await pool.query(`INSERT INTO mileage_credits(id,account_id,amount,reason,source_id,business_date)
    VALUES ($1,'coin-customer',500,'DRAW_BONUS','test-credit','2026-10-07')`,[randomUUID()]);
  return { pool, coin, shop, badges, identities, state, publicationA, publicationB };
}

// 이미 발행된 부분등급 풀은 보존한다. 신규 publishPool은 4등급만 받는다.
async function legacyPool(db: Awaited<ReturnType<typeof setup>>, input: PublishCoinPoolInput) {
  const id = randomUUID();
  await db.pool.query(`INSERT INTO coin_pools
    (id,merchant_id,event_name,grade,price,purchase_starts_at,purchase_ends_at,use_expires_at,per_account_limit,issuance_cap)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,input.merchantId,input.eventName,input.grade,input.price,
    input.purchaseStartsAt,input.purchaseEndsAt,input.useExpiresAt,input.perAccountLimit,input.issuanceCap]);
  for (const entry of input.entries) await db.pool.query(`INSERT INTO coin_pool_entries(pool_id,publication_id,grade_id,weight)
    VALUES ($1,$2,$3,$4)`, [id,entry.publicationId,entry.gradeId,entry.weight]);
  return { id, entries: [] };
}

test('new partial-grade pools are rejected while stored legacy custom odds match the draw', async t => {
  const db = await setup(t);
  const input = { actorAccountId: 'coin-admin', merchantId: 'coin-a', eventName: '기존 맞춤 등급',
    grade: 'BRONZE' as const, price: 1, purchaseStartsAt: date(6), purchaseEndsAt: date(10),
    useExpiresAt: date(20), perAccountLimit: 2, issuanceCap: 2,
    entries: [{ publicationId: db.publicationA, gradeId: 'bronze', weight: 1 }] };
  const before = (await db.pool.query<{ n: number }>(
    "SELECT count(*)::integer AS n FROM coin_pools WHERE merchant_id = 'coin-a'")).rows[0]!.n;
  await assert.rejects(db.coin.publishPool(input), { code: 'INVALID_REQUEST' });
  assert.equal((await db.pool.query<{ n: number }>(
    "SELECT count(*)::integer AS n FROM coin_pools WHERE merchant_id = 'coin-a'")).rows[0]?.n, before);
  await db.pool.query(`INSERT INTO collectible_publication_grades(publication_id,grade_id,summary,detail)
    VALUES ($1,'a-custom','{"name":"맞춤"}'::jsonb,'{}'::jsonb)`, [db.publicationA]);
  const legacy = await legacyPool(db, { ...input, entries: [
    { publicationId: db.publicationA, gradeId: 'a-custom', weight: 1 }, ...input.entries] });
  const ticket = await db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    poolId: legacy.id, requestId: 'legacy-custom' });
  assert.equal(ticket.ticket.expiresAt, date(14));
  assert.deepEqual((await db.coin.getShop('coin-customer')).pools.find(pool => pool.id === legacy.id)?.entries
    .map(entry => [entry.gradeId, entry.probability]), [['a-custom', .5], ['bronze', .5]]);
  assert.equal((await db.coin.useTicket({ accountId: 'coin-customer', ticketId: ticket.ticket.id })).coin.gradeId,
    'a-custom');
});

test('scoped ticket purchase is idempotent, capped, expires, and draws duplicate quantities', async t => {
  const db = await setup(t);
  const args = {
    actorAccountId: 'coin-admin', merchantId: 'coin-a', eventName: '시험 축제', grade: 'SILVER' as const,
    price: 50, purchaseStartsAt: date(6), purchaseEndsAt: date(10), useExpiresAt: date(12),
    perAccountLimit: 2, issuanceCap: 2,
    entries: [{ publicationId: db.publicationA, gradeId: 'bronze', weight: 1 }],
  };
  await assert.rejects(db.coin.publishPool({ ...args, entries: [{ publicationId: db.publicationB, gradeId: 'bronze', weight: 1 }] }),
    { code: 'COIN_PUBLICATION_UNAVAILABLE' });
  const pool = await legacyPool(db,args);
  assert.deepEqual(pool.entries, []);
  const first = await db.coin.purchase({ accountId: 'coin-customer', poolId: pool.id, requestId: 'first' });
  assert.equal((await db.coin.getShop('coin-customer')).pools.find(item => item.id === pool.id)?.entries[0]?.probability, 1);
  assert.equal(first.balance, 450);
  const replay = await db.coin.purchase({ accountId: 'coin-customer', poolId: pool.id, requestId: 'first' });
  assert.equal(replay.ticket.id, first.ticket.id);
  assert.equal(replay.replayed, true);
  assert.equal((await db.shop.getShop('coin-customer')).mileage.balance, 450);
  const second = await db.coin.purchase({ accountId: 'coin-customer', poolId: pool.id, requestId: 'second' });
  await assert.rejects(db.coin.purchase({ accountId: 'other', poolId: pool.id, requestId: 'third' }),
    { code: 'COIN_POOL_LIMIT_REACHED' });
  await db.coin.pausePool({ actorAccountId:'coin-admin', poolId:pool.id });
  const drawn = await db.coin.useTicket({ accountId: 'coin-customer', ticketId: first.ticket.id });
  assert.equal(drawn.coin.quantity, 1);
  const twice = await db.coin.useTicket({ accountId: 'coin-customer', ticketId: second.ticket.id });
  assert.equal(twice.coin.quantity, 2);
  assert.equal((await db.coin.useTicket({ accountId: 'coin-customer', ticketId: first.ticket.id })).replayed, true);
  db.state.now = new Date(date(13));
  assert.equal((await db.coin.getShop('coin-customer')).tickets.length, 2);
  assert.equal((await db.coin.getCollection('coin-customer')).coins[0]?.quantity, 2);
  await assert.rejects(db.coin.purchase({ accountId: 'coin-customer', poolId: pool.id, requestId: 'late' }),
    { code: 'COIN_POOL_EXPIRED' });
});

test('shared mascot bag serializes customers, hides odds after the last ticket, and refills on prism', async t => {
  const db = await setup(t);
  const pool = await db.coin.publishPool({ actorAccountId: 'coin-admin', merchantId: 'coin-a',
    eventName: '공유 마스코트', grade: 'BRONZE', price: 1, purchaseStartsAt: date(6),
    purchaseEndsAt: date(17), useExpiresAt: date(20), perAccountLimit: 3, issuanceCap: 10,
    entries: ['bronze','silver','gold','prism'].map(gradeId => ({
      publicationId: db.publicationA, gradeId, weight: 1 })) });
  assert.equal(pool.remaining, undefined);
  assert.deepEqual(pool.entries, []);
  const first = await db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    poolId: pool.id, requestId: 'bag-first' });
  const second = await db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'other',
    poolId: pool.id, requestId: 'bag-second' });
  assert.equal(first.ticket.expiresAt, date(14));
  assert.equal((await db.coin.getShop('other')).pools.find(item => item.id === pool.id)?.remaining, 100);
  assert.equal((await db.coin.getShop('other')).pools.find(item => item.id === pool.id)?.entries[0]?.probability, .5);
  const results = await Promise.all([
    db.coin.useTicket({ accountId: 'coin-customer', ticketId: first.ticket.id }),
    db.coin.useTicket({ accountId: 'other', ticketId: second.ticket.id }),
  ]);
  assert.deepEqual(results.map(result => result.coin.gradeId), ['bronze','bronze']);
  assert.equal((await db.coin.getOwnedCoinDetail('coin-customer', db.publicationA, 'bronze')).backImageDataUrl,
    'data:image/png;base64,back-bronze');
  await assert.rejects(db.coin.getOwnedCoinDetail('coin-customer', db.publicationA, 'gold'),
    { code: 'COIN_OWNED_DETAIL_NOT_FOUND' });
  assert.deepEqual((await db.coin.getShop('other')).pools.find(item => item.id === pool.id)?.entries, []);
  const hiddenReroll = (await db.coin.getCollection('other')).reroll.options.find(option =>
    option.poolId === pool.id && option.grade === 'NORMAL');
  assert.ok(hiddenReroll);
  assert.deepEqual(hiddenReroll.entries, []);
  assert.equal(hiddenReroll.oddsExpiresAt, undefined);
  const bag = await db.pool.query<{ bronze_remaining: number; cycle: number }>(
    'SELECT bronze_remaining,cycle FROM coin_shared_bags WHERE pool_id = $1', [pool.id]);
  assert.equal(bag.rows[0]?.bronze_remaining, 48);
  const third = await db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'other',
    poolId: pool.id, requestId: 'bag-third' });
  assert.equal((await db.coin.getShop('other')).pools.find(item => item.id === pool.id)?.entries[0]?.probability, 48 / 98);
  assert.equal((await db.coin.getCollection('other')).reroll.options.find(option =>
    option.poolId === pool.id && option.grade === 'NORMAL')?.oddsExpiresAt, date(14));
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'coin-economy-integration-hmac-secret-at-least-32-bytes' });
  const prismPicker = new PostgresCoinEconomyService(db.pool, { accountLifecycle: lifecycle,
    now: () => db.state.now, randomInt: bound => bound - 1 });
  const prism = await prismPicker.useTicket({ accountId: 'other', ticketId: third.ticket.id });
  assert.equal(prism.coin.gradeId, 'prism');
  assert.equal((await prismPicker.useTicket({ accountId: 'other', ticketId: third.ticket.id })).replayed, true);
  const refilled = await db.pool.query<{ bronze_remaining: number; silver_remaining: number;
    gold_remaining: number; prism_remaining: number; cycle: number }>(
    `SELECT bronze_remaining,silver_remaining,gold_remaining,prism_remaining,cycle
      FROM coin_shared_bags WHERE pool_id = $1`, [pool.id]);
  assert.deepEqual(refilled.rows[0], { bronze_remaining: 50, silver_remaining: 35,
    gold_remaining: 14, prism_remaining: 1, cycle: 2 });
  const goldTicket = await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin',
    accountId: 'other', grade: 'GOLD', requestId: 'gold-reroll' });
  assert.deepEqual((await db.coin.getCollection('other')).reroll.options.find(option =>
    option.poolId === pool.id && option.grade === 'GOLD')?.entries, []);
  const rerollInput = { accountId: 'other', ticketId: goldTicket.ticket.id, poolId: pool.id,
    sourceKind: 'STORE_DRAW' as const, sourceId: third.ticket.id, requestId: 'gold-reroll-use' };
  const gold = await db.coin.useRerollTicket(rerollInput);
  assert.equal(gold.coin.gradeId, 'gold');
  await assert.rejects(db.coin.getOwnedCoinDetail('other', db.publicationA, 'prism'),
    { code: 'COIN_OWNED_DETAIL_NOT_FOUND' });
  assert.equal((await db.coin.getOwnedCoinDetail('other', db.publicationA, 'gold')).imageDataUrl,
    'data:image/png;base64,gold');
  assert.equal((await db.coin.useRerollTicket(rerollInput)).replayed, true);
  assert.equal((await db.pool.query<{ gold_remaining: number }>(
    'SELECT gold_remaining FROM coin_shared_bags WHERE pool_id = $1', [pool.id])).rows[0]?.gold_remaining, 13);
  const fourth = await db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'other',
    poolId: pool.id, requestId: 'bag-fourth' });
  db.state.now = new Date(date(14));
  assert.equal((await db.coin.getShop('other')).tickets.find(ticket => ticket.id === fourth.ticket.id)?.status, 'EXPIRED');
  assert.deepEqual((await db.coin.getShop('other')).pools.find(item => item.id === pool.id)?.entries, []);
  await assert.rejects(db.coin.useTicket({ accountId: 'other', ticketId: fourth.ticket.id }),
    { code: 'COIN_TICKET_EXPIRED' });
  assert.equal((await db.pool.query<{ cycle: number }>(
    'SELECT cycle FROM coin_shared_bags WHERE pool_id = $1', [pool.id])).rows[0]?.cycle, 2);
  const publishAgain = { actorAccountId: 'coin-admin', merchantId: 'coin-a',
    eventName: '다음 공유 풀', grade: 'BRONZE' as const, price: 1, purchaseStartsAt: date(6),
    purchaseEndsAt: date(17), useExpiresAt: date(20), perAccountLimit: 1, issuanceCap: 1,
    entries: ['bronze','silver','gold','prism'].map(gradeId => ({ publicationId: db.publicationA, gradeId, weight: 1 })) };
  await assert.rejects(db.coin.publishPool(publishAgain), { code: 'COIN_POOL_UNAVAILABLE' });
  const pending = await db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    poolId: pool.id, requestId: 'paused-pending' });
  await db.coin.pausePool({ actorAccountId: 'coin-admin', poolId: pool.id });
  assert.equal((await db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    poolId: pool.id, requestId: 'paused-pending' })).replayed, true);
  await assert.rejects(db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    poolId: pool.id, requestId: 'paused-new' }), { code: 'COIN_POOL_UNAVAILABLE' });
  await assert.rejects(db.coin.publishPool(publishAgain), { code: 'COIN_POOL_UNAVAILABLE' });
  await db.coin.useTicket({ accountId: 'coin-customer', ticketId: pending.ticket.id });
  const contenders = await Promise.allSettled([db.coin.publishPool(publishAgain),
    db.coin.publishPool({ ...publishAgain, eventName: '동시 발행' })]);
  assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(contenders.filter(result => result.status === 'rejected').length, 1);
  await assert.rejects(db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    poolId: pool.id, requestId: 'superseded-new' }), { code: 'COIN_POOL_UNAVAILABLE' });
});

test('reroll consumes one owned instance and one separate ticket atomically, then replays the persisted result', async t => {
  const db = await setup(t);
  const pool = await legacyPool(db,{ actorAccountId: 'coin-admin', merchantId: 'coin-a',
    eventName: '등급 풀', grade: 'SILVER', price: 1, purchaseStartsAt: date(6), purchaseEndsAt: date(10),
    useExpiresAt: date(12), perAccountLimit: 3, issuanceCap: 3,
    entries: [{ publicationId: db.publicationA, gradeId: 'bronze', weight: 3 },
      { publicationId: db.publicationA, gradeId: 'prism', weight: 1 }] });
  const storeTicket = await db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    poolId: pool.id, requestId: 'original-draw' });
  await db.coin.useTicket({ accountId: 'coin-customer', ticketId: storeTicket.ticket.id });
  await db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    poolId: pool.id, requestId: 'odds-holder' });
  assert.equal((await db.coin.getCollection('coin-customer')).reroll.tickets.length, 0);
  const normal = await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    grade: 'NORMAL', requestId: 'normal-grant' });
  assert.equal((await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    grade: 'NORMAL', requestId: 'normal-grant' })).replayed, true);
  const before = await db.coin.getCollection('coin-customer');
  assert.deepEqual(before.reroll.options.find(option => option.grade === 'NORMAL')?.entries.map(entry => entry.probability), [.75, .25]);
  assert.deepEqual(before.reroll.options.find(option => option.grade === 'SILVER')?.entries.map(entry => entry.gradeId), ['prism']);
  const input = { accountId: 'coin-customer', ticketId: normal.ticket.id, poolId: pool.id,
    sourceKind: 'STORE_DRAW' as const, sourceId: storeTicket.ticket.id, requestId: 'reroll-once' };
  await db.pool.query(`INSERT INTO collection_experience_profiles(account_id,coin_source_kind,coin_source_id)
    VALUES ('coin-customer','STORE_DRAW',$1)`, [storeTicket.ticket.id]);
  const result = await db.coin.useRerollTicket(input);
  assert.equal(result.spent.sourceId, storeTicket.ticket.id);
  assert.equal(result.coin.gradeId, 'bronze'); // 같은 코인 재획득 허용
  assert.equal(result.coin.quantity, 1);
  assert.equal(result.coin.rerollQuantity, 1);
  const representative = await db.pool.query<{ coin_source_id: string | null }>(
    'SELECT coin_source_id FROM collection_experience_profiles WHERE account_id = $1', ['coin-customer']);
  assert.equal(representative.rows[0]?.coin_source_id, null);
  const replay = await db.coin.useRerollTicket(input);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.coin, result.coin);
  const after = await db.coin.getCollection('coin-customer');
  assert.equal(after.coins[0]?.quantity, 1);
  assert.equal(after.coins[0]?.drawQuantity, 0);
  assert.equal(after.coins[0]?.rerollQuantity, 1);
  assert.equal(after.reroll.sources[0]?.sourceKind, 'REROLL');
  assert.equal((await db.pool.query('SELECT 1 FROM coin_reroll_consumptions WHERE source_id = $1',
    [storeTicket.ticket.id])).rowCount, 1);
  const silver = await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    grade: 'SILVER', requestId: 'silver-grant' });
  const upgraded = await db.coin.useRerollTicket({ ...input, ticketId: silver.ticket.id,
    sourceKind: 'REROLL', sourceId: result.rerollId, requestId: 'silver-use' });
  assert.equal(upgraded.coin.gradeId, 'prism');
  assert.equal((await db.coin.getCollection('coin-customer')).coins.find(coin => coin.gradeId === 'bronze'), undefined);
  const downgradeTicket = await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    grade: 'NORMAL', requestId: 'downgrade-ticket' });
  const downgraded = await db.coin.useRerollTicket({ ...input, ticketId: downgradeTicket.ticket.id,
    sourceKind: 'REROLL', sourceId: upgraded.rerollId, requestId: 'downgrade-use' });
  assert.equal(downgraded.coin.gradeId, 'bronze');
  await assert.rejects(db.coin.useRerollTicket({ ...input, ticketId: silver.ticket.id, requestId: 'new-key' }),
    { code: 'COIN_REROLL_TICKET_USED' });
  await db.pool.query('SELECT * FROM collectible_remove_publication_media($1)', [db.publicationA]);
  const redacted = await db.coin.useRerollTicket({ ...input, ticketId: downgradeTicket.ticket.id,
    sourceKind: 'REROLL', sourceId: upgraded.rerollId, requestId: 'downgrade-use' });
  assert.deepEqual(redacted.coin.summary, { name: '공개가 중단된 코인', mediaRemoved: true });
});

test('concurrent rerolls cannot spend the same source twice or spend another account source', async t => {
  const db = await setup(t);
  const pool = await legacyPool(db,{ actorAccountId: 'coin-admin', merchantId: 'coin-a',
    eventName: '동시성 풀', grade: 'BRONZE', price: 1, purchaseStartsAt: date(6), purchaseEndsAt: date(10),
    useExpiresAt: date(12), perAccountLimit: 1, issuanceCap: 1,
    entries: [{ publicationId: db.publicationA, gradeId: 'bronze', weight: 1 }] });
  const drawn = await db.coin.grantTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    poolId: pool.id, requestId: 'source' });
  await db.coin.useTicket({ accountId: 'coin-customer', ticketId: drawn.ticket.id });
  const first = await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    grade: 'NORMAL', requestId: 'first-reroll-ticket' });
  const second = await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    grade: 'NORMAL', requestId: 'second-reroll-ticket' });
  const base = { accountId: 'coin-customer', poolId: pool.id, sourceKind: 'STORE_DRAW' as const,
    sourceId: drawn.ticket.id };
  const attempts = await Promise.allSettled([
    db.coin.useRerollTicket({ ...base, ticketId: first.ticket.id, requestId: 'first-use' }),
    db.coin.useRerollTicket({ ...base, ticketId: second.ticket.id, requestId: 'second-use' }),
  ]);
  assert.deepEqual(attempts.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  assert.equal((await db.pool.query('SELECT 1 FROM coin_rerolls WHERE account_id = $1',
    ['coin-customer'])).rowCount, 1);
  assert.equal((await db.coin.getCollection('coin-customer')).coins[0]?.quantity, 1);
  const other = await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin', accountId: 'other',
    grade: 'NORMAL', requestId: 'other-ticket' });
  await assert.rejects(db.coin.useRerollTicket({ accountId: 'other', ticketId: other.ticket.id,
    poolId: pool.id, sourceKind: 'STORE_DRAW', sourceId: drawn.ticket.id, requestId: 'steal' }),
  { code: 'COIN_REROLL_SOURCE_NOT_FOUND' });
});

test('NFT-locked visits cannot reroll and canceled visits revoke chained rerolls', async t => {
  const db = await setup(t);
  await db.pool.query(`INSERT INTO merchant_members(merchant_id,account_id,role,status)
    VALUES ('coin-a','coin-staff','STAFF','ACTIVE')`);
  await db.pool.query(`INSERT INTO campaign_goals(campaign_id,target_visit_count,display_name)
    VALUES ('campaign-coin-a',1,'첫 방문')`);
  const claim = randomUUID(); const visit = randomUUID(); const entitlement = randomUUID();
  await db.pool.query(`INSERT INTO claim_slots(id,merchant_id,customer_account_id,merchant_reference_hash,
    created_by_account_id,token_hash,status,expires_at,claimed_at,created_at)
    VALUES ($1,'coin-a','coin-customer',decode(repeat('a1',32),'hex'),'coin-staff',
      decode(repeat('b1',32),'hex'),'CLAIMED',$2,$3,$3)`, [claim, date(8), date(7)]);
  await db.pool.query(`INSERT INTO visit_events(id,claim_slot_id,merchant_id,campaign_id,customer_account_id,
    occurred_at,business_date,verification_level,status,progress_counted)
    VALUES ($1,$2,'coin-a','campaign-coin-a','coin-customer',$3,'2026-10-07',
      'MERCHANT_CONFIRMED','VALID',true)`, [visit, claim, date(7)]);
  await db.pool.query(`INSERT INTO reward_entitlements(id,customer_account_id,campaign_id,target_visit_count,
    source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
    VALUES ($1,'coin-customer','campaign-coin-a',1,$2,'GRANTED','test',$3,$4)`,
  [entitlement, visit, date(7), date(12)]);
  assert.equal((await db.pool.query('SELECT 1 FROM collectible_acquisitions WHERE entitlement_id = $1',
    [entitlement])).rowCount, 1);
  const pool = await legacyPool(db,{ actorAccountId: 'coin-admin', merchantId: 'coin-a',
    eventName: 'NFT 보호', grade: 'BRONZE', price: 1, purchaseStartsAt: date(6), purchaseEndsAt: date(10),
    useExpiresAt: date(12), perAccountLimit: 1, issuanceCap: 1,
    entries: [{ publicationId: db.publicationA, gradeId: 'bronze', weight: 1 }] });
  const ticket = await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    grade: 'NORMAL', requestId: 'nft-guard-ticket' });
  const input = { accountId: 'coin-customer', ticketId: ticket.ticket.id, poolId: pool.id,
    sourceKind: 'VISIT' as const, sourceId: entitlement, requestId: 'nft-guard-use' };
  for (const status of ['MINT_REQUESTED','FULFILLED'] as const) {
    await db.pool.query('UPDATE reward_entitlements SET status = $2 WHERE id = $1', [entitlement, status]);
    await assert.rejects(db.coin.useRerollTicket(input), { code: 'COIN_REROLL_SOURCE_LOCKED' });
  }
  assert.equal((await db.pool.query('SELECT 1 FROM coin_rerolls WHERE ticket_id = $1',
    [ticket.ticket.id])).rowCount, 0);
  await db.pool.query('UPDATE reward_entitlements SET status = $2 WHERE id = $1', [entitlement, 'GRANTED']);
  const firstReroll = await db.coin.useRerollTicket(input);
  const collection = new PostgresCollectionReader(db.pool);
  const storeTickets = new PostgresStoreTicketService(db.pool, collection,
    new PostgresAccountLifecycle({ hmacSecret: 'coin-economy-integration-hmac-secret-at-least-32-bytes' }));
  assert.deepEqual((await collection.getCollection('coin-customer')).collectibles, []);
  assert.deepEqual((await storeTickets.list('coin-customer')).tickets, []);
  await assert.rejects(storeTickets.open({ accountId: 'coin-customer', entitlementId: entitlement }),
    { code: 'STORE_TICKET_NOT_FOUND' });
  await db.pool.query(`INSERT INTO nft_series(id,campaign_id,target_visit_count,chain_id,contract_address,
    contract_address_normalized,series_key,max_ever_minted,status)
    VALUES ('s-0000000000000000000000000000c001','campaign-coin-a',1,84532,
      '0x7000000000000000000000000000000000000007',
      '0x7000000000000000000000000000000000000007',
      decode(repeat('44',32),'hex'),10,'ACTIVE')`);
  const mint = new PostgresMintRequestService(db.pool, { accountLifecycle: new PostgresAccountLifecycle({
    hmacSecret: 'coin-economy-integration-hmac-secret-at-least-32-bytes' }),
    now: () => db.state.now, supportedConsentVersion: 'nft-mint-v2' });
  await assert.rejects(mint.requestMint({ accountId: 'coin-customer', entitlementId: entitlement,
    walletBindingId: randomUUID(), bindingVersion: 1, consentVersion: 'nft-mint-v2',
    idempotencyKey: 'spent-visit-mint' }), { code: 'ENTITLEMENT_NOT_MINTABLE' });
  const secondTicket = await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    grade: 'NORMAL', requestId: 'visit-chain-ticket' });
  const secondReroll = await db.coin.useRerollTicket({ accountId: 'coin-customer',
    ticketId: secondTicket.ticket.id, poolId: pool.id, sourceKind: 'REROLL',
    sourceId: firstReroll.rerollId, requestId: 'visit-chain-use' });
  const series = await db.coin.publishSeries({ actorAccountId: 'coin-admin', merchantId: 'coin-a',
    title: '철회 시리즈', endsAt: date(20),
    baseCoins: [{ publicationId: db.publicationA, gradeId: 'bronze' }],
    prismCoins: [{ publicationId: db.publicationA, gradeId: 'prism' }],
    baseCoupon: { title: '기본', detail: '시험', validDays: 7, issuanceCap: 2 },
    prismCoupon: { title: '프리즘', detail: '시험', validDays: 7, issuanceCap: 2 },
    consentDocumentRef: 'consent-visit-reversal', consent });
  const claimed = await db.coin.claimSeries({ accountId: 'coin-customer', seriesId: series.id });
  assert.equal(claimed.series.coupon?.status, 'ISSUED');
  await db.pool.query(`UPDATE coin_series_coupons SET redeemed_at=$2,redeemed_by_account_id='coin-staff'
    WHERE id=$1`, [claimed.series.coupon!.id, db.state.now]);
  const reversal = new PostgresReversalService(db.pool, {
    now: () => db.state.now, labelHmacSecret: 'coin-economy-reversal-label-secret-at-least-32-bytes',
    accountLifecycle: new PostgresAccountLifecycle({ hmacSecret: 'coin-economy-integration-hmac-secret-at-least-32-bytes' }),
  });
  const cancelInput = { merchantId: 'coin-a', staffAccountId: 'coin-staff', visitEventId: visit,
    reason: 'WRONG_CUSTOMER' };
  await assert.rejects(reversal.cancelVisit(cancelInput), { code: 'VISIT_REWARD_COUPON_REDEEMED' });
  assert.equal((await db.coin.getCollection('coin-customer')).coins[0]?.quantity, 1);
  await db.pool.query(`UPDATE coin_series_coupons SET redeemed_at=NULL,redeemed_by_account_id=NULL WHERE id=$1`,
    [claimed.series.coupon!.id]);
  const canceled = await reversal.cancelVisit(cancelInput);
  assert.equal(canceled.revokedRewardCount, 1);
  assert.equal((await db.coin.getCollection('coin-customer')).coins.length, 0);
  assert.equal((await db.coin.getCollection('coin-customer')).series.find(row => row.id === series.id)?.coupon?.status, 'REVOKED');
  const identity = await db.identities.create('coin-customer');
  await assert.rejects(db.badges.redeemCoupon({ token: identity.token, merchantId: 'coin-a',
    staffAccountId: 'coin-staff', couponId: claimed.series.coupon!.id }), { code: 'COUPON_NOT_FOUND' });
  const revoked = await db.pool.query<{ id: string; revoked_by_visit_event_id: string }>(
    'SELECT id, revoked_by_visit_event_id FROM coin_rerolls WHERE account_id = $1 ORDER BY id', ['coin-customer']);
  assert.deepEqual(revoked.rows.map(row => row.id).sort(), [firstReroll.rerollId, secondReroll.rerollId].sort());
  assert.ok(revoked.rows.every(row => row.revoked_by_visit_event_id === visit));
  await assert.rejects(db.coin.useRerollTicket(input), { code: 'COIN_REROLL_RESULT_REVOKED' });
  const thirdTicket = await db.coin.grantRerollTicket({ actorAccountId: 'coin-admin', accountId: 'coin-customer',
    grade: 'NORMAL', requestId: 'visit-chain-third-ticket' });
  await assert.rejects(db.coin.useRerollTicket({ accountId: 'coin-customer', ticketId: thirdTicket.ticket.id,
    poolId: pool.id, sourceKind: 'REROLL', sourceId: secondReroll.rerollId, requestId: 'visit-chain-third-use' }),
  { code: 'COIN_REROLL_SOURCE_NOT_FOUND' });
});

test('global ticket cap survives concurrent purchases', async t => {
  const db = await setup(t);
  const pool = await legacyPool(db,{ actorAccountId:'coin-admin', merchantId:'coin-a',eventName:'한정',
    grade:'BRONZE',price:1,purchaseStartsAt:date(6),purchaseEndsAt:date(10),useExpiresAt:date(12),
    perAccountLimit:1,issuanceCap:1,entries:[{publicationId:db.publicationA,gradeId:'bronze',weight:1}] });
  for (const accountId of ['account-1','account-2']) {
    await db.pool.query(`INSERT INTO mileage_credits(id,account_id,amount,reason,source_id,business_date)
      VALUES ($1,$2,10,'DRAW_BONUS','test-credit','2026-10-07')`,[randomUUID(),accountId]);
  }
  const attempts = await Promise.allSettled(['account-1','account-2'].map(accountId =>
    db.coin.purchase({accountId,poolId:pool.id,requestId:accountId})));
  assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length,1);
  assert.equal(attempts.filter(attempt => attempt.status === 'rejected').length,1);
  const issued = await db.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM coin_tickets WHERE pool_id = $1',[pool.id]);
  assert.equal(issued.rows[0]?.n,1);
});

test('every live unused ticket remains visible past the history limit and expires before use', async t => {
  const db = await setup(t);
  const pools = [];
  for (let index = 0; index < 2; index++) pools.push(await legacyPool(db,{
    actorAccountId:'coin-admin',merchantId:'coin-a',eventName:`묶음 ${index}`,grade:'BRONZE',price:1,
    purchaseStartsAt:date(6),purchaseEndsAt:date(10),useExpiresAt:date(12),perAccountLimit:100,issuanceCap:100,
    entries:[{publicationId:db.publicationA,gradeId:'bronze',weight:1}],
  }));
  const ticketIds = Array.from({length:101},()=>randomUUID());
  await db.pool.query(`INSERT INTO coin_tickets(id,account_id,pool_id,request_id,source,price,acquired_at,expires_at)
    SELECT item.id::uuid,'coin-customer',CASE WHEN item.ordinality <= 100 THEN $2::uuid ELSE $3::uuid END,
      item.ordinality::text,'GRANT',0,$4::timestamptz,$5::timestamptz
    FROM unnest($1::text[]) WITH ORDINALITY AS item(id,ordinality)`,
    [ticketIds,pools[0]!.id,pools[1]!.id,date(7),date(12)]);
  const snapshot = await db.coin.getShop('coin-customer');
  assert.equal(snapshot.tickets.length,101);
  assert.equal(snapshot.pools.length,2);
  assert.equal(snapshot.tickets.find(ticket => ticket.id === ticketIds[0])?.status,'UNUSED');
  db.state.now = new Date(date(13));
  await assert.rejects(db.coin.useTicket({accountId:'coin-customer',ticketId:ticketIds[0]!}),
    {code:'COIN_TICKET_EXPIRED'});
  assert.equal((await db.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM coin_draws')).rows[0]?.n,0);
});

test('live issued coupons stay visible beyond the recent series limit', async t => {
  const db = await setup(t);
  const seriesIds = Array.from({length:101},()=>randomUUID());
  const couponIds = Array.from({length:101},()=>randomUUID());
  await db.pool.query(`INSERT INTO coin_series
    (id,merchant_id,title,ends_at,status,base_title,base_detail,base_valid_days,base_cap,
     prism_title,prism_detail,prism_valid_days,prism_cap,consent_document_ref)
    SELECT item.id::uuid,'coin-a','시험 시리즈',$2::timestamptz,'PAUSED','기본','',7,101,
      '프리즘','',7,101,'consent-qa-1' FROM unnest($1::text[]) AS item(id)`,[seriesIds,date(20)]);
  await db.pool.query(`INSERT INTO coin_series_coupons
    (id,account_id,series_id,merchant_id,tier,title,detail,issued_at,expires_at)
    SELECT item.coupon_id::uuid,'coin-customer',item.series_id::uuid,'coin-a','BASE','기본','',
      $3::timestamptz,$4::timestamptz
    FROM unnest($1::text[],$2::text[]) AS item(series_id,coupon_id)`,[seriesIds,couponIds,date(7),date(12)]);
  const collection = await db.coin.getCollection('coin-customer');
  assert.equal(collection.series.length,101);
  assert.equal(collection.series.find(series => series.id === seriesIds[0])?.coupon?.status,'ISSUED');
});

test('removed publication hides artwork while preserving owned count and ticket history', async t => {
  const db = await setup(t);
  const pool = await legacyPool(db,{actorAccountId:'coin-admin',merchantId:'coin-a',eventName:'한정',grade:'BRONZE',
    price:1,purchaseStartsAt:date(6),purchaseEndsAt:date(10),useExpiresAt:date(12),perAccountLimit:3,issuanceCap:3,
    entries:[{publicationId:db.publicationA,gradeId:'bronze',weight:1}]});
  const drawnTicket = await db.coin.grantTicket({actorAccountId:'coin-admin',accountId:'coin-customer',poolId:pool.id,requestId:'drawn'});
  await db.coin.useTicket({accountId:'coin-customer',ticketId:drawnTicket.ticket.id});
  const unusedTicket = await db.coin.grantTicket({actorAccountId:'coin-admin',accountId:'coin-customer',poolId:pool.id,requestId:'unused'});
  await db.pool.query('SELECT * FROM collectible_remove_publication_media($1)',[db.publicationA]);
  await assert.rejects(db.coin.getOwnedCoinDetail('coin-customer', db.publicationA, 'bronze'),
    { code: 'COIN_OWNED_DETAIL_NOT_FOUND' });
  const owned = (await db.coin.getCollection('coin-customer')).coins[0]!;
  assert.equal(owned.quantity,1);
  assert.deepEqual(owned.summary,{name:'공개가 중단된 코인',mediaRemoved:true});
  const visiblePool = (await db.coin.getShop('coin-customer')).pools[0]!;
  assert.equal(visiblePool.unavailableReason,'MEDIA_REMOVED');
  assert.deepEqual(visiblePool.entries[0]?.summary,{name:'공개가 중단된 코인',mediaRemoved:true});
  const replay = await db.coin.useTicket({accountId:'coin-customer',ticketId:drawnTicket.ticket.id});
  assert.equal(replay.replayed,true);
  assert.deepEqual(replay.coin.summary,{name:'공개가 중단된 코인',mediaRemoved:true});
  await assert.rejects(db.coin.useTicket({accountId:'coin-customer',ticketId:unusedTicket.ticket.id}),
    {code:'COIN_PUBLICATION_UNAVAILABLE'});
  await assert.rejects(db.coin.grantTicket({actorAccountId:'coin-admin',accountId:'coin-customer',poolId:pool.id,requestId:'new'}),
    {code:'COIN_PUBLICATION_UNAVAILABLE'});
});

test('series chooses prism once, preserves coins and enforces merchant consent and publication checks', async t => {
  const db = await setup(t);
  const base = [{ publicationId: db.publicationA, gradeId: 'bronze' }, { publicationId: db.publicationB, gradeId: 'bronze' }];
  const prism = [{ publicationId: db.publicationA, gradeId: 'prism' }, { publicationId: db.publicationB, gradeId: 'prism' }];
  await assert.rejects(db.coin.publishSeries({ actorAccountId:'coin-admin', merchantId:'coin-a',title:'시리즈',endsAt:date(20),
    baseCoins:base,prismCoins:prism,baseCoupon:{title:'기본',detail:'시험',validDays:7,issuanceCap:2},
    prismCoupon:{title:'프리즘',detail:'시험',validDays:7,issuanceCap:2},consentDocumentRef:'invalid@example.com',consent }),
  { code:'INVALID_REQUEST' });
  const series = await db.coin.publishSeries({ actorAccountId:'coin-admin', merchantId:'coin-a',title:'시리즈',endsAt:date(20),
    baseCoins:base,prismCoins:prism,baseCoupon:{title:'기본',detail:'시험',validDays:7,issuanceCap:2},
    prismCoupon:{title:'프리즘',detail:'시험',validDays:7,issuanceCap:2},consentDocumentRef:'consent-series-1',consent });
  for (const [merchant,publicationId] of [['coin-a',db.publicationA],['coin-b',db.publicationB]] as const) {
    for (const gradeId of ['bronze','prism']) {
      const pool = await legacyPool(db,{ actorAccountId:'coin-admin',merchantId:merchant,eventName:'시험',grade:'SILVER',
        price:1,purchaseStartsAt:date(6),purchaseEndsAt:date(10),useExpiresAt:date(12),perAccountLimit:1,issuanceCap:1,
        entries:[{publicationId,gradeId,weight:1}] });
      const ticket = await db.coin.grantTicket({ actorAccountId:'coin-admin',accountId:'coin-customer',poolId:pool.id,requestId:`${merchant}-${gradeId}` });
      await db.coin.useTicket({accountId:'coin-customer',ticketId:ticket.ticket.id});
    }
  }
  const progress = await db.coin.getCollection('coin-customer');
  assert.equal(progress.series[0]?.id,series.id);
  assert.equal(progress.series[0]?.claimable,'PRISM');
  const claim = await db.coin.claimSeries({accountId:'coin-customer',seriesId:series.id});
  assert.equal(claim.series.coupon?.tier,'PRISM');
  assert.equal((await db.coin.claimSeries({accountId:'coin-customer',seriesId:series.id})).replayed,true);
  assert.equal((await db.coin.getCollection('coin-customer')).coins.length,4);
  const count = await db.pool.query<{n:number}>('SELECT count(*)::integer AS n FROM coin_series_coupons WHERE account_id = $1',['coin-customer']);
  assert.equal(count.rows[0]?.n,1);
  const prismSoldOut = await db.coin.publishSeries({ actorAccountId:'coin-admin', merchantId:'coin-a',title:'프리즘 소진',endsAt:date(20),
    baseCoins:base,prismCoins:prism,baseCoupon:{title:'기본',detail:'시험',validDays:7,issuanceCap:2},
    prismCoupon:{title:'프리즘',detail:'시험',validDays:7,issuanceCap:1},consentDocumentRef:'consent-series-2',consent });
  await db.pool.query('UPDATE coin_series SET prism_issued = 1 WHERE id = $1',[prismSoldOut.id]);
  assert.equal((await db.coin.getCollection('coin-customer')).series.find(item => item.id === prismSoldOut.id)?.claimable,null);
  await assert.rejects(db.coin.claimSeries({accountId:'coin-customer',seriesId:prismSoldOut.id}),
    {code:'COIN_SERIES_CAP_REACHED'});
  await db.pool.query(`INSERT INTO merchant_members(merchant_id,account_id,role,status)
    VALUES ('coin-a','coin-staff','STAFF','ACTIVE')`);
  const identity = await db.identities.create('coin-customer');
  const staffInput = {token:identity.token,merchantId:'coin-a',staffAccountId:'coin-staff'};
  assert.equal((await db.badges.lookupCoupons(staffInput)).coupons[0]?.couponId,claim.series.coupon?.id);
  const redeemed = await db.badges.redeemCoupon({...staffInput,couponId:claim.series.coupon!.id});
  assert.equal(redeemed.replayed,false);
  assert.equal((await db.badges.redeemCoupon({...staffInput,couponId:claim.series.coupon!.id})).replayed,true);
  assert.equal((await db.coin.getCollection('coin-customer')).series.find(item => item.id === series.id)?.coupon?.status,'REDEEMED');
});
