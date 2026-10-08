import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';

import { CourseError } from './course-rules.js';
import { MerchantAccessError } from './merchant-access.js';
import { AdminError } from './postgres/admin.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresCourseService } from './postgres/courses.js';
import { PostgresRecommendationSource } from './postgres/recommendation.js';
import { RecommendationService } from './recommendation-service.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresReversalService } from './postgres/reversal.js';
import { PostgresRetentionService } from './postgres/retention.js';

const now = new Date('2026-10-08T03:00:00Z');
const secret = 'course-test-account-lifecycle-secret-32-bytes';
const draft = (merchantIds: string[], countsFrom: string | null = null) => ({
  title: '식사 후 모으는 장면', situation: 'AFTER_MEAL', sceneKey: 'test-picnic', countsFrom,
  startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z',
  steps: merchantIds.map((merchantId, index) => ({ merchantId, targetVisitCount: 1,
    pieceKey: `piece-${index + 1}`, pieceLabel: ['그릇', '컵', '봉투'][index] ?? '조각', ownerOptinRef: `COURSE-OPTIN-REF-${index + 1}` })),
});

test('courses: server progress, publish eligibility, concurrent unlock, stale reversal and deletion', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test'))
    throw new Error('dedicated TEST_DATABASE_URL required');
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query('TRUNCATE merchants, account_deletion_requests, platform_admins, auth_identities CASCADE');
  await pool.query(`INSERT INTO auth_identities(provider,subject,account_id,created_at)
    VALUES ('google','course-curator-subject','curator',now()),
      ('google','course-revoked-subject','revoked-curator',now())`);
  await pool.query("INSERT INTO platform_admins(account_id) VALUES ('curator'),('revoked-curator')");
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
  await pool.query(`INSERT INTO merchant_members(merchant_id,account_id,role,status)
    VALUES ('course-a','owner-a','OWNER','ACTIVE')`);
  await pool.query(`INSERT INTO showcase_guest_trials(merchant_id,account_id,client_key_hash,expires_at)
    VALUES ('course-trial','trial-owner',decode(repeat('ab',32),'hex'),'2026-11-01')`);

  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const service = new PostgresCourseService(pool, { now: () => now, accountLifecycle: lifecycle });

  await t.test('only this store owner can register its own draft opt-in reference', async () => {
    const input = draft(['course-a', 'course-b']);
    input.steps[0]!.ownerOptinRef = '';
    const created = await service.adminCreate('curator', input);
    await assert.rejects(service.merchantList('staff', 'course-a'), MerchantAccessError);
    const listed = await service.merchantList('owner-a', 'course-a');
    assert.equal(listed.find(course => course.id === created.id)?.ownerOptinRef, null);
    await assert.rejects(service.merchantOptIn('owner-a', 'course-b', created.id, 'OPTIN-NEW'), MerchantAccessError);
    await assert.rejects(service.merchantOptIn('owner-a', 'course-a', created.id, '010-1234-5678'),
      (error: unknown) => error instanceof CourseError && error.code === 'COURSE_INVALID_INPUT');
    await assert.rejects(service.merchantOptIn('owner-a', 'course-a', created.id, 'COURSE-OPTIN-REF-2'),
      (error: unknown) => error instanceof CourseError && error.code === 'COURSE_INVALID_INPUT');
    const opted = await service.merchantOptIn('owner-a', 'course-a', created.id, 'OPTIN-NEW');
    assert.equal(opted.ownerOptinRef, 'OPTIN-NEW');
    assert.equal(opted.steps.length, 2);
    assert.equal((await service.merchantOptIn('owner-a', 'course-a', created.id, 'OPTIN-NEW')).ownerOptinRef,
      'OPTIN-NEW');
    assert.equal((await service.adminList('curator')).find(course => course.id === created.id)?.steps[0]?.ownerOptinRef,
      'OPTIN-NEW');
  });

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
    const noWindow = await service.adminCreate('curator', { ...draft(['course-a', 'course-b']),
      startsAt: null, endsAt: null });
    await service.adminCheck('curator', noWindow.id, null);
    await assert.rejects(service.adminPublish('curator', noWindow.id),
      (error: unknown) => error instanceof CourseError && error.reasons.includes('COURSE_WINDOW_MISSING'));
    const missingCheck = await service.adminCreate('curator', draft(['course-a', 'course-b']));
    await assert.rejects(service.adminPublish('curator', missingCheck.id),
      (error: unknown) => error instanceof CourseError && error.reasons.includes('COURSE_CHECK_MISSING'));
    await service.adminCheck('curator', missingCheck.id, null);
    const late = new PostgresCourseService(pool, { now: () => new Date(now.getTime() + 3600001),
      accountLifecycle: lifecycle });
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

  await t.test('revoked admin cannot create, check, publish or pause courses', async () => {
    const candidate = await service.adminCreate('revoked-curator', draft(['course-a', 'course-b']));
    await pool.query("UPDATE platform_admins SET revoked_at=now() WHERE account_id='revoked-curator'");
    for (const mutation of [
      () => service.adminCreate('revoked-curator', draft(['course-a', 'course-b'])),
      () => service.adminCheck('revoked-curator', candidate.id, null),
      () => service.adminPublish('revoked-curator', candidate.id),
      () => service.adminPause('revoked-curator', published.id),
    ]) await assert.rejects(mutation(),
      (error: unknown) => error instanceof AdminError && error.code === 'ADMIN_FORBIDDEN');
    assert.equal((await pool.query('SELECT status FROM courses WHERE id=$1', [published.id])).rows[0]?.status, 'ACTIVE');
  });

  await t.test('an ended or non-public step campaign fails the campaign-goal check', async () => {
    for (const change of ["status='ENDED'", 'is_public=false']) {
      await pool.query(`UPDATE campaigns SET ${change} WHERE id='campaign-course-b'`);
      const candidate = await service.adminCreate('curator', draft(['course-a', 'course-b']));
      const checked = await service.adminCheck('curator', candidate.id, null);
      assert.equal(checked.checkSummary?.items.find(item => item.key === 'CAMPAIGN_GOAL')?.status, 'FAIL');
      await pool.query("UPDATE campaigns SET status='ACTIVE', is_public=true WHERE id='campaign-course-b'");
    }
  });

  const visitAndEntitle = async (merchantId: string, accountId: string, earnedAt: string, grant = true) => {
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
    if (grant) await pool.query(`INSERT INTO reward_entitlements(id,customer_account_id,campaign_id,
      target_visit_count,source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
      VALUES ($1,$2,$3,1,$4,'GRANTED','VISIT_1_3_5_KST_DAILY_V1',$5,$6)`,
      [entitlement, accountId, `campaign-${merchantId}`, visit, earnedAt,
        new Date(Date.parse(earnedAt) + 90 * 86400000)]);
    return { entitlement: grant ? entitlement : null, visit };
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

  await t.test('a real course puts a goal-1-only next campaign in recommendation tier zero', async () => {
    await visitAndEntitle('course-a', 'course-reco', '2026-10-07T02:00:00Z');
    const reader = new RecommendationService(
      new PostgresRecommendationSource(pool, () => now, service), () => now);
    const recommendations = await reader.listRecommendations('course-reco');
    assert.equal(recommendations[0]?.merchantId, 'course-b');
    assert.equal(recommendations[0]?.course?.courseId, published.id);
    assert.equal(recommendations[0]?.nextGoal?.targetVisitCount, 1);
  });

  await t.test('course listing uses bounded batched reads and hints omit artwork', async () => {
    const queries: string[] = [];
    const trackedPool = new Proxy(pool, { get(target, key) {
      if (key === 'query') return (...args: unknown[]) => {
        queries.push(String(args[0]));
        return Reflect.apply(target.query, target, args);
      };
      return Reflect.get(target, key);
    } });
    const tracked = new PostgresCourseService(trackedPool, { now: () => now, accountLifecycle: lifecycle });
    await tracked.list('course-reco');
    assert.equal(queries.length, 5);
    assert.match(queries[0]!, /LIMIT 50/);
    assert.match(queries[1]!, /step\.course_id = ANY\(\$1::uuid\[\]\)/);
    assert.match(queries[2]!, /visit\.merchant_id = step\.merchant_id/);
    assert.match(queries[2]!, /visit\.occurred_at < COALESCE\(course\.ends_at/);
    queries.length = 0;
    await tracked.listHints('course-reco');
    assert.equal(queries.length, 3);
    assert.ok(queries.every(query => !query.includes('collectible_')));
  });

  await t.test('recommendations survive a course hint read failure', async () => {
    await pool.query(`INSERT INTO campaign_goals(campaign_id,target_visit_count,display_name)
      VALUES ('campaign-course-a',3,'세 번째 방문'),('campaign-course-a',5,'다섯 번째 방문')`);
    const source = new PostgresRecommendationSource(pool, () => now, {
      list: async () => [], listHints: async () => { throw new Error('COURSE_HINT_TEST_FAILURE'); },
    });
    const previousError = console.error;
    let logged = false;
    console.error = () => { logged = true; };
    try {
      const candidates = await source.listCandidates('course-reco');
      assert.equal(candidates.some(candidate => candidate.merchantId === 'course-a'), true);
      assert.equal(logged, true);
    } finally { console.error = previousError; }
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

  await t.test('counts_from excludes earlier visits', async () => {
    const later = await service.adminCreate('curator', draft(['course-a', 'course-b'], '2026-10-08T02:00:00Z'));
    await service.adminCheck('curator', later.id, null);
    await service.adminPublish('curator', later.id);
    assert.equal((await service.get('course-customer', later.id)).done, 0);
  });

  await t.test('counts_from includes visits at and after its instant', async () => {
    const boundary = '2026-10-08T02:00:00Z';
    await visitAndEntitle('course-a', 'course-boundary', boundary);
    await visitAndEntitle('course-b', 'course-boundary', '2026-10-08T02:01:00Z');
    const candidate = await service.adminCreate('curator', draft(['course-a', 'course-b'], boundary));
    await service.adminCheck('curator', candidate.id, null);
    await service.adminPublish('curator', candidate.id);
    assert.equal((await service.get('course-boundary', candidate.id)).done, 2);
    assert.equal((await service.unlock('course-boundary', candidate.id)).course.state, 'UNLOCKED');
  });

  await t.test('a visit inside the mission period before publication still completes its step', async () => {
    const backfilled = await service.adminCreate('curator', draft(['course-a', 'course-b']));
    await service.adminCheck('curator', backfilled.id, null);
    await service.adminPublish('curator', backfilled.id);
    assert.deepEqual((await service.get('course-customer', backfilled.id)).steps.map(step => step.done), [true, false]);
  });

  await t.test('period visits, not old entitlement milestones, prove goals and scene unlock', async () => {
    const account = 'course-period';
    await visitAndEntitle('course-a', account, '2026-10-04T01:00:00Z');
    await visitAndEntitle('course-a', account, '2026-10-05T01:00:00Z', false);
    const first = await visitAndEntitle('course-a', account, '2026-10-06T01:00:00Z', false);
    const input = { ...draft(['course-a', 'course-b'], '2026-10-06T00:00:00Z'),
      endsAt: '2026-10-09T00:00:00Z' };
    input.steps[0]!.targetVisitCount = 3;
    const mission = await service.adminCreate('curator', input);
    await service.adminCheck('curator', mission.id, null);
    await service.adminPublish('curator', mission.id);
    const goalOne = await service.adminCreate('curator', { ...input,
      steps: input.steps.map(step => ({ ...step, targetVisitCount: 1 })) });
    await service.adminCheck('curator', goalOne.id, null);
    await service.adminPublish('curator', goalOne.id);
    assert.equal((await service.get(account, goalOne.id)).steps[0]!.done, true);
    assert.equal((await service.get(account, mission.id)).steps[0]!.progressVisitCount, 1);
    assert.equal((await service.get(account, mission.id)).steps[0]!.done, false);
    await assert.rejects(service.unlock(account, mission.id),
      (error: unknown) => error instanceof CourseError && error.code === 'COURSE_INCOMPLETE');
    await visitAndEntitle('course-a', account, '2026-10-09T00:00:00Z', false);
    assert.equal((await service.get(account, mission.id)).steps[0]!.progressVisitCount, 1);
    const second = await visitAndEntitle('course-a', account, '2026-10-07T01:00:00Z', false);
    const third = await visitAndEntitle('course-a', account, '2026-10-08T01:00:00Z', false);
    await visitAndEntitle('course-b', account, '2026-10-06T02:00:00Z', false);
    const ready = await service.get(account, mission.id);
    assert.equal(ready.state, 'READY');
    assert.equal(ready.steps[0]!.progressVisitCount, 3);
    assert.equal(ready.steps[0]!.earnedAt, '2026-10-08T01:00:00.000Z');
    const unlocked = await service.unlock(account, mission.id);
    assert.equal(unlocked.course.state, 'UNLOCKED');
    const evidence = (await pool.query<{ evidence: { steps: { visitEventIds: string[] }[] } }>(
      'SELECT evidence FROM course_unlocks WHERE account_id=$1 AND course_id=$2', [account, mission.id])).rows[0]!.evidence;
    assert.deepEqual(evidence.steps[0]!.visitEventIds, [first.visit, second.visit, third.visit]);
    await pool.query("UPDATE visit_events SET status='CANCELED',cancellation_reason='test reversal' WHERE id=$1", [third.visit]);
    const stale = await service.get(account, mission.id);
    assert.equal(stale.state, 'STALE');
    assert.equal(stale.steps[0]!.progressVisitCount, 2);
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
    assert.equal(detail.steps[0]?.state, 'UNAVAILABLE');
    assert.equal(detail.steps[0]?.done, false);
    await pool.query("UPDATE campaigns SET status='ACTIVE' WHERE id='campaign-course-a'");
  });

  await t.test('hidden merchants and changed campaigns make steps unavailable and block new unlocks', async () => {
    await service.unlock('course-boundary', published.id);
    for (const [change, restore] of ([
      ["UPDATE merchants SET status='PAUSED' WHERE id='course-b'", "UPDATE merchants SET status='ACTIVE' WHERE id='course-b'"],
      ["UPDATE merchants SET published_at=NULL WHERE id='course-b'", "UPDATE merchants SET published_at='2026-10-08T03:00:00Z' WHERE id='course-b'"],
      ["UPDATE campaigns SET is_public=false WHERE id='campaign-course-b'", "UPDATE campaigns SET is_public=true WHERE id='campaign-course-b'"],
    ] as const)) {
      await pool.query(change);
      const detail = await service.get('course-reco', published.id);
      assert.equal(detail.steps[1]?.state, 'UNAVAILABLE');
      assert.equal(detail.steps[1]?.done, false);
      assert.equal((await service.list('course-reco')).find(course => course.id === published.id)?.steps[1]?.state,
        'UNAVAILABLE');
      assert.equal((await service.get('course-boundary', published.id)).state, 'UNLOCKED');
      assert.equal((await service.unlock('course-boundary', published.id)).replayed, true);
      assert.deepEqual(await service.listHints('course-reco'), []);
      await assert.rejects(service.unlock('course-reco', published.id),
        (error: unknown) => error instanceof CourseError && error.code === 'COURSE_UNAVAILABLE');
      await pool.query(restore);
    }
  });

  await t.test('a removed campaign goal makes its published step unavailable', async () => {
    await pool.query("INSERT INTO campaign_goals(campaign_id,target_visit_count,display_name) VALUES ('campaign-course-b',3,'세 번째 방문')");
    const input = draft(['course-a', 'course-b']);
    input.steps[1]!.targetVisitCount = 3;
    const candidate = await service.adminCreate('curator', input);
    await service.adminCheck('curator', candidate.id, null);
    await service.adminPublish('curator', candidate.id);
    await pool.query("DELETE FROM campaign_goals WHERE campaign_id='campaign-course-b' AND target_visit_count=3");
    assert.equal((await service.get('course-reco', candidate.id)).steps[1]?.state, 'UNAVAILABLE');
    await assert.rejects(service.unlock('course-reco', candidate.id),
      (error: unknown) => error instanceof CourseError && error.code === 'COURSE_UNAVAILABLE');
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
    await assert.rejects(service.unlock('course-reco', published.id),
      (error: unknown) => error instanceof CourseError && error.code === 'COURSE_UNAVAILABLE');
  });

  await t.test('account deletion removes unlock rows and curator identity', async () => {
    const deletion = new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test', now: () => now,
      accountLifecycle: lifecycle });
    await deletion.requestDeletion({ accountId: 'course-customer', confirmation: 'DELETE MY ACCOUNT' });
    assert.equal((await pool.query('SELECT 1 FROM course_unlocks WHERE account_id=$1', ['course-customer'])).rowCount, 0);
    await assert.rejects(service.unlock('course-customer', published.id),
      (error: unknown) => error instanceof CourseError && error.code === 'ACCOUNT_DELETED');
    await deletion.requestDeletion({ accountId: 'curator', confirmation: 'DELETE MY ACCOUNT' });
    assert.equal((await pool.query("SELECT 1 FROM courses WHERE curated_by_account_id='curator'")).rowCount, 0);
    for (const mutation of [
      () => service.adminCreate('curator', draft(['course-a', 'course-b'])),
      () => service.adminCheck('curator', created.id, null),
      () => service.adminPublish('curator', created.id),
      () => service.adminPause('curator', published.id),
    ]) await assert.rejects(mutation(),
      (error: unknown) => error instanceof AdminError && error.code === 'ADMIN_FORBIDDEN');
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

  await t.test('the active course cap returns only 50 of 51 new eligible courses', async () => {
    const ids: string[] = Array.from({ length: 51 }, () => randomUUID());
    try {
      await pool.query(`INSERT INTO courses(id,title,situation,scene_key,curated_by_account_id,checked_at,check_summary,created_at)
        SELECT id::uuid,'목록 상한','AFTER_MEAL','test-picnic','load-test-curator',now(),'{}',now() + interval '1 minute'
        FROM unnest($1::text[]) AS ids(id)`, [ids]);
      await pool.query(`INSERT INTO course_steps(course_id,position,merchant_id,target_visit_count,piece_key,piece_label,owner_optin_ref,owner_optin_at)
        SELECT ids.id::uuid, step.position, step.merchant_id, 1, step.piece_key, step.piece_label,
          step.owner_optin_ref, now() FROM unnest($1::text[]) AS ids(id)
        CROSS JOIN (VALUES (1,'course-a','piece-1','그릇','COURSE-OPTIN-REF-1'),
          (2,'course-b','piece-2','컵','COURSE-OPTIN-REF-2'))
          AS step(position,merchant_id,piece_key,piece_label,owner_optin_ref)`, [ids]);
      await pool.query("UPDATE courses SET status='ACTIVE' WHERE id = ANY($1::uuid[])", [ids]);
      const listed = await service.list('course-reco');
      assert.equal(listed.length, 50);
      assert.equal(listed.every(course => ids.includes(course.id)), true);
    } finally { await pool.query('TRUNCATE courses CASCADE'); }
  });
});
