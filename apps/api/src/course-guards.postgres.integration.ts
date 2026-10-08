import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Pool } from 'pg';

import { runMigrations } from './postgres/migrate.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
  throw new Error('dedicated TEST_DATABASE_URL required');
}

test('course terms and steps stay guarded at the database boundary', async t => {
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const merchants = Array.from({ length: 5 }, () => randomUUID());
    for (const merchant of merchants) {
      await client.query(`INSERT INTO merchants(id,name,story,road_address,minimum_spend_won,status,is_demo)
        VALUES ($1,'코스 제약 가게','','서울',0,'ACTIVE',false)`, [merchant]);
    }
    const insertDraft = async (stepCount: number, checked = true, optins = true) => {
      const id = randomUUID();
      await client.query(`INSERT INTO courses(id,title,situation,scene_key,curated_by_account_id,checked_at,check_summary)
        VALUES ($1,'처음 제목','AFTER_MEAL','guard-scene','guard-curator',$2,$3)`,
      [id, checked ? new Date() : null, checked ? '{}' : null]);
      for (let index = 0; index < stepCount; index++) {
        await client.query(`INSERT INTO course_steps(course_id,position,merchant_id,piece_key,piece_label,owner_optin_ref,owner_optin_at)
          VALUES ($1,$2,$3,$4,'조각',$5,$6)`, [id, index + 1, merchants[index], `piece-${index + 1}`,
          optins ? `OPTIN-REF-${index + 1}` : null, optins ? new Date() : null]);
      }
      return id;
    };
    const rejected = async (sql: string, params: unknown[] = []) => {
      await client.query('SAVEPOINT guard_test');
      await assert.rejects(client.query(sql, params), (error: unknown) => (error as { code?: string }).code === '23514');
      await client.query('ROLLBACK TO SAVEPOINT guard_test');
      await client.query('RELEASE SAVEPOINT guard_test');
    };
    for (const [steps, checked, optins] of [[1, true, true], [2, false, true], [2, true, false]] as const) {
      const id = await insertDraft(steps, checked, optins);
      await rejected("UPDATE courses SET status='ACTIVE' WHERE id=$1", [id]);
      assert.equal((await client.query('SELECT status FROM courses WHERE id=$1', [id])).rows[0]?.status, 'DRAFT');
    }
    const four = await insertDraft(4);
    await rejected(`INSERT INTO course_steps(course_id,position,merchant_id,piece_key,piece_label,owner_optin_ref,owner_optin_at)
      VALUES ($1,5,$2,'piece-5','조각','OPTIN-REF-5',now())`, [four, merchants[4]]);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM course_steps WHERE course_id=$1', [four]))
      .rows[0]?.count, 4);
    // Lift the position CHECK only within this rolled-back transaction to exercise the publish trigger's own upper bound.
    await client.query('ALTER TABLE course_steps DROP CONSTRAINT course_steps_position_check');
    await client.query(`INSERT INTO course_steps(course_id,position,merchant_id,piece_key,piece_label,owner_optin_ref,owner_optin_at)
      VALUES ($1,5,$2,'piece-5','조각','OPTIN-REF-5',now())`, [four, merchants[4]]);
    await rejected("UPDATE courses SET status='ACTIVE' WHERE id=$1", [four]);
    const id = await insertDraft(2);
    await client.query("UPDATE courses SET status='ACTIVE' WHERE id=$1", [id]);
    for (const status of ['ACTIVE', 'PAUSED'] as const) {
      if (status === 'PAUSED') await client.query("UPDATE courses SET status='PAUSED' WHERE id=$1", [id]);
      for (const [column, value] of [['title', '바꾼 제목'], ['counts_from', new Date()], ['ends_at', new Date()]] as const) {
        await rejected(`UPDATE courses SET ${column}=$2 WHERE id=$1`, [id, value]);
      }
      await rejected('DELETE FROM courses WHERE id=$1', [id]);
    }
    await client.query('UPDATE courses SET checked_at=NULL, check_summary=NULL WHERE id=$1', [id]);
    await rejected("UPDATE courses SET status='ACTIVE' WHERE id=$1", [id]);
    assert.equal((await client.query('SELECT status FROM courses WHERE id=$1', [id])).rows[0]?.status, 'PAUSED');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('the final migration accepts all 23 platform audit actions', async t => {
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const merchant = randomUUID();
    await client.query(`INSERT INTO merchants(id,name,story,road_address,minimum_spend_won,status,is_demo)
      VALUES ($1,'감사 제약 가게','','서울',0,'ACTIVE',false)`, [merchant]);
    const actions = [
      'MERCHANT_CREATED', 'MERCHANT_UPDATED', 'MERCHANT_HIDDEN', 'CAMPAIGN_DRAFT_CREATED', 'COUPON_VOIDED',
      'ACCOUNT_DELETION_PROCESSED', 'ACCOUNT_DELETION_REJECTED', 'ACCOUNT_DELETION_RECONCILED',
      'MERCHANT_PUBLISHED', 'MERCHANT_OWNER_GRANTED', 'MERCHANT_OWNER_REVOKED',
      'REWARD_OFFER_CREATED', 'REWARD_OFFER_PAUSED', 'CAMPAIGN_PUBLISHED', 'CAMPAIGN_PAUSED',
      'CAMPAIGN_EXTENDED', 'CAMPAIGN_PURPOSE_SET', 'CAMPAIGN_BENEFIT_CREATED', 'CAMPAIGN_BENEFIT_PAUSED',
      'COURSE_CREATED', 'COURSE_CHECKED', 'COURSE_PUBLISHED', 'COURSE_PAUSED',
    ];
    assert.equal(new Set(actions).size, 23);
    for (const action of actions) {
      const accountDeletion = action.startsWith('ACCOUNT_DELETION_');
      const owner = action.startsWith('MERCHANT_OWNER_');
      await client.query(`INSERT INTO platform_admin_audit
        (id,actor_account_id,merchant_id,action,after_state,target_account_id)
        VALUES ($1,'audit-actor',$2,$3,'{}',$4)`, [randomUUID(), accountDeletion ? null : merchant, action,
        owner ? 'merchant-owner' : null]);
    }
    assert.equal((await client.query('SELECT count(*)::int AS count FROM platform_admin_audit WHERE actor_account_id=$1',
      ['audit-actor'])).rows[0]?.count, 23);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
