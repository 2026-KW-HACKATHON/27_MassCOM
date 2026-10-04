import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  await pool.query(`TRUNCATE merchants, account_deletion_requests, account_profile, account_characters,
    play_runs, play_records, studios, play_flow_counts CASCADE`);
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
    assert.deepEqual(await play.finish({ accountId: 'player', runId: run.id, actions: [] }), finished);
  }
  const pending = await play.start({ accountId: 'player', kind: 'orders' });
  await assert.rejects(() => play.finish({ accountId: 'other', runId: pending.id, actions: [] }),
    (error) => error instanceof PlayError && error.code === 'PLAY_RUN_NOT_FOUND');
  await assert.rejects(() => play.finish({ accountId: 'player', runId: pending.id,
    actions: [{ at: 5000, choice: 0 }] }),
  (error) => error instanceof PlayError && error.code === 'PLAY_ACTIONS_INVALID');
  const partial = await play.finish({ accountId: 'player', runId: pending.id, actions: [] });
  assert.equal(partial.completed, false);
  assert.equal(partial.plays, 3);
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
  assert.equal(metrics.games.find((game) => game.kind === 'orders')?.completed, 3);
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
