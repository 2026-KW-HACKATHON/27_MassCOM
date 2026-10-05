import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from './account-consent.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresCollectionExperienceService } from './postgres/collection-experience.js';
import { runMigrations } from './postgres/migrate.js';

test('recorded draw, visit badge, equipment, reversal and friend disclosure stay consistent', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(`TRUNCATE account_deletion_requests, collection_experience_profiles, mileage_spends, play_runs, play_records,
    account_consents, friendships, reward_entitlements, visit_events, claim_slots, merchant_members,
    campaign_goals, campaigns, merchants CASCADE`);
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: 'collection-experience-test-secret-32-bytes' });
  const service = new PostgresCollectionExperienceService(pool, lifecycle);
  const account = 'experience-owner';
  const other = 'experience-friend';
  const spendId = randomUUID();
  const friendId = randomUUID();
  await pool.query(`INSERT INTO mileage_spends (id,account_id,amount,reason,grade,item_id,request_id,cosmetic_bonus_id)
    VALUES ($1,$2,100,'REROLL','BRONZE','cook-cat','experience-draw-1','bronze-hat')`, [spendId, account]);
  const bonus = 'bronze-hat';
  let snapshot = await service.getSnapshot(account);
  assert.equal(snapshot.progress.packs.find((pack) => pack.id === 'bronze')?.opens, 1);
  assert.equal(snapshot.progress.cosmetics.find((item) => item.id === bonus)?.equippable, true);
  await assert.rejects(service.setEquipment({ accountId: account, cosmetics: { hat: 'silver-hat' } }), { code: 'EXPERIENCE_LOCKED' });
  const slot = bonus.split('-').at(-1) as 'hat' | 'prop' | 'decor';
  snapshot = await service.setEquipment({ accountId: account, cosmetics: { [slot]: bonus } });
  assert.equal(snapshot.profile.cosmetics[slot], bonus);
  await service.setWishlist({ accountId: account, itemId: 'bakery-squirrel' });
  assert.equal((await service.getSnapshot(account)).profile.wishlist, 'bakery-squirrel');

  await pool.query(`INSERT INTO merchants (id,name,story,road_address,minimum_spend_won,status,is_demo)
    VALUES ('experience-shop','경험 가게','소개','서울',0,'ACTIVE',true)`);
  await pool.query(`INSERT INTO merchant_members (merchant_id,account_id,role,status)
    VALUES ('experience-shop','experience-staff','STAFF','ACTIVE')`);
  await pool.query(`INSERT INTO campaigns (id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES ('experience-campaign','experience-shop','방문','2026-01-01','2027-01-01','ACTIVE',true,20)`);
  const claimId = randomUUID();
  const visitId = randomUUID();
  const coinId = randomUUID();
  await pool.query(`INSERT INTO claim_slots (id,merchant_id,customer_account_id,merchant_reference_hash,
    created_by_account_id,token_hash,status,expires_at,claimed_at)
    VALUES ($1,'experience-shop',$2,$3,'experience-staff',$4,'CLAIMED','2027-01-01','2026-10-01')`,
  [claimId, account, randomBytes(32), randomBytes(32)]);
  await pool.query(`INSERT INTO visit_events (id,claim_slot_id,merchant_id,campaign_id,customer_account_id,
    occurred_at,business_date,verification_level,status,progress_counted)
    VALUES ($1,$2,'experience-shop','experience-campaign',$3,'2026-10-01','2026-10-01','MERCHANT_CONFIRMED','VALID',true)`,
  [visitId, claimId, account]);
  await pool.query(`INSERT INTO campaign_goals (campaign_id,target_visit_count,display_name)
    VALUES ('experience-campaign',1,'첫 방문')`);
  await pool.query(`INSERT INTO reward_entitlements (id,customer_account_id,campaign_id,target_visit_count,
    source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
    VALUES ($1,$2,'experience-campaign',1,$3,'GRANTED','test','2026-10-01','2027-01-01')`,
  [coinId, account, visitId]);
  snapshot = await service.setEquipment({ accountId: account, badgeId: 'explorer-bronze',
    cosmetics: { hat: 'explorer-bronze-hat' }, coinEntitlementId: coinId });
  assert.equal(snapshot.profile.badgeId, 'explorer-bronze');
  assert.equal(snapshot.profile.coinEntitlementId, coinId);
  await pool.query(`INSERT INTO friendships (id,account_low,account_high) VALUES ($1,$2,$3)`, [friendId, other, account]);
  await pool.query(`INSERT INTO account_consents (account_id,terms_version,privacy_version,age_confirmed,source)
    VALUES ($1,$2,$3,true,'ANDROID')`, [account, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION]);
  const publicProfile = await service.getFriend({ accountId: other, friendshipId: friendId });
  assert.equal(publicProfile.badgeId, 'explorer-bronze');
  assert.equal(publicProfile.badgeName, '동네 탐험 동');
  assert.equal(publicProfile.coin?.merchantId, 'experience-shop');
  assert.ok(!('coinEntitlementId' in publicProfile));
  assert.ok(!('wishlist' in publicProfile));
  await pool.query(`UPDATE visit_events SET status='CANCELED',cancellation_reason='test reversal' WHERE id=$1`, [visitId]);
  await pool.query(`UPDATE reward_entitlements SET status='CANCELED' WHERE id=$1`, [coinId]);
  snapshot = await service.getSnapshot(account);
  assert.equal(snapshot.profile.badgeId, null);
  assert.equal(snapshot.profile.cosmetics.hat, null);
  assert.equal(snapshot.profile.coinEntitlementId, null);
  assert.equal((await service.getFriend({ accountId: other, friendshipId: friendId })).badgeId, null);
  // Removal can commit while a reader waits for the account lock after its first relationship lookup.
  const blocker = await pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lifecycle.referenceHash(account).toString('hex')]);
    const waitingRead = service.getFriend({ accountId: other, friendshipId: friendId });
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const active = await pool.query<{ n: number }>(`SELECT count(*)::integer AS n FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event='advisory'`);
      if (active.rows[0]!.n > 0) { blocked = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(blocked, 'friend read reached the account lock');
    await blocker.query(`DELETE FROM friendships WHERE id=$1`, [friendId]);
    await blocker.query('COMMIT');
    await assert.rejects(waitingRead, { code: 'EXPERIENCE_FRIEND_NOT_FOUND' });
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }

  const auditId = randomUUID();
  await pool.query(`INSERT INTO merchant_campaign_extension_audit
    (id,request_id,merchant_id,campaign_id,actor_account_id,previous_ends_at,new_ends_at,days,consent_accepted_at)
    VALUES ($1,$2,'experience-shop','experience-campaign',$3,'2027-01-01','2027-02-01',30,'2026-10-01')`,
  [auditId, randomUUID(), account]);
  await pool.query(`INSERT INTO merchant_staff_action_audit
    (id,merchant_id,actor_account_id,target_account_id,action,before_permissions,after_permissions)
    VALUES ($1,'experience-shop',$2,$2,'PERMISSIONS_CHANGED',$3,$3)`,
  [randomUUID(), account, JSON.stringify({ accountId: account, confirmVisit: true })]);
  await pool.query(`INSERT INTO notification_items
    (id,account_id,category,dedupe_key,title,body,target_path)
    VALUES ($1,$2,'REWARD_AVAILABLE','experience-test','제목','내용','/me/experience')`,
  [randomUUID(), account]);
  await pool.query(`INSERT INTO notification_preferences (account_id) VALUES ($1)`, [account]);
  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret: 'collection-experience-test-secret-32-bytes', policyVersion: 'test', accountLifecycle: lifecycle,
  });
  await deletion.requestDeletion({ accountId: account, confirmation: 'DELETE MY ACCOUNT' });
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM collection_experience_profiles WHERE account_id=$1`, [account])).rows[0]!.n, 0);
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM notification_items WHERE account_id=$1`, [account])).rows[0]!.n, 0);
  assert.equal((await pool.query(`SELECT count(*)::integer AS n FROM notification_preferences WHERE account_id=$1`, [account])).rows[0]!.n, 0);
  const audit = (await pool.query<{ actor_account_id: string }>(`SELECT actor_account_id FROM merchant_campaign_extension_audit WHERE id=$1`, [auditId])).rows[0]!;
  assert.notEqual(audit.actor_account_id, account);
  const staffAudit = (await pool.query<{ actor_account_id: string; target_account_id: string;
    before_permissions: Record<string, unknown>; after_permissions: Record<string, unknown> }>(
    `SELECT actor_account_id,target_account_id,before_permissions,after_permissions FROM merchant_staff_action_audit
     WHERE merchant_id='experience-shop'`)).rows[0]!;
  assert.notEqual(staffAudit.actor_account_id, account);
  assert.notEqual(staffAudit.target_account_id, account);
  assert.ok(!('accountId' in staffAudit.before_permissions));
  assert.ok(!('accountId' in staffAudit.after_permissions));
});
