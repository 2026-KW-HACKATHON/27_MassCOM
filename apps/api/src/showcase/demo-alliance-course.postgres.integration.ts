import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresClaimSlotService } from '../postgres/claim-slot-service.js';
import { PostgresCourseService } from '../postgres/courses.js';
import { runMigrations } from '../postgres/migrate.js';
import { SHOWCASE_DEMO_ALLIANCE_COURSE_ID, SHOWCASE_DEMO_ALLIANCE_STORES } from './demo-alliance-course.js';
import { seedLocalShowcase } from './local-seed.js';

test('a selected demo alliance mission progresses through three test visits, unlocks its reward, and survives reseed', async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const admin = new Pool({ connectionString });
  const databaseName = `masscom_showcase_ci_${randomUUID().replaceAll('-', '')}_test`;
  let created = false;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const url = new URL(connectionString);
    url.pathname = `/${databaseName}`;
    const pool = new Pool({ connectionString: url.toString() });
    try {
      await runMigrations(pool);
      await seedLocalShowcase(pool);
      const courses = new PostgresCourseService(pool, { includeDemo: true });
      const accountId = 'demo-alliance-visitor';
      const listed = await courses.list(accountId);
      const initial = listed.find(course => course.id === SHOWCASE_DEMO_ALLIANCE_COURSE_ID);
      assert.ok(initial, 'demo mission is selectable from the course list');
      assert.match(initial.title, /^시연 연합 미션/);
      assert.deepEqual(initial.steps.map(step => step.merchantId), SHOWCASE_DEMO_ALLIANCE_STORES.map(store => store.id));
      assert.deepEqual([initial.state, initial.done, initial.total], ['NOT_STARTED', 0, 3]);
      assert.equal((await new PostgresCourseService(pool, { includeDemo: false }).list(accountId))
        .some(course => course.id === SHOWCASE_DEMO_ALLIANCE_COURSE_ID), false);

      const visits = new PostgresClaimSlotService(pool, {
        referenceHmacSecret: 'test-only-demo-alliance-reference-secret-32-bytes',
      });
      for (const [index, store] of SHOWCASE_DEMO_ALLIANCE_STORES.entries()) {
        const issued = await visits.issueShowcaseTestSlot({ merchantId: store.id, accountId });
        const redeemed = await visits.redeem({ accountId, token: issued.token });
        assert.equal(redeemed.visit.progressCounted, true);
        assert.equal(redeemed.grantedRewards[0]?.targetVisitCount, 1);
        const progress = await courses.get(accountId, SHOWCASE_DEMO_ALLIANCE_COURSE_ID);
        assert.deepEqual([progress.done, progress.state], [index + 1, index === 2 ? 'READY' : 'IN_PROGRESS']);
        assert.equal(progress.steps[index]?.done, true);
      }
      const unlocked = await courses.unlock(accountId, SHOWCASE_DEMO_ALLIANCE_COURSE_ID);
      assert.deepEqual([unlocked.replayed, unlocked.course.state], [false, 'UNLOCKED']);
      assert.ok(unlocked.course.steps.every(step => step.artwork?.thumbnailDataUrl));
      assert.equal((await courses.unlock(accountId, SHOWCASE_DEMO_ALLIANCE_COURSE_ID)).replayed, true);
      const rewardsBefore = (await pool.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM reward_entitlements WHERE customer_account_id = $1', [accountId])).rows[0]!.total;
      await seedLocalShowcase(pool);
      assert.equal((await courses.get(accountId, SHOWCASE_DEMO_ALLIANCE_COURSE_ID)).state, 'UNLOCKED');
      assert.equal((await pool.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM reward_entitlements WHERE customer_account_id = $1', [accountId])).rows[0]!.total,
      rewardsBefore);
      assert.equal((await pool.query<{ total: number }>(
        'SELECT count(*)::int AS total FROM course_unlocks WHERE account_id = $1 AND course_id = $2',
        [accountId, SHOWCASE_DEMO_ALLIANCE_COURSE_ID])).rows[0]!.total, 1);
    } finally {
      await pool.end();
    }
  } finally {
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    await admin.end();
  }
});
