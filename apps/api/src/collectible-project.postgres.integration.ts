import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';
import { Pool } from 'pg';
import { photoProject, tinyPng } from './collectible-project-test-support.js';
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

test('claim inserts capture fixed standard grades once, never backfill, leave rewards/NFT unchanged, and keep old publication snapshots immutable', async t => {
  const { pool, projects, claims, input, claim, setDay } = await setup(t);
  const before = await claim('before-publish','before'); const beforeId = before.redeemed.grantedRewards[0]!.entitlementId;
  const raw = photoProject(); raw.rewardGrades = { '1': 'custom' };
  const draft = await projects.create({ ...input,project:raw });
  // campaign-b(다른 점포)에 campaign-a와 같은 목표를 주어, 거절 이유가 목표 부족이 아니라 점포 불일치(merchant_id = $2)뿐임을 시험이 가르게 한다.
  await pool.query(`INSERT INTO campaign_goals (campaign_id,target_visit_count,display_name) VALUES ('campaign-b',1,'첫 도장'),('campaign-b',3,'세 번째 도장'),('campaign-b',5,'다섯 번째 도장')`);
  await assert.rejects(projects.publish({ ...input,projectId:draft.id,expectedVersion:1,campaignId:'campaign-b' }), { code:'COLLECTIBLE_CAMPAIGN_UNAVAILABLE' });
  const published = await projects.publish({ ...input,projectId:draft.id,expectedVersion:1,campaignId:'campaign-a' });
  const publishedGrades = await pool.query<{ grade_id: string; summary: { gradeName?: string } }>(
    'SELECT grade_id, summary FROM collectible_publication_grades WHERE publication_id = $1 ORDER BY grade_id', [published.publicationId]);
  assert.deepEqual(publishedGrades.rows.map(row => [row.grade_id, row.summary.gradeName]),
    [['bronze', '브론즈'], ['custom', '가게 특별판'], ['gold', '골드'], ['prism', '프리즘'], ['silver', '실버']]);
  await assert.rejects(projects.getAcquired({accountId:'before-publish',entitlementId:beforeId}), {code:'COLLECTIBLE_NOT_FOUND'});
  await assert.rejects(projects.save({ ...input,projectId:draft.id,expectedVersion:2,project:raw }), {code:'COLLECTIBLE_PUBLISHED_IMMUTABLE'});
  const fresh = await claim('customer-new','fresh'); const entitlementId = fresh.redeemed.grantedRewards[0]!.entitlementId;
  const acquired = await projects.getAcquired({accountId:'customer-new',entitlementId});
  assert.equal(acquired.publicationId,published.publicationId); assert.equal(acquired.gradeId,'bronze'); assert.equal(acquired.animation,'still');
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
  assert.equal((await projects.getAcquired({accountId:'customer-new',entitlementId:third.redeemed.grantedRewards[0]!.entitlementId})).gradeId,'silver');
  await assert.rejects(pool.query(`UPDATE collectible_publications SET reward_grades='{}' WHERE id=$1`,[published.publicationId]), /immutable/);
  await assert.rejects(pool.query(`UPDATE collectible_publication_grades SET detail='{}' WHERE publication_id=$1`,[published.publicationId]), /immutable/);
  await assert.rejects(pool.query(`DELETE FROM collectible_publication_grades WHERE publication_id=$1`,[published.publicationId]), /immutable/);
  await assert.rejects(pool.query(`UPDATE collectible_acquisitions SET grade_id='bronze' WHERE entitlement_id=$1`,[entitlementId]), /immutable/);
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
  await client.query('BEGIN'); await client.query(`SELECT 1 FROM campaigns WHERE id='campaign-a' FOR KEY SHARE`);
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

// 위 시험은 시험 쪽이 직접 FOR KEY SHARE를 잡는다. 이 시험은 보상권 INSERT 트리거가 스스로 잡는 잠금만으로 발행 교체가 기다리는지 본다
// (트리거에서 FOR KEY SHARE를 빼면 이 시험만 실패한다).
test('publication replacement waits for the lock the claim-insert trigger itself takes, with the test locking nothing', async t => {
  const { pool, projects, input, claim } = await setup(t);
  const first = await projects.create({ ...input, project: photoProject() });
  const old = await projects.publish({ ...input, projectId: first.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const second = await projects.copy({ ...input, projectId: first.id, expectedVersion: 2 });
  const visit = await claim('trigger-lock-source', 'source');
  const client = await pool.connect();
  let pending: Promise<unknown> | undefined;
  let entitlementId = '';
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: string }>(`INSERT INTO reward_entitlements
      (id,customer_account_id,campaign_id,target_visit_count,source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
      VALUES (gen_random_uuid(),'trigger-lock-customer','campaign-a',1,$1,'GRANTED','same-policy',now(),now()+interval '90 days') RETURNING id`, [visit.redeemed.visit.visitEventId]);
    entitlementId = inserted.rows[0]!.id;
    assert.equal((await client.query('SELECT publication_id FROM collectible_acquisitions WHERE entitlement_id=$1', [entitlementId])).rows[0]!.publication_id, old.publicationId);
    pending = projects.publish({ ...input, projectId: second.id, expectedVersion: 1, campaignId: 'campaign-a' });
    pending.catch(() => undefined);
    const early = await Promise.race([pending.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 500))]);
    assert.equal(early, 'waiting', 'the trigger lock must hold the replacement until the claim transaction ends');
  } finally { await client.query('ROLLBACK'); client.release(); }
  await pending;
  assert.equal((await pool.query('SELECT 1 FROM collectible_acquisitions WHERE entitlement_id=$1', [entitlementId])).rowCount, 0);
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
  const stored = await pool.query('SELECT summary,detail FROM collectible_publication_grades WHERE publication_id=$1',[published.publicationId]);
  assert.equal(JSON.stringify(stored.rows).includes('originalDataUrl'),false);
  assert.equal(JSON.stringify(stored.rows).includes('owner-a'),false);
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

test('acquisitions store references only; the list reads the per-grade summary and detail reads the immutable publication grade', async t => {
  const { pool, projects, input, claim } = await setup(t);
  const raw = photoProject(); raw.motion = raw.motion.map(item => ({ ...item, gradeIds: ['silver'] }));
  const draft = await projects.create({ ...input, project: raw });
  const published = await projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const visit = await claim('customer-ref', 'ref'); const entitlementId = visit.redeemed.grantedRewards[0]!.entitlementId;
  const columns = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'collectible_acquisitions' ORDER BY ordinal_position`);
  assert.deepEqual(columns.rows.map(row => row.column_name), ['entitlement_id', 'publication_id', 'grade_id', 'acquired_at']);
  const stored = await pool.query('SELECT publication_id, grade_id FROM collectible_acquisitions WHERE entitlement_id = $1', [entitlementId]);
  assert.deepEqual(stored.rows[0], { publication_id: published.publicationId, grade_id: 'bronze' });
  const grades = await pool.query<{ grade_id: string; summary: Record<string, unknown>; detail: Record<string, unknown> }>(
    'SELECT grade_id, summary, detail FROM collectible_publication_grades WHERE publication_id = $1 ORDER BY grade_id', [published.publicationId]);
  assert.deepEqual(grades.rows.map(row => row.grade_id), ['bronze', 'custom', 'gold', 'prism', 'silver']);
  assert.deepEqual(Object.keys(grades.rows[0]!.summary).sort(), ['gradeId', 'gradeName', 'name', 'projectId', 'publicationId', 'shape', 'theme', 'thumbnailDataUrl']);
  assert.equal('imageDataUrl' in grades.rows[0]!.summary, false); assert.equal('thumbnailDataUrl' in grades.rows[0]!.detail, false);
  const artwork = (await new PostgresCollectionReader(pool).getCollection('customer-ref')).collectibles[0]!.artwork!;
  assert.deepEqual(artwork, grades.rows[0]!.summary);
  const detail = await projects.getAcquired({ accountId: 'customer-ref', entitlementId });
  assert.deepEqual(detail, { ...grades.rows[0]!.summary, ...grades.rows[0]!.detail });
  assert.equal(detail.gradeId, 'bronze'); assert.equal(typeof detail.imageDataUrl, 'string');
});

test('a linked publication with a missing grade row keeps the visit reward and skips only the collectible', async t => {
  const { pool, projects, input, claim } = await setup(t);
  const draft = await projects.create({ ...input, project: photoProject() });
  const published = await projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' });
  // A publication whose 1-visit goal names a grade without stored media (damaged data) must not fail the claim.
  const ghost = await projects.copy({ ...input, projectId: draft.id, expectedVersion: 2 });
  await pool.query(`INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades)
    VALUES (gen_random_uuid(), $1, 'merchant-a', 'campaign-a', 1, '{"1":"ghost"}') RETURNING id`, [ghost.id])
    .then(result => pool.query(`UPDATE campaign_collectible_publications SET publication_id = $1 WHERE campaign_id = 'campaign-a'`, [result.rows[0].id]));
  const visit = await claim('customer-ghost', 'ghost');
  assert.equal(visit.redeemed.grantedRewards.length, 1);
  assert.equal((await pool.query('SELECT 1 FROM reward_entitlements WHERE id = $1', [visit.redeemed.grantedRewards[0]!.entitlementId])).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM collectible_acquisitions')).rowCount, 0);
  assert.equal((await new PostgresCollectionReader(pool).getCollection('customer-ghost')).collectibles[0]!.artwork, undefined);
  assert.ok(published.publicationId);
});

test('capture locks a linked campaign with FOR KEY SHARE so enrollment count updates do not wait on an open claim', async t => {
  const { pool, projects, input, claim } = await setup(t);
  const draft = await projects.create({ ...input, project: photoProject() });
  await projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const visit = await claim('lock-source', 'lock');
  const client = await pool.connect(); const other = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO reward_entitlements
      (id,customer_account_id,campaign_id,target_visit_count,source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
      VALUES (gen_random_uuid(),'lock-holder','campaign-a',1,$1,'GRANTED','same-policy',now(),now()+interval '90 days')`, [visit.redeemed.visit.visitEventId]);
    assert.equal((await client.query(`SELECT 1 FROM collectible_acquisitions a JOIN reward_entitlements e ON e.id = a.entitlement_id WHERE e.customer_account_id = 'lock-holder'`)).rowCount, 1);
    await other.query('BEGIN'); await other.query(`SET LOCAL lock_timeout = '1s'`);
    await other.query(`UPDATE campaigns SET enrolled_count = enrolled_count WHERE id = 'campaign-a'`);
    await other.query('ROLLBACK'); await client.query('ROLLBACK');
  } finally { await other.query('ROLLBACK').catch(() => {}); await client.query('ROLLBACK').catch(() => {}); other.release(); client.release(); }
});

test('publish validates and strips media before the campaign lock, so a not-ready project fails without waiting for claims', async t => {
  const { pool, projects, input } = await setup(t);
  const raw = photoProject(); delete raw.derived.gold;
  const draft = await projects.create({ ...input, project: raw });
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query(`SELECT 1 FROM campaigns WHERE id='campaign-a' FOR KEY SHARE`);
    const started = Date.now();
    const outcome = await Promise.race([
      projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' }).then(() => 'published', error => error.code),
      new Promise(resolve => setTimeout(() => resolve('waited for campaign lock'), 1000)),
    ]);
    assert.equal(outcome, 'COLLECTIBLE_NOT_READY'); assert.ok(Date.now() - started < 1000);
  } finally { await client.query('ROLLBACK'); client.release(); }
});

test('account deletion stops distributing publications the account authored, keeps others and keeps acquired copies', async t => {
  const { pool, projects, input, claim, accountLifecycle } = await setup(t);
  const authored = await projects.create({ ...input, project: photoProject() });
  const published = await projects.publish({ ...input, projectId: authored.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const kept = await claim('customer-before-delete', 'before-delete'); const keptId = kept.redeemed.grantedRewards[0]!.entitlementId;
  const before = await projects.getAcquired({ accountId: 'customer-before-delete', entitlementId: keptId });
  // Another store owner's own publication is not authored by the deleted account and keeps distributing.
  await pool.query(`INSERT INTO campaign_goals (campaign_id,target_visit_count,display_name) VALUES ('campaign-b',1,'첫 도장'),('campaign-b',3,'세 번째 도장'),('campaign-b',5,'다섯 번째 도장')`);
  const otherRaw = photoProject('다른 점주 작품'); otherRaw.rewardGrades = { '1': 'bronze' };
  const otherInput = { merchantId: 'merchant-b', accountId: 'owner-b' };
  const other = await projects.create({ ...otherInput, project: otherRaw });
  const otherPublished = await projects.publish({ ...otherInput, projectId: other.id, expectedVersion: 1, campaignId: 'campaign-b' });
  await new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test-v1', accountLifecycle }).requestDeletion({ accountId: 'owner-a', confirmation: 'DELETE MY ACCOUNT' });
  const links = await pool.query<{ campaign_id: string; publication_id: string }>('SELECT campaign_id, publication_id FROM campaign_collectible_publications ORDER BY campaign_id');
  assert.deepEqual(links.rows, [{ campaign_id: 'campaign-b', publication_id: otherPublished.publicationId }]);
  const after = await claim('customer-after-delete', 'after-delete');
  assert.equal(after.redeemed.grantedRewards.length, 1);
  assert.equal((await pool.query('SELECT 1 FROM collectible_acquisitions WHERE entitlement_id = $1', [after.redeemed.grantedRewards[0]!.entitlementId])).rowCount, 0);
  assert.deepEqual(await projects.getAcquired({ accountId: 'customer-before-delete', entitlementId: keptId }), before);
  assert.equal(before.publicationId, published.publicationId);
});

test('merchant unpublish removes only the current link under an in-transaction MANAGE_ART recheck', async t => {
  const { pool, projects, input, claim } = await setup(t);
  const first = await projects.create({ ...input, project: photoProject() });
  await assert.rejects(projects.unpublish({ ...input, projectId: first.id, expectedVersion: 1 }), { code: 'COLLECTIBLE_NOT_PUBLISHED' });
  const firstPublished = await projects.publish({ ...input, projectId: first.id, expectedVersion: 1, campaignId: 'campaign-a' });
  assert.equal((await projects.list(input)).find(p => p.id === first.id)!.distributingCampaignId, 'campaign-a');
  await assert.rejects(projects.unpublish({ merchantId: 'merchant-b', accountId: 'owner-b', projectId: first.id, expectedVersion: 2 }), { code: 'COLLECTIBLE_PROJECT_NOT_FOUND' });
  await assert.rejects(projects.unpublish({ ...input, accountId: 'staff-a', projectId: first.id, expectedVersion: 2 }), MerchantAccessError);
  await assert.rejects(projects.unpublish({ ...input, projectId: first.id, expectedVersion: 1 }), { code: 'COLLECTIBLE_VERSION_CONFLICT' });
  // A newer publication replaced the link: unpublishing the old one must not remove the new one.
  const second = await projects.copy({ ...input, projectId: first.id, expectedVersion: 2 });
  const secondPublished = await projects.publish({ ...input, projectId: second.id, expectedVersion: 1, campaignId: 'campaign-a' });
  assert.deepEqual(await projects.unpublish({ ...input, projectId: first.id, expectedVersion: 2 }),
    { projectId: first.id, publicationId: firstPublished.publicationId, unlinkedCampaignId: null });
  assert.equal((await pool.query('SELECT publication_id FROM campaign_collectible_publications')).rows[0].publication_id, secondPublished.publicationId);
  const acquired = await claim('customer-before-stop', 'before-stop'); const acquiredId = acquired.redeemed.grantedRewards[0]!.entitlementId;
  assert.deepEqual(await projects.unpublish({ ...input, projectId: second.id, expectedVersion: 2 }),
    { projectId: second.id, publicationId: secondPublished.publicationId, unlinkedCampaignId: 'campaign-a' });
  assert.equal((await projects.list(input)).every(p => p.distributingCampaignId === null), true);
  const later = await claim('customer-after-stop', 'after-stop');
  assert.equal((await pool.query('SELECT 1 FROM collectible_acquisitions WHERE entitlement_id = $1', [later.redeemed.grantedRewards[0]!.entitlementId])).rowCount, 0);
  assert.equal((await projects.getAcquired({ accountId: 'customer-before-stop', entitlementId: acquiredId })).publicationId, secondPublished.publicationId);
  const delegated = new PostgresCollectibleProjectService(pool, { staffMayManageArt: true, now: () => now });
  await pool.query(`UPDATE merchant_members SET status='REVOKED', revoked_at=now() WHERE account_id='staff-a'`);
  await assert.rejects(delegated.unpublish({ ...input, accountId: 'staff-a', projectId: second.id, expectedVersion: 2 }), MerchantAccessError);
});

test('merchant delete removes drafts (freeing the project cap) and clears a published source while acquired copies remain', async t => {
  const { pool, projects, input, claim } = await setup(t);
  const draft = await projects.create({ ...input, project: photoProject() });
  await assert.rejects(projects.remove({ ...input, projectId: draft.id, expectedVersion: 2 }), { code: 'COLLECTIBLE_VERSION_CONFLICT' });
  await assert.rejects(projects.remove({ ...input, accountId: 'staff-a', projectId: draft.id, expectedVersion: 1 }), MerchantAccessError);
  assert.deepEqual(await projects.remove({ ...input, projectId: draft.id, expectedVersion: 1 }), { projectId: draft.id, deleted: true, unlinkedCampaignId: null });
  assert.equal((await pool.query('SELECT 1 FROM collectible_projects WHERE id = $1', [draft.id])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM collectible_project_contributors WHERE project_id = $1', [draft.id])).rowCount, 0);
  await pool.query(`INSERT INTO collectible_projects (id, merchant_id, project, name, lineage_id)
    SELECT id, 'merchant-a', '{}'::jsonb, '채우기', id FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 100)) AS filler`);
  await assert.rejects(projects.create({ ...input, project: photoProject() }), { code: 'COLLECTIBLE_PROJECT_LIMIT' });
  const filler = await pool.query<{ id: string }>(`SELECT id FROM collectible_projects WHERE merchant_id = 'merchant-a' LIMIT 1`);
  await projects.remove({ ...input, projectId: filler.rows[0]!.id, expectedVersion: 1 });
  const published = await projects.create({ ...input, project: photoProject() });
  const publication = await projects.publish({ ...input, projectId: published.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const acquired = await claim('customer-delete-source', 'delete-source'); const acquiredId = acquired.redeemed.grantedRewards[0]!.entitlementId;
  const before = await projects.getAcquired({ accountId: 'customer-delete-source', entitlementId: acquiredId });
  assert.deepEqual(await projects.remove({ ...input, projectId: published.id, expectedVersion: 2 }), { projectId: published.id, deleted: true, unlinkedCampaignId: 'campaign-a' });
  const source = await pool.query('SELECT project, created_by_account_id, edited_by_account_id, publication_id FROM collectible_projects WHERE id = $1', [published.id]);
  assert.deepEqual(source.rows[0], { project: null, created_by_account_id: null, edited_by_account_id: null, publication_id: publication.publicationId });
  assert.equal((await pool.query('SELECT 1 FROM campaign_collectible_publications')).rowCount, 0);
  await assert.rejects(projects.get({ ...input, projectId: published.id }), { code: 'COLLECTIBLE_PROJECT_NOT_FOUND' });
  assert.deepEqual(await projects.getAcquired({ accountId: 'customer-delete-source', entitlementId: acquiredId }), before);
});

test('operator media removal blanks a publication only through the guarded function and hides it from holders', async t => {
  const { pool, projects, input, claim } = await setup(t);
  const draft = await projects.create({ ...input, project: photoProject() });
  const published = await projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const holder = await claim('customer-removed', 'removed'); const entitlementId = holder.redeemed.grantedRewards[0]!.entitlementId;
  assert.ok((await new PostgresCollectionReader(pool).getCollection('customer-removed')).collectibles[0]!.artwork);
  // Without the function's session setting every UPDATE stays refused, and the setting never allows other columns or DELETE.
  await assert.rejects(pool.query(`UPDATE collectible_publications SET media_removed_at = now() WHERE id = $1`, [published.publicationId]), /immutable/);
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); await client.query(`SET LOCAL masscom.collectible_media_removal = 'on'`);
    await assert.rejects(client.query(`UPDATE collectible_publications SET reward_grades = '{}' , media_removed_at = now() WHERE id = $1`, [published.publicationId]), /immutable/);
    await client.query('ROLLBACK');
    await client.query('BEGIN'); await client.query(`SET LOCAL masscom.collectible_media_removal = 'on'`);
    await assert.rejects(client.query(`DELETE FROM collectible_publication_grades WHERE publication_id = $1`, [published.publicationId]), /immutable/);
  } finally { await client.query('ROLLBACK'); client.release(); }
  const removed = await pool.query('SELECT * FROM collectible_remove_publication_media($1)', [published.publicationId]);
  assert.deepEqual(removed.rows, [{ removed_publication_id: published.publicationId, cleared_grades: 5 }]);
  assert.equal((await pool.query('SELECT 1 FROM campaign_collectible_publications')).rowCount, 0);
  const grades = await pool.query('SELECT summary, detail FROM collectible_publication_grades WHERE publication_id = $1', [published.publicationId]);
  assert.equal(JSON.stringify(grades.rows).includes('data:'), false);
  assert.equal((await pool.query('SELECT project FROM collectible_projects WHERE id = $1', [draft.id])).rows[0].project, null);
  const collectedAfterRemoval = (await new PostgresCollectionReader(pool).getCollection('customer-removed')).collectibles[0]!;
  assert.equal(collectedAfterRemoval.artwork, undefined);
  assert.equal(collectedAfterRemoval.publicationId, published.publicationId);
  await assert.rejects(projects.getAcquired({ accountId: 'customer-removed', entitlementId }), { code: 'COLLECTIBLE_NOT_FOUND' });
  assert.equal((await pool.query('SELECT 1 FROM reward_entitlements WHERE id = $1', [entitlementId])).rowCount, 1);
  // Only the owning (migration) role may run the removal: PUBLIC has no EXECUTE grant.
  const acl = await pool.query<{ acl: string[] | null }>(`SELECT proacl::text[] AS acl FROM pg_proc WHERE proname = 'collectible_remove_publication_media'`);
  assert.ok(acl.rows[0]!.acl && acl.rows[0]!.acl.length > 0); assert.equal(acl.rows[0]!.acl.some(entry => entry.startsWith('=')), false);
  // The setting is transaction-local, so the guard is back on afterwards.
  await assert.rejects(pool.query(`UPDATE collectible_publication_grades SET detail = '{}' WHERE publication_id = $1`, [published.publicationId]), /immutable/);
});

test('editor campaign list returns only this store publishable campaigns with goals and the current publication', async t => {
  const { pool, projects, input } = await setup(t);
  await pool.query(`INSERT INTO campaigns (id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity) VALUES
    ('campaign-ended','merchant-a','끝난 캠페인','2026-08-01','2026-09-01','PAUSED',true,100),
    ('campaign-hidden','merchant-a','비공개 캠페인','2026-09-01','2026-12-01','ACTIVE',false,100)`);
  assert.deepEqual(await projects.listCampaigns(input), [{
    id: 'campaign-a', title: '가상 캠페인', status: 'ACTIVE', startsAt: new Date('2026-09-01').toISOString(), endsAt: new Date('2026-12-01').toISOString(),
    goals: [1, 3, 5], publication: null,
  }]);
  const draft = await projects.create({ ...input, project: photoProject() });
  const published = await projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' });
  assert.deepEqual((await projects.listCampaigns(input))[0]!.publication, { publicationId: published.publicationId, projectId: draft.id });
  assert.deepEqual((await projects.listCampaigns({ merchantId: 'merchant-b', accountId: 'owner-b' })).map(c => [c.id, c.goals]), [['campaign-b', []]]);
  await assert.rejects(projects.listCampaigns({ merchantId: 'merchant-b', accountId: 'owner-a' }), MerchantAccessError);
  await assert.rejects(projects.listCampaigns({ ...input, accountId: 'staff-a' }), MerchantAccessError);
  const delegated = new PostgresCollectibleProjectService(pool, { staffMayManageArt: true, now: () => now });
  assert.equal((await delegated.listCampaigns({ ...input, accountId: 'staff-a' })).length, 1);
  await pool.query(`UPDATE merchant_members SET status='REVOKED', revoked_at=now() WHERE account_id='staff-a'`);
  await assert.rejects(delegated.listCampaigns({ ...input, accountId: 'staff-a' }), MerchantAccessError);
  await pool.query(`UPDATE merchants SET status='PAUSED' WHERE id='merchant-a'`);
  await assert.rejects(projects.listCampaigns(input), MerchantAccessError);
});

test('operator removal follows copies and the same stored photo: copied publications and drafts lose the face too', async t => {
  const { pool, projects, input, claim } = await setup(t);
  const original = await projects.create({ ...input, project: photoProject() });
  const originalPublished = await projects.publish({ ...input, projectId: original.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const copy = await projects.copy({ ...input, projectId: original.id, expectedVersion: 2 });
  const copyPublished = await projects.publish({ ...input, projectId: copy.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const copyOfCopy = await projects.copy({ ...input, projectId: copy.id, expectedVersion: 2 });
  // Deleting the middle draft must not break the chain; a fresh project that re-uploads the same photo is caught by its bytes.
  const middle = await projects.copy({ ...input, projectId: copy.id, expectedVersion: 2 });
  const leaf = await projects.copy({ ...input, projectId: middle.id, expectedVersion: 1 });
  await projects.remove({ ...input, projectId: middle.id, expectedVersion: 1 });
  // The leaf replaced its photo, so only the lineage (not the bytes) ties it to the removed face.
  const leafRaw = photoProject('사진을 바꾼 복사본'); leafRaw.photo = { originalDataUrl: '', width: 0, height: 0 };
  await projects.save({ ...input, projectId: leaf.id, expectedVersion: 1, project: leafRaw });
  const reupload = await projects.create({ ...input, project: photoProject('다시 올린 같은 사진') });
  const otherRaw = photoProject('다른 사진'); otherRaw.photo = { originalDataUrl: '', width: 0, height: 0 };
  const other = await projects.create({ ...input, project: otherRaw });
  const holder = await claim('customer-copy', 'copy'); const entitlementId = holder.redeemed.grantedRewards[0]!.entitlementId;
  assert.equal((await projects.getAcquired({ accountId: 'customer-copy', entitlementId })).publicationId, copyPublished.publicationId);
  const removed = await pool.query<{ removed_publication_id: string; cleared_grades: number }>(
    'SELECT * FROM collectible_remove_publication_media($1) ORDER BY removed_publication_id', [originalPublished.publicationId]);
  assert.deepEqual(removed.rows.map(row => row.removed_publication_id).sort(), [originalPublished.publicationId, copyPublished.publicationId].sort());
  assert.equal((await pool.query('SELECT 1 FROM campaign_collectible_publications')).rowCount, 0);
  const cleared = await pool.query<{ id: string }>('SELECT id FROM collectible_projects WHERE project IS NULL ORDER BY id');
  assert.deepEqual(cleared.rows.map(row => row.id).sort(), [original.id, copy.id, copyOfCopy.id, leaf.id, reupload.id].sort());
  assert.ok((await projects.get({ ...input, projectId: other.id })).project);
  const media = await pool.query('SELECT summary, detail FROM collectible_publication_grades WHERE publication_id = ANY($1)', [[originalPublished.publicationId, copyPublished.publicationId]]);
  assert.equal(media.rowCount, 10); assert.equal(JSON.stringify(media.rows).includes('data:'), false);
  await assert.rejects(projects.getAcquired({ accountId: 'customer-copy', entitlementId }), { code: 'COLLECTIBLE_NOT_FOUND' });
  assert.equal((await pool.query('SELECT 1 FROM collectible_project_contributors WHERE project_id = ANY($1)', [[original.id, copy.id, copyOfCopy.id, leaf.id, reupload.id]])).rowCount, 0);
});

test('a store can hold at most 100 publications with media, so publish/delete/copy loops cannot grow storage without bound', async t => {
  const { pool, projects, input } = await setup(t);
  await pool.query(`WITH filler AS (SELECT gen_random_uuid() AS project_id, gen_random_uuid() AS publication_id FROM generate_series(1, 100)),
    made AS (INSERT INTO collectible_projects (id, merchant_id, lineage_id) SELECT project_id, 'merchant-a', project_id FROM filler)
    INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades)
    SELECT publication_id, project_id, 'merchant-a', 'campaign-a', 1, '{}'::jsonb FROM filler`);
  const draft = await projects.create({ ...input, project: photoProject() });
  await assert.rejects(projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' }), { code: 'COLLECTIBLE_PUBLICATION_LIMIT' });
  // Another store is not affected, and operator media removal frees a slot.
  await pool.query(`INSERT INTO campaign_goals (campaign_id,target_visit_count,display_name) VALUES ('campaign-b',1,'첫 도장'),('campaign-b',3,'셋'),('campaign-b',5,'다섯')`);
  const other = await projects.create({ merchantId: 'merchant-b', accountId: 'owner-b', project: photoProject() });
  await projects.publish({ merchantId: 'merchant-b', accountId: 'owner-b', projectId: other.id, expectedVersion: 1, campaignId: 'campaign-b' });
  const oldest = await pool.query<{ id: string }>(`SELECT id FROM collectible_publications WHERE merchant_id = 'merchant-a' LIMIT 1`);
  await pool.query('SELECT * FROM collectible_remove_publication_media($1)', [oldest.rows[0]!.id]);
  assert.ok((await projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' })).publicationId);
});

test('account deletion waits for an in-flight claim on a linked campaign before removing the link', async t => {
  const { pool, projects, input, accountLifecycle } = await setup(t);
  const draft = await projects.create({ ...input, project: photoProject() });
  await projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const client = await pool.connect();
  let deletion: Promise<unknown> | undefined;
  try {
    await client.query('BEGIN'); await client.query(`SELECT 1 FROM campaigns WHERE id = 'campaign-a' FOR KEY SHARE`);
    deletion = new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test-v1', accountLifecycle })
      .requestDeletion({ accountId: 'owner-a', confirmation: 'DELETE MY ACCOUNT' });
    const early = await Promise.race([deletion.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 500))]);
    assert.equal(early, 'waiting');
    assert.equal((await client.query('SELECT 1 FROM campaign_collectible_publications')).rowCount, 1);
  } finally { await client.query('ROLLBACK'); client.release(); }
  await deletion;
  assert.equal((await pool.query('SELECT 1 FROM campaign_collectible_publications')).rowCount, 0);
});

test('account deletion waits for the lock the claim-insert trigger itself takes, with the test locking nothing', async t => {
  const { pool, projects, input, claim, accountLifecycle } = await setup(t);
  const visit = await claim('deletion-lock-source', 'source');
  const draft = await projects.create({ ...input, project: photoProject() });
  await projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const client = await pool.connect();
  let deletion: Promise<unknown> | undefined;
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO reward_entitlements
      (id,customer_account_id,campaign_id,target_visit_count,source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
      VALUES (gen_random_uuid(),'deletion-lock-customer','campaign-a',1,$1,'GRANTED','same-policy',now(),now()+interval '90 days')`, [visit.redeemed.visit.visitEventId]);
    deletion = new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test-v1', accountLifecycle })
      .requestDeletion({ accountId: 'owner-a', confirmation: 'DELETE MY ACCOUNT' });
    deletion.catch(() => undefined);
    const early = await Promise.race([deletion.then(() => 'finished'), new Promise(resolve => setTimeout(() => resolve('waiting'), 500))]);
    assert.equal(early, 'waiting', 'the trigger lock must hold the link removal until the claim transaction ends');
    assert.equal((await client.query('SELECT 1 FROM campaign_collectible_publications')).rowCount, 1);
  } finally { await client.query('ROLLBACK'); client.release(); }
  await deletion;
  assert.equal((await pool.query('SELECT 1 FROM campaign_collectible_publications')).rowCount, 0);
});

test('the project list reads a separate name column kept in step with the private project', async t => {
  const { pool, projects, input } = await setup(t);
  const draft = await projects.create({ ...input, project: photoProject('첫 이름') });
  await projects.save({ ...input, projectId: draft.id, expectedVersion: 1, project: photoProject('바꾼 이름') });
  assert.equal((await pool.query('SELECT name FROM collectible_projects WHERE id = $1', [draft.id])).rows[0].name, '바꾼 이름');
  assert.equal((await projects.list(input))[0]!.name, '바꾼 이름');
  // The list query touches only the name column, never the project jsonb holding original media.
  await pool.query(`UPDATE collectible_projects SET project = jsonb_set(project, '{name}', '"숨은 값"') WHERE id = $1`, [draft.id]);
  assert.equal((await projects.list(input))[0]!.name, '바꾼 이름');
  await assert.rejects(pool.query('UPDATE collectible_projects SET project = NULL WHERE id = $1', [draft.id]), /check constraint/);
  const copied = await projects.copy({ ...input, projectId: draft.id, expectedVersion: 2 });
  assert.equal((await pool.query('SELECT name FROM collectible_projects WHERE id = $1', [copied.id])).rows[0].name, '숨은 값');
});

// Issue #284 WP1: v1 저장분이 이 마이그레이션 뒤에도 그대로 열리고, v2 게시는 새 필드를 온전히 담아 왕복한다.
const v1Fixture = () => JSON.parse(readFileSync(new URL('../../../tests/fixtures/collectible-v1.json', import.meta.url), 'utf8'));

test('a v1-shaped publication detail row (written before the v2 schema) is returned byte-identical through getAcquired', async t => {
  const { pool, projects, input, claim } = await setup(t);
  // draft는 발행본의 project_id FK 자리만 채우는 대상이다(project_id는 발행본마다 유일해 실제 게시는 하지 않는다).
  const draft = await projects.create({ ...input, project: photoProject() });
  const legacyPublicationId = (await pool.query<{ id: string }>(`SELECT gen_random_uuid() AS id`)).rows[0]!.id;
  const legacySummary = { projectId: draft.id, publicationId: legacyPublicationId, gradeId: 'bronze', gradeName: '브론즈', shape: 'circle', theme: { name: '우리 가게' }, name: '옛 발행본', thumbnailDataUrl: tinyPng };
  const legacyDetail = {
    imageDataUrl: tinyPng, thickness: 8, angle: 0, animation: 'float', greeting: '옛 인사말입니다.',
    audio: null, story: { type: 'none', cartoon: 0, strength: 50, frames: [] }, effects: [],
  };
  await pool.query(`INSERT INTO collectible_publications (id, project_id, merchant_id, campaign_id, project_version, reward_grades, published_at)
    VALUES ($1,$2,'merchant-a','campaign-a',1,'{"1":"bronze"}'::jsonb, now())`, [legacyPublicationId, draft.id]);
  await pool.query(`INSERT INTO collectible_publication_grades (publication_id, grade_id, summary, detail) VALUES ($1,'bronze',$2::jsonb,$3::jsonb)`,
    [legacyPublicationId, JSON.stringify(legacySummary), JSON.stringify(legacyDetail)]);
  // 이 캠페인엔 아직 배포 연결이 없으니(발행을 거치지 않았다) 바로 연결을 만든다.
  await pool.query(`INSERT INTO campaign_collectible_publications (campaign_id, publication_id) VALUES ('campaign-a', $1)`, [legacyPublicationId]);
  const visit = await claim('customer-legacy-detail', 'legacy-detail');
  const entitlementId = visit.redeemed.grantedRewards[0]!.entitlementId;
  const detail = await projects.getAcquired({ accountId: 'customer-legacy-detail', entitlementId });
  assert.deepEqual(detail, { ...legacySummary, ...legacyDetail });
  assert.equal('motions' in detail, false); assert.equal('backImageDataUrl' in detail, false);
});

test('a v2 publish round-trips through getAcquired with motions, rotation speed, thickness 48 and the back image intact', async t => {
  const { projects, input, claim, setDay } = await setup(t);
  const raw = photoProject(); raw.motion = raw.motion.map(item => ({ ...item, gradeIds: ['silver'] }));
  raw.rotationSpeed = 2;
  raw.thickness = 48;
  const draft = await projects.create({ ...input, project: raw });
  assert.equal(draft.project.rotationSpeed, 2);
  assert.equal(draft.project.thickness, 48);
  const published = await projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' });
  await claim('customer-v2-round-trip', 'first');
  setDay(1); await claim('customer-v2-round-trip', 'second');
  setDay(2); const third = await claim('customer-v2-round-trip', 'third');
  const reward = third.redeemed.grantedRewards.find(r => r.targetVisitCount === 3)!;
  const detail = await projects.getAcquired({ accountId: 'customer-v2-round-trip', entitlementId: reward.entitlementId });
  assert.equal(detail.publicationId, published.publicationId); assert.equal(detail.gradeId, 'silver');
  assert.equal(detail.animation, 'float'); assert.deepEqual(detail.motions, [{ type: 'float', playback: 'loop' }]);
  assert.equal(detail.rotationSpeed, 2);
  assert.equal(detail.thickness, 48);
  assert.equal(detail.backImageDataUrl, tinyPng); assert.equal('parallax' in detail, false); assert.equal('strokes' in detail, false);
});

test('copying a v1-shaped PUBLISHED source project (never resaved since before the v2 schema) yields a v2 draft', async t => {
  const { pool, projects, input } = await setup(t);
  const draft = await projects.create({ ...input, project: photoProject() });
  const published = await projects.publish({ ...input, projectId: draft.id, expectedVersion: 1, campaignId: 'campaign-a' });
  const v1 = v1Fixture();
  await pool.query(`UPDATE collectible_projects SET project = $2::jsonb, name = $3 WHERE id = $1`, [draft.id, JSON.stringify(v1), v1.name]);
  const copy = await projects.copy({ ...input, projectId: draft.id, expectedVersion: published.project.version });
  assert.equal(copy.status, 'DRAFT'); assert.equal(copy.project.schemaVersion, 2);
  assert.equal(copy.project.back.mode, 'default'); assert.equal(copy.project.motion[0]!.particle, 'confetti');
});

test('a PUT carrying a v1-shaped project (an old editor tab open across the deploy) is accepted and upgraded to v2', async t => {
  const { projects, input } = await setup(t);
  const draft = await projects.create({ ...input, project: photoProject() });
  const saved = await projects.save({ ...input, projectId: draft.id, expectedVersion: 1, project: v1Fixture() });
  assert.equal(saved.project.schemaVersion, 2); assert.equal(saved.project.back.mode, 'default');
  assert.deepEqual(saved.project.stickers[0]!.layouts, {}); assert.equal(saved.project.motion[0]!.particle, 'confetti');
});
