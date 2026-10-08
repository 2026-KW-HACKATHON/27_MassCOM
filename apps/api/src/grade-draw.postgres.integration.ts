import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Pool } from 'pg';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
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
    coin_reroll_tickets, furniture_inventory, account_characters, account_profile, collection_experience_profiles,
    campaign_goals, campaigns, merchant_members, merchants CASCADE`);
  await pool.query(`INSERT INTO mileage_credits (id,account_id,amount,reason,source_id,business_date)
    VALUES ($1,$2,3000,'DRAW_BONUS','test-credit','2026-10-07')`, [randomUUID(), accountId]);
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'grade-draw-test-account-lifecycle-secret-32-bytes' });
  let sequence = [0, 0, 0];
  let index = 0;
  const service = new PostgresGradeDrawService(pool, lifecycle, { now: () => now, randomInt: () => sequence[index++]! });
  return { pool, service, select: (...values: number[]) => { sequence = values; index = 0; }, lifecycle };
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

test('weighted pool excludes coins and characters and grants exactly one reward per draw', async (t) => {
  const { pool, service, select } = await setup(t);
  const publicationId = await publishCoin(pool);
  const bronze = (await service.getShop(accountId)).pools[0]!;
  assert.deepEqual(bronze.gradeWeights, { BRONZE: 8000, SILVER: 1700, GOLD: 280, PLATINUM: 20 });
  assert.equal(bronze.rewards.some((entry) => ['COIN', 'CHARACTER'].includes(entry.reward.kind)), false);
  assert.equal(bronze.rewards.some((entry) => entry.rarity !== 'BRONZE' && entry.reward.kind === 'FURNITURE'), false);
  assert.equal(bronze.categoryWeightsByRarity.SILVER.FURNITURE, 0);
  assert.ok(Math.abs(bronze.rewards.reduce((sum, entry) => sum + entry.probability, 0) - 1) < 1e-12);
  const draw = (requestId: string) => service.draw({ accountId, grade: 'BRONZE', requestId,
    expectedPoolVersion: bronze.version });

  select(0, 0, 0);
  const ticket = await draw('ticket');
  assert.equal(ticket.reward.kind, 'REROLL_TICKET');
  assert.equal(ticket.rarity, 'BRONZE');
  assert.deepEqual((await pool.query(`SELECT grade,source,request_id,granted_by_account_id FROM coin_reroll_tickets
    WHERE account_id=$1`, [accountId])).rows, [{ grade: 'BRONZE', source: 'GRADE_DRAW',
    request_id: `grade-draw:${ticket.drawId}`, granted_by_account_id: null }]);
  assert.equal((await draw('ticket')).replayed, true);
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM coin_reroll_tickets WHERE account_id=$1`, [accountId])).rows[0].n, 1);

  select(0, 50, 0);
  const mileage = await draw('mileage');
  assert.deepEqual(mileage.reward, { kind: 'MILEAGE', id: 'mileage-bronze', name: '20P', amount: 20 });
  assert.equal(mileage.balance, 2820);
  assert.deepEqual((await pool.query(`SELECT amount,source_id,business_date::text FROM mileage_credits
    WHERE account_id=$1 AND source_id=$2`, [accountId, `grade-draw:${mileage.drawId}`])).rows,
  [{ amount: 20, source_id: `grade-draw:${mileage.drawId}`, business_date: '2026-10-07' }]);
  assert.equal((await draw('mileage')).balance, mileage.balance);

  select(0, 6050, 0);
  const furniture = await draw('furniture');
  assert.equal(furniture.reward.kind, 'FURNITURE');
  if (furniture.reward.kind === 'FURNITURE') assert.equal(furniture.reward.assetId, furniture.reward.id);
  assert.deepEqual((await draw('furniture')).reward, furniture.reward);
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM furniture_inventory WHERE account_id=$1 AND item_id=$2`,
    [accountId, furniture.reward.id])).rows[0].n, 1);
  select(0, 8050, 0);
  const theme = await draw('theme');
  assert.equal(theme.reward.kind, 'THEME');
  assert.equal((await service.getShop(accountId)).history.find((item) => item.drawId === theme.drawId)!.reward.kind, 'THEME');
  assert.equal((await service.getShop(accountId)).balance, 2620);
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM grade_draws WHERE reward_kind='COIN' AND account_id=$1`,
    [accountId])).rows[0].n, 0);

  // Old receipts remain readable and preserve coin ownership after the live pool excludes coins.
  await pool.query(`INSERT INTO grade_draws(id,account_id,request_id,grade,price,pool_version,reward_kind,
    publication_id,grade_id,duplicate,quantity,created_at)
    VALUES($1,$2,'legacy-coin','BRONZE',100,$3,'COIN',$4,'bronze-coin',false,1,$5)`,
  [randomUUID(), accountId, 'a'.repeat(64), publicationId, now]);
  const history = (await service.getShop(accountId)).history.find((item) => item.reward.kind === 'COIN')!;
  assert.equal(history.reward.kind, 'COIN');
  assert.equal(history.rarity, null);
  await pool.query(`INSERT INTO grade_draws(id,account_id,request_id,grade,price,pool_version,reward_kind,
    item_id,duplicate,quantity,created_at)
    VALUES($1,$2,'legacy-character','BRONZE',100,$3,'CHARACTER','cook-cat',false,1,$4)`,
  [randomUUID(), accountId, 'a'.repeat(64), now]);
  assert.equal((await service.getShop(accountId)).history.find((item) => item.reward.id === 'cook-cat')?.rarity, null);

  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'grade-draw-test-account-lifecycle-secret-32-bytes', policyVersion: 'test', now: () => now,
  });
  await deletion.requestDeletion({ accountId, confirmation: 'DELETE MY ACCOUNT' });
  for (const table of ['grade_draws', 'coin_reroll_tickets', 'furniture_inventory', 'mileage_credits']) {
    assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM ${table} WHERE account_id=$1`,
      [accountId])).rows[0].n, 0);
  }
});

test('rarity and category endpoints issue the advertised reward', async (t) => {
  const { pool, service, select } = await setup(t);
  const bronze = (await service.getShop(accountId)).pools[0]!;
  select(9999, 0, 0);
  const rare = await service.draw({ accountId, grade: 'BRONZE', requestId: 'prism', expectedPoolVersion: bronze.version });
  assert.equal(rare.rarity, 'PLATINUM');
  assert.deepEqual(rare.reward, { kind: 'REROLL_TICKET', id: 'reroll-gold', name: 'GOLD 재뽑기권', grade: 'GOLD' });
  assert.equal((await pool.query(`SELECT grade FROM coin_reroll_tickets WHERE request_id=$1`,
    [`grade-draw:${rare.drawId}`])).rows[0].grade, 'GOLD');
  await assert.rejects(service.draw({ accountId, grade: 'SILVER', requestId: 'prism',
    expectedPoolVersion: bronze.version }), { code: 'DRAW_REQUEST_CONFLICT' });
});

test('concurrent requests serialize mileage and failed award rolls back draw', async (t) => {
  const { pool, service, select, lifecycle } = await setup(t);
  await pool.query(`UPDATE mileage_credits SET amount=100 WHERE account_id=$1`, [accountId]);
  const bronze = (await service.getShop(accountId)).pools[0]!;
  select(0, 6000, 0);
  const results = await Promise.allSettled(['one', 'two'].map((requestId) => service.draw({ accountId,
    grade: 'BRONZE', requestId, expectedPoolVersion: bronze.version })));
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected' &&
    result.reason?.code === 'DRAW_INSUFFICIENT_MILEAGE').length, 1);
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM grade_draws WHERE account_id=$1`,
    [accountId])).rows[0].n, 1);

  const broken = new PostgresGradeDrawService(pool, lifecycle, { now: () => now,
    randomInt: (() => { const values = [0, 50, 0]; let index = 0; return () => values[index++]!; })(),
    nextId: (() => { let index = 0; return () => index++ === 0 ? randomUUID() : 'invalid-uuid'; })() });
  await pool.query(`UPDATE mileage_credits SET amount=1000 WHERE account_id=$1`, [accountId]);
  await assert.rejects(broken.draw({ accountId, grade: 'BRONZE', requestId: 'rollback',
    expectedPoolVersion: bronze.version }));
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM grade_draws WHERE request_id='rollback'`,
    [])).rows[0].n, 0);
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM mileage_credits WHERE source_id LIKE 'grade-draw:%'`,
    [])).rows[0].n, 1);
});

test('empty furniture catalog keeps disclosed odds and actual draw aligned', async (t) => {
  const { pool, service, select } = await setup(t);
  await pool.query('DELETE FROM furniture_catalog');
  const bronze = (await service.getShop(accountId)).pools[0]!;
  assert.equal(bronze.categoryWeightsByRarity.BRONZE.FURNITURE, 0);
  assert.equal(bronze.categoryWeightsByRarity.BRONZE.MILEAGE, 8000);
  assert.equal(bronze.rewards.some(({ reward }) => reward.kind === 'FURNITURE'), false);
  assert.ok(Math.abs(bronze.rewards.reduce((sum, entry) => sum + entry.probability, 0) - 1) < 1e-12);
  select(0, 1000, 0);
  const draw = await service.draw({ accountId, grade: 'BRONZE', requestId: 'no-furniture',
    expectedPoolVersion: bronze.version });
  assert.equal(draw.reward.kind, 'MILEAGE');
});
