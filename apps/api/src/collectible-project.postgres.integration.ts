import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Pool } from 'pg';
import { photoProject } from './collectible-project-test-support.js';
import { CollectibleProjectError } from './collectible-project.js';
import { MerchantAccessError } from './merchant-access.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresCollectibleProjectService } from './postgres/collectible-project.js';
import { PostgresCollectionReader } from './postgres/collection.js';
import { runMigrations } from './postgres/migrate.js';

const secret = 'collectible-test-account-lifecycle-hmac-at-least-32-bytes';
const now = new Date('2026-09-30T03:00:00Z');
async function setup(t: TestContext) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) throw new Error('dedicated TEST_DATABASE_URL ending _test is required');
  const pool = new Pool({ connectionString }); t.after(() => pool.end()); await runMigrations(pool);
  await pool.query('TRUNCATE merchants, account_deletion_requests CASCADE');
  await pool.query(`INSERT INTO merchants (id,name,story,road_address,minimum_spend_won,status,is_demo) VALUES
    ('merchant-a','가상 점포 A','시험','시험',0,'ACTIVE',true),('merchant-b','가상 점포 B','시험','시험',0,'ACTIVE',true)`);
  await pool.query(`INSERT INTO merchant_members (merchant_id,account_id,role,status) VALUES
    ('merchant-a','owner-a','OWNER','ACTIVE'),('merchant-a','owner-backup','OWNER','ACTIVE'),
    ('merchant-a','staff-a','STAFF','ACTIVE'),('merchant-b','owner-b','OWNER','ACTIVE')`);
  await pool.query(`INSERT INTO campaigns (id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity) VALUES
    ('campaign-a','merchant-a','가상 캠페인','2026-09-01','2026-12-01','ACTIVE',true,100),
    ('campaign-b','merchant-b','다른 점포 캠페인','2026-09-01','2026-12-01','ACTIVE',true,100)`);
  await pool.query(`INSERT INTO campaign_goals (campaign_id,target_visit_count,display_name) VALUES
    ('campaign-a',1,'첫 도장'),('campaign-a',3,'세 번째 도장'),('campaign-a',5,'다섯 번째 도장')`);
  const accountLifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const projects = new PostgresCollectibleProjectService(pool, { accountLifecycle, now: () => now });
  let visitTime = now;
  const claims = new PostgresClaimSlotService(pool, { referenceHmacSecret: secret, now: () => visitTime, accountLifecycle });
  const input = { merchantId: 'merchant-a', accountId: 'owner-a' };
  const claim = async (accountId: string, reference: string) => {
    const issued = await claims.issue({ merchantId: 'merchant-a', customerAccountId: accountId, merchantReference: reference, createdByAccountId: 'staff-a' });
    return { issued, redeemed: await claims.redeem({ accountId, token: issued.token }) };
  };
  return { pool, projects, claims, input, claim, accountLifecycle, setDay: (day: number) => { visitTime = new Date(now.getTime() + day * 86400000); } };
}

test('private project persistence, optimistic save race, copy and permission rechecks isolate merchants and active members', async t => {
  const { pool, projects, input } = await setup(t);
  const first = await projects.create({ ...input, project: photoProject() });
  assert.deepEqual((await projects.get({ ...input, projectId: first.id })).project,photoProject());
  const list = await projects.list(input); assert.equal(list.length,1); assert.equal('project' in list[0]!,false);
  assert.equal(JSON.stringify(list).includes('originalDataUrl'),false);
  const race = await Promise.allSettled(['변경 A','변경 B'].map(name => projects.save({ ...input, projectId: first.id, expectedVersion: 1, project: photoProject(name) })));
  assert.equal(race.filter(r => r.status === 'fulfilled').length,1);
  assert.equal((race.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code,'COLLECTIBLE_VERSION_CONFLICT');
  const saved = await projects.get({ ...input, projectId: first.id }); assert.equal(saved.version,2);
  const copy = await projects.copy({ ...input, projectId: first.id, expectedVersion: 2 }); assert.notEqual(copy.id,first.id); assert.equal(copy.version,1);
  await assert.rejects(projects.get({ merchantId: 'merchant-b', accountId: 'owner-b', projectId: first.id }), { code: 'COLLECTIBLE_PROJECT_NOT_FOUND' });
  await assert.rejects(projects.list({ ...input, accountId: 'staff-a' }), MerchantAccessError);
  const delegated = new PostgresCollectibleProjectService(pool,{staffMayManageArt:true}); assert.equal((await delegated.list({ ...input,accountId:'staff-a' })).length,2);
  await pool.query(`UPDATE merchant_members SET status='REVOKED',revoked_at=now() WHERE account_id='staff-a'`);
  await assert.rejects(delegated.list({ ...input,accountId:'staff-a' }),MerchantAccessError);
  await pool.query(`UPDATE merchants SET status='PAUSED' WHERE id='merchant-a'`);
  await assert.rejects(projects.get({ ...input,projectId:first.id }),MerchantAccessError);
});

test('claim inserts capture explicit current grade once, never backfill, leave rewards/NFT unchanged, and keep old publication snapshots immutable', async t => {
  const { pool, projects, claims, input, claim, setDay } = await setup(t);
  const before = await claim('before-publish','before'); const beforeId = before.redeemed.grantedRewards[0]!.entitlementId;
  const raw = photoProject(); raw.rewardGrades = { '1': 'custom' };
  const draft = await projects.create({ ...input,project:raw });
  await assert.rejects(projects.publish({ ...input,projectId:draft.id,expectedVersion:1,campaignId:'campaign-b' }), { code:'COLLECTIBLE_CAMPAIGN_UNAVAILABLE' });
  const published = await projects.publish({ ...input,projectId:draft.id,expectedVersion:1,campaignId:'campaign-a' });
  await assert.rejects(projects.getAcquired({accountId:'before-publish',entitlementId:beforeId}), {code:'COLLECTIBLE_NOT_FOUND'});
  await assert.rejects(projects.save({ ...input,projectId:draft.id,expectedVersion:2,project:raw }), {code:'COLLECTIBLE_PUBLISHED_IMMUTABLE'});
  const fresh = await claim('customer-new','fresh'); const entitlementId = fresh.redeemed.grantedRewards[0]!.entitlementId;
  const acquired = await projects.getAcquired({accountId:'customer-new',entitlementId});
  assert.equal(acquired.publicationId,published.publicationId); assert.equal(acquired.gradeId,'custom'); assert.equal(acquired.animation,'float');
  assert.equal('photo' in acquired,false); assert.equal('crop' in acquired,false); assert.equal('photoEdits' in acquired,false);
  await assert.rejects(projects.getAcquired({accountId:'other-customer',entitlementId}), {code:'COLLECTIBLE_NOT_FOUND'});
  const replay = await claims.redeem({accountId:'customer-new',token:fresh.issued.token}); assert.equal(replay.replayed,true);
  assert.equal((await pool.query('SELECT * FROM collectible_acquisitions')).rowCount,1);
  const next = await projects.copy({ ...input,projectId:draft.id,expectedVersion:2 });
  const nextRaw = structuredClone(next.project); nextRaw.name = '새 시즌 도장';
  await projects.save({ ...input,projectId:next.id,expectedVersion:1,project:nextRaw });
  const nextPublished = await projects.publish({ ...input,projectId:next.id,expectedVersion:2,campaignId:'campaign-a' });
  const newest = await claim('customer-next','next');
  assert.equal((await projects.getAcquired({accountId:'customer-next',entitlementId:newest.redeemed.grantedRewards[0]!.entitlementId})).publicationId,nextPublished.publicationId);
  assert.deepEqual(await projects.getAcquired({accountId:'customer-new',entitlementId}),acquired);
  const collection = await new PostgresCollectionReader(pool).getCollection('customer-new');
  assert.equal(collection.collectibles[0]!.nftStatus,'NOT_REQUESTED'); assert.equal(collection.collectibles[0]!.artwork!.name,raw.name);
  assert.equal('imageDataUrl' in collection.collectibles[0]!.artwork!,false);
  const preparingCollection = await new PostgresCollectionReader(pool,{nftMinting:'PREPARING'}).getCollection('customer-new');
  assert.equal(preparingCollection.nftMinting,'PREPARING');
  assert.deepEqual(preparingCollection.collectibles,collection.collectibles);
  setDay(1); await claim('customer-new','day-two'); setDay(2); const third = await claim('customer-new','day-three');
  assert.equal(third.redeemed.grantedRewards[0]!.targetVisitCount,3);
  await assert.rejects(projects.getAcquired({accountId:'customer-new',entitlementId:third.redeemed.grantedRewards[0]!.entitlementId}),{code:'COLLECTIBLE_NOT_FOUND'});
  await assert.rejects(pool.query(`UPDATE collectible_publications SET snapshots='{}' WHERE id=$1`,[published.publicationId]), /immutable/);
  await assert.rejects(pool.query(`UPDATE collectible_acquisitions SET snapshot='{}' WHERE entitlement_id=$1`,[entitlementId]), /immutable/);
  await pool.query(`UPDATE reward_entitlements SET status='CANCELED' WHERE id=$1`,[entitlementId]);
  await assert.rejects(projects.getAcquired({accountId:'customer-new',entitlementId}),{code:'COLLECTIBLE_NOT_FOUND'});
  assert.equal((await pool.query('SELECT * FROM mint_jobs')).rowCount,0);
});

test('publication replacement waits for acquisition campaign lock; rollback leaves neither partial entitlement nor acquisition', async t => {
  const { pool,projects,input,claim } = await setup(t);
  const first = await projects.create({...input,project:photoProject()});
  const old = await projects.publish({...input,projectId:first.id,expectedVersion:1,campaignId:'campaign-a'});
  const second = await projects.copy({...input,projectId:first.id,expectedVersion:2});
  const visit = await claim('transaction-source','source');
  const client = await pool.connect();
  await client.query('BEGIN'); await client.query(`SELECT 1 FROM campaigns WHERE id='campaign-a' FOR SHARE`);
  const pendingPublication = projects.publish({...input,projectId:second.id,expectedVersion:1,campaignId:'campaign-a'});
  const inserted = await client.query<{id:string}>(`INSERT INTO reward_entitlements
    (id,customer_account_id,campaign_id,target_visit_count,source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
    VALUES (gen_random_uuid(),'capture-before-replace','campaign-a',1,$1,'GRANTED','same-policy',now(),now()+interval '90 days') RETURNING id`,[visit.redeemed.visit.visitEventId]);
  const oldCapture = await client.query<{publication_id:string}>('SELECT publication_id FROM collectible_acquisitions WHERE entitlement_id=$1',[inserted.rows[0]!.id]);
  assert.equal(oldCapture.rows[0]!.publication_id,old.publicationId);
  await client.query('ROLLBACK'); await pendingPublication;
  client.release();
  assert.equal((await pool.query('SELECT 1 FROM collectible_acquisitions WHERE entitlement_id=$1',[inserted.rows[0]!.id])).rowCount,0);
  assert.equal((await pool.query('SELECT 1 FROM reward_entitlements WHERE id=$1',[inserted.rows[0]!.id])).rowCount,0);
});

test('account deletion clears authored private source and raw identities while other customers retain their immutable final assets', async t => {
  const {pool,projects,input,claim,accountLifecycle} = await setup(t);
  const first = await projects.create({...input,project:photoProject()});
  const published = await projects.publish({...input,projectId:first.id,expectedVersion:1,campaignId:'campaign-a'});
  const customer = await claim('customer-kept','owner-delete'); const entitlementId=customer.redeemed.grantedRewards[0]!.entitlementId;
  const before = await projects.getAcquired({accountId:'customer-kept',entitlementId});
  await new PostgresAccountDeletionService(pool,{hmacSecret:secret,policyVersion:'test-v1',accountLifecycle}).requestDeletion({accountId:'owner-a',confirmation:'DELETE MY ACCOUNT'});
  const source = await pool.query('SELECT project,created_by_account_id,edited_by_account_id FROM collectible_projects WHERE id=$1',[first.id]);
  assert.deepEqual(source.rows[0],{project:null,created_by_account_id:null,edited_by_account_id:null});
  await assert.rejects(projects.list(input),{code:'ACCOUNT_DELETED'});
  await assert.rejects(projects.get({...input,accountId:'owner-backup',projectId:first.id}),{code:'COLLECTIBLE_PROJECT_NOT_FOUND'});
  assert.deepEqual(await projects.getAcquired({accountId:'customer-kept',entitlementId}),before);
  const stored = await pool.query<{snapshots:unknown}>('SELECT snapshots FROM collectible_publications WHERE id=$1',[published.publicationId]);
  assert.equal(JSON.stringify(stored.rows[0]!.snapshots).includes('originalDataUrl'),false);
  assert.equal(JSON.stringify(stored.rows[0]!.snapshots).includes('owner-a'),false);
});

test('deletion follows inherited source authors through copies and intermediate editors rather than just the last editor',async t=>{
  const {pool,projects,input,accountLifecycle}=await setup(t);
  const first=await projects.create({...input,project:photoProject()});
  const copied=await projects.copy({...input,accountId:'owner-backup',projectId:first.id,expectedVersion:1});
  const staffProjects=new PostgresCollectibleProjectService(pool,{accountLifecycle,staffMayManageArt:true,now:()=>now});
  await staffProjects.save({...input,accountId:'staff-a',projectId:copied.id,expectedVersion:1,project:photoProject('중간 편집')});
  await projects.save({...input,accountId:'owner-backup',projectId:copied.id,expectedVersion:2,project:photoProject('마지막 편집')});
  assert.equal((await pool.query(`SELECT 1 FROM collectible_project_contributors WHERE project_id=$1 AND account_id='staff-a'`,[copied.id])).rowCount,1);
  await new PostgresAccountDeletionService(pool,{hmacSecret:secret,policyVersion:'test-v1',accountLifecycle}).requestDeletion({accountId:'staff-a',confirmation:'DELETE MY ACCOUNT'});
  assert.equal((await pool.query('SELECT project FROM collectible_projects WHERE id=$1',[copied.id])).rows[0].project,null);
  assert.equal((await pool.query('SELECT 1 FROM collectible_project_contributors WHERE project_id=$1',[copied.id])).rowCount,0);
  const copiedAgain=await projects.copy({...input,accountId:'owner-backup',projectId:first.id,expectedVersion:1});
  await new PostgresAccountDeletionService(pool,{hmacSecret:secret,policyVersion:'test-v1',accountLifecycle}).requestDeletion({accountId:'owner-a',confirmation:'DELETE MY ACCOUNT'});
  assert.equal((await pool.query('SELECT project FROM collectible_projects WHERE id=$1',[copiedAgain.id])).rows[0].project,null);
  assert.equal((await pool.query(`SELECT 1 FROM collectible_project_contributors WHERE account_id IN ('owner-a','staff-a')`)).rowCount,0);
});

test('copy concurrent with source author deletion cannot leave a newly inherited original behind',async t=>{
  const {pool,projects,input,accountLifecycle}=await setup(t);
  const first=await projects.create({...input,project:photoProject()});
  const deletion=new PostgresAccountDeletionService(pool,{hmacSecret:secret,policyVersion:'test-v1',accountLifecycle});
  const results=await Promise.allSettled([
    projects.copy({...input,accountId:'owner-backup',projectId:first.id,expectedVersion:1}),
    deletion.requestDeletion({accountId:'owner-a',confirmation:'DELETE MY ACCOUNT'}),
  ]);
  assert.equal(results[1]!.status,'fulfilled');
  if(results[0]!.status==='rejected') assert.equal(results[0].reason.code,'COLLECTIBLE_PROJECT_NOT_FOUND');
  assert.equal((await pool.query(`SELECT 1 FROM collectible_projects WHERE project IS NOT NULL`)).rowCount,0);
  assert.equal((await pool.query('SELECT 1 FROM collectible_project_contributors')).rowCount,0);
});
