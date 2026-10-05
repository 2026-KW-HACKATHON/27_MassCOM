import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';

import { Pool } from 'pg';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, type ConsentService } from './account-consent.js';
import { PlayError, type Studio } from './play.js';
import { getGameBoard } from './play-rules.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresPlayService } from './postgres/play.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

const secret = 'test-only-account-deletion-secret-at-least-32-bytes';

async function friendStudioRequest(server: Server, accountId: string, friendshipId: string) {
  const request = new IncomingMessage(new Socket());
  request.method = 'GET';
  request.url = `/friends/${friendshipId}/studio`;
  request.httpVersion = '1.0';
  request.headers = { 'x-account-id': accountId };
  request.push(null);
  const response = new ServerResponse(request);
  const transport = new PassThrough();
  const chunks: Buffer[] = [];
  transport.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.assignSocket(transport as unknown as Socket);
  await new Promise<void>((resolve, reject) => {
    response.once('finish', resolve);
    response.once('error', reject);
    server.emit('request', request, response);
  });
  return { status: response.statusCode,
    body: JSON.parse(Buffer.concat(chunks).toString('utf8').split('\r\n\r\n')[1]!) as unknown };
}

test('play runs replay once, studio requires ownership, friend view hides identifiers, deletion clears data', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must name a dedicated _test database');
  }
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  await runMigrations(pool);
  await pool.query(`TRUNCATE merchants, friendships, account_deletion_requests, account_profile, account_characters,
    play_runs, play_records, studios, play_flow_counts, retention_scan_progress CASCADE`);
  const state = { now: new Date('2026-10-04T10:00:00.000Z') };
  const now = () => state.now;
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const play = new PostgresPlayService(pool, lifecycle, { now });
  const malformedUuid = '-'.repeat(36);
  await assert.rejects(() => play.finish({ accountId: 'player', runId: malformedUuid, actions: [] }),
    (error) => error instanceof PlayError && error.code === 'PLAY_RUN_NOT_FOUND');
  await assert.rejects(() => play.getFriendStudio({ accountId: 'player', friendshipId: malformedUuid }),
    (error) => error instanceof PlayError && error.code === 'FRIEND_STUDIO_NOT_FOUND');
  await assert.rejects(() => play.saveStudio({ accountId: 'player', studio: {
    theme: 'daylight', layout: 'shelf', accent: 'mint', slots: [malformedUuid], goal: null,
  } }), (error) => error instanceof PlayError && error.code === 'STUDIO_INVALID');
  await pool.query(`INSERT INTO merchants (id,name,story,road_address,minimum_spend_won,status,is_demo)
    VALUES ('play-merchant','Play Shop','test','test',0,'ACTIVE',true)`);
  await pool.query(`INSERT INTO campaigns (id,merchant_id,title,starts_at,ends_at,status,is_public,enrollment_capacity)
    VALUES ('play-campaign','play-merchant','Play campaign','2026-01-01','2027-01-01','ACTIVE',true,100)`);
  await pool.query(`INSERT INTO campaign_goals (campaign_id,target_visit_count,display_name)
    VALUES ('play-campaign',1,'First collectible'),
      ('play-campaign',3,'Third collectible'),
      ('play-campaign',5,'Fifth collectible')`);
  await pool.query(`INSERT INTO merchant_members (merchant_id,account_id,role,status)
    VALUES ('play-merchant','staff','STAFF','ACTIVE')`);
  const slot = randomUUID();
  const visit = randomUUID();
  const entitlement = randomUUID();
  await pool.query(`INSERT INTO claim_slots (id,merchant_id,customer_account_id,merchant_reference_hash,created_by_account_id,
    token_hash,status,expires_at,claimed_at,created_at,updated_at)
    VALUES ($1,'play-merchant','player',decode(repeat('11',32),'hex'),'staff',decode(repeat('22',32),'hex'),
    'CLAIMED','2026-10-04T10:15:00Z','2026-10-04T10:00:00Z','2026-10-04T09:55:00Z','2026-10-04T10:00:00Z')`, [slot]);
  await pool.query(`INSERT INTO visit_events (id,claim_slot_id,merchant_id,campaign_id,customer_account_id,
    occurred_at,business_date,verification_level,status,progress_counted)
    VALUES ($1,$2,'play-merchant','play-campaign','player','2026-10-04T10:00:00Z','2026-10-04',
    'MERCHANT_CONFIRMED','VALID',true)`, [visit, slot]);
  await pool.query(`INSERT INTO reward_entitlements (id,customer_account_id,campaign_id,target_visit_count,
    source_visit_event_id,status,policy_version,earned_at,claim_expires_at)
    VALUES ($1,'player','play-campaign',1,$2,'GRANTED','test','2026-10-04T10:00:00Z','2027-01-01')`,
    [entitlement, visit]);

  for (let index = 0; index < 3; index++) {
    const run = await play.start({ accountId: 'player', kind: 'orders' });
    assert.equal(run.rulesVersion, 2);
    // A run created by the previous server must still finish under its original rules.
    await pool.query('UPDATE play_runs SET rules_version=1 WHERE id=$1', [run.id]);
    const board = getGameBoard('orders', run.seed);
    if (board.kind !== 'orders') throw new Error('unexpected board');
    const actions = board.orders.flat().map((choice, step) => ({ at: (step + 1) * 180, choice }));
    state.now = new Date(state.now.getTime() + 1000);
    await assert.rejects(() => play.finish({ accountId: 'player', runId: run.id, actions }),
      (error) => error instanceof PlayError && error.code === 'PLAY_ACTIONS_INVALID');
    state.now = new Date(state.now.getTime() + 100);
    const finished = await play.finish({ accountId: 'player', runId: run.id, actions });
    assert.equal(finished.completed, true);
    assert.equal(finished.plays, index + 1);
    assert.equal(finished.skill?.id, 'order-streak');
    assert.equal(finished.skill?.achieved, true);
    assert.equal(finished.newlyEarned, index === 0);
    assert.deepEqual(await play.finish({ accountId: 'player', runId: run.id, actions: [] }), finished);
  }
  assert.equal((await play.getPlay('player')).achievements?.find((skill) => skill.id === 'order-streak')?.achieved, true);
  const version2 = await play.start({ accountId: 'player', kind: 'orders' });
  const version2Board = getGameBoard('orders', version2.seed);
  if (version2Board.kind !== 'orders') throw new Error('unexpected board');
  const version2Actions = version2Board.orders.flatMap((order) => [...order, 4])
    .map((choice, index) => ({ at: index * 100, choice }));
  state.now = new Date(state.now.getTime() + 1_600);
  const version2Result = await play.finish({ accountId: 'player', runId: version2.id, actions: version2Actions });
  assert.equal(version2Result.rulesVersion, 2);
  assert.equal(version2Result.completed, true);
  assert.equal(version2Result.version2Plays, 1);
  assert.equal(version2Result.plays, 4);
  assert.ok(version2Result.version2BestScore! > 0);
  assert.deepEqual(await play.finish({ accountId: 'player', runId: version2.id, actions: [] }), version2Result);
  assert.deepEqual((await play.getPlay('player')).records.find((record) => record.kind === 'orders'), {
    kind: 'orders', bestScore: 1125, plays: 4,
    version2BestScore: version2Result.score, version2Plays: 1,
  });
  await pool.query(`UPDATE play_runs SET result = result - 'skill' WHERE account_id='player' AND kind='orders'`);
  assert.equal((await play.getPlay('player')).achievements?.find((skill) => skill.id === 'order-streak')?.achieved, true,
    'perfect legacy scores still prove the achievement when old run JSON lacks skill details');
  const pending = await play.start({ accountId: 'player', kind: 'orders' });
  await assert.rejects(() => play.finish({ accountId: 'other', runId: pending.id, actions: [] }),
    (error) => error instanceof PlayError && error.code === 'PLAY_RUN_NOT_FOUND');
  await assert.rejects(() => play.finish({ accountId: 'player', runId: pending.id,
    actions: [{ at: 5000, choice: 0 }] }),
  (error) => error instanceof PlayError && error.code === 'PLAY_ACTIONS_INVALID');
  const partial = await play.finish({ accountId: 'player', runId: pending.id, actions: [] });
  assert.equal(partial.completed, false);
  assert.equal(partial.plays, 4);
  assert.ok(partial.bestScore > 0);
  const expired = await play.start({ accountId: 'player', kind: 'stack' });
  state.now = new Date(state.now.getTime() + 46_000);
  await assert.rejects(() => play.finish({ accountId: 'player', runId: expired.id, actions: [] }),
    (error) => error instanceof PlayError && error.code === 'PLAY_RUN_EXPIRED');
  assert.deepEqual((await play.getPlay('player')).unlockedThemes, ['evening']);
  await pool.query(`INSERT INTO account_characters (account_id,item_id,source)
    VALUES ('player','companion-legacy','REROLL')`);
  await pool.query(`INSERT INTO account_profile (account_id,avatar_item_id)
    VALUES ('player','companion-legacy')`);
  await pool.query(`INSERT INTO friendships (id,account_low,account_high) VALUES ($1,'friend','player')`,
    [randomUUID()]);
  const friendshipId = (await pool.query<{ id: string }>('SELECT id FROM friendships')).rows[0]!.id;
  assert.equal((await play.getStudio('player')).avatar, 'companion-legacy');
  const beforeSave = await play.getFriendStudio({ accountId: 'friend', friendshipId });
  assert.equal(beforeSave.avatar, null);
  assert.equal(beforeSave.avatarClothingId, null);
  assert.deepEqual(beforeSave.items, []);
  assert.deepEqual(beforeSave.studio, { theme: 'daylight', layout: 'shelf', accent: 'mint', goal: null });
  const studio: Studio = { theme: 'evening', layout: 'gallery', accent: 'rose', slots: [entitlement],
    goal: { kind: 'regular', merchantId: 'play-merchant' } };
  await pool.query(`INSERT INTO showcase_guest_trials (account_id,merchant_id,created_at,expires_at)
    VALUES ('guest-player','play-merchant',$1,$2)`, [state.now, new Date(state.now.getTime() + 86400_000)]);
  await assert.rejects(() => play.saveStudio({ accountId: 'player', studio }),
    (error) => error instanceof PlayError && error.code === 'STUDIO_GOAL_UNAVAILABLE');
  await pool.query(`DELETE FROM showcase_guest_trials WHERE account_id='guest-player'`);
  const currentTime = state.now;
  for (const outsideCampaign of ['2025-12-31T23:59:59Z', '2027-01-01T00:00:00Z']) {
    state.now = new Date(outsideCampaign);
    await assert.rejects(() => play.saveStudio({ accountId: 'player', studio }),
      (error) => error instanceof PlayError && error.code === 'STUDIO_GOAL_UNAVAILABLE');
  }
  state.now = currentTime;
  assert.equal((await play.saveStudio({ accountId: 'player', studio })).items[0]?.entitlementId, entitlement);
  assert.deepEqual((await play.getFriendStudio({ accountId: 'friend', friendshipId })).items, [],
    'saved studio stays private without current consent');
  await pool.query(`INSERT INTO account_consents (account_id,terms_version,privacy_version,age_confirmed,source)
    VALUES ('player',$1,'privacy-old',true,'ANDROID')`, [CURRENT_TERMS_VERSION]);
  assert.deepEqual((await play.getFriendStudio({ accountId: 'friend', friendshipId })).items, [],
    'old privacy consent does not expose the saved studio');
  await pool.query(`INSERT INTO account_consents (account_id,terms_version,privacy_version,age_confirmed,source)
    VALUES ('player',$1,$2,true,'ANDROID')`, [CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION]);
  await assert.rejects(() => play.saveStudio({ accountId: 'player', studio: { ...studio,
    slots: [randomUUID()] } }),
  (error) => error instanceof PlayError && error.code === 'STUDIO_ITEM_NOT_OWNED');
  await assert.rejects(() => play.saveStudio({ accountId: 'other', studio }),
    (error) => error instanceof PlayError && error.code === 'STUDIO_THEME_LOCKED');
  const friendView = await play.getFriendStudio({ accountId: 'friend', friendshipId });
  assert.equal(friendView.avatar, 'companion-legacy');
  assert.equal(friendView.avatarClothingId, null);
  assert.equal(friendView.items[0]?.merchantId, 'play-merchant');
  assert.equal(JSON.stringify(friendView).includes(entitlement), false);
  assert.equal(JSON.stringify(friendView).includes('player'), false);
  await pool.query(`DELETE FROM campaign_goals WHERE campaign_id='play-campaign' AND target_visit_count=5`);
  await assert.rejects(() => play.saveStudio({ accountId: 'player', studio }),
    (error) => error instanceof PlayError && error.code === 'STUDIO_GOAL_UNAVAILABLE');
  assert.equal((await play.getStudio('player')).studio.goal, null);
  assert.equal((await play.getFriendStudio({ accountId: 'friend', friendshipId })).studio.goal, null);
  await pool.query(`INSERT INTO campaign_goals (campaign_id,target_visit_count,display_name)
    VALUES ('play-campaign',5,'Fifth collectible')`);
  assert.deepEqual((await play.getStudio('player')).studio.goal, studio.goal);
  assert.deepEqual((await play.getFriendStudio({ accountId: 'friend', friendshipId })).studio.goal, studio.goal);
  await pool.query(`UPDATE reward_entitlements SET status='CANCELED' WHERE id=$1`, [entitlement]);
  await pool.query(`UPDATE campaigns SET status='PAUSED' WHERE id='play-campaign'`);
  const sanitized = await play.getStudio('player');
  assert.deepEqual(sanitized.studio.slots, []);
  assert.equal(sanitized.studio.goal, null);
  assert.deepEqual(sanitized.items, []);
  const metrics = await play.aggregate(30);
  assert.equal(metrics.games.find((game) => game.kind === 'orders')?.completed, 4);
  assert.equal(metrics.events.find((event) => event.event === 'studio_saved')?.count, 1);
  await pool.query('DELETE FROM friendships WHERE id=$1', [friendshipId]);
  await assert.rejects(() => play.getFriendStudio({ accountId: 'friend', friendshipId }),
    (error) => error instanceof PlayError && error.code === 'FRIEND_STUDIO_NOT_FOUND');

  const deletion = new PostgresAccountDeletionService(pool, { hmacSecret: secret,
    policyVersion: 'test', now, accountLifecycle: lifecycle });
  const consent: ConsentService = { appSource: 'ANDROID',
    status: async () => ({ required: false, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION }),
    record: async () => { throw new Error('unexpected consent write'); },
  };
  const challenge = new WalletChallengeService({ store: new InMemoryChallengeStore(),
    domain: 'api.masscom.local', uri: 'https://api.masscom.local/wallet/verify', chainId: 84532,
    ttlMs: 300000, nonce: () => 'abc12345def67890', challengeId: () => 'challenge-studio-race' });
  for (const deletedRole of ['viewer', 'friend'] as const) {
    const viewerId = `race-viewer-${deletedRole}`;
    const friendId = `race-friend-${deletedRole}`;
    const pair = [viewerId, friendId].sort();
    const raceFriendshipId = randomUUID();
    await pool.query('INSERT INTO friendships (id,account_low,account_high) VALUES ($1,$2,$3)',
      [raceFriendshipId, ...pair]);
    const racingLifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
    const assertAllActive = racingLifecycle.assertAllActive.bind(racingLifecycle);
    let raced = false;
    racingLifecycle.assertAllActive = async (client, accounts) => {
      if (!raced && accounts.length === 2) {
        raced = true;
        // The relationship has been read, but neither account lock has been acquired yet.
        await deletion.requestDeletion({ accountId: deletedRole === 'viewer' ? viewerId : friendId,
          confirmation: 'DELETE MY ACCOUNT' });
      }
      await assertAllActive(client, accounts);
    };
    const args: Parameters<typeof createApiServer> = [challenge, developmentHeaderAccountResolver];
    args[26] = consent;
    args[37] = new PostgresPlayService(pool, racingLifecycle, { now });
    const result = await friendStudioRequest(createApiServer(...args), viewerId, raceFriendshipId);
    assert.equal(raced, true);
    assert.equal(result.status, deletedRole === 'viewer' ? 410 : 404);
    assert.deepEqual(result.body, { code: deletedRole === 'viewer' ? 'ACCOUNT_DELETED' : 'FRIEND_STUDIO_NOT_FOUND' });
  }
  await deletion.requestDeletion({ accountId: 'player', confirmation: 'DELETE MY ACCOUNT' });
  for (const table of ['play_runs', 'play_records', 'studios']) {
    assert.equal((await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM ${table} WHERE account_id='player'`)).rows[0]!.count, 0);
  }
  await assert.rejects(() => play.getStudio('player'),
    (error) => error instanceof PlayError && error.code === 'ACCOUNT_DELETED');
});

test('non-perfect game achievements and equipped rewards survive actual run retention', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) throw new Error('dedicated test database required');
  const pool = new Pool({ connectionString }); t.after(() => pool.end());
  await runMigrations(pool);
  const now = new Date('2026-10-05T00:00:00Z');
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const play = new PostgresPlayService(pool, lifecycle, { now: () => now });
  const accountId = `retained-skill-${randomUUID()}`;
  const run = await play.start({ accountId, kind: 'memory' });
  const board = getGameBoard('memory', run.seed);
  if (board.kind !== 'memory') throw new Error('wrong board');
  const mismatch = board.cards.findIndex(face => face !== board.cards[0]);
  const choices = [0, mismatch];
  for (let face=0; face<6; face++) choices.push(...board.cards.flatMap((value,index)=>value===face ? [index] : []));
  const actions = choices.map((choice,index)=>({choice,at:(index+1)*500}));
  now.setTime(now.getTime()+7500);
  const result = await play.finish({ accountId, runId: run.id, actions });
  assert.equal(result.score,585);
  assert.equal(result.skill?.achieved,true);
  const { PostgresCollectionExperienceService } = await import('./postgres/collection-experience.js');
  const experience = new PostgresCollectionExperienceService(pool,lifecycle);
  await experience.setEquipment({ accountId, badgeId: 'match-efficient', cosmetics: { prop: 'memory-card' } });
  now.setTime(now.getTime()+31*86400_000);
  const { PostgresRetentionService } = await import('./postgres/retention.js');
  const retention = await new PostgresRetentionService(pool,{now:()=>now}).run();
  assert.deepEqual(retention.failed,[]);
  assert.equal((await pool.query('SELECT 1 FROM play_runs WHERE id=$1',[run.id])).rowCount,0);
  assert.equal((await play.getPlay(accountId)).achievements?.find(a=>a.id==='match-efficient')?.achieved,true);
  const snapshot = await experience.getSnapshot(accountId);
  assert.equal(snapshot.profile.badgeId,'match-efficient');
  assert.equal(snapshot.profile.cosmetics.prop,'memory-card');
  const retained = (await play.getPlay(accountId)).records.find(record => record.kind === 'memory');
  assert.deepEqual(retained, { kind: 'memory', bestScore: 0, plays: 1, version2BestScore: 585, version2Plays: 1 });
});

test('0050 preserves pre-upgrade pending runs, cached results, scores and permanent rights', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) throw new Error('dedicated test database required');
  const pool = new Pool({ connectionString }); t.after(() => pool.end());
  const client = await pool.connect();
  const schema = `quality_${randomUUID().replaceAll('-', '')}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await client.query(await readFile(new URL('../migrations/0042_connected_play.sql', import.meta.url), 'utf8'));
    const pendingId = randomUUID();
    const cachedId = randomUUID();
    const cached = { kind: 'orders', score: 1125, bestScore: 1125, plays: 10, completed: true,
      correct: 12, total: 12, unlockedThemes: ['evening', 'garden'],
      skill: { id: 'order-streak', progress: 8, target: 8, achieved: true } };
    await client.query(`INSERT INTO play_records (account_id,kind,best_score,plays) VALUES ('legacy','orders',1125,10)`);
    await client.query(`INSERT INTO play_runs (id,account_id,kind,seed,started_at,expires_at,rules_version)
      VALUES ($1,'legacy','orders',17,now(),now()+interval '45 seconds',1)`, [pendingId]);
    await client.query(`INSERT INTO play_runs (id,account_id,kind,seed,started_at,expires_at,rules_version,finished_at,result)
      VALUES ($1,'legacy','orders',17,now(),now()+interval '45 seconds',1,now(),$2)`, [cachedId, JSON.stringify(cached)]);
    await client.query(await readFile(new URL('../migrations/0047_durable_game_achievements.sql', import.meta.url), 'utf8'));
    await client.query(await readFile(new URL('../migrations/0050_quality_game_records.sql', import.meta.url), 'utf8'));
    assert.equal((await client.query('SELECT rules_version FROM play_runs WHERE id=$1', [pendingId])).rows[0].rules_version, 1);
    assert.deepEqual((await client.query('SELECT result FROM play_runs WHERE id=$1', [cachedId])).rows[0].result, cached);
    assert.deepEqual((await client.query('SELECT best_score,plays,version2_best_score,version2_plays FROM play_records')).rows[0],
      { best_score: 1125, plays: 10, version2_best_score: 0, version2_plays: 0 });
    assert.deepEqual((await client.query('SELECT skill_progress,skill_achieved FROM play_records')).rows[0],
      { skill_progress: 8, skill_achieved: true });
    await client.query('UPDATE play_runs SET rules_version=2 WHERE id=$1', [pendingId]);
    assert.equal((await client.query('SELECT rules_version FROM play_runs WHERE id=$1', [pendingId])).rows[0].rules_version, 2);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('quality finishes enforce server elapsed and stop sample while preserving legacy scores and closed-account boundaries', async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) throw new Error('dedicated test database required');
  const pool = new Pool({ connectionString }); t.after(() => pool.end());
  await runMigrations(pool);
  const now = new Date('2026-10-05T00:00:00Z');
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const play = new PostgresPlayService(pool, lifecycle, { now: () => now });
  const accountId = `quality-${randomUUID()}`;
  await pool.query(`INSERT INTO play_records (account_id,kind,best_score,plays,skill_progress,skill_achieved)
    VALUES ($1,'stack',10,10,3,true)`, [accountId]);
  const stack = await play.start({ accountId, kind: 'stack' });
  await pool.query('UPDATE play_runs SET seed=17 WHERE id=$1', [stack.id]);
  const stackActions = [172, 541, 1011, 1212, 1711, 2387].map(at => ({ at, choice: 0 }));
  const invalid = (runId: string, actions: { at: number; choice: number }[]) => assert.rejects(() =>
    play.finish({ accountId, runId, actions }), error => error instanceof PlayError && error.code === 'PLAY_ACTIONS_INVALID');
  now.setTime(now.getTime() + 600);
  await invalid(stack.id, stackActions);
  now.setTime(now.getTime() + 1787);
  const result = await play.finish({ accountId, runId: stack.id, actions: stackActions });
  assert.equal(result.bestScore, 10);
  assert.equal(result.version2BestScore, 600);
  assert.equal(result.plays, 11);
  assert.equal(result.version2Plays, 1);
  assert.equal(result.newlyEarned, false);
  assert.deepEqual(result.unlockedThemes, ['evening', 'garden']);
  now.setTime(now.getTime() + 46_000);
  assert.deepEqual(await play.finish({ accountId, runId: stack.id, actions: [{ at: -1, choice: 9 }] }), result);
  const emptyDelivery = await play.start({ accountId, kind: 'delivery' });
  const stoppedDelivery = await play.start({ accountId, kind: 'delivery' });
  const completeDelivery = await play.start({ accountId, kind: 'delivery' });
  await pool.query('UPDATE play_runs SET seed=17 WHERE id=ANY($1::uuid[])', [[emptyDelivery.id, stoppedDelivery.id, completeDelivery.id]]);
  const deliveryBoard = getGameBoard('delivery', 17);
  if (deliveryBoard.kind !== 'delivery') throw new Error('unexpected board');
  const safe = deliveryBoard.ticks.map(tick => ({ at: tick.at, choice: tick.bonusLane }));
  now.setTime(now.getTime() + 23_000);
  await invalid(completeDelivery.id, safe);
  now.setTime(now.getTime() + 1000);
  const empty = await play.finish({ accountId, runId: emptyDelivery.id, actions: [] });
  assert.equal(empty.completed, false);
  assert.equal(empty.score, 0);
  const stopped = await play.finish({ accountId, runId: stoppedDelivery.id, actions: safe.slice(0, 1) });
  assert.equal(stopped.completed, false);
  assert.equal(stopped.score, 100);
  const [arrived, retry] = await Promise.all([
    play.finish({ accountId, runId: completeDelivery.id, actions: safe }),
    play.finish({ accountId, runId: completeDelivery.id, actions: safe }),
  ]);
  assert.deepEqual(retry, arrived);
  assert.equal(arrived.completed, true);
  assert.equal(arrived.score, 1200);
  assert.equal(arrived.version2Plays, 1);
  const pending = await play.start({ accountId, kind: 'orders' });
  const orders = getGameBoard('orders', pending.seed);
  if (orders.kind !== 'orders') throw new Error('unexpected board');
  const actions = orders.orders.flatMap(order => [...order, 4]).map((choice, index) => ({ at: index * 100, choice }));
  await invalid(pending.id, actions);
  const snapshot = await play.getPlay(accountId);
  assert.equal(snapshot.achievements?.find(skill => skill.id === 'stack-precision')?.achieved, true);
  for (let index = 5; index < 30; index++) await play.start({ accountId, kind: 'memory' });
  await assert.rejects(() => play.start({ accountId, kind: 'memory' }),
    error => error instanceof PlayError && error.code === 'PLAY_RATE_LIMITED');
  const deletion = new PostgresAccountDeletionService(pool, { hmacSecret: secret, policyVersion: 'test',
    now: () => now, accountLifecycle: lifecycle });
  await deletion.requestDeletion({ accountId, confirmation: 'DELETE MY ACCOUNT' });
  for (const action of [() => play.start({ accountId, kind: 'orders' }), () => play.getPlay(accountId),
    () => play.finish({ accountId, runId: stack.id, actions: [] })]) {
    await assert.rejects(action, error => error instanceof PlayError && error.code === 'ACCOUNT_DELETED');
  }
  assert.equal((await pool.query('SELECT 1 FROM play_records WHERE account_id=$1', [accountId])).rowCount, 0);
});

test('explicit legacy and quality starts persist their negotiated version and finish with separate scores', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) throw new Error('dedicated test database required');
  const pool = new Pool({ connectionString }); t.after(() => pool.end());
  await runMigrations(pool);
  const now = new Date('2026-10-05T00:00:00Z');
  const play = new PostgresPlayService(pool, new PostgresAccountLifecycle({ hmacSecret: secret }), { now: () => now });
  const accountId = `negotiated-${randomUUID()}`;
  const legacy = await play.start({ accountId, kind: 'orders', rulesVersion: 1 });
  const quality = await play.start({ accountId, kind: 'orders', rulesVersion: 2 });
  assert.equal(legacy.rulesVersion, 1);
  assert.equal(quality.rulesVersion, 2);
  assert.equal((await play.start({ accountId, kind: 'orders' })).rulesVersion, 2,
    'internal service callers retain the new-rule default');
  const stored = await pool.query('SELECT rules_version FROM play_runs WHERE id=$1 OR id=$2 ORDER BY rules_version', [legacy.id, quality.id]);
  assert.deepEqual(stored.rows, [{ rules_version: 1 }, { rules_version: 2 }]);
  await pool.query('UPDATE play_runs SET seed=17 WHERE id=$1 OR id=$2', [legacy.id, quality.id]);
  const board = getGameBoard('orders', 17);
  if (board.kind !== 'orders') throw new Error('unexpected board');
  now.setTime(now.getTime() + 1600);
  const oldResult = await play.finish({ accountId, runId: legacy.id,
    actions: board.orders.flat().map((choice, index) => ({ at: index * 100, choice })) });
  const newResult = await play.finish({ accountId, runId: quality.id,
    actions: board.orders.flatMap(order => [...order, 4]).map((choice, index) => ({ at: index * 100, choice })) });
  assert.equal(oldResult.rulesVersion, 1);
  assert.equal(oldResult.score, 1125);
  assert.equal(oldResult.version2Plays, 0);
  assert.equal(newResult.rulesVersion, 2);
  assert.equal(newResult.score, 1110);
  assert.equal(newResult.bestScore, 1125);
  assert.equal(newResult.version2BestScore, 1110);
  assert.equal(newResult.plays, 2);
  assert.equal(newResult.version2Plays, 1);
  assert.deepEqual(await play.finish({ accountId, runId: legacy.id, actions: [] }), oldResult);
  assert.deepEqual(await play.finish({ accountId, runId: quality.id, actions: [] }), newResult);
});

test('friend studios project only equipped owned clothing under the existing sharing and friendship boundary', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) throw new Error('dedicated test database required');
  const pool = new Pool({ connectionString }); t.after(() => pool.end());
  await runMigrations(pool);
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret: secret });
  const play = new PostgresPlayService(pool, lifecycle);
  const owner = `clothing-owner-${randomUUID()}`;
  const viewer = `clothing-viewer-${randomUUID()}`;
  const friendshipId = randomUUID();
  await pool.query('INSERT INTO friendships(id,account_low,account_high) VALUES($1,$2,$3)', [friendshipId, ...[owner, viewer].sort()]);
  await pool.query("INSERT INTO account_clothing(account_id,item_id,source) VALUES($1,'green-apron','REROLL'),($1,'sky-hoodie','REROLL')", [owner]);
  const { PostgresMileageShopService } = await import('./postgres/mileage-shop.js');
  const shop = new PostgresMileageShopService(pool, { accountLifecycle: lifecycle });
  await shop.setClothing({ accountId: owner, itemId: 'green-apron' });
  assert.equal((await play.getFriendStudio({ accountId: viewer, friendshipId })).avatarClothingId, null,
    'selected clothing remains private without a shared studio');
  await play.saveStudio({ accountId: owner, studio: { theme: 'daylight', layout: 'shelf', accent: 'mint', slots: [], goal: null } });
  assert.equal((await play.getFriendStudio({ accountId: viewer, friendshipId })).avatarClothingId, null,
    'a saved studio without current consent remains private');
  await pool.query("INSERT INTO account_consents(account_id,terms_version,privacy_version,age_confirmed,source) VALUES($1,$2,$3,true,'ANDROID')", [owner, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION]);
  const equipped = await play.getFriendStudio({ accountId: viewer, friendshipId });
  assert.equal(equipped.avatarClothingId, 'green-apron');
  assert.equal(JSON.stringify(equipped).includes('sky-hoodie'), false, 'unselected clothing inventory stays private');
  assert.equal(JSON.stringify(equipped).includes(owner), false);
  await shop.setClothing({ accountId: owner, itemId: null });
  assert.equal((await play.getFriendStudio({ accountId: viewer, friendshipId })).avatarClothingId, null);
  await shop.setClothing({ accountId: owner, itemId: 'green-apron' });
  await pool.query("DELETE FROM account_clothing WHERE account_id=$1 AND item_id='green-apron'", [owner]);
  assert.equal((await play.getFriendStudio({ accountId: viewer, friendshipId })).avatarClothingId, null,
    'removed ownership stops clothing projection');
  await assert.rejects(() => shop.setClothing({ accountId: owner, itemId: 'green-apron' }));
  await pool.query('DELETE FROM friendships WHERE id=$1', [friendshipId]);
  await assert.rejects(() => play.getFriendStudio({ accountId: viewer, friendshipId }),
    error => error instanceof PlayError && error.code === 'FRIEND_STUDIO_NOT_FOUND');
});
