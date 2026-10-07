import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Pool } from 'pg';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresCoinEconomyService } from './postgres/coin-economy.js';
import { PostgresCollectionExperienceService } from './postgres/collection-experience.js';
import { PostgresGradeDrawService } from './postgres/grade-draw.js';
import { runMigrations } from './postgres/migrate.js';

const now = new Date('2026-10-07T03:00:00.000Z');
const accountId = 'grade-draw-customer';

async function setup(t: TestContext) {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !decodeURIComponent(new URL(url).pathname).endsWith('_test')) {
    throw new Error('dedicated TEST_DATABASE_URL ending in _test is required');
  }
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(`TRUNCATE account_deletion_requests, grade_draws, coin_draws, coin_tickets, coin_pool_entries, coin_pools,
    collectible_acquisitions, collectible_publication_grades, campaign_collectible_publications,
    collectible_publications, collectible_projects, mileage_credits, mileage_spends,
    account_characters, account_profile, collection_experience_profiles,
    campaign_goals, campaigns, merchant_members, merchants CASCADE`);
  await pool.query(`INSERT INTO mileage_credits (id,account_id,amount,reason,source_id,business_date)
    VALUES ($1,$2,3000,'DRAW_BONUS','test-credit','2026-10-07')`, [randomUUID(), accountId]);
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'grade-draw-test-account-lifecycle-secret-32-bytes' });
  let selected = 0;
  const service = new PostgresGradeDrawService(pool, lifecycle, { now: () => now, randomInt: () => selected });
  const coinEconomy = new PostgresCoinEconomyService(pool, { accountLifecycle: lifecycle, now: () => now });
  const experience = new PostgresCollectionExperienceService(pool, lifecycle);
  return { pool, service, coinEconomy, experience, select: (index: number) => { selected = index; } };
}

async function publishCoin(pool: Pool) {
  const project = randomUUID(); const publication = randomUUID();
  await pool.query(`INSERT INTO merchants (id,name,story,road_address,minimum_spend_won,status,is_demo)
    VALUES ('grade-shop','시험 가게','story','road',0,'ACTIVE',true)`);
  await pool.query(`INSERT INTO campaigns (id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES ('grade-campaign','grade-shop','시험 캠페인','2026-01-01','2027-01-01','ACTIVE',true,10)`);
  await pool.query(`INSERT INTO campaign_goals (campaign_id,target_visit_count,display_name)
    VALUES ('grade-campaign',1,'첫 방문')`);
  await pool.query(`INSERT INTO collectible_projects (id,merchant_id,created_by_account_id,version,status,
    project,name,lineage_id) VALUES ($1,'grade-shop','staff',1,'DRAFT','{}','시험 코인',$1)`, [project]);
  await pool.query(`INSERT INTO collectible_publications (id,project_id,merchant_id,campaign_id,project_version,reward_grades)
    VALUES ($1,$2,'grade-shop','grade-campaign',1,'{"1":"bronze-coin"}')`, [publication, project]);
  await pool.query(`UPDATE collectible_projects SET status='PUBLISHED',publication_id=$2 WHERE id=$1`, [project, publication]);
  await pool.query(`INSERT INTO collectible_publication_grades (publication_id,grade_id,summary,detail)
    VALUES ($1,'bronze-coin',$2::jsonb,'{}')`, [publication, JSON.stringify({
      projectId: project, publicationId: publication, gradeId: 'bronze-coin', gradeName: '브론즈',
      shape: 'circle', theme: { name: '동네' }, name: '시험 코인', thumbnailDataUrl: 'data:image/png;base64,AA==',
    })]);
  await pool.query(`INSERT INTO campaign_collectible_publications (campaign_id,publication_id)
    VALUES ('grade-campaign',$1)`, [publication]);
  return publication;
}

test('one item per draw, repeats are counted, and coins/themes join existing ownership', async (t) => {
  const { pool, service, coinEconomy, experience, select } = await setup(t);
  const publicationId = await publishCoin(pool);
  const bronze = (await service.getShop(accountId)).pools[0]!;
  assert.equal(bronze.total, 7);
  assert.deepEqual(bronze.counts, { CHARACTER: 3, THEME: 3, COIN: 1 });
  assert.equal(bronze.probabilityPerItem, 1 / 7);
  const draw = (requestId: string) => service.draw({ accountId, grade: 'BRONZE', requestId,
    expectedPoolVersion: bronze.version });

  select(0);
  const first = await draw('character-1'); const again = await draw('character-2');
  assert.equal(first.reward.kind, 'CHARACTER');
  assert.deepEqual([first.duplicate, first.quantity, again.duplicate, again.quantity], [false, 1, true, 2]);
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM account_characters WHERE account_id=$1`,
    [accountId])).rows[0].n, 1);
  assert.deepEqual((await draw('character-2')).replayed, true);
  assert.deepEqual((await draw('character-2')).balance, again.balance);
  await assert.rejects(service.draw({ accountId, grade: 'SILVER', requestId: 'character-2',
    expectedPoolVersion: bronze.version }), { code: 'DRAW_REQUEST_CONFLICT' });

  select(3);
  const theme = await draw('theme-1');
  assert.equal(theme.reward.kind, 'THEME');
  assert.equal((await experience.getSnapshot(accountId)).progress.cosmetics
    .find((item) => item.id === theme.reward.id)?.equippable, true);
  assert.equal((await experience.setEquipment({ accountId, cosmetics: { hat: theme.reward.id } }))
    .profile.cosmetics.hat, theme.reward.id);

  select(6);
  const coin = await draw('coin-1'); const repeatCoin = await draw('coin-2');
  assert.equal(coin.reward.kind, 'COIN');
  assert.equal(coin.reward.kind === 'COIN' && coin.reward.publicationId, publicationId);
  assert.deepEqual([coin.duplicate, coin.quantity, repeatCoin.duplicate, repeatCoin.quantity], [false, 1, true, 2]);
  const owned = (await coinEconomy.getCollection(accountId)).coins.find((item) => item.publicationId === publicationId)!;
  assert.equal(owned.quantity, 2);
  assert.equal(owned.drawQuantity, 2);
  assert.equal((await service.getShop(accountId)).balance, 2500);

  await pool.query(`UPDATE campaigns SET status='PAUSED' WHERE id='grade-campaign'`);
  const changed = (await service.getShop(accountId)).pools[0]!;
  assert.equal(changed.total, 6);
  await assert.rejects(draw('stale-pool'), { code: 'DRAW_STATE_CHANGED' });
  assert.equal((await service.getShop(accountId)).balance, 2500);

  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'grade-draw-test-account-lifecycle-secret-32-bytes', policyVersion: 'test', now: () => now,
  });
  await deletion.requestDeletion({ accountId, confirmation: 'DELETE MY ACCOUNT' });
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM grade_draws WHERE account_id=$1', [accountId])).rows[0].n, 0);
});

test('parallel requests serialize the balance and media withdrawal redacts history', async (t) => {
  const { pool, service, select } = await setup(t);
  const publicationId = await publishCoin(pool);
  await pool.query(`UPDATE mileage_credits SET amount=100 WHERE account_id=$1`, [accountId]);
  const poolVersion = (await service.getShop(accountId)).pools[0]!.version;
  select(6);
  const results = await Promise.allSettled(['one', 'two'].map((requestId) => service.draw({ accountId,
    grade: 'BRONZE', requestId, expectedPoolVersion: poolVersion })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' &&
    result.reason?.code === 'DRAW_INSUFFICIENT_MILEAGE').length, 1);
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM grade_draws WHERE account_id=$1`,
    [accountId])).rows[0].n, 1);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('masscom.collectible_media_removal','on',true)`);
    await client.query(`DELETE FROM campaign_collectible_publications WHERE publication_id=$1`, [publicationId]);
    await client.query(`UPDATE collectible_publications SET media_removed_at=now() WHERE id=$1`, [publicationId]);
    await client.query(`UPDATE collectible_publication_grades SET summary='{"mediaRemoved":true}'::jsonb,
      detail='{"mediaRemoved":true}'::jsonb WHERE publication_id=$1`, [publicationId]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  const history = (await service.getShop(accountId)).history[0]!;
  assert.equal(history.reward.name, '공개가 중단된 코인');
  assert.equal(history.reward.kind === 'COIN' && history.reward.artwork, undefined);
});

test('personal trial coins stay in their owner catalogs and draw pool', async t => {
  const { pool, service, coinEconomy, select } = await setup(t);
  const publicationId = await publishCoin(pool);
  const outsiderBefore = (await service.getShop(accountId)).pools[0]!;
  const coinPoolId = randomUUID();
  await pool.query(`INSERT INTO coin_pools (id,merchant_id,event_name,grade,price,purchase_starts_at,
    purchase_ends_at,use_expires_at,per_account_limit,issuance_cap)
    VALUES ($1,'grade-shop','시험','BRONZE',1,'2026-01-01','2027-01-01','2027-02-01',1,10)`, [coinPoolId]);
  await pool.query(`INSERT INTO coin_pool_entries (pool_id,publication_id,grade_id,weight)
    VALUES ($1,$2,'bronze-coin',1)`, [coinPoolId, publicationId]);
  await pool.query(`INSERT INTO showcase_guest_trials (account_id,merchant_id,created_at,expires_at)
    VALUES ('trial-owner','grade-shop','2026-10-01','2026-10-09')`);

  const outsider = (await service.getShop(accountId)).pools[0]!;
  const owner = (await service.getShop('trial-owner')).pools[0]!;
  assert.equal(outsider.counts.COIN, 0);
  assert.equal(owner.counts.COIN, 1);
  assert.notEqual(outsider.version, outsiderBefore.version);
  assert.equal(owner.version, outsiderBefore.version);
  assert.equal((await coinEconomy.getShop(accountId)).pools.some(pool => pool.id === coinPoolId), false);
  assert.equal((await coinEconomy.getShop('trial-owner')).pools.some(pool => pool.id === coinPoolId), true);
  assert.equal((await coinEconomy.getCollection(accountId)).catalog.some(row => row.merchantId === 'grade-shop'), false);
  assert.equal((await coinEconomy.getCollection('trial-owner')).catalog.some(row => row.merchantId === 'grade-shop'), true);
  await assert.rejects(coinEconomy.purchase({ accountId, poolId: coinPoolId, requestId: 'foreign-trial' }),
    { code: 'COIN_POOL_UNAVAILABLE' });
  await pool.query(`INSERT INTO mileage_credits (id,account_id,amount,reason,source_id,business_date)
    VALUES ($1,'trial-owner',10,'DRAW_BONUS','trial-credit','2026-10-07')`, [randomUUID()]);
  assert.equal((await coinEconomy.purchase({ accountId: 'trial-owner', poolId: coinPoolId,
    requestId: 'own-trial' })).ticket.poolId, coinPoolId);
  select(0);
  assert.notEqual((await service.draw({ accountId, grade: 'BRONZE', requestId: 'outsider-draw',
    expectedPoolVersion: outsider.version })).reward.kind, 'COIN');
  await pool.query(`UPDATE campaigns SET is_public=false WHERE id='grade-campaign'`);
  assert.equal((await service.getShop(accountId)).pools[0]!.version, outsider.version);
  assert.notEqual((await service.getShop('trial-owner')).pools[0]!.version, owner.version);
});
