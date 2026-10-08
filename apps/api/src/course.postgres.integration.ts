import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';

import { CourseError } from './course-rules.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresCourseService } from './postgres/courses.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresReversalService } from './postgres/reversal.js';
import { PostgresRetentionService } from './postgres/retention.js';

const now = new Date('2026-10-08T03:00:00Z');
const secret = 'course-test-account-lifecycle-secret-32-bytes';
const draft = (merchantIds: string[], countsFrom: string | null = null) => ({
  title: '식사 후 모으는 장면', situation: 'AFTER_MEAL', sceneKey: 'test-picnic', countsFrom,
  steps: merchantIds.map((merchantId, index) => ({ merchantId, targetVisitCount: 1,
    pieceKey: `piece-${index + 1}`, pieceLabel: ['그릇', '컵', '봉투'][index] ?? '조각', ownerOptinRef: 'COURSE-OPTIN-REF' })),
});

test('courses: server progress, publish eligibility, concurrent unlock, stale reversal and deletion', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test'))
    throw new Error('dedicated TEST_DATABASE_URL required');
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE merchants, account_deletion_requests CASCADE');
  await pool.query(`INSERT INTO merchants(id,name,story,road_address,minimum_spend_won,status,is_demo,category,published_at)
    VALUES ('course-a','가게 A','','서울',0,'ACTIVE',false,'한식',$1),
      ('course-b','가게 B','','서울',0,'ACTIVE',false,'카페',$1),
      ('course-demo','가상 가게','','시연',0,'ACTIVE',true,'카페',$1),
      ('course-trial','체험 가게','','시연',0,'ACTIVE',false,'카페',$1)`, [now]);
  for (const [index, merchantId] of ['course-a', 'course-b', 'course-demo', 'course-trial'].entries()) {
    const latitude = 37.6 + index * 0.001;
    await pool.query(`INSERT INTO merchant_real_world_profiles(merchant_id,profile,latitude,longitude)
      VALUES ($1,$2,$3,127.07)`, [merchantId, JSON.stringify({ location: { building: { latitude, longitude: 127.07 } },
      schedule: null, todayOverride: null }), latitude]);
    await pool.query(`INSERT INTO campaigns(id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
      VALUES ($1,$2,'방문 수집','2026-10-01','2026-11-30','ACTIVE',true,20)`, [`campaign-${merchantId}`, merchantId]);
    await pool.query(`INSERT INTO campaign_goals(campaign_id,target_visit_count,display_name)
      VALUES ($1,1,'첫 방문')`, [`campaign-${merchantId}`]);
    await pool.query(`INSERT INTO merchant_members(merchant_id,account_id,role,status)
      VALUES ($1,'staff','STAFF','ACTIVE')`, [merchantId]);
  }
  await pool.query(`INSERT INTO showcase_guest_trials(merchant_id,account_id,client_key_hash,expires_at)
    VALUES ('course-trial','trial-owner',decode(repeat('ab',32),'hex'),'2026-11-01')`);

  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const service = new PostgresCourseService(pool, { now: () => now, accountLifecycle: lifecycle });

  await t.test('check and publish reject demo and guest trial stores', async () => {
    for (const merchantId of ['course-demo', 'course-trial']) {
      const created = await service.adminCreate('curator', draft(['course-a', merchantId]));
      const checked = await service.adminCheck('curator', created.id, null);
      assert.equal(checked.checkSummary?.ok, false);
      await assert.rejects(service.adminPublish('curator', created.id),
        (error: unknown) => error instanceof CourseError && error.code === 'COURSE_NOT_PUBLISHABLE');
    }
  });

  await t.test('publish needs a fresh successful check and both owner references', async () => {
    const missingCheck = await service.adminCreate('curator', draft(['course-a', 'course-b']));
    await assert.rejects(service.adminPublish('curator', missingCheck.id),
      (error: unknown) => error instanceof CourseError && error.reasons.includes('COURSE_CHECK_MISSING'));
    await service.adminCheck('curator', missingCheck.id, null);
    const late = new PostgresCourseService(pool, { now: () => new Date(now.getTime() + 3600001) });
    await assert.rejects(late.adminPublish('curator', missingCheck.id),
      (error: unknown) => error instanceof CourseError && error.reasons.includes('COURSE_CHECK_STALE'));
    const noOptin = draft(['course-a', 'course-b']);
    noOptin.steps[1]!.ownerOptinRef = '';
    const pending = await service.adminCreate('curator', noOptin);
    await service.adminCheck('curator', pending.id, null);
    await assert.rejects(service.adminPublish('curator', pending.id),
      (error: unknown) => error instanceof CourseError && error.reasons.includes('COURSE_OPTIN_MISSING'));
  });

  await t.test('a merchant without OWNED coordinates fails the saved check', async () => {
    await pool.query("DELETE FROM merchant_real_world_profiles WHERE merchant_id='course-b'");
    const missing = await service.adminCreate('curator', draft(['course-a', 'course-b']));
    const checked = await service.adminCheck('curator', missing.id, null);
    assert.equal(checked.checkSummary?.items.find(item => item.key === 'LOCATION_OWNED')?.status, 'FAIL');
    await assert.rejects(service.adminPublish('curator', missing.id),
      (error: unknown) => error instanceof CourseError && error.code === 'COURSE_NOT_PUBLISHABLE');
    await pool.query(`INSERT INTO merchant_real_world_profiles(merchant_id,profile,latitude,longitude)
      VALUES ('course-b',$1,37.601,127.07)`, [JSON.stringify({
      location: { building: { latitude: 37.601, longitude: 127.07 } }, schedule: null, todayOverride: null,
    })]);
  });

  const created = await service.adminCreate('curator', draft(['course-a', 'course-b']));
  const checked = await service.adminCheck('curator', created.id, null);
  assert.equal(checked.checkSummary?.ok, true);
  const published = await service.adminPublish('curator', created.id);
  assert.equal(published.status, 'ACTIVE');

  const visitAndEntitle = async (merchantId: string, accountId: string, earnedAt: string) => {
    const slot = randomUUID(), visit = randomUUID(), entitlement = randomUUID();
    await pool.query(`INSERT INTO claim_slots(id,merchant_id,customer_account_id,merchant_reference_hash,
      created_by_account_id,token_hash,status,expires_at,claimed_at,created_at,updated_at)
      VALUES ($1,$2,$3,$4,'staff',$5,'CLAIMED',$6,$7,$8,$8)`,
      [slot, merchantId, accountId, createHash('sha256').update(`ref:${slot}`).digest(),
        createHash('sha256').update(`token:${slot}`).digest(), new Date(Date.parse(earnedAt) + 900000),
        earnedAt, new Date(Date.parse(earnedAt) - 60000)]);
    await pool.query(`INSERT INTO visit_events(id,claim_slot_id,merchant_id,campaign_id,customer_account_id,
      occurred_at,business_date,verification_level,status,progress_counted)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'MERCHANT_CONFIRMED','VALID',$8)`,
      [visit, slot, merchantId, `campaign-${merchantId}`, accountId, earnedAt, earnedAt.slice(0, 10), true]);
    await pool.query(`INSERT INTO reward_entitlements(id,customer_account_id,campaign_id,
      target_visit_count,source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
      VALUES ($1,$2,$3,1,$4,'GRANTED','VISIT_1_3_5_KST_DAILY_V1',$5,$6)`,
      [entitlement, accountId, `campaign-${merchantId}`, visit, earnedAt,
        new Date(Date.parse(earnedAt) + 90 * 86400000)]);
    return { entitlement, visit };
  };

  await t.test('staff self-claim with no entitlement does not complete a step', async () => {
    const claims = new PostgresClaimSlotService(pool, {
      now: () => now, referenceHmacSecret: 'course-claim-reference-secret-at-least-32-bytes', accountLifecycle: lifecycle,
    });
    const slot = await claims.issue({ merchantId: 'course-a', customerAccountId: 'staff',
      merchantReference: randomUUID(), createdByAccountId: 'staff' });
    const received = await claims.redeem({ accountId: 'staff', token: slot.token });
    assert.equal(received.visit.progressCounted, false);
    assert.deepEqual(received.grantedRewards, []);
    assert.equal((await pool.query("SELECT 1 FROM reward_entitlements WHERE customer_account_id='staff'")).rowCount, 0);
    assert.equal((await service.get('staff', published.id)).done, 0);
    await assert.rejects(service.unlock('staff', published.id),
      (error: unknown) => error instanceof CourseError && error.code === 'COURSE_INCOMPLETE');
  });

  await t.test('concurrent unlocks create one row, then replay is idempotent', async () => {
    await visitAndEntitle('course-a', 'course-customer', '2026-10-07T01:00:00Z');
    const second = await visitAndEntitle('course-b', 'course-customer', '2026-10-08T01:00:00Z');
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => service.unlock('course-customer', published.id)));
    assert.equal(outcomes.filter(outcome => !outcome.replayed).length, 1);
    assert.equal(outcomes.filter(outcome => outcome.replayed).length, 7);
    assert.equal(outcomes[0]!.course.state, 'UNLOCKED');
    const count = await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM course_unlocks WHERE account_id = $1', ['course-customer']);
    assert.equal(count.rows[0]!.count, 1);
    const reversal = new PostgresReversalService(pool, { now: () => now,
      labelHmacSecret: 'course-reversal-label-secret-at-least-32-bytes', accountLifecycle: lifecycle });
    await reversal.cancelVisit({ merchantId: 'course-b', staffAccountId: 'staff', visitEventId: second.visit,
      reason: 'WRONG_CUSTOMER' });
    assert.equal((await pool.query('SELECT status FROM reward_entitlements WHERE id=$1', [second.entitlement])).rows[0]?.status,
      'CANCELED');
    const after = await service.get('course-customer', published.id);
    assert.equal(after.state, 'STALE');
    assert.deepEqual(after.steps.map(step => step.done), [true, false]);
  });

  await t.test('counts_from excludes earlier entitlements', async () => {
    const later = await service.adminCreate('curator', draft(['course-a', 'course-b'], '2026-10-08T02:00:00Z'));
    await service.adminCheck('curator', later.id, null);
    await service.adminPublish('curator', later.id);
    assert.equal((await service.get('course-customer', later.id)).done, 0);
  });

  await t.test('without counts_from, a visit earned before publication still completes its step', async () => {
    const backfilled = await service.adminCreate('curator', draft(['course-a', 'course-b']));
    await service.adminCheck('curator', backfilled.id, null);
    await service.adminPublish('curator', backfilled.id);
    assert.deepEqual((await service.get('course-customer', backfilled.id)).steps.map(step => step.done), [true, false]);
  });

  await t.test('a completed step keeps its own published coin thumbnail after its campaign ends', async () => {
    const entitlement = (await pool.query<{ id: string }>(
      `SELECT id FROM reward_entitlements WHERE customer_account_id='course-customer'
       AND campaign_id='campaign-course-a'`)).rows[0]!.id;
    const projectId = randomUUID(), publicationId = randomUUID();
    await pool.query(`INSERT INTO collectible_projects(id,merchant_id,lineage_id)
      VALUES ($1,'course-a',$1)`, [projectId]);
    await pool.query(`INSERT INTO collectible_publications(id,project_id,merchant_id,campaign_id,project_version,reward_grades)
      VALUES ($1,$2,'course-a','campaign-course-a',1,'{"1":"bronze"}')`, [publicationId, projectId]);
    const artwork = { gradeId: 'bronze', gradeName: '브론즈', shape: 'ROUND', name: '가게 A 코인',
      theme: { name: '테스트' }, thumbnailDataUrl: 'data:image/png;base64,dGVzdA==' };
    await pool.query(`INSERT INTO collectible_publication_grades(publication_id,grade_id,summary,detail)
      VALUES ($1,'bronze',$2,'{}')`, [publicationId, JSON.stringify(artwork)]);
    await pool.query(`INSERT INTO collectible_acquisitions(entitlement_id,publication_id,grade_id)
      VALUES ($1,$2,'bronze')`, [entitlement, publicationId]);
    await pool.query("UPDATE campaigns SET status='ENDED' WHERE id='campaign-course-a'");
    const detail = await service.get('course-customer', published.id);
    assert.equal(detail.steps[0]?.artwork?.thumbnailDataUrl, artwork.thumbnailDataUrl);
    await pool.query("UPDATE campaigns SET status='ACTIVE' WHERE id='campaign-course-a'");
  });

  await t.test('ACTIVE step terms cannot be changed, added, or deleted', async () => {
    await assert.rejects(pool.query("UPDATE course_steps SET piece_label='변경' WHERE course_id=$1 AND position=1", [published.id]),
      (error: unknown) => (error as { code?: string }).code === '23514');
    await assert.rejects(pool.query('DELETE FROM course_steps WHERE course_id=$1 AND position=1', [published.id]),
      (error: unknown) => (error as { code?: string }).code === '23514');
    await assert.rejects(pool.query(`INSERT INTO course_steps(course_id,position,merchant_id,piece_key,piece_label)
      VALUES ($1,3,'course-demo','piece-3','봉투')`, [published.id]),
      (error: unknown) => (error as { code?: string }).code === '23514');
  });

  await t.test('pause removes the course from customer reads', async () => {
    assert.equal((await service.adminPause('curator', published.id)).status, 'PAUSED');
    await assert.rejects(service.get('course-customer', published.id),
      (error: unknown) => error instanceof CourseError && error.code === 'COURSE_NOT_FOUND');
  });

  await t.test('account deletion removes unlock rows and curator identity', async () => {
    const deletion = new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test', now: () => now,
      accountLifecycle: lifecycle });
    await deletion.requestDeletion({ accountId: 'course-customer', confirmation: 'DELETE MY ACCOUNT' });
    assert.equal((await pool.query('SELECT 1 FROM course_unlocks WHERE account_id=$1', ['course-customer'])).rowCount, 0);
    await deletion.requestDeletion({ accountId: 'curator', confirmation: 'DELETE MY ACCOUNT' });
    assert.equal((await pool.query("SELECT 1 FROM courses WHERE curated_by_account_id='curator'")).rowCount, 0);
  });

  await t.test('retention repair respects its row cap for multiple orphan unlocks of one deleted account', async () => {
    // Simulate a rollback image that writes old data after the deletion ledger was already recorded.
    await pool.query("DELETE FROM retention_scan_progress WHERE step='deleted_play_data'");
    const otherCourseId = (await pool.query<{ id: string }>(
      'SELECT id FROM courses WHERE id <> $1 ORDER BY id LIMIT 1', [published.id])).rows[0]!.id;
    await pool.query(`INSERT INTO course_unlocks(account_id,course_id,evidence) VALUES
      ('course-customer',$1,'{}'),('course-customer',$2,'{}')`, [published.id, otherCourseId]);
    const retention = new PostgresRetentionService(pool, { now: () => now, playBatchSize: 1, playMaxBatches: 1 });
    const first = await retention.run({ hmacSecret: secret });
    assert.equal(first.counts.find(entry => entry.step === 'deleted_play_data')?.count, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM course_unlocks WHERE account_id='course-customer'"))
      .rows[0]?.n, 1);
    const second = await retention.run({ hmacSecret: secret });
    assert.equal(second.counts.find(entry => entry.step === 'deleted_play_data')?.count, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM course_unlocks WHERE account_id='course-customer'"))
      .rows[0]?.n, 0);
  });
});
