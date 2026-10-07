import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Pool } from 'pg';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresBadgeRewardService } from './postgres/badge-rewards.js';
import { PostgresCoinEconomyService } from './postgres/coin-economy.js';
import { PostgresCustomerIdentityService } from './postgres/customer-identity.js';
import { PostgresMileageShopService } from './postgres/mileage-shop.js';
import { runMigrations } from './postgres/migrate.js';

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
  await pool.query('TRUNCATE account_deletion_requests, customer_identity_tokens, platform_admins, auth_identities, mileage_credits, mileage_spends, merchants CASCADE');
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
    for (const grade of ['bronze','prism']) {
      await pool.query(`INSERT INTO collectible_publication_grades(publication_id,grade_id,summary,detail)
        VALUES ($1,$2,$3::jsonb,'{}'::jsonb)`,[publication,grade,JSON.stringify({ name: `${merchant} ${grade}`, gradeId: grade })]);
    }
    return publication;
  };
  const publicationA = await makePublication('coin-a');
  const publicationB = await makePublication('coin-b');
  await pool.query(`INSERT INTO mileage_credits(id,account_id,amount,reason,source_id,business_date)
    VALUES ($1,'coin-customer',500,'DRAW_BONUS','test-credit','2026-10-07')`,[randomUUID()]);
  return { pool, coin, shop, badges, identities, state, publicationA, publicationB };
}

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
  const pool = await db.coin.publishPool(args);
  assert.equal(pool.entries[0]?.probability, 1);
  const first = await db.coin.purchase({ accountId: 'coin-customer', poolId: pool.id, requestId: 'first' });
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

test('global ticket cap survives concurrent purchases', async t => {
  const db = await setup(t);
  const pool = await db.coin.publishPool({ actorAccountId:'coin-admin', merchantId:'coin-a',eventName:'한정',
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
  for (let index = 0; index < 2; index++) pools.push(await db.coin.publishPool({
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
  const pool = await db.coin.publishPool({actorAccountId:'coin-admin',merchantId:'coin-a',eventName:'한정',grade:'BRONZE',
    price:1,purchaseStartsAt:date(6),purchaseEndsAt:date(10),useExpiresAt:date(12),perAccountLimit:3,issuanceCap:3,
    entries:[{publicationId:db.publicationA,gradeId:'bronze',weight:1}]});
  const drawnTicket = await db.coin.grantTicket({actorAccountId:'coin-admin',accountId:'coin-customer',poolId:pool.id,requestId:'drawn'});
  await db.coin.useTicket({accountId:'coin-customer',ticketId:drawnTicket.ticket.id});
  const unusedTicket = await db.coin.grantTicket({actorAccountId:'coin-admin',accountId:'coin-customer',poolId:pool.id,requestId:'unused'});
  await db.pool.query('SELECT * FROM collectible_remove_publication_media($1)',[db.publicationA]);
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
      const pool = await db.coin.publishPool({ actorAccountId:'coin-admin',merchantId:merchant,eventName:'시험',grade:'SILVER',
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
