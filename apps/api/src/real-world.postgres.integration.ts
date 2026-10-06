import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { AdminError, assertPlatformAdmin } from './postgres/admin.js';
import { PostgresCampaignEnrollmentService } from './postgres/campaign-enrollment.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresPlayService } from './postgres/play.js';
import { PostgresRealWorldService } from './postgres/real-world.js';
import { PostgresMerchantProfileService } from './postgres/merchant-profile.js';
import type { DiscoveryEvent, RealWorldProfile } from './real-world-contract.js';
import type { Studio } from './play.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
}

test('discovery keeps same-name branches, unlocated stores and ended campaigns distinct', async t => {
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await runMigrations(pool);
  await pool.query('TRUNCATE platform_admins, auth_identities CASCADE');
  await pool.query('TRUNCATE merchants CASCADE');
  await pool.query(`INSERT INTO merchants
    (id,name,story,road_address,minimum_spend_won,status,is_demo,published_at,category)
    VALUES ('rw-a','같은 이름','A','서울 같은 건물 1층',0,'ACTIVE',false,now(),'카페'),
           ('rw-b','같은 이름','B','서울 같은 건물 2층',0,'ACTIVE',false,now(),'카페'),
           ('rw-c','좌표 미확인','C','서울 다른 곳',0,'ACTIVE',false,now(),'한식'),
           ('rw-unpublished','비공개','D','서울',0,'ACTIVE',false,NULL,'카페'),
           ('rw-demo','체험','E','서울',0,'ACTIVE',true,now(),'카페')`);
  const profile: RealWorldProfile = { location: { building: { latitude: 37.5, longitude: 127 }, entrance: null,
    floor: '1층', unit: null, entranceNote: null, source: 'OWNER_DECLARED',
    verificationNote: '실제 점주 제공', verifiedAt: '2026-10-05T00:00:00Z' },
    schedule: null, todayOverride: null, menuItems: [], visitInstructions: '', contact: { phone: null, website: null } };
  await pool.query(`INSERT INTO merchant_real_world_profiles (merchant_id,profile,latitude,longitude)
    VALUES ('rw-a',$1,37.5,127),('rw-b',$1,37.5,127)`, [JSON.stringify(profile)]);
  const openSchedule = { timezone: 'Asia/Seoul', weekly: Array.from({ length: 7 }, (_, index) =>
    ({ weekday: index + 1, periods: [{ startMinute: 0, endMinute: 1440, lastOrderMinute: null }] })),
  exceptions: [], verifiedAt: '2026-10-05T00:00:00Z' };
  await pool.query(`UPDATE merchant_real_world_profiles SET profile = jsonb_set(profile, '{schedule}', $1::jsonb)
    WHERE merchant_id IN ('rw-a','rw-b')`, [JSON.stringify(openSchedule)]);
  await pool.query(`UPDATE merchants SET menu_items='[{"name":"옛 메뉴","priceWon":5000}]'::jsonb WHERE id='rw-c'`);
  await pool.query(`INSERT INTO campaigns (id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES ('rw-ended','rw-a','종료된 행사','2026-01-01','2026-02-01','ENDED',true,10)`);
  await pool.query(`INSERT INTO merchant_members (merchant_id,account_id,role,status)
    VALUES ('rw-a','rw-owner','OWNER','ACTIVE'),('rw-a','rw-staff','STAFF','ACTIVE'),
      ('rw-unpublished','rw-preview-owner','OWNER','ACTIVE')`);
  const media = new Map<string, Uint8Array>();
  const store = { async save(bytes: Uint8Array) { const digest = createHash('sha256').update(bytes).digest('hex');
    await pool.query(`INSERT INTO merchant_real_world_media (digest,width,height,image_bytes)
      VALUES ($1,10,10,$2) ON CONFLICT (digest) DO NOTHING`, [digest, bytes]);
    media.set(digest, bytes); return { digest, width: 10, height: 10 }; },
  async read(digest: string) { return media.get(digest) ?? null; } };
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'real-world-integration-test-secret-over-32' });
  const service = new PostgresRealWorldService(pool, { now: () => new Date('2026-10-06T00:00:00Z'),
    accountLifecycle: lifecycle, mediaStore: store });
  const query = { bounds: { west: 126, east: 128, south: 36, north: 38 }, zoom: 16, limit: 1 };
  const first = await service.search(query);
  assert.equal(first.merchants.length, 1);
  assert.ok(first.nextCursor);
  const second = await service.search({ ...query, cursor: first.nextCursor! });
  assert.equal(second.merchants.length, 1);
  assert.notEqual(first.merchants[0]!.id, second.merchants[0]!.id);
  assert.equal(first.unlocatedCount, 1);
  const openFirst = await service.search({ ...query, openOnly: true });
  assert.equal(openFirst.merchants.length, 1);
  assert.equal(openFirst.clusters[0]?.count, 2, 'open cluster includes same-building shop beyond limit-one page');
  const openSecond = await service.search({ ...query, openOnly: true, cursor: openFirst.nextCursor! });
  assert.equal(openSecond.clusters[0]?.count, 2, 'open cluster count is independent of cursor');
  await pool.query(`UPDATE merchant_real_world_profiles
    SET profile = jsonb_set(profile, '{schedule,exceptions}', $2::jsonb)
    WHERE merchant_id = $1`, ['rw-b', JSON.stringify([{ date: '2026-10-06', periods: [], note: '휴무' }])]);
  assert.equal((await service.search({ ...query, openOnly: true })).clusters[0]?.count, 1,
    'closed same-building shop is excluded while the open singleton remains');
  const together = await service.search({ ...query, limit: 5 });
  assert.equal(together.clusters[0]?.count, 2);
  await assert.rejects(service.search({ ...query, bounds: { ...query.bounds, north: 37 }, cursor: first.nextCursor! }),
    { code: 'DISCOVERY_CURSOR_INVALID' });
  const detail = await service.merchant('rw-a');
  assert.equal(detail.campaign?.state, 'ENDED');
  assert.equal(detail.campaign?.rewardAvailability, 'NOT_RUNNING');
  assert.equal(Object.hasOwn(detail.location ?? {}, 'verificationNote'), false);
  assert.equal(JSON.stringify(detail).includes('실제 점주 제공'), false);
  await pool.query(`INSERT INTO campaigns (id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES ('rw-active','rw-b','실제 수집품 행사','2026-01-01','2027-01-01','ACTIVE',true,2)`);
  await pool.query(`INSERT INTO campaign_goals (campaign_id,target_visit_count,display_name)
    VALUES ('rw-active',1,'첫 방문'),('rw-active',3,'셋째 방문'),('rw-active',5,'다섯째 방문')`);
  assert.equal((await service.merchant('rw-b')).campaign?.rewardAvailability, 'UNKNOWN',
    'active campaign without a linked valid collectible does not claim availability');
  const projectId = randomUUID(), publicationId = randomUUID();
  await pool.query(`INSERT INTO collectible_projects (id,merchant_id,lineage_id)
    VALUES ($1,'rw-b',$1)`, [projectId]);
  await pool.query(`INSERT INTO collectible_publications
    (id,project_id,merchant_id,campaign_id,project_version,reward_grades)
    VALUES ($1,$2,'rw-b','rw-active',1,'{"1":"silver"}'::jsonb)`, [publicationId, projectId]);
  await pool.query(`INSERT INTO collectible_publication_grades (publication_id,grade_id,summary,detail)
    VALUES ($1,'silver','{"gradeId":"silver","gradeName":"실버","name":"실제 수집품"}'::jsonb,'{}'::jsonb)`, [publicationId]);
  await pool.query(`INSERT INTO campaign_collectible_publications (campaign_id,publication_id)
    VALUES ('rw-active',$1)`, [publicationId]);
  assert.equal((await service.merchant('rw-b')).campaign?.rewardAvailability, 'AVAILABLE');
  assert.equal((await service.gameContent(['rw-b']))[0]?.campaign?.rewardAvailability, 'AVAILABLE');
  await pool.query(`INSERT INTO merchant_members (merchant_id,account_id,role,status)
    VALUES ('rw-b','rw-b-staff','STAFF','ACTIVE')`);
  const slotId = randomUUID(), visitId = randomUUID(), rightId = randomUUID();
  await pool.query(`INSERT INTO campaign_enrollments (id,campaign_id,account_id,enrolled_at)
    VALUES ($1,'rw-active','rw-owned','2026-10-05')`, [randomUUID()]);
  await pool.query(`INSERT INTO claim_slots (id,merchant_id,customer_account_id,merchant_reference_hash,
    created_by_account_id,token_hash,status,expires_at,claimed_at,created_at,updated_at)
    VALUES ($1,'rw-b','rw-owned',decode(repeat('11',32),'hex'),'rw-b-staff',
      decode(repeat('22',32),'hex'),'CLAIMED','2026-10-07','2026-10-05','2026-10-05','2026-10-05')`, [slotId]);
  await pool.query(`INSERT INTO visit_events (id,claim_slot_id,merchant_id,campaign_id,customer_account_id,
    occurred_at,business_date,verification_level,status,progress_counted)
    VALUES ($1,$2,'rw-b','rw-active','rw-owned','2026-10-05','2026-10-05',
      'MERCHANT_CONFIRMED','VALID',true)`, [visitId, slotId]);
  await pool.query(`INSERT INTO reward_entitlements (id,customer_account_id,campaign_id,target_visit_count,
    source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
    VALUES ($1,'rw-owned','rw-active',1,$2,'GRANTED','test','2026-10-05','2027-01-01')`,
  [rightId, visitId]);
  assert.equal((await pool.query('SELECT 1 FROM collectible_acquisitions WHERE entitlement_id=$1', [rightId])).rowCount, 1);
  await pool.query(`UPDATE campaigns SET enrolled_count=2 WHERE id='rw-active'`);
  assert.deepEqual({ enrollment: (await service.merchant('rw-b')).campaign?.enrollment,
    collectible: (await service.merchant('rw-b')).campaign?.rewardAvailability },
  { enrollment: 'FULL', collectible: 'AVAILABLE' });
  const enrollment = new PostgresCampaignEnrollmentService(pool, {
    now: () => new Date('2026-10-06T00:00:00Z'), accountLifecycle: lifecycle });
  await assert.rejects(enrollment.enroll({ accountId: 'rw-new', campaignId: 'rw-active' }),
    { code: 'CAMPAIGN_FULL' });
  assert.equal((await enrollment.enroll({ accountId: 'rw-owned', campaignId: 'rw-active' })).created, false);
  const wantedGoal: Studio = { theme: 'daylight', layout: 'shelf', accent: 'mint', slots: [], goal: {
    kind: 'collectible', merchantId: 'rw-b', campaignId: 'rw-active', publicationId,
    targetVisitCount: 1 } };
  const play = new PostgresPlayService(pool, lifecycle, { now: () => new Date('2026-10-06T00:00:00Z') });
  assert.deepEqual((await play.saveStudio({ accountId: 'rw-owned', studio: wantedGoal })).studio.goal,
    wantedGoal.goal);
  assert.equal((await pool.query(`SELECT 1 FROM campaign_enrollments WHERE account_id='rw-owned'`)).rowCount, 1);
  const mediaClient = await pool.connect();
  try {
    await mediaClient.query('BEGIN');
    await mediaClient.query("SET LOCAL masscom.collectible_media_removal = 'on'");
    await mediaClient.query(`UPDATE collectible_publications SET media_removed_at=now() WHERE id=$1`, [publicationId]);
    await mediaClient.query('COMMIT');
  } catch (error) { await mediaClient.query('ROLLBACK'); throw error; }
  finally { mediaClient.release(); }
  assert.equal((await service.merchant('rw-b')).campaign?.rewardAvailability, 'UNKNOWN');
  await pool.query(`UPDATE campaigns SET status='ENDED' WHERE id='rw-active'`);
  assert.equal((await service.merchant('rw-b')).campaign?.rewardAvailability, 'NOT_RUNNING');
  assert.equal((await pool.query(`SELECT 1 FROM reward_entitlements WHERE id=$1 AND status='GRANTED'`, [rightId])).rowCount, 1);
  assert.equal((await pool.query('SELECT 1 FROM collectible_acquisitions WHERE entitlement_id=$1', [rightId])).rowCount, 1);
  assert.deepEqual((await play.getStudio('rw-owned')).studio.goal, wantedGoal.goal);
  const legacyDetail = await service.merchant('rw-c');
  assert.equal(legacyDetail.position, null);
  assert.equal(legacyDetail.menuItems[0]?.name, '옛 메뉴');
  await assert.rejects(service.merchant('rw-unpublished'), { code: 'MERCHANT_NOT_FOUND' });
  await assert.rejects(service.merchant('rw-demo'), { code: 'MERCHANT_NOT_FOUND' });
  await assert.rejects(service.profile('rw-staff', 'rw-a'), { code: 'MERCHANT_FORBIDDEN' });
  const owner = await service.profile('rw-owner', 'rw-a');
  assert.equal(owner.version, 1);
  assert.equal(owner.profile.location?.verificationNote, '실제 점주 제공');
  await assert.rejects(service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 1,
    profile: { ...profile, location: { ...profile.location!, source: 'ADMIN_DOCUMENTED' } } }),
  { code: 'LOCATION_SOURCE_FORBIDDEN' });
  const changed = await service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 1, profile });
  assert.equal(changed.version, 2);
  const legacy = await new PostgresMerchantProfileService(pool, { accountLifecycle: lifecycle }).updateProfile({
    accountId: 'rw-owner', merchantId: 'rw-a', body: { story: '옛 화면의 수정', businessHours: '11-20',
      menuItems: [{ name: '국수', priceWon: 9000 }], expectedVersion: 2 },
  });
  assert.equal(legacy.version, 3);
  assert.deepEqual((await service.profile('rw-owner', 'rw-a')).profile.location?.building,
    { latitude: 37.5, longitude: 127 });
  await assert.rejects(service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 1, profile }),
    { code: 'VERSION_CONFLICT' });
  const bytes = new Uint8Array(24).fill(2);
  await assert.rejects(service.createPhoto('rw-staff', 'rw-a', { expectedVersion: 3, kind: 'STORE',
    caption: null, rightsConfirmed: true, bytes, mimeType: 'image/png' }), { code: 'MERCHANT_FORBIDDEN' });
  assert.equal(media.size, 0);
  const uploaded = await service.createPhoto('rw-owner', 'rw-a', { expectedVersion: 3, kind: 'STORE',
    caption: null, rightsConfirmed: true, bytes, mimeType: 'image/png' });
  assert.equal(uploaded.photos.length, 1);
  const photoId = uploaded.photos[0]!.id;
  const attached: RealWorldProfile = { ...profile, menuItems: [
    { id: 'shared-1', name: '첫 메뉴', priceWon: 5000, priceNote: null, photoId },
    { id: 'shared-2', name: '둘째 메뉴', priceWon: 6000, priceNote: null, photoId },
  ] };
  const attachedView = await service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 4, profile: attached });
  assert.deepEqual(attachedView.profile.menuItems.map(item => item.photoId), [photoId, photoId]);
  const foreignPhotoId = randomUUID();
  const foreignMedia = await store.save(new Uint8Array(24).fill(3));
  await pool.query(`INSERT INTO merchant_real_world_photos
    (id,merchant_id,digest,mime_type,width,height,kind) VALUES ($1,'rw-b',$2,'image/webp',10,10,'STORE')`,
  [foreignPhotoId, foreignMedia.digest]);
  await assert.rejects(service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 5,
    profile: { ...attached, menuItems: [{ ...attached.menuItems[0]!, photoId: foreignPhotoId }] } }),
  { code: 'PROFILE_PHOTO_INVALID' });
  assert.ok(await service.publicPhoto(createHash('sha256').update(bytes).digest('hex')));
  assert.ok(await service.privatePhoto('rw-owner', 'rw-a', photoId));
  await assert.rejects(service.privatePhoto('rw-staff', 'rw-a', photoId),
    { code: 'MERCHANT_FORBIDDEN' });
  await assert.rejects(service.deletePhoto('rw-staff', 'rw-a', photoId, 5),
    { code: 'MERCHANT_FORBIDDEN' });
  const removed = await service.deletePhoto('rw-owner', 'rw-a', photoId, 5);
  assert.equal(removed.photos.length, 0);
  assert.deepEqual(removed.profile.menuItems.map(item => item.photoId), [null, null]);
  assert.deepEqual((await service.merchant('rw-a')).menuItems.map(item => item.photoId), [null, null]);
  assert.deepEqual((await service.gameContent(['rw-a']))[0]?.menuItems.map(item => item.photoId), [null, null]);
  const unrelated = await service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 6,
    profile: { ...removed.profile, visitInstructions: '입구로 와주세요' } });
  assert.deepEqual(unrelated.profile.menuItems.map(item => item.photoId), [null, null]);
  await assert.rejects(service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 7, profile: attached }),
    { code: 'PROFILE_PHOTO_INVALID' });
  assert.equal(await service.publicPhoto(createHash('sha256').update(bytes).digest('hex')), null);

  const previewProfile: RealWorldProfile = { ...profile,
    location: { ...profile.location!, entrance: { latitude: 37.5001, longitude: 127.0001 },
      entranceNote: '1층 문', verificationNote: '비공개 확인 증거' },
    schedule: openSchedule as RealWorldProfile['schedule'],
    menuItems: [{ id: 'preview-menu', name: '실제 국수', priceWon: 7000, priceNote: null, photoId: null }],
    visitInstructions: '직원에게 알려주세요', contact: { phone: '02-1234-5678', website: null } };
  const drafted = await service.updateProfile('rw-preview-owner', 'rw-unpublished',
    { expectedVersion: 1, profile: previewProfile });
  assert.equal(drafted.preview?.menuItems[0]?.name, '실제 국수');
  const previewImage = await service.createPhoto('rw-preview-owner', 'rw-unpublished',
    { expectedVersion: 2, kind: 'ENTRANCE', caption: '가게 입구', rightsConfirmed: true,
      bytes: new Uint8Array(24).fill(4), mimeType: 'image/png' });
  await pool.query(`UPDATE merchants SET status='PAUSED' WHERE id='rw-unpublished'`);
  const privateView = await service.profile('rw-preview-owner', 'rw-unpublished');
  assert.equal(privateView.version, 3);
  assert.equal(privateView.profile.location?.verificationNote, '비공개 확인 증거');
  assert.deepEqual({ name: privateView.preview?.name, address: privateView.preview?.roadAddress,
    menu: privateView.preview?.menuItems[0]?.name, price: privateView.preview?.menuItems[0]?.priceWon,
    hours: privateView.preview?.business.state, entrance: privateView.preview?.location?.entranceNote,
    conditions: privateView.preview?.visitInstructions, phone: privateView.preview?.contact.phone,
    photoId: privateView.preview?.photos[0]?.id, campaign: privateView.preview?.campaign },
  { name: '비공개', address: '서울', menu: '실제 국수', price: 7000, hours: 'OPEN', entrance: '1층 문',
    conditions: '직원에게 알려주세요', phone: '02-1234-5678',
    photoId: previewImage.photos[0]!.id, campaign: null });
  assert.equal(Object.hasOwn(privateView.preview?.location ?? {}, 'verificationNote'), false);
  assert.equal(JSON.stringify(privateView.preview).includes('비공개 확인 증거'), false);
  assert.deepEqual((await pool.query<{ published_at: Date | null; status: string; version: number }>(
    `SELECT published_at,status,version FROM merchants WHERE id='rw-unpublished'`)).rows[0],
  { published_at: null, status: 'PAUSED', version: 3 });
  await assert.rejects(service.merchant('rw-unpublished'), { code: 'MERCHANT_NOT_FOUND' });
  assert.equal(await service.publicPhoto(createHash('sha256').update(new Uint8Array(24).fill(4)).digest('hex')), null);
  assert.ok(await service.privatePhoto('rw-preview-owner', 'rw-unpublished', previewImage.photos[0]!.id));
  await assert.rejects(service.profile('rw-staff', 'rw-unpublished'), { code: 'MERCHANT_FORBIDDEN' });

  const report = await service.report('rw-reporter', 'rw-a', { kind: 'HOURS', note: '운영시간 확인 요청' });
  assert.equal((await service.reports('rw-owner', 'rw-a'))[0]?.id, report.id);
  assert.equal((await service.resolveReport('rw-owner', 'rw-a', report.id,
    { status: 'RESOLVED', resolution: '점주가 확인함' })).status, 'RESOLVED');
  const eventId = randomUUID();
  await assert.rejects(service.recordEvent({ eventId: randomUUID(), merchantId: 'rw-a',
    event: 'MAP_SELECT', source: 'map', latitude: 37.5 } as unknown as DiscoveryEvent), { code: 'EVENT_INVALID' });
  await service.recordEvent({ eventId, merchantId: 'rw-a', event: 'MAP_SELECT', source: 'map' });
  await service.recordEvent({ eventId, merchantId: 'rw-a', event: 'MAP_SELECT', source: 'map' });
  assert.equal((await service.engagement('rw-owner', 'rw-a')).counts.mapSelect, 1);
  assert.equal((await service.gameContent(['rw-a', 'rw-unpublished'])).length, 1);
  await pool.query(`INSERT INTO auth_identities (provider,subject,account_id,created_at)
    VALUES ('google','rw-admin-subject','rw-admin',now())`);
  await pool.query(`INSERT INTO platform_admins (account_id) VALUES ('rw-admin')`);
  const admin = new PostgresRealWorldService(pool, { now: () => new Date('2026-10-06T00:00:00Z'),
    accountLifecycle: lifecycle, mediaStore: store, isAdmin: async (client, accountId) => {
      await client.query("SET LOCAL statement_timeout = '2s'");
      try { await assertPlatformAdmin(client, lifecycle, accountId); return true; }
      catch (error) { if (error instanceof AdminError && error.code === 'ADMIN_FORBIDDEN') return false; throw error; }
    } });
  const adminLocation = { ...profile, location: { ...profile.location!, source: 'ADMIN_DOCUMENTED' as const } };
  const adminChange = await admin.updateProfile('rw-admin', 'rw-a', { expectedVersion: 7, profile: adminLocation });
  assert.equal(adminChange.version, 8);
  assert.equal((await admin.profile('rw-admin', 'rw-a')).profile.location?.source, 'ADMIN_DOCUMENTED');
  const adminDraft = await admin.profile('rw-admin', 'rw-unpublished');
  assert.equal(adminDraft.preview?.menuItems[0]?.name, '실제 국수');
  assert.equal(Object.hasOwn(adminDraft.preview?.location ?? {}, 'verificationNote'), false);
  await assert.rejects(admin.profile('rw-outsider', 'rw-a'), { code: 'MERCHANT_FORBIDDEN' });
  const ownerPreserve = await service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 8,
    profile: { ...adminLocation, visitInstructions: '계단으로 오세요' } });
  assert.equal(ownerPreserve.version, 9);
  await pool.query(`UPDATE platform_admins SET revoked_at=now() WHERE account_id='rw-admin'`);
  await assert.rejects(admin.profile('rw-admin', 'rw-a'), { code: 'MERCHANT_FORBIDDEN' });
  const competing = await Promise.allSettled([
    service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 9, profile: ownerPreserve.profile }),
    service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 9, profile: ownerPreserve.profile }),
  ]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(competing.filter(result => result.status === 'rejected' &&
    result.reason?.code === 'VERSION_CONFLICT').length, 1);
  await pool.query(`UPDATE merchant_members SET status='REVOKED', revoked_at=now() WHERE merchant_id='rw-a' AND account_id='rw-owner'`);
  await assert.rejects(service.updateProfile('rw-owner', 'rw-a', { expectedVersion: 10, profile }),
    { code: 'MERCHANT_FORBIDDEN' });

  await pool.query(`INSERT INTO merchants (id,name,story,road_address,minimum_spend_won,status,is_demo,published_at)
    SELECT 'rw-solo-' || n, 'Solo ' || n, '', '서울 서로 다른 건물', 0, 'ACTIVE', false, now()
    FROM generate_series(1,40) AS g(n)`);
  await pool.query(`INSERT INTO merchant_real_world_profiles (merchant_id,profile,latitude,longitude)
    SELECT 'rw-solo-' || n,
      jsonb_set(jsonb_set($1::jsonb, '{location,building,latitude}', to_jsonb(36.5 + n * 0.01)),
        '{location,building,longitude}', '127.5'::jsonb),
      36.5 + n * 0.01, 127.5
    FROM generate_series(1,40) AS g(n)`, [JSON.stringify({ ...profile, schedule: openSchedule })]);
  const allCells = await service.search({ ...query, limit: 1 });
  assert.equal(allCells.clusters.length, 41, 'full bounded map includes every singleton cell beyond page one');
  assert.equal(allCells.clusters.filter(cluster => cluster.count === 1).length, 40);
  const openCells = await service.search({ ...query, limit: 1, openOnly: true });
  assert.equal(openCells.clusters.length, 40);
  assert.ok(openCells.clusters.every(cluster => cluster.count === 1));

  await pool.query(`INSERT INTO merchants (id,name,story,road_address,minimum_spend_won,status,is_demo,published_at)
    SELECT 'rw-dense-' || n, 'Dense ' || n, '', '서울 같은 건물', 0, 'ACTIVE', false, now()
    FROM generate_series(1,5001) AS n`);
  await pool.query(`INSERT INTO merchant_real_world_profiles (merchant_id,profile,latitude,longitude)
    SELECT 'rw-dense-' || n, $1::jsonb, 37.5, 127
    FROM generate_series(1,5001) AS n`, [JSON.stringify({ ...profile, schedule: openSchedule })]);
  await assert.rejects(service.search({ ...query, openOnly: true }), { code: 'DISCOVERY_ZOOM_REQUIRED' });
});
