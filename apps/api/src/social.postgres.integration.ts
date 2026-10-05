import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';

import { Pool } from 'pg';

import type { PushGateway, PushMessage, PushReceipt, PushTicket } from './social.js';
import { SocialError } from './social.js';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from './account-consent.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresFriendService } from './postgres/friends.js';
import { runMigrations } from './postgres/migrate.js';
import { PostgresSocialService } from './postgres/social.js';
import { mailPageSize } from './social-rules.js';

const hmacSecret = 'test-only-social-account-secret-at-least-32-bytes';
let dbTestQueue = Promise.resolve();

class StubGateway implements PushGateway {
  readonly messages: PushMessage[] = [];
  tickets: PushTicket[] = [];
  receipts = new Map<string, PushReceipt>();
  throwOnSend = false;

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.messages.push(...messages);
    if (this.throwOnSend) throw new Error('network');
    return messages.map((_, index) => this.tickets.shift() ?? { status: 'ok', id: `ticket-${this.messages.length}-${index}` });
  }

  async getReceipts(ticketIds: string[]): Promise<Map<string, PushReceipt>> {
    return new Map(ticketIds.flatMap((id) => {
      const receipt = this.receipts.get(id);
      return receipt ? [[id, receipt] as const] : [];
    }));
  }
}

class HookGateway implements PushGateway {
  readonly messages: PushMessage[] = [];
  tickets: PushTicket[] = [];
  beforeSend: (() => Promise<void>) | undefined;

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    await this.beforeSend?.();
    this.messages.push(...messages);
    return messages.map((_, index) => this.tickets.shift() ?? { status: 'ok', id: `hook-ticket-${this.messages.length}-${index}` });
  }

  async getReceipts(): Promise<Map<string, PushReceipt>> {
    return new Map();
  }
}

class BlockingReceiptGateway extends StubGateway {
  private pending: ((receipts: Map<string, PushReceipt>) => void) | undefined;
  requestedTicketIds: string[] = [];

  async getReceipts(ticketIds: string[]): Promise<Map<string, PushReceipt>> {
    this.requestedTicketIds = ticketIds;
    return new Promise((resolve) => { this.pending = resolve; });
  }

  resolve(receipts: Map<string, PushReceipt>): void {
    if (!this.pending) throw new Error('no pending receipt request');
    this.pending(receipts);
    this.pending = undefined;
  }
}

class BlockingGateway implements PushGateway {
  readonly messages: PushMessage[][] = [];
  private readonly pending: ((tickets: PushTicket[]) => void)[] = [];

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.messages.push(messages);
    return new Promise((resolve) => this.pending.push(resolve));
  }

  resolveNext(tickets: PushTicket[]): void {
    const resolve = this.pending.shift();
    if (!resolve) throw new Error('no pending gateway send');
    resolve(tickets);
  }

  async getReceipts(): Promise<Map<string, PushReceipt>> {
    return new Map();
  }
}

async function setup(t: TestContext) {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString || !decodeURIComponent(new URL(connectionString).pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated _test database');
  }
  let releaseDb!: () => void;
  const previousDbTest = dbTestQueue;
  dbTestQueue = new Promise<void>((resolve) => { releaseDb = resolve; });
  await previousDbTest;
  const pool = new Pool({ connectionString });
  t.after(async () => {
    await pool.end();
    releaseDb();
  });
  await runMigrations(pool);
  await pool.query(
    `TRUNCATE notification_deliveries, notification_items, notification_devices, notification_preferences,
              notification_outbox, push_tokens, social_mail, meal_invitations,
              friendship_gifts, mileage_credits, friendships, explorer_profiles,
              auth_sessions, account_consents, account_deletion_requests, merchants CASCADE`,
  );
  const state = { now: new Date('2026-10-04T15:00:00.000Z') };
  const gateway = new StubGateway();
  const lifecycle = new PostgresAccountLifecycle({ hmacSecret });
  const social = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway,
    now: () => state.now,
  });
  return { pool, state, gateway, lifecycle, social };
}

async function addFriendship(pool: Pool, a: string, b: string): Promise<string> {
  const id = randomUUID();
  const [low, high] = [a, b].sort();
  await pool.query('INSERT INTO friendships (id, account_low, account_high) VALUES ($1, $2, $3)', [id, low, high]);
  await pool.query(
    `INSERT INTO explorer_profiles (account_id, nickname) VALUES ($1, $2), ($3, $4)
     ON CONFLICT (account_id) DO NOTHING`,
    [a, `별명-${a}`, b, `별명-${b}`],
  );
  return id;
}

async function addMerchant(pool: Pool, id = 'shop-a'): Promise<void> {
  await pool.query(
    `INSERT INTO merchants (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ($1, $2, 'story', $3, 0, 'ACTIVE', true)
     ON CONFLICT (id) DO NOTHING`,
    [id, `가상 ${id}`, `서울 ${id}`],
  );
}

async function addConsent(pool: Pool, accountId: string, source = 'ANDROID'): Promise<void> {
  await pool.query(
    `INSERT INTO account_consents (account_id, terms_version, privacy_version, age_confirmed, source)
     VALUES ($1, $2, $3, true, $4)
     ON CONFLICT (account_id, terms_version, privacy_version) DO NOTHING`,
    [accountId, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION, source],
  );
}

const rejectsWith = (code: string) => (error: unknown) => error instanceof SocialError && error.code === code;

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condition was not reached');
}

async function waitForAsync(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('async condition was not reached');
}

test('migration 0050 creates social, mail, push, and credit tables with the required credit contract', async (t) => {
  const { pool } = await setup(t);
  await runMigrations(pool);
  const migrated = await pool.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations
     WHERE filename IN ('0043_campaign_extended_audit.sql', '0050_social_mail.sql',
                        '0051_shop_draw_rewards.sql', '0052_store_ticket_openings.sql', '0053_social_notification_deliveries.sql',
                        '0054_push_token_binding_revision.sql', '0055_notification_delivery_token_version.sql')
     ORDER BY filename`,
  );
  assert.deepEqual(migrated.rows.map((row) => row.filename), [
    '0043_campaign_extended_audit.sql',
    '0050_social_mail.sql',
    '0051_shop_draw_rewards.sql',
    '0052_store_ticket_openings.sql',
    '0053_social_notification_deliveries.sql',
    '0054_push_token_binding_revision.sql',
    '0055_notification_delivery_token_version.sql',
  ]);
  for (const table of [
    'mileage_credits', 'friendship_gifts', 'social_mail', 'meal_invitations', 'push_tokens', 'notification_outbox',
    'social_notification_deliveries',
  ]) {
    assert.equal((await pool.query(
      `SELECT count(*)::integer AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
      [table],
    )).rows[0]!.n, 1, table);
  }

  const deliveryColumns = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'social_notification_deliveries'
       AND column_name IN ('authorized_at', 'push_token_id', 'binding_revision')
     ORDER BY column_name`,
  );
  assert.deepEqual(deliveryColumns.rows.map((row) => row.column_name), ['authorized_at', 'binding_revision', 'push_token_id']);
  const pushColumns = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'push_tokens' AND column_name = 'binding_revision'`,
  );
  assert.deepEqual(pushColumns.rows.map((row) => row.column_name), ['binding_revision']);
  await runMigrations(pool);

  await pool.query(
    `INSERT INTO mileage_credits (id, account_id, amount, reason, source_id, business_date)
     VALUES ($1, 'a', 5, 'FRIENDSHIP', 'source-1', '2026-10-05')`,
    [randomUUID()],
  );
  await assert.rejects(pool.query(
    `INSERT INTO mileage_credits (id, account_id, amount, reason, source_id, business_date)
     VALUES ($1, 'a', 5, 'FRIENDSHIP', 'source-1', '2026-10-05')`,
    [randomUUID()],
  ), /unique|duplicate/i);
  await assert.rejects(pool.query(
    `INSERT INTO mileage_credits (id, account_id, amount, reason, source_id, business_date)
     VALUES ($1, 'a', 0, 'FRIENDSHIP', 'source-2', '2026-10-05')`,
    [randomUUID()],
  ), /check/i);
});


test('migration 0047 upgrades legacy outbox statuses and duplicate active tokens in an isolated schema', async (t) => {
  const { pool, state } = await setup(t);
  const schema = `social_migration_${randomUUID().replaceAll('-', '_')}`;
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE push_tokens (
        id uuid PRIMARY KEY,
        account_id text NOT NULL,
        app_variant text NOT NULL,
        token text NOT NULL,
        device_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz,
        CONSTRAINT push_tokens_account_variant_token_unique UNIQUE (account_id, app_variant, token)
      );
      CREATE TABLE notification_outbox (
        id uuid PRIMARY KEY,
        account_id text NOT NULL,
        mail_id uuid,
        event_type text NOT NULL,
        payload jsonb NOT NULL,
        status text NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        lease_id text,
        lease_expires_at timestamptz,
        expo_ticket_id text,
        last_error_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await client.query(
      `INSERT INTO push_tokens (id, account_id, app_variant, token, updated_at)
       VALUES ($1, 'old-owner', 'ANDROID', 'ExpoPushToken[dup]', $3),
              ($2, 'new-owner', 'ANDROID', 'ExpoPushToken[dup]', $4)`,
      [randomUUID(), randomUUID(), new Date(state.now.getTime() - 1_000), state.now],
    );
    const statuses = [
      ['PENDING', null],
      ['PROCESSING', new Date(Date.now() + 60_000)],
      ['PROCESSING', new Date(Date.now() - 60_000)],
      ['AWAITING_RECEIPT', null],
      ['RETRY', null],
      ['SENT', null],
      ['DEAD', null],
      ['CANCELLED', null],
    ] as const;
    for (const [index, [status, leaseExpiresAt]] of statuses.entries()) {
      await client.query(
        `INSERT INTO notification_outbox (
           id, account_id, event_type, payload, status, attempts, next_attempt_at,
           lease_id, lease_expires_at, expo_ticket_id, created_at, updated_at
         ) VALUES ($1, 'legacy-account', 'MESSAGE', '{}', $2, 1, $3, $4, $5, $6, $3, $3)`,
        [randomUUID(), status, state.now, leaseExpiresAt ? `lease-${index}` : null, leaseExpiresAt, `ticket-${index}`],
      );
    }

    await client.query(await readFile(new URL('../migrations/0053_social_notification_deliveries.sql', import.meta.url), 'utf8'));

    assert.deepEqual((await client.query<{ account_id: string; revoked: boolean }>(
      `SELECT account_id, revoked_at IS NOT NULL AS revoked FROM push_tokens ORDER BY account_id`,
    )).rows, [
      { account_id: 'new-owner', revoked: false },
      { account_id: 'old-owner', revoked: true },
    ]);
    const upgraded = await client.query<{ outbox_status: string; delivery_status: string; lease_id: string | null }>(
      `SELECT outbox.status AS outbox_status, delivery.status AS delivery_status, delivery.lease_id
       FROM notification_outbox outbox
       LEFT JOIN social_notification_deliveries delivery ON delivery.outbox_id = outbox.id
       ORDER BY outbox.created_at, outbox.id`,
    );
    assert.equal(upgraded.rows.filter((row) => row.outbox_status === 'PENDING' && row.delivery_status === null).length, 1);
    assert.equal(upgraded.rows.filter((row) => row.outbox_status === 'PROCESSING' && row.delivery_status === 'PROCESSING' && row.lease_id !== null).length, 1);
    assert.equal(upgraded.rows.filter((row) => row.outbox_status === 'PROCESSING' && row.delivery_status === 'RETRY' && row.lease_id === null).length, 1);
    for (const status of ['AWAITING_RECEIPT', 'RETRY', 'SENT', 'DEAD', 'CANCELLED']) {
      assert.equal(upgraded.rows.filter((row) => row.outbox_status === status && row.delivery_status === status).length, 1, status);
    }
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
});


test('migration 0054 upgrades duplicate active device rows before the unique binding index', async (t) => {
  const { pool, state } = await setup(t);
  const schema = `social_migration_${randomUUID().replaceAll('-', '_')}`;
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE push_tokens (
        id uuid PRIMARY KEY,
        account_id text NOT NULL,
        app_variant text NOT NULL,
        token text NOT NULL,
        device_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz,
        CONSTRAINT push_tokens_account_variant_token_unique UNIQUE (account_id, app_variant, token)
      );
    `);
    await client.query(
      `INSERT INTO push_tokens (id, account_id, app_variant, token, device_id, updated_at)
       VALUES ($1, 'old-owner', 'ANDROID', 'ExpoPushToken[old-device]', 'install-dup', $3),
              ($2, 'new-owner', 'ANDROID', 'ExpoPushToken[new-device]', 'install-dup', $4)`,
      [randomUUID(), randomUUID(), new Date(state.now.getTime() - 1_000), state.now],
    );

    const sql = await readFile(new URL('../migrations/0054_push_token_binding_revision.sql', import.meta.url), 'utf8');
    await client.query(sql);
    await client.query(sql);

    assert.deepEqual((await client.query<{ account_id: string; revoked: boolean }>(
      `SELECT account_id, revoked_at IS NOT NULL AS revoked FROM push_tokens ORDER BY account_id`,
    )).rows, [
      { account_id: 'new-owner', revoked: false },
      { account_id: 'old-owner', revoked: true },
    ]);
    assert.equal((await client.query<{ n: number }>(
      `SELECT count(*)::integer AS n FROM pg_indexes
       WHERE schemaname = $1 AND indexname = 'push_tokens_active_device_binding_unique'`,
      [schema],
    )).rows[0]!.n, 1);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
});

test('friendship gifts enforce pending lock, request replay, send limit, and FRIENDSHIP-only daily reward cap', async (t) => {
  const { pool, social } = await setup(t);
  const firstFriendship = await addFriendship(pool, 'alice', 'bob');
  await pool.query(
    `INSERT INTO mileage_credits (id, account_id, amount, reason, source_id, business_date)
     VALUES ($1, 'alice', 50, 'DRAW_BONUS', 'draw-1', '2026-10-05')`,
    [randomUUID()],
  );
  const first = await social.sendFriendshipGift({ accountId: 'alice', friendshipId: firstFriendship, requestId: 'send-1' });
  assert.equal(first.senderReward, 5, 'DRAW_BONUS must not consume the FRIENDSHIP daily cap');
  assert.equal(first.replayed, false);
  assert.equal((await social.sendFriendshipGift({ accountId: 'alice', friendshipId: firstFriendship, requestId: 'send-1' })).replayed, true);
  const conflictFriendship = await addFriendship(pool, 'alice', 'cf');
  await assert.rejects(
    social.sendFriendshipGift({ accountId: 'alice', friendshipId: conflictFriendship, requestId: 'send-1' }),
    rejectsWith('SOCIAL_REQUEST_CONFLICT'),
  );
  await assert.rejects(
    social.sendFriendshipGift({ accountId: 'alice', friendshipId: firstFriendship, requestId: 'send-1b' }),
    rejectsWith('SOCIAL_GIFT_PENDING'),
  );

  for (let index = 0; index < 4; index++) {
    const friendshipId = await addFriendship(pool, 'alice', `friend-${index}`);
    const sent = await social.sendFriendshipGift({ accountId: 'alice', friendshipId, requestId: `send-${index + 2}` });
    assert.equal(sent.senderReward, 5);
  }
  const sixth = await addFriendship(pool, 'alice', 'sixth');
  await assert.rejects(
    social.sendFriendshipGift({ accountId: 'alice', friendshipId: sixth, requestId: 'send-6' }),
    rejectsWith('SOCIAL_SEND_LIMIT_REACHED'),
  );
  const credit = await pool.query<{ total: number; rows: number }>(
    `SELECT coalesce(sum(amount), 0)::integer AS total, count(*)::integer AS rows
     FROM mileage_credits WHERE account_id = 'alice' AND reason = 'FRIENDSHIP'`,
  );
  assert.deepEqual(credit.rows[0], { total: 25, rows: 5 });
});

test('receiving gifts is unlimited, clears pending, and caps receiver rewards at 25 per KST day', async (t) => {
  const { pool, social } = await setup(t);
  const giftIds: string[] = [];
  for (let index = 0; index < 6; index++) {
    const friendshipId = await addFriendship(pool, `sender-${index}`, 'receiver');
    giftIds.push((await social.sendFriendshipGift({
      accountId: `sender-${index}`,
      friendshipId,
      requestId: `send-${index}`,
    })).giftId);
  }
  for (let index = 0; index < giftIds.length; index++) {
    const received = await social.receiveFriendshipGift({
      accountId: 'receiver',
      giftId: giftIds[index]!,
      requestId: `receive-${index}`,
    });
    assert.equal(received.status, 'RECEIVED');
    assert.equal(received.receiverReward, index < 5 ? 5 : 0);
  }
  const total = await pool.query<{ total: number; pending: number }>(
    `SELECT
       (SELECT coalesce(sum(amount), 0)::integer FROM mileage_credits WHERE account_id = 'receiver' AND reason = 'FRIENDSHIP') AS total,
       (SELECT count(*)::integer FROM friendship_gifts WHERE receiver_account_id = 'receiver' AND status = 'PENDING') AS pending`,
  );
  assert.deepEqual(total.rows[0], { total: 25, pending: 0 });
});

test('simultaneous gifts in both directions preserve each incoming gift and the current send policy', async t => {
  const { pool, social } = await setup(t);
  const friendshipId = await addFriendship(pool, 'alice', 'bob');
  const [fromAlice, fromBob] = await Promise.all([
    social.sendFriendshipGift({ accountId: 'alice', friendshipId, requestId: 'both-alice' }),
    social.sendFriendshipGift({ accountId: 'bob', friendshipId, requestId: 'both-bob' }),
  ]);
  const [alice, bob] = await Promise.all([social.getSocial('alice'), social.getSocial('bob')]);
  assert.deepEqual(alice.friends[0]!.gift, { pendingGiftId: fromBob.giftId,
    pendingDirection: 'RECEIVED', canSend: false, canReceive: true });
  assert.deepEqual(bob.friends[0]!.gift, { pendingGiftId: fromAlice.giftId,
    pendingDirection: 'RECEIVED', canSend: false, canReceive: true });
  await social.receiveFriendshipGift({ accountId: 'alice', giftId: alice.friends[0]!.gift.pendingGiftId!, requestId: 'both-receive-alice' });
  assert.deepEqual((await social.getSocial('alice')).friends[0]!.gift, { pendingGiftId: fromAlice.giftId,
    pendingDirection: 'SENT', canSend: false, canReceive: false });
  await social.receiveFriendshipGift({ accountId: 'bob', giftId: bob.friends[0]!.gift.pendingGiftId!, requestId: 'both-receive-bob' });
  assert.deepEqual((await social.getSocial('alice')).friends[0]!.gift, { pendingGiftId: null,
    pendingDirection: null, canSend: true, canReceive: false });
});

test('KST reset restores send count and reward cap while an old pending gift still blocks the same friend', async (t) => {
  const { pool, social, state } = await setup(t);
  const friendshipId = await addFriendship(pool, 'alice', 'bob');
  await social.sendFriendshipGift({ accountId: 'alice', friendshipId, requestId: 'old-day' });
  state.now = new Date('2026-10-05T15:00:00.000Z');
  const snapshot = await social.getSocial('alice');
  assert.equal(snapshot.businessDate, '2026-10-06');
  assert.equal(snapshot.friendshipGift.sendCount, 0);
  assert.equal(snapshot.friendshipGift.rewardEarnedToday, 0);
  assert.equal(snapshot.friends[0]!.gift.pendingGiftId !== null, true);
  await assert.rejects(
    social.sendFriendshipGift({ accountId: 'alice', friendshipId, requestId: 'new-day-same-friend' }),
    rejectsWith('SOCIAL_GIFT_PENDING'),
  );
});

test('messages and mail are visible only to sender and receiver', async (t) => {
  const { pool, social } = await setup(t);
  const friendshipId = await addFriendship(pool, 'alice', 'bob');
  const sent = await social.sendMessage({ accountId: 'alice', friendshipId, requestId: 'message-1', body: '  비밀 쪽지  ' });
  assert.equal(sent.body, '비밀 쪽지');
  assert.equal(sent.replayed, false);
  const replayed = await social.sendMessage({ accountId: 'alice', friendshipId, requestId: 'message-1', body: '비밀 쪽지' });
  assert.equal(replayed.id, sent.id);
  assert.equal(replayed.replayed, true);
  await assert.rejects(
    social.sendMessage({ accountId: 'alice', friendshipId, requestId: 'message-1', body: '다른 내용' }),
    rejectsWith('SOCIAL_REQUEST_CONFLICT'),
  );
  const otherFriendshipId = await addFriendship(pool, 'alice', 'charlie');
  await assert.rejects(
    social.sendMessage({ accountId: 'alice', friendshipId: otherFriendshipId, requestId: 'message-1', body: '비밀 쪽지' }),
    rejectsWith('SOCIAL_REQUEST_CONFLICT'),
  );
  await addMerchant(pool);
  await assert.rejects(
    social.createMealInvitation({
      accountId: 'alice',
      friendshipId,
      requestId: 'message-1',
      merchantId: 'shop-a',
      date: '2026-10-05',
      kind: 'CONFIRMED',
      time: '12:00',
    }),
    rejectsWith('SOCIAL_REQUEST_CONFLICT'),
  );
  const bobMail = await social.getMail({ accountId: 'bob', mailId: sent.id });
  assert.equal(bobMail.direction, 'INBOX');
  assert.equal((await social.markMailRead({ accountId: 'bob', mailId: sent.id })).readAt !== null, true);
  assert.equal((await social.listMail({ accountId: 'alice' })).mail[0]!.direction, 'SENT');
  await assert.rejects(social.getMail({ accountId: 'mallory', mailId: sent.id }), rejectsWith('SOCIAL_MAIL_NOT_FOUND'));
  await assert.rejects(
    social.sendMessage({ accountId: 'mallory', friendshipId, requestId: 'bad', body: 'x' }),
    rejectsWith('SOCIAL_FRIENDSHIP_NOT_FOUND'),
  );
});

test('meal invitations snapshot merchant data, validate range responses, and create one response mail/outbox on races', async (t) => {
  const { pool, social } = await setup(t);
  await addMerchant(pool);
  const friendshipId = await addFriendship(pool, 'alice', 'bob');
  const invitationMail = await social.createMealInvitation({
    accountId: 'alice',
    friendshipId,
    requestId: 'invite-1',
    merchantId: 'shop-a',
    date: '2026-10-05',
    kind: 'RANGE',
    startTime: '12:00',
    endTime: '14:00',
  });
  assert.equal(invitationMail.mealInvitation?.merchant.address, '서울 shop-a');
  assert.equal(invitationMail.replayed, false);
  assert.equal((await social.createMealInvitation({
    accountId: 'alice',
    friendshipId,
    requestId: 'invite-1',
    merchantId: ' shop-a ',
    date: '2026-10-05',
    kind: 'RANGE',
    startTime: '12:00',
    endTime: '14:00',
  })).id, invitationMail.id);
  assert.equal((await social.createMealInvitation({
    accountId: 'alice',
    friendshipId,
    requestId: 'invite-1',
    merchantId: 'shop-a',
    date: '2026-10-05',
    kind: 'RANGE',
    startTime: '12:00',
    endTime: '14:00',
  })).replayed, true);
  await assert.rejects(
    social.createMealInvitation({
      accountId: 'alice',
      friendshipId,
      requestId: 'invite-1',
      merchantId: 'shop-a',
      date: '2026-10-05',
      kind: 'RANGE',
      startTime: '12:00',
      endTime: '13:30',
    }),
    rejectsWith('SOCIAL_REQUEST_CONFLICT'),
  );
  await assert.rejects(
    social.sendMessage({ accountId: 'alice', friendshipId, requestId: 'invite-1', body: '초대 대신 쪽지' }),
    rejectsWith('SOCIAL_REQUEST_CONFLICT'),
  );
  const invitationId = invitationMail.mealInvitation!.invitationId;
  await assert.rejects(
    social.respondToMealInvitation({
      accountId: 'bob',
      invitationId,
      requestId: 'respond-bad',
      decision: 'ACCEPT',
      selectedTime: '14:01',
    }),
    rejectsWith('INVALID_REQUEST'),
  );
  const raced = await Promise.allSettled([
    social.respondToMealInvitation({
      accountId: 'bob',
      invitationId,
      requestId: 'respond-1',
      decision: 'ACCEPT',
      selectedTime: '12:40',
    }),
    social.respondToMealInvitation({
      accountId: 'bob',
      invitationId,
      requestId: 'respond-2',
      decision: 'DECLINE',
    }),
  ]);
  assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await pool.query(
    `SELECT count(*)::integer AS n FROM social_mail WHERE type = 'MEAL_RESPONSE' AND payload->>'invitationId' = $1`,
    [invitationId],
  )).rows[0]!.n, 1);
  assert.equal((await pool.query(
    `SELECT count(*)::integer AS n FROM notification_outbox WHERE event_type = 'MEAL_RESPONSE'`,
  )).rows[0]!.n, 1);
});

test('meal response and replay keep the authenticated responder perspective and full invitation detail', async t => {
  const { pool, social } = await setup(t);
  await addMerchant(pool);
  const friendshipId = await addFriendship(pool, 'alice', 'bob');
  for (const decision of ['ACCEPT', 'DECLINE'] as const) {
    const sent = await social.createMealInvitation({ accountId: 'alice', friendshipId,
      requestId: `perspective-invite-${decision}`, merchantId: 'shop-a', date: '2026-10-05',
      kind: 'RANGE', startTime: '12:00', endTime: '14:00' });
    const input = { accountId: 'bob', invitationId: sent.mealInvitation!.invitationId,
      requestId: `perspective-response-${decision}`, decision, ...(decision === 'ACCEPT' ? { selectedTime: '12:40' } : {}) };
    const response = await social.respondToMealInvitation(input);
    const replay = await social.respondToMealInvitation(input);
    assert.equal(response.replayed, false);
    assert.equal(replay.replayed, true);
    const expectedDetail = await social.getMail({ accountId: 'bob', mailId: response.mail.id });
    for (const result of [response, replay]) {
      assert.equal(result.mail.direction, 'SENT');
      assert.equal(result.mail.fromNickname, '별명-bob');
      assert.equal(result.mail.toNickname, '별명-alice');
      assert.deepEqual(result.mail, expectedDetail);
      assert.deepEqual(result.mail.mealInvitation, result.invitation);
      assert.equal(result.invitation.status, decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED');
      assert.equal(result.invitation.selectedTime, decision === 'ACCEPT' ? '12:40' : null);
    }
    assert.equal((await social.getMail({ accountId: 'alice', mailId: response.mail.id })).direction, 'INBOX');
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM social_mail WHERE type='MEAL_RESPONSE' AND payload->>'invitationId'=$1", [input.invitationId])).rows[0].count, 1);
  }
});

test('impossible meal dates fail as INVALID_REQUEST before reaching PostgreSQL date casts', async t => {
  const { pool, social } = await setup(t);
  await addMerchant(pool);
  const friendshipId = await addFriendship(pool, 'alice', 'bob');
  for (const date of ['2027-02-29', '2027-02-30', '2028-02-30', '2027-04-31', '2027-13-01', '2100-02-29']) {
    await assert.rejects(social.createMealInvitation({ accountId: 'alice', friendshipId,
      requestId: `calendar-${date}`, merchantId: 'shop-a', date, kind: 'CONFIRMED', time: '12:00' }), rejectsWith('INVALID_REQUEST'));
  }
  const leapDay = await social.createMealInvitation({ accountId: 'alice', friendshipId,
    requestId: 'calendar-leap', merchantId: 'shop-a', date: '2028-02-29', kind: 'CONFIRMED', time: '12:00' });
  assert.equal(leapDay.mealInvitation!.date, '2028-02-29');
  assert.equal((await pool.query('SELECT count(*)::integer AS count FROM meal_invitations')).rows[0].count, 1);
});

test('meal invitation responses reject previous-date and same-day past-time pending invitations as expired', async (t) => {
  const { pool, social, state } = await setup(t);
  await addMerchant(pool);
  const friendshipId = await addFriendship(pool, 'alice', 'bob');
  const previousDate = await social.createMealInvitation({
    accountId: 'alice',
    friendshipId,
    requestId: 'expired-date',
    merchantId: 'shop-a',
    date: '2026-10-05',
    kind: 'CONFIRMED',
    time: '12:00',
  });
  state.now = new Date('2026-10-05T15:00:00.000Z');
  await assert.rejects(
    social.respondToMealInvitation({
      accountId: 'bob',
      invitationId: previousDate.mealInvitation!.invitationId,
      requestId: 'expired-date-response',
      decision: 'ACCEPT',
      selectedTime: '12:00',
    }),
    rejectsWith('SOCIAL_INVITATION_EXPIRED'),
  );

  state.now = new Date('2026-10-04T15:00:00.000Z');
  const pastConfirmed = await social.createMealInvitation({
    accountId: 'alice',
    friendshipId,
    requestId: 'expired-confirmed',
    merchantId: 'shop-a',
    date: '2026-10-05',
    kind: 'CONFIRMED',
    time: '09:00',
  });
  const pastRange = await social.createMealInvitation({
    accountId: 'alice',
    friendshipId,
    requestId: 'expired-range',
    merchantId: 'shop-a',
    date: '2026-10-05',
    kind: 'RANGE',
    startTime: '08:00',
    endTime: '09:30',
  });
  state.now = new Date('2026-10-05T01:00:00.000Z');
  await assert.rejects(
    social.respondToMealInvitation({
      accountId: 'bob',
      invitationId: pastConfirmed.mealInvitation!.invitationId,
      requestId: 'expired-confirmed-response',
      decision: 'ACCEPT',
      selectedTime: '09:00',
    }),
    rejectsWith('SOCIAL_INVITATION_EXPIRED'),
  );
  await assert.rejects(
    social.respondToMealInvitation({
      accountId: 'bob',
      invitationId: pastRange.mealInvitation!.invitationId,
      requestId: 'expired-range-response',
      decision: 'ACCEPT',
      selectedTime: '09:00',
    }),
    rejectsWith('SOCIAL_INVITATION_EXPIRED'),
  );
});

test('mail pagination uses created_at and id keyset so same timestamp rows are not skipped', async (t) => {
  const { pool, social } = await setup(t);
  const ids = Array.from({ length: mailPageSize + 1 }, (_, index) => `00000000-0000-0000-0000-${(index + 1).toString(16).padStart(12, '0')}`);
  await pool.query(
    `INSERT INTO explorer_profiles (account_id, nickname)
     VALUES ('alice', '별명-alice'), ('bob', '별명-bob')
     ON CONFLICT (account_id) DO NOTHING`,
  );
  for (const id of ids) {
    await pool.query(
      `INSERT INTO social_mail (
         id, type, sender_account_id, receiver_account_id, title, body, payload, created_at
       ) VALUES ($1, 'MESSAGE', 'alice', 'bob', '친구 쪽지', $2, '{}'::jsonb, $3)`,
      [id, `body-${id}`, new Date('2026-10-04T15:00:00.000Z')],
    );
  }

  const first = await social.listMail({ accountId: 'alice' });
  assert.deepEqual(first.mail.map((mail) => mail.id), ids.slice(1).reverse());
  assert.equal(first.nextCursor, ids[1]);
  const second = await social.listMail({ accountId: 'alice', cursor: first.nextCursor! });
  assert.deepEqual(second.mail.map((mail) => mail.id), [ids[0]]);
  assert.equal(second.nextCursor, null);
});

test('push token binding is variant scoped and gateway/receipt processing avoids private notification bodies', async (t) => {
  const { pool, social, gateway } = await setup(t);
  await addConsent(pool, 'alice');
  await social.registerPushToken({
    accountId: 'alice',
    appVariant: 'ANDROID',
    token: 'ExpoPushToken[alice]',
    deviceId: 'device-1',
  });
  await social.registerPushToken({
    accountId: 'alice',
    appVariant: 'ANDROID',
    token: 'ExpoPushToken[alice-2]',
    deviceId: 'device-2',
  });
  await assert.rejects(social.registerPushToken({
    accountId: 'alice',
    appVariant: 'SHOWCASE_APP',
    token: 'ExpoPushToken[bad]',
  }), rejectsWith('SOCIAL_PUSH_TOKEN_INVALID'));

  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MEAL_RESPONSE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"x","type":"MEAL_RESPONSE"}}',
       'PENDING', $2)`,
    [randomUUID(), new Date('2026-10-04T15:00:00.000Z')],
  );
  gateway.tickets.push({ status: 'ok', id: 'ticket-ok' }, { status: 'ok', id: 'ticket-dead' });
  const flushed = await social.flushNotifications({ limit: 10 });
  assert.equal(flushed.sent, 2);
  assert.equal(gateway.messages.length, 2);
  assert.equal(JSON.stringify(gateway.messages[0]).includes('12:40'), false);
  assert.equal(JSON.stringify(gateway.messages[0]).includes('ExpoPushToken'), true, 'the gateway receives the token but logs are not used in service');
  gateway.receipts.set('ticket-ok', { status: 'ok' });
  gateway.receipts.set('ticket-dead', { status: 'error', code: 'DeviceNotRegistered', retryable: false, deadToken: true });
  assert.deepEqual(await social.reconcileReceipts({ limit: 10 }), { checked: 2, delivered: 1, retry: 0, dead: 1 });
  assert.equal((await pool.query(
    `SELECT count(*)::integer AS n FROM push_tokens WHERE account_id = 'alice' AND revoked_at IS NOT NULL`,
  )).rows[0]!.n, 1);
  assert.equal((await pool.query(
    `SELECT count(*)::integer AS n FROM push_tokens WHERE account_id = 'alice' AND revoked_at IS NULL`,
  )).rows[0]!.n, 1);

  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"y","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), new Date('2026-10-04T15:00:00.000Z')],
  );
  gateway.tickets.push({ status: 'ok', id: 'ticket-dead' });
  await social.flushNotifications({ limit: 10 });
  assert.equal(gateway.messages.length, 3, 'only the surviving token is used on the next dispatch');
});

test('push token registration transfers active token ownership and rotates device bindings', async (t) => {
  const { pool, social } = await setup(t);
  await addConsent(pool, 'alice');
  await addConsent(pool, 'bob');
  await social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[shared]', deviceId: 'phone', bindingRevision: 1 });
  await social.registerPushToken({ accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[shared]', deviceId: 'phone', bindingRevision: 2 });
  assert.deepEqual((await pool.query<{ account_id: string }>(
    `SELECT account_id FROM push_tokens WHERE token = 'ExpoPushToken[shared]' AND revoked_at IS NULL`,
  )).rows, [{ account_id: 'bob' }]);

  await social.registerPushToken({ accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[new]', deviceId: 'phone', bindingRevision: 3 });
  assert.deepEqual((await pool.query<{ token: string }>(
    `SELECT token FROM push_tokens WHERE account_id = 'bob' AND device_id = 'phone' AND revoked_at IS NULL`,
  )).rows, [{ token: 'ExpoPushToken[new]' }]);
});


test('push token binding revisions reject stale register and fence late unregister cleanup', async (t) => {
  const { pool, social } = await setup(t);
  await addConsent(pool, 'alice');
  await addConsent(pool, 'bob');

  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a1]', deviceId: 'install-1', bindingRevision: 1,
  });
  await assert.rejects(social.registerPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b1]', deviceId: 'install-1', bindingRevision: 1,
  }), rejectsWith('SOCIAL_REQUEST_CONFLICT'));

  await social.registerPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b2]', deviceId: 'install-1', bindingRevision: 2,
  });
  await assert.rejects(social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a1]', deviceId: 'install-1', bindingRevision: 1,
  }), rejectsWith('SOCIAL_REQUEST_CONFLICT'));

  await social.registerPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b2]', deviceId: 'install-1', bindingRevision: 2,
  });
  assert.deepEqual((await pool.query<{ account_id: string; token: string; binding_revision: number }>(
    `SELECT account_id, token, binding_revision FROM push_tokens WHERE app_variant = 'ANDROID' AND device_id = 'install-1' AND revoked_at IS NULL`,
  )).rows, [{ account_id: 'bob', token: 'ExpoPushToken[b2]', binding_revision: 2 }]);

  await social.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a1]', deviceId: 'install-1', bindingRevision: 1,
  });
  assert.deepEqual((await pool.query<{ account_id: string; token: string; binding_revision: number }>(
    `SELECT account_id, token, binding_revision FROM push_tokens WHERE app_variant = 'ANDROID' AND device_id = 'install-1' AND revoked_at IS NULL`,
  )).rows, [{ account_id: 'bob', token: 'ExpoPushToken[b2]', binding_revision: 2 }]);

  await social.registerPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b3]', deviceId: 'install-1', bindingRevision: 3,
  });
  await social.unregisterPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b3]', deviceId: 'install-1', bindingRevision: 2,
  });
  assert.deepEqual((await pool.query<{ token: string; binding_revision: number }>(
    `SELECT token, binding_revision FROM push_tokens WHERE account_id = 'bob' AND app_variant = 'ANDROID' AND device_id = 'install-1' AND revoked_at IS NULL`,
  )).rows, [{ token: 'ExpoPushToken[b3]', binding_revision: 3 }]);

  await social.unregisterPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b3]', deviceId: 'install-1', bindingRevision: 3,
  });
  assert.deepEqual((await pool.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM push_tokens WHERE account_id = 'bob' AND app_variant = 'ANDROID' AND device_id = 'install-1' AND revoked_at IS NULL`,
  )).rows, [{ n: 0 }]);

  await assert.rejects(social.registerPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b3]', deviceId: 'install-1', bindingRevision: 2,
  }), rejectsWith('SOCIAL_REQUEST_CONFLICT'));
});


test('absent-device logout tombstone blocks delayed older and equal revision registers', async (t) => {
  const { pool, social } = await setup(t);
  await addConsent(pool, 'alice');
  await social.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[absent]', deviceId: 'install-absent', bindingRevision: 5,
  });
  assert.deepEqual((await pool.query<{ account_id: string; token: string; binding_revision: number; active: boolean }>(
    `SELECT account_id, token, binding_revision, revoked_at IS NULL AS active
     FROM push_tokens WHERE app_variant = 'ANDROID' AND device_id = 'install-absent'`,
  )).rows, [{ account_id: 'alice', token: 'ExpoPushToken[absent]', binding_revision: 5, active: false }]);

  await assert.rejects(social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[absent]', deviceId: 'install-absent', bindingRevision: 4,
  }), rejectsWith('SOCIAL_REQUEST_CONFLICT'));
  await assert.rejects(social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[absent]', deviceId: 'install-absent', bindingRevision: 5,
  }), rejectsWith('SOCIAL_REQUEST_CONFLICT'));
  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[absent]', deviceId: 'install-absent', bindingRevision: 6,
  });
  assert.deepEqual((await pool.query<{ binding_revision: number }>(
    `SELECT binding_revision FROM push_tokens
     WHERE app_variant = 'ANDROID' AND device_id = 'install-absent' AND revoked_at IS NULL`,
  )).rows, [{ binding_revision: 6 }]);
});

test('legacy-shaped token operations cannot steal or revoke a current versioned binding', async (t) => {
  const { pool, social } = await setup(t);
  await addConsent(pool, 'alice');
  await addConsent(pool, 'bob');
  await social.registerPushToken({ accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[owned]', deviceId: 'install-owned', bindingRevision: 3 });

  await assert.rejects(social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[owned]',
  }), rejectsWith('SOCIAL_REQUEST_CONFLICT'));
  await social.unregisterPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[owned]' });
  assert.deepEqual((await pool.query<{ account_id: string; binding_revision: number }>(
    `SELECT account_id, binding_revision FROM push_tokens
     WHERE token = 'ExpoPushToken[owned]' AND revoked_at IS NULL`,
  )).rows, [{ account_id: 'bob', binding_revision: 3 }]);
});


test('newer caller logout leaves a tombstone while another account remains active', async (t) => {
  const { pool, social, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  await addConsent(pool, 'bob');
  await social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a-cycle5]', deviceId: 'install-cycle5', bindingRevision: 1 });

  let pauseReached!: () => void;
  let resumeRegister!: () => void;
  const reached = new Promise<void>((resolve) => { pauseReached = resolve; });
  const resume = new Promise<void>((resolve) => { resumeRegister = resolve; });
  const heldRegister = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway: new StubGateway(),
    now: () => state.now,
    beforePushTokenAuthorization: async (operation) => {
      if (operation === 'register') {
        pauseReached();
        await resume;
      }
    },
  });

  const staleRegister = heldRegister.registerPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b-cycle5]', deviceId: 'install-cycle5', bindingRevision: 3,
  });
  await reached;
  await social.unregisterPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b-cycle5]', deviceId: 'install-cycle5', bindingRevision: 4,
  });
  resumeRegister();
  await assert.rejects(staleRegister, rejectsWith('SOCIAL_REQUEST_CONFLICT'));

  assert.deepEqual((await pool.query<{ account_id: string; token: string; binding_revision: number; active: boolean }>(
    `SELECT account_id, token, binding_revision, revoked_at IS NULL AS active
     FROM push_tokens
     WHERE app_variant = 'ANDROID' AND device_id = 'install-cycle5'
     ORDER BY account_id, token`,
  )).rows, [
    { account_id: 'alice', token: 'ExpoPushToken[a-cycle5]', binding_revision: 1, active: true },
    { account_id: 'bob', token: 'ExpoPushToken[b-cycle5]', binding_revision: 4, active: false },
  ]);

  await social.registerPushToken({ accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b-cycle5]', deviceId: 'install-cycle5', bindingRevision: 5 });
  assert.deepEqual((await pool.query<{ account_id: string; token: string; binding_revision: number }>(
    `SELECT account_id, token, binding_revision
     FROM push_tokens
     WHERE app_variant = 'ANDROID' AND device_id = 'install-cycle5' AND revoked_at IS NULL`,
  )).rows, [{ account_id: 'bob', token: 'ExpoPushToken[b-cycle5]', binding_revision: 5 }]);

  await social.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a-cycle5]', deviceId: 'install-cycle5', bindingRevision: 4,
  });
  assert.deepEqual((await pool.query<{ account_id: string; token: string; binding_revision: number }>(
    `SELECT account_id, token, binding_revision
     FROM push_tokens
     WHERE app_variant = 'ANDROID' AND device_id = 'install-cycle5' AND revoked_at IS NULL`,
  )).rows, [{ account_id: 'bob', token: 'ExpoPushToken[b-cycle5]', binding_revision: 5 }]);
});

test('failed same-account replacement logout keeps old cleanup authority and blocks delayed older register', async (t) => {
  const { pool, social } = await setup(t);
  await addConsent(pool, 'alice');
  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[old-cycle5]', deviceId: 'install-same-cycle5', bindingRevision: 1,
  });

  await social.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[new-cycle5]', deviceId: 'install-same-cycle5', bindingRevision: 3,
  });
  assert.deepEqual((await pool.query<{ token: string; binding_revision: number; active: boolean }>(
    `SELECT token, binding_revision, revoked_at IS NULL AS active
     FROM push_tokens
     WHERE account_id = 'alice' AND app_variant = 'ANDROID' AND device_id = 'install-same-cycle5'
     ORDER BY token`,
  )).rows, [
    { token: 'ExpoPushToken[new-cycle5]', binding_revision: 3, active: false },
    { token: 'ExpoPushToken[old-cycle5]', binding_revision: 1, active: true },
  ]);

  await social.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[old-cycle5]', deviceId: 'install-same-cycle5', bindingRevision: 3,
  });
  assert.deepEqual((await pool.query<{ token: string; binding_revision: number; active: boolean }>(
    `SELECT token, binding_revision, revoked_at IS NULL AS active
     FROM push_tokens
     WHERE account_id = 'alice' AND app_variant = 'ANDROID' AND device_id = 'install-same-cycle5'
     ORDER BY token`,
  )).rows, [
    { token: 'ExpoPushToken[new-cycle5]', binding_revision: 3, active: false },
    { token: 'ExpoPushToken[old-cycle5]', binding_revision: 3, active: false },
  ]);
  await assert.rejects(social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[new-cycle5]', deviceId: 'install-same-cycle5', bindingRevision: 2,
  }), rejectsWith('SOCIAL_REQUEST_CONFLICT'));
  await assert.rejects(social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[old-cycle5]', deviceId: 'install-same-cycle5', bindingRevision: 2,
  }), rejectsWith('SOCIAL_REQUEST_CONFLICT'));
});

test('stale other-account cleanup held before locks cannot revoke newer caller tombstone', async (t) => {
  const { pool, social, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  await addConsent(pool, 'bob');
  await social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a-held-cycle5]', deviceId: 'install-held-cycle5', bindingRevision: 1 });

  let pauseReached!: () => void;
  let resumeUnregister!: () => void;
  const reached = new Promise<void>((resolve) => { pauseReached = resolve; });
  const resume = new Promise<void>((resolve) => { resumeUnregister = resolve; });
  const heldCleanup = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway: new StubGateway(),
    now: () => state.now,
    beforePushTokenAuthorization: async (operation) => {
      if (operation === 'unregister') {
        pauseReached();
        await resume;
      }
    },
  });

  const staleCleanup = heldCleanup.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a-held-cycle5]', deviceId: 'install-held-cycle5', bindingRevision: 4,
  });
  await reached;
  await social.unregisterPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b-held-cycle5]', deviceId: 'install-held-cycle5', bindingRevision: 5,
  });
  resumeUnregister();
  await staleCleanup;

  assert.deepEqual((await pool.query<{ account_id: string; token: string; binding_revision: number; active: boolean }>(
    `SELECT account_id, token, binding_revision, revoked_at IS NULL AS active
     FROM push_tokens
     WHERE app_variant = 'ANDROID' AND device_id = 'install-held-cycle5'
     ORDER BY account_id, token`,
  )).rows, [
    { account_id: 'alice', token: 'ExpoPushToken[a-held-cycle5]', binding_revision: 1, active: true },
    { account_id: 'bob', token: 'ExpoPushToken[b-held-cycle5]', binding_revision: 5, active: false },
  ]);

  await social.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a-held-cycle5]', deviceId: 'install-held-cycle5', bindingRevision: 6,
  });
  assert.deepEqual((await pool.query<{ account_id: string; token: string; binding_revision: number; active: boolean }>(
    `SELECT account_id, token, binding_revision, revoked_at IS NULL AS active
     FROM push_tokens
     WHERE app_variant = 'ANDROID' AND device_id = 'install-held-cycle5'
     ORDER BY account_id, token`,
  )).rows, [
    { account_id: 'alice', token: 'ExpoPushToken[a-held-cycle5]', binding_revision: 6, active: false },
    { account_id: 'bob', token: 'ExpoPushToken[b-held-cycle5]', binding_revision: 5, active: false },
  ]);
});


test('current cleanup safe-noop after newer caller tombstone preserves active binding until exact fresh cleanup', async (t) => {
  const { pool, social, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  await addConsent(pool, 'bob');
  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a-old-cycle6]', deviceId: 'install-cycle6', bindingRevision: 2,
  });
  await social.registerPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b-cycle6]', deviceId: 'install-cycle6', bindingRevision: 4,
  });
  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a-new-cycle6]', deviceId: 'install-cycle6', bindingRevision: 5,
  });

  let pauseReached!: () => void;
  let resumeUnregister!: () => void;
  const reached = new Promise<void>((resolve) => { pauseReached = resolve; });
  const resume = new Promise<void>((resolve) => { resumeUnregister = resolve; });
  const heldCurrentCleanup = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway: new StubGateway(),
    now: () => state.now,
    beforePushTokenAuthorization: async (operation) => {
      if (operation === 'unregister') {
        pauseReached();
        await resume;
      }
    },
  });

  const staleCurrentCleanup = heldCurrentCleanup.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a-new-cycle6]', deviceId: 'install-cycle6', bindingRevision: 6,
  });
  await reached;
  await social.unregisterPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b-cycle6]', deviceId: 'install-cycle6', bindingRevision: 7,
  });
  resumeUnregister();
  await staleCurrentCleanup;

  await social.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a-old-cycle6]', deviceId: 'install-cycle6', bindingRevision: 8,
  });
  await assert.rejects(social.registerPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[b-cycle6]', deviceId: 'install-cycle6', bindingRevision: 6,
  }), rejectsWith('SOCIAL_REQUEST_CONFLICT'));

  assert.deepEqual((await pool.query<{ account_id: string; token: string; binding_revision: number; active: boolean }>(
    `SELECT account_id, token, binding_revision, revoked_at IS NULL AS active
     FROM push_tokens
     WHERE app_variant = 'ANDROID' AND device_id = 'install-cycle6'
     ORDER BY account_id, token`,
  )).rows, [
    { account_id: 'alice', token: 'ExpoPushToken[a-new-cycle6]', binding_revision: 5, active: true },
    { account_id: 'alice', token: 'ExpoPushToken[a-old-cycle6]', binding_revision: 8, active: false },
    { account_id: 'bob', token: 'ExpoPushToken[b-cycle6]', binding_revision: 7, active: false },
  ]);

  await social.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a-new-cycle6]', deviceId: 'install-cycle6', bindingRevision: 9,
  });
  assert.deepEqual((await pool.query<{ account_id: string; token: string; binding_revision: number; active: boolean }>(
    `SELECT account_id, token, binding_revision, revoked_at IS NULL AS active
     FROM push_tokens
     WHERE app_variant = 'ANDROID' AND device_id = 'install-cycle6'
     ORDER BY account_id, token`,
  )).rows, [
    { account_id: 'alice', token: 'ExpoPushToken[a-new-cycle6]', binding_revision: 9, active: false },
    { account_id: 'alice', token: 'ExpoPushToken[a-old-cycle6]', binding_revision: 8, active: false },
    { account_id: 'bob', token: 'ExpoPushToken[b-cycle6]', binding_revision: 7, active: false },
  ]);
});

test('account deletion completes while dispatch is paused before authorization locks', async (t) => {
  const { pool, lifecycle, state } = await setup(t);
  await addConsent(pool, 'delete-race');
  const gateway = new StubGateway();
  let pauseReached!: () => void;
  let resumeAuthorization!: () => void;
  const reached = new Promise<void>((resolve) => { pauseReached = resolve; });
  const resume = new Promise<void>((resolve) => { resumeAuthorization = resolve; });
  const social = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway,
    now: () => state.now,
    beforeDispatchAuthorization: async () => {
      pauseReached();
      await resume;
    },
  });
  await social.registerPushToken({ accountId: 'delete-race', appVariant: 'ANDROID', token: 'ExpoPushToken[delete-race]' });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'delete-race', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"delete-race","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), state.now],
  );

  const flush = social.flushNotifications({ limit: 1 });
  await reached;
  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret,
    policyVersion: 'test-policy',
    accountLifecycle: lifecycle,
    now: () => state.now,
  });
  await Promise.race([
    deletion.requestDeletion({ accountId: 'delete-race', confirmation: 'DELETE MY ACCOUNT' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('deletion deadlocked behind dispatch')), 2_000)),
  ]);
  resumeAuthorization();
  assert.deepEqual(await flush, { claimed: 0, sent: 0, retry: 0, dead: 0, skipped: 0 });
  assert.equal(gateway.messages.length, 0);
});

test('same-account legacy push mutations cannot alter current revisioned binding', async (t) => {
  const { pool, social } = await setup(t);
  await addConsent(pool, 'alice');
  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[current-rev3]', deviceId: 'install-rev3', bindingRevision: 3,
  });

  await assert.rejects(
    social.unregisterPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[current-rev3]' }),
    rejectsWith('SOCIAL_REQUEST_CONFLICT'),
  );
  await assert.rejects(
    social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[legacy-rotation]', deviceId: 'install-rev3' }),
    rejectsWith('SOCIAL_REQUEST_CONFLICT'),
  );
  assert.deepEqual((await pool.query<{ token: string; binding_revision: number }>(
    `SELECT token, binding_revision FROM push_tokens
     WHERE account_id = 'alice' AND app_variant = 'ANDROID' AND device_id = 'install-rev3' AND revoked_at IS NULL`,
  )).rows, [{ token: 'ExpoPushToken[current-rev3]', binding_revision: 3 }]);

  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[current-rev4]', deviceId: 'install-rev3', bindingRevision: 4,
  });
  assert.deepEqual((await pool.query<{ token: string; binding_revision: number }>(
    `SELECT token, binding_revision FROM push_tokens
     WHERE account_id = 'alice' AND app_variant = 'ANDROID' AND device_id = 'install-rev3' AND revoked_at IS NULL`,
  )).rows, [{ token: 'ExpoPushToken[current-rev4]', binding_revision: 4 }]);
});

test('legacy token-only registration rejects versioned revoked token history', async (t) => {
  const { pool, social } = await setup(t);
  await addConsent(pool, 'alice');
  await addConsent(pool, 'bob');
  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[history]', deviceId: 'install-history', bindingRevision: 3,
  });
  await social.unregisterPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[history]', deviceId: 'install-history', bindingRevision: 4,
  });

  await assert.rejects(
    social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[history]' }),
    rejectsWith('SOCIAL_REQUEST_CONFLICT'),
  );
  await assert.rejects(
    social.registerPushToken({ accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[history]' }),
    rejectsWith('SOCIAL_REQUEST_CONFLICT'),
  );
  assert.deepEqual((await pool.query<{ active: number }>(
    `SELECT count(*)::integer AS active FROM push_tokens WHERE token = 'ExpoPushToken[history]' AND revoked_at IS NULL`,
  )).rows, [{ active: 0 }]);

  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[history]', deviceId: 'install-history', bindingRevision: 5,
  });
  assert.deepEqual((await pool.query<{ binding_revision: number }>(
    `SELECT binding_revision FROM push_tokens WHERE token = 'ExpoPushToken[history]' AND revoked_at IS NULL`,
  )).rows, [{ binding_revision: 5 }]);
});

test('retry dispatch rechecks binding after newer transfer commits before authorization', async (t) => {
  const { pool, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  await addConsent(pool, 'bob');
  const setupGateway = new StubGateway();
  setupGateway.throwOnSend = true;
  const setupSocial = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway: setupGateway,
    now: () => state.now,
  });
  await setupSocial.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[transfer-retry]', deviceId: 'install-transfer', bindingRevision: 1,
  });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"transfer-retry","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), state.now],
  );
  assert.deepEqual(await setupSocial.flushNotifications({ limit: 1 }), { claimed: 1, sent: 0, retry: 1, dead: 0, skipped: 0 });
  state.now = new Date('2026-10-04T15:01:00.000Z');
  const gateway = new StubGateway();
  let pauseReached!: () => void;
  let resumeAuthorization!: () => void;
  const reached = new Promise<void>((resolve) => { pauseReached = resolve; });
  const resume = new Promise<void>((resolve) => { resumeAuthorization = resolve; });
  const retrySocial = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway,
    now: () => state.now,
    beforeDispatchAuthorization: async () => {
      pauseReached();
      await resume;
    },
  });

  const retryFlush = retrySocial.flushNotifications({ limit: 1 });
  await reached;
  await setupSocial.registerPushToken({
    accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[transfer-retry]', deviceId: 'install-transfer', bindingRevision: 2,
  });
  resumeAuthorization();
  assert.deepEqual(await retryFlush, { claimed: 1, sent: 0, retry: 0, dead: 1, skipped: 1 });
  assert.equal(gateway.messages.length, 0);
});

async function runReceiptRetryOverlapCase(t: TestContext, releaseReceiptFirst: boolean): Promise<void> {
  const { pool, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  const setupGateway = new StubGateway();
  const setupSocial = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway: setupGateway,
    now: () => state.now,
  });
  await setupSocial.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[receipt-overlap]', deviceId: 'install-receipt', bindingRevision: 1 });
  await setupSocial.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[retry-overlap]', deviceId: 'install-retry', bindingRevision: 1 });
  const outboxId = randomUUID();
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"overlap","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [outboxId, state.now],
  );
  setupGateway.tickets.push({ status: 'ok', id: 'ticket-receipt-overlap' }, { status: 'ok', id: 'ticket-retry-overlap-old' });
  assert.equal((await setupSocial.flushNotifications({ limit: 1 })).sent, 2);
  await pool.query(
    `UPDATE social_notification_deliveries
     SET status = 'RETRY', next_attempt_at = $2, lease_id = NULL, lease_expires_at = NULL, last_error_code = 'MessageRateExceeded'
     WHERE outbox_id = $1 AND token = 'ExpoPushToken[retry-overlap]'`,
    [outboxId, state.now],
  );
  await pool.query(`UPDATE notification_outbox SET status = 'AWAITING_RECEIPT', lease_id = NULL, lease_expires_at = NULL WHERE id = $1`, [outboxId]);

  const receiptGateway = new BlockingReceiptGateway();
  receiptGateway.receipts.set('ticket-receipt-overlap', { status: 'ok' });
  const receiptSocial = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway: receiptGateway,
    now: () => state.now,
  });
  const sendGateway = new BlockingGateway();
  const sendSocial = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway: sendGateway,
    now: () => state.now,
  });

  const receiptWork = receiptSocial.reconcileReceipts({ limit: 1 });
  await waitFor(() => receiptGateway.requestedTicketIds.includes('ticket-receipt-overlap'));
  const sendWork = sendSocial.flushNotifications({ limit: 1 });
  await waitFor(() => sendGateway.messages.length === 1);
  assert.deepEqual(sendGateway.messages[0]!.map((message) => message.to), ['ExpoPushToken[retry-overlap]']);

  if (releaseReceiptFirst) {
    receiptGateway.resolve(new Map([['ticket-receipt-overlap', { status: 'ok' }]]));
    assert.deepEqual(await receiptWork, { checked: 1, delivered: 1, retry: 0, dead: 0 });
    sendGateway.resolveNext([{ status: 'ok', id: 'ticket-retry-overlap-new' }]);
    assert.deepEqual(await sendWork, { claimed: 1, sent: 1, retry: 0, dead: 0, skipped: 0 });
  } else {
    sendGateway.resolveNext([{ status: 'ok', id: 'ticket-retry-overlap-new' }]);
    assert.deepEqual(await sendWork, { claimed: 1, sent: 1, retry: 0, dead: 0, skipped: 0 });
    receiptGateway.resolve(new Map([['ticket-receipt-overlap', { status: 'ok' }]]));
    assert.deepEqual(await receiptWork, { checked: 1, delivered: 1, retry: 0, dead: 0 });
  }

  assert.deepEqual((await pool.query<{ token: string; status: string; expo_ticket_id: string | null }>(
    `SELECT token, status, expo_ticket_id FROM social_notification_deliveries
     WHERE outbox_id = $1
     ORDER BY token`,
    [outboxId],
  )).rows, [
    { token: 'ExpoPushToken[receipt-overlap]', status: 'SENT', expo_ticket_id: 'ticket-receipt-overlap' },
    { token: 'ExpoPushToken[retry-overlap]', status: 'AWAITING_RECEIPT', expo_ticket_id: 'ticket-retry-overlap-new' },
  ]);
  assert.equal((await sendSocial.flushNotifications({ limit: 1 })).claimed, 0);
}

test('receipt completion before retry send release preserves both deliveries', async (t) => {
  await runReceiptRetryOverlapCase(t, true);
});

test('retry send completion before receipt release preserves both deliveries', async (t) => {
  await runReceiptRetryOverlapCase(t, false);
});

async function seedTwoDeliveryOutbox(pool: Pool, social: PostgresSocialService, gateway: StubGateway, state: { now: Date }, accountId: string, suffix: string): Promise<string> {
  await social.registerPushToken({ accountId, appVariant: 'ANDROID', token: `ExpoPushToken[${suffix}-a]`, deviceId: `${suffix}-a`, bindingRevision: 1 });
  await social.registerPushToken({ accountId, appVariant: 'ANDROID', token: `ExpoPushToken[${suffix}-b]`, deviceId: `${suffix}-b`, bindingRevision: 1 });
  const outboxId = randomUUID();
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, $2, 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"seed","type":"MESSAGE"}}',
       'PENDING', $3)`,
    [outboxId, accountId, state.now],
  );
  gateway.tickets.push({ status: 'ok', id: `${suffix}-ticket-a` }, { status: 'ok', id: `${suffix}-ticket-b` });
  assert.equal((await social.flushNotifications({ limit: 1 })).sent, 2);
  return outboxId;
}

test('receipt terminal rollback keeps token active and receipt recoverable without resend', async (t) => {
  const { pool, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  const gateway = new StubGateway();
  const social = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway, now: () => state.now, leaseMs: 1_000 });
  await social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[rollback]', deviceId: 'install-rollback', bindingRevision: 1 });
  const outboxId = randomUUID();
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"rollback","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [outboxId, state.now],
  );
  gateway.tickets.push({ status: 'ok', id: 'ticket-rollback' });
  assert.equal((await social.flushNotifications({ limit: 1 })).sent, 1);
  gateway.receipts.set('ticket-rollback', { status: 'error', code: 'DeviceNotRegistered', retryable: false, deadToken: true });

  const failing = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway, now: () => state.now, leaseMs: 1_000,
    failReceiptCompletionAfterTerminal: true,
  });
  await assert.rejects(failing.reconcileReceipts({ limit: 1 }), /TEST_RECEIPT_COMPLETION_AFTER_TERMINAL/);
  assert.deepEqual((await pool.query<{ status: string; active: boolean }>(
    `SELECT delivery.status, token.revoked_at IS NULL AS active
     FROM social_notification_deliveries delivery JOIN push_tokens token ON token.id = delivery.push_token_id
     WHERE delivery.expo_ticket_id = 'ticket-rollback'`,
  )).rows, [{ status: 'PROCESSING', active: true }]);

  state.now = new Date('2026-10-04T15:00:02.000Z');
  assert.deepEqual(await social.reconcileReceipts({ limit: 1 }), { checked: 1, delivered: 0, retry: 0, dead: 1 });
  assert.equal(gateway.messages.length, 1, 'receipt recovery does not resend through gateway');
  assert.deepEqual((await pool.query<{ status: string; active: boolean }>(
    `SELECT delivery.status, token.revoked_at IS NULL AS active
     FROM social_notification_deliveries delivery JOIN push_tokens token ON token.id = delivery.push_token_id
     WHERE delivery.expo_ticket_id = 'ticket-rollback'`,
  )).rows, [{ status: 'DEAD', active: false }]);
  assert.deepEqual((await pool.query<{
    status: string; lease_id: string | null; lease_expires_at: Date | null; last_error_code: string | null;
  }>(
    `SELECT status, lease_id, lease_expires_at, last_error_code
     FROM notification_outbox WHERE id = $1`,
    [outboxId],
  )).rows, [{ status: 'DEAD', lease_id: null, lease_expires_at: null, last_error_code: 'DeviceNotRegistered' }]);
});

test('receipt completion waits with parent lock while retry dispatch blocks at SQL boundary', async (t) => {
  const { pool, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  const setupGateway = new StubGateway();
  const setupSocial = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway: setupGateway, now: () => state.now });
  const outboxId = await seedTwoDeliveryOutbox(pool, setupSocial, setupGateway, state, 'alice', 'lock-boundary');
  await pool.query(
    `UPDATE social_notification_deliveries SET status = 'RETRY', next_attempt_at = $2, lease_id = NULL, lease_expires_at = NULL
     WHERE outbox_id = $1 AND token = 'ExpoPushToken[lock-boundary-b]'`,
    [outboxId, state.now],
  );
  await pool.query(`UPDATE notification_outbox SET status = 'AWAITING_RECEIPT', lease_id = NULL, lease_expires_at = NULL WHERE id = $1`, [outboxId]);

  let aggregateReached!: () => void;
  let releaseAggregate!: () => void;
  const reached = new Promise<void>((resolve) => { aggregateReached = resolve; });
  const release = new Promise<void>((resolve) => { releaseAggregate = resolve; });
  const receiptGateway = new BlockingReceiptGateway();
  const receiptSocial = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway: receiptGateway, now: () => state.now,
    beforeReceiptAggregateUpdate: async () => {
      aggregateReached();
      await release;
    },
  });
  const sendGateway = new BlockingGateway();
  const sendSocial = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway: sendGateway, now: () => state.now });

  const receiptWork = receiptSocial.reconcileReceipts({ limit: 1 });
  await waitFor(() => receiptGateway.requestedTicketIds.includes('lock-boundary-ticket-a'));
  receiptGateway.resolve(new Map([['lock-boundary-ticket-a', { status: 'ok' }]]));
  await reached;
  await assert.rejects(
    pool.query('SELECT 1 FROM notification_outbox WHERE id = $1 FOR UPDATE NOWAIT', [outboxId]),
    /could not obtain lock|55P03/,
  );
  const sendWork = sendSocial.flushNotifications({ limit: 1 });
  await waitForAsync(async () => {
    const waiting = await pool.query<{ n: number }>(
      `SELECT count(*)::integer AS n
       FROM pg_stat_activity
       WHERE datname = current_database()
         AND wait_event_type = 'Lock'
         AND cardinality(pg_blocking_pids(pid)) > 0
         AND query LIKE 'SELECT pg_advisory_xact_lock%'`,
    );
    return waiting.rows[0]!.n > 0;
  });
  assert.equal(sendGateway.messages.length, 0, 'retry dispatch is blocked by ordered lifecycle/token DB locks before gateway');
  releaseAggregate();
  assert.deepEqual(await receiptWork, { checked: 1, delivered: 1, retry: 0, dead: 0 });
  await waitFor(() => sendGateway.messages.length === 1);
  assert.notEqual((await pool.query<{ lease_id: string | null }>(
    'SELECT lease_id FROM notification_outbox WHERE id = $1', [outboxId],
  )).rows[0]!.lease_id, null, 'retry dispatch owns a live parent lease while gateway is held');
  sendGateway.resolveNext([{ status: 'ok', id: 'lock-boundary-ticket-b-new' }]);
  assert.deepEqual(await sendWork, { claimed: 1, sent: 1, retry: 0, dead: 0, skipped: 0 });
  assert.deepEqual((await pool.query<{ token: string; status: string; expo_ticket_id: string | null }>(
    `SELECT token, status, expo_ticket_id FROM social_notification_deliveries WHERE outbox_id = $1 ORDER BY token`, [outboxId],
  )).rows, [
    { token: 'ExpoPushToken[lock-boundary-a]', status: 'SENT', expo_ticket_id: 'lock-boundary-ticket-a' },
    { token: 'ExpoPushToken[lock-boundary-b]', status: 'AWAITING_RECEIPT', expo_ticket_id: 'lock-boundary-ticket-b-new' },
  ]);
});

test('receipt pending deletion and transfer cannot recreate state or revoke newer binding', async (t) => {
  const { pool, lifecycle, state } = await setup(t);
  await addConsent(pool, 'delete-pending');
  const deleteGateway = new StubGateway();
  const deleteSocial = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway: deleteGateway, now: () => state.now });
  await deleteSocial.registerPushToken({ accountId: 'delete-pending', appVariant: 'ANDROID', token: 'ExpoPushToken[delete-pending]', deviceId: 'install-delete-pending', bindingRevision: 1 });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'delete-pending', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"delete-pending","type":"MESSAGE"}}',
       'PENDING', $2)`, [randomUUID(), state.now],
  );
  deleteGateway.tickets.push({ status: 'ok', id: 'ticket-delete-pending' });
  assert.equal((await deleteSocial.flushNotifications({ limit: 1 })).sent, 1);
  const blockingDelete = new BlockingReceiptGateway();
  const pendingDeleteSocial = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway: blockingDelete, now: () => state.now });
  const pendingDelete = pendingDeleteSocial.reconcileReceipts({ limit: 1 });
  await waitFor(() => blockingDelete.requestedTicketIds.includes('ticket-delete-pending'));
  const deletion = new PostgresAccountDeletionService(pool, { hmacSecret, policyVersion: 'test-policy', accountLifecycle: lifecycle, now: () => state.now });
  await deletion.requestDeletion({ accountId: 'delete-pending', confirmation: 'DELETE MY ACCOUNT' });
  blockingDelete.resolve(new Map([['ticket-delete-pending', { status: 'error', code: 'DeviceNotRegistered', retryable: false, deadToken: true }]]));
  assert.deepEqual(await pendingDelete, { checked: 1, delivered: 0, retry: 0, dead: 0 });
  assert.deepEqual((await pool.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM notification_outbox WHERE account_id = 'delete-pending'`,
  )).rows, [{ n: 0 }]);

  await addConsent(pool, 'transfer-pending');
  const transferGateway = new StubGateway();
  const transferSocial = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway: transferGateway, now: () => state.now });
  await transferSocial.registerPushToken({ accountId: 'transfer-pending', appVariant: 'ANDROID', token: 'ExpoPushToken[transfer-pending]', deviceId: 'install-transfer-pending', bindingRevision: 1 });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'transfer-pending', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"transfer-pending","type":"MESSAGE"}}',
       'PENDING', $2)`, [randomUUID(), state.now],
  );
  transferGateway.tickets.push({ status: 'ok', id: 'ticket-transfer-pending' });
  assert.equal((await transferSocial.flushNotifications({ limit: 1 })).sent, 1);
  const blockingTransfer = new BlockingReceiptGateway();
  const pendingTransferSocial = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway: blockingTransfer, now: () => state.now });
  const pendingTransfer = pendingTransferSocial.reconcileReceipts({ limit: 1 });
  await waitFor(() => blockingTransfer.requestedTicketIds.includes('ticket-transfer-pending'));
  await transferSocial.registerPushToken({ accountId: 'transfer-pending', appVariant: 'ANDROID', token: 'ExpoPushToken[transfer-pending]', deviceId: 'install-transfer-pending', bindingRevision: 2 });
  blockingTransfer.resolve(new Map([['ticket-transfer-pending', { status: 'error', code: 'DeviceNotRegistered', retryable: false, deadToken: true }]]));
  assert.deepEqual(await pendingTransfer, { checked: 1, delivered: 0, retry: 0, dead: 1 });
  assert.deepEqual((await pool.query<{ binding_revision: number }>(
    `SELECT binding_revision FROM push_tokens WHERE account_id = 'transfer-pending' AND token = 'ExpoPushToken[transfer-pending]' AND revoked_at IS NULL`,
  )).rows, [{ binding_revision: 2 }]);
});

test('unexpired live parent dispatch lease blocks later due retry until owner completes', async (t) => {
  const { pool, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  const setupGateway = new StubGateway();
  const setupSocial = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway: setupGateway, now: () => state.now, leaseMs: 60_000 });
  const outboxId = await seedTwoDeliveryOutbox(pool, setupSocial, setupGateway, state, 'alice', 'staggered');
  const firstDue = state.now;
  const secondDue = new Date(state.now.getTime() + 10_000);
  await pool.query(
    `UPDATE social_notification_deliveries
     SET status = 'RETRY', next_attempt_at = CASE WHEN token = 'ExpoPushToken[staggered-a]' THEN $2::timestamptz ELSE $3::timestamptz END,
         lease_id = NULL, lease_expires_at = NULL, expo_ticket_id = NULL
     WHERE outbox_id = $1`, [outboxId, firstDue, secondDue],
  );
  await pool.query(`UPDATE notification_outbox SET status = 'RETRY', next_attempt_at = $2, lease_id = NULL, lease_expires_at = NULL WHERE id = $1`, [outboxId, firstDue]);

  const firstGateway = new BlockingGateway();
  const firstSocial = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway: firstGateway, now: () => state.now, leaseMs: 60_000 });
  const firstFlush = firstSocial.flushNotifications({ limit: 1 });
  await waitFor(() => firstGateway.messages.length === 1);
  assert.deepEqual(firstGateway.messages[0]!.map((message) => message.to), ['ExpoPushToken[staggered-a]']);
  const liveParent = (await pool.query<{ lease_id: string | null; lease_generation: number }>(
    'SELECT lease_id, lease_generation FROM notification_outbox WHERE id = $1', [outboxId],
  )).rows[0]!;

  state.now = new Date(state.now.getTime() + 11_000);
  const secondGateway = new StubGateway();
  const secondSocial = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway: secondGateway, now: () => state.now, leaseMs: 60_000 });
  assert.deepEqual(await secondSocial.flushNotifications({ limit: 1 }), { claimed: 0, sent: 0, retry: 0, dead: 0, skipped: 0 });
  assert.equal(secondGateway.messages.length, 0);
  assert.deepEqual((await pool.query<{ lease_id: string | null; lease_generation: number }>(
    'SELECT lease_id, lease_generation FROM notification_outbox WHERE id = $1', [outboxId],
  )).rows[0], liveParent);

  firstGateway.resolveNext([{ status: 'ok', id: 'staggered-ticket-a-new' }]);
  assert.deepEqual(await firstFlush, { claimed: 1, sent: 1, retry: 0, dead: 0, skipped: 0 });
  secondGateway.tickets.push({ status: 'ok', id: 'staggered-ticket-b-new' });
  assert.deepEqual(await secondSocial.flushNotifications({ limit: 1 }), { claimed: 1, sent: 1, retry: 0, dead: 0, skipped: 0 });
  assert.deepEqual((await pool.query<{ token: string; expo_ticket_id: string | null }>(
    `SELECT token, expo_ticket_id FROM social_notification_deliveries WHERE outbox_id = $1 ORDER BY token`, [outboxId],
  )).rows, [
    { token: 'ExpoPushToken[staggered-a]', expo_ticket_id: 'staggered-ticket-a-new' },
    { token: 'ExpoPushToken[staggered-b]', expo_ticket_id: 'staggered-ticket-b-new' },
  ]);
});

test('removed friends lose queued gift and message pushes while historical mail, rewards and valid friend pushes remain', async t => {
  const { pool, social, gateway, lifecycle, state } = await setup(t);
  const removed = await addFriendship(pool, 'alice', 'bob');
  const valid = await addFriendship(pool, 'alice', 'charlie');
  for (const accountId of ['bob', 'charlie']) {
    await addConsent(pool, accountId);
    await social.registerPushToken({ accountId, appVariant: 'ANDROID', token: `ExpoPushToken[relation-${accountId}]` });
  }
  const message = await social.sendMessage({ accountId: 'alice', friendshipId: removed, requestId: 'relation-message', body: '보관할 쪽지' });
  const gift = await social.sendFriendshipGift({ accountId: 'alice', friendshipId: removed, requestId: 'relation-gift' });
  const kept = await social.sendMessage({ accountId: 'alice', friendshipId: valid, requestId: 'relation-valid', body: '유효한 친구 쪽지' });
  const creditsBefore = (await pool.query('SELECT * FROM mileage_credits ORDER BY id')).rows;
  await new PostgresFriendService(pool, { accountLifecycle: lifecycle, now: () => state.now }).remove({ accountId: 'bob', friendshipId: removed });
  assert.deepEqual(await social.flushNotifications({ limit: 10 }), { claimed: 3, sent: 1, retry: 0, dead: 2, skipped: 2 });
  assert.deepEqual(gateway.messages.map(item => item.to), ['ExpoPushToken[relation-charlie]']);
  assert.equal((await social.getMail({ accountId: 'bob', mailId: message.id })).body, '보관할 쪽지');
  assert.equal((await social.listMail({ accountId: 'bob' })).mail.length, 2);
  assert.deepEqual((await pool.query('SELECT * FROM mileage_credits ORDER BY id')).rows, creditsBefore);
  assert.deepEqual(await social.sendFriendshipGift({ accountId: 'alice', friendshipId: removed, requestId: 'relation-gift' }), { ...gift, replayed: true });
  assert.deepEqual((await pool.query('SELECT status,last_error_code FROM notification_outbox WHERE mail_id=$1', [message.id])).rows,
    [{ status: 'DEAD', last_error_code: 'FRIENDSHIP_REMOVED' }]);
  assert.equal((await pool.query('SELECT status FROM notification_outbox WHERE mail_id=$1', [kept.id])).rows[0].status, 'AWAITING_RECEIPT');
});

test('dispatch rejects missing and mismatched mail friendship references', async t => {
  const { pool, social, gateway } = await setup(t);
  const friendshipId = await addFriendship(pool, 'alice', 'bob');
  const other = await addFriendship(pool, 'alice', 'charlie');
  await addConsent(pool, 'bob');
  await social.registerPushToken({ accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[relation-reference]' });
  for (const [index, reference] of [null, other].entries()) {
    const mail = await social.sendMessage({ accountId: 'alice', friendshipId, requestId: `relation-reference-${index}`, body: '과거 쪽지' });
    await pool.query('UPDATE social_mail SET friendship_id=$2 WHERE id=$1', [mail.id, reference]);
  }
  assert.deepEqual(await social.flushNotifications({ limit: 10 }), { claimed: 2, sent: 0, retry: 0, dead: 2, skipped: 2 });
  assert.equal(gateway.messages.length, 0);
  assert.equal((await social.listMail({ accountId: 'bob' })).mail.length, 2);
});

test('friend removal after dispatch preparation is rechecked before authorization', async t => {
  const { pool, lifecycle, state } = await setup(t);
  const friendshipId = await addFriendship(pool, 'alice', 'bob');
  await addConsent(pool, 'bob');
  const gateway = new StubGateway();
  let reached!: () => void; let resume!: () => void;
  const prepared = new Promise<void>(resolve => { reached = resolve; });
  const removed = new Promise<void>(resolve => { resume = resolve; });
  const social = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway,
    now: () => state.now, beforeDispatchAuthorization: async () => { reached(); await removed; } });
  await social.registerPushToken({ accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[relation-race]' });
  await social.sendMessage({ accountId: 'alice', friendshipId, requestId: 'relation-race', body: '발송 전 관계 확인' });
  const flush = social.flushNotifications({ limit: 1 });
  await prepared;
  await new PostgresFriendService(pool, { accountLifecycle: lifecycle, now: () => state.now }).remove({ accountId: 'alice', friendshipId });
  resume();
  assert.deepEqual(await flush, { claimed: 1, sent: 0, retry: 0, dead: 1, skipped: 1 });
  assert.equal(gateway.messages.length, 0);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM social_notification_deliveries WHERE authorized_at IS NOT NULL')).rows[0].n, 0);
});

test('friend removal after authorization commit preserves the already authorized generic push boundary', async t => {
  const { pool, lifecycle, state } = await setup(t);
  const friendshipId = await addFriendship(pool, 'alice', 'bob');
  await addConsent(pool, 'bob');
  const gateway = new HookGateway();
  const social = new PostgresSocialService(pool, { accountLifecycle: lifecycle, appVariant: 'ANDROID', gateway, now: () => state.now });
  await social.registerPushToken({ accountId: 'bob', appVariant: 'ANDROID', token: 'ExpoPushToken[relation-authorized]' });
  const mail = await social.sendMessage({ accountId: 'alice', friendshipId, requestId: 'relation-authorized', body: '발송 승인 뒤 경계' });
  gateway.beforeSend = () => new PostgresFriendService(pool, { accountLifecycle: lifecycle, now: () => state.now }).remove({ accountId: 'bob', friendshipId });
  assert.deepEqual(await social.flushNotifications({ limit: 1 }), { claimed: 1, sent: 1, retry: 0, dead: 0, skipped: 0 });
  assert.equal(gateway.messages.length, 1);
  assert.equal((await social.getMail({ accountId: 'bob', mailId: mail.id })).body, '발송 승인 뒤 경계');
});

test('dispatch rechecks token revocation after preparation before authorization', async (t) => {
  const { pool, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  const gateway = new StubGateway();
  let pauseReached!: () => void;
  let resumeAuthorization!: () => void;
  const reached = new Promise<void>((resolve) => { pauseReached = resolve; });
  const resume = new Promise<void>((resolve) => { resumeAuthorization = resolve; });
  const social = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway,
    now: () => state.now,
    beforeDispatchAuthorization: async () => {
      pauseReached();
      await resume;
    },
  });
  await social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[before-auth]' });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"before-auth","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), state.now],
  );

  const flush = social.flushNotifications({ limit: 1 });
  await reached;
  await social.unregisterPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[before-auth]' });
  resumeAuthorization();

  assert.deepEqual(await flush, { claimed: 1, sent: 0, retry: 0, dead: 1, skipped: 1 });
  assert.equal(gateway.messages.length, 0);
  assert.deepEqual((await pool.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM social_notification_deliveries
     WHERE token = 'ExpoPushToken[before-auth]' AND authorized_at IS NOT NULL`,
  )).rows[0]!.n, 0);
});

test('dispatch authorization boundary distinguishes before-recheck revokes from after-commit sends', async (t) => {
  const { pool, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  const beforeGateway = new HookGateway();
  const before = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway: beforeGateway,
    now: () => state.now,
  });
  await before.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[before]' });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"before","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), state.now],
  );
  await before.unregisterPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[before]' });
  assert.deepEqual(await before.flushNotifications({ limit: 10 }), { claimed: 1, sent: 0, retry: 0, dead: 1, skipped: 1 });
  assert.equal(beforeGateway.messages.length, 0);

  await before.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[after]' });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"after","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), state.now],
  );
  beforeGateway.beforeSend = async () => {
    await before.unregisterPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[after]' });
  };
  assert.deepEqual(await before.flushNotifications({ limit: 1 }), { claimed: 1, sent: 1, retry: 0, dead: 0, skipped: 0 });
  assert.deepEqual(beforeGateway.messages.map((message) => message.to), ['ExpoPushToken[after]']);
  assert.equal((await pool.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM social_notification_deliveries
     WHERE token = 'ExpoPushToken[after]' AND authorized_at IS NOT NULL AND push_token_id IS NOT NULL`,
  )).rows[0]!.n, 1);
});

test('queued notifications recheck deletion, consent, and active tokens before dispatch', async (t) => {
  const { pool, social, gateway, lifecycle } = await setup(t);
  await addConsent(pool, 'revoked-consent');
  await social.registerPushToken({ accountId: 'revoked-consent', appVariant: 'ANDROID', token: 'ExpoPushToken[consent]' });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'revoked-consent', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"c","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), new Date('2026-10-04T15:00:00.000Z')],
  );
  await pool.query('DELETE FROM account_consents WHERE account_id = $1', ['revoked-consent']);
  assert.deepEqual(await social.flushNotifications({ limit: 10 }), { claimed: 1, sent: 0, retry: 0, dead: 1, skipped: 1 });

  await addConsent(pool, 'deleted');
  await social.registerPushToken({ accountId: 'deleted', appVariant: 'ANDROID', token: 'ExpoPushToken[deleted]' });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'deleted', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"d","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), new Date('2026-10-04T15:00:00.000Z')],
  );
  await pool.query(
    `INSERT INTO account_deletion_requests (
       id, account_reference_hash, deleted_account_alias, status, policy_version,
       cancelled_mint_jobs, pending_mint_jobs, retained_finalized_nfts, requested_at, completed_at, updated_at
     ) VALUES ($1, $2, $3, 'COMPLETED', 'test', 0, 0, 0, $4, $4, $4)`,
    [randomUUID(), lifecycle.referenceHash('deleted'), `deleted:${'d'.repeat(64)}`, new Date('2026-10-04T15:00:00.000Z')],
  );
  assert.deepEqual(await social.flushNotifications({ limit: 10 }), { claimed: 1, sent: 0, retry: 0, dead: 1, skipped: 1 });

  await addConsent(pool, 'logout');
  await social.registerPushToken({ accountId: 'logout', appVariant: 'ANDROID', token: 'ExpoPushToken[logout]' });
  await social.unregisterPushToken({ accountId: 'logout', appVariant: 'ANDROID', token: 'ExpoPushToken[logout]' });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'logout', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"l","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), new Date('2026-10-04T15:00:00.000Z')],
  );
  assert.deepEqual(await social.flushNotifications({ limit: 10 }), { claimed: 1, sent: 0, retry: 0, dead: 1, skipped: 1 });
  assert.equal(gateway.messages.length, 0);
});

test('account deletion removes push bindings and queued notification private state before dispatch', async (t) => {
  const { pool, social, gateway, lifecycle, state } = await setup(t);
  await addConsent(pool, 'delete-social');
  await social.registerPushToken({
    accountId: 'delete-social',
    appVariant: 'ANDROID',
    token: 'ExpoPushToken[delete-social]',
    deviceId: 'install-delete',
    bindingRevision: 1,
  });
  await social.unregisterPushToken({
    accountId: 'delete-social',
    appVariant: 'ANDROID',
    token: 'ExpoPushToken[delete-social]',
    deviceId: 'install-delete',
    bindingRevision: 2,
  });
  const socialOutboxId = randomUUID();
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'delete-social', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"delete","type":"MESSAGE"}}',
       'RETRY', $2)`,
    [socialOutboxId, state.now],
  );
  await pool.query(
    `INSERT INTO social_notification_deliveries (
       id, outbox_id, account_id, app_variant, token, status, attempts, next_attempt_at, lease_generation
     ) VALUES ($1, $2, 'delete-social', 'ANDROID', 'ExpoPushToken[delete-social]', 'RETRY', 1, $3, 0)`,
    [randomUUID(), socialOutboxId, state.now],
  );
  const upstreamDeviceId = randomUUID();
  const upstreamNotificationId = randomUUID();
  await pool.query(
    `INSERT INTO auth_sessions (id, account_id, token_hash, created_at, expires_at, last_authenticated_at)
     VALUES ($1, 'delete-social', $2, $3, $4, $3)`,
    [randomUUID(), Buffer.alloc(32, 7), state.now, new Date(state.now.getTime() + 86_400_000)],
  );
  await pool.query(`INSERT INTO notification_preferences (account_id, push_enabled) VALUES ('delete-social', true)`);
  await pool.query(
    `INSERT INTO notification_devices (device_id, account_id, session_id, token, platform)
     SELECT $1, 'delete-social', id, 'fcm-delete-social', 'android' FROM auth_sessions WHERE account_id = 'delete-social'`,
    [upstreamDeviceId],
  );
  await pool.query(
    `INSERT INTO notification_items (id, account_id, category, dedupe_key, title, body, target_path)
     VALUES ($1, 'delete-social', 'REWARD_AVAILABLE', 'delete-dual', '보상', '확인해 주세요', '/collection')`,
    [upstreamNotificationId],
  );
  await pool.query(
    `INSERT INTO notification_deliveries (id, notification_id, device_id, status)
     VALUES ($1, $2, $3, 'PENDING')`,
    [randomUUID(), upstreamNotificationId, upstreamDeviceId],
  );

  const deletion = new PostgresAccountDeletionService(pool, {
    hmacSecret,
    policyVersion: 'test-policy',
    accountLifecycle: lifecycle,
    now: () => state.now,
  });
  await deletion.requestDeletion({ accountId: 'delete-social', confirmation: 'DELETE MY ACCOUNT' });

  for (const table of ['push_tokens', 'social_notification_deliveries', 'notification_outbox']) {
    assert.deepEqual((await pool.query<{ n: number }>(
      `SELECT count(*)::integer AS n FROM ${table} WHERE account_id = 'delete-social'`,
    )).rows, [{ n: 0 }], table);
  }
  assert.deepEqual((await pool.query<{ n: number }>(
    `SELECT count(*)::integer AS n
     FROM notification_deliveries delivery
     JOIN notification_items item ON item.id = delivery.notification_id
     WHERE item.account_id = 'delete-social'`,
  )).rows, [{ n: 0 }], 'notification_deliveries');
  for (const table of ['notification_items', 'notification_devices', 'notification_preferences']) {
    assert.deepEqual((await pool.query<{ n: number }>(
      `SELECT count(*)::integer AS n FROM ${table} WHERE account_id = 'delete-social'`,
    )).rows, [{ n: 0 }], table);
  }
  assert.deepEqual(await social.flushNotifications({ limit: 10 }), { claimed: 0, sent: 0, retry: 0, dead: 0, skipped: 0 });
  assert.equal(gateway.messages.length, 0);
});

test('receipt reconciliation keeps missing receipts waiting and retries retryable receipts', async (t) => {
  const { pool, social, gateway, state } = await setup(t);
  await addConsent(pool, 'alice');
  await social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[a]' });
  await social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[b]' });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"r","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), new Date('2026-10-04T15:00:00.000Z')],
  );
  gateway.tickets.push({ status: 'ok', id: 'ticket-missing' }, { status: 'ok', id: 'ticket-retry' });
  assert.equal((await social.flushNotifications({ limit: 10 })).sent, 2);
  gateway.receipts.set('ticket-retry', { status: 'error', code: 'MessageRateExceeded', retryable: true });
  assert.deepEqual(await social.reconcileReceipts({ limit: 10 }), { checked: 2, delivered: 0, retry: 1, dead: 0 });
  const rows = await pool.query<{ status: string; expo_ticket_id: string }>(
    `SELECT status, expo_ticket_id FROM social_notification_deliveries ORDER BY expo_ticket_id`,
  );
  assert.deepEqual(rows.rows, [
    { status: 'AWAITING_RECEIPT', expo_ticket_id: 'ticket-missing' },
    { status: 'RETRY', expo_ticket_id: 'ticket-retry' },
  ]);
  state.now = new Date('2026-10-04T15:02:00.000Z');
  gateway.tickets.push({ status: 'ok', id: 'ticket-retry-2' });
  assert.equal((await social.flushNotifications({ limit: 10 })).sent, 1);
});


test('dead receipts only revoke the exact authorized token binding version', async (t) => {
  const { pool, social, gateway } = await setup(t);
  await addConsent(pool, 'alice');
  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[reuse]', deviceId: 'install-reuse', bindingRevision: 1,
  });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"old","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), new Date('2026-10-04T15:00:00.000Z')],
  );
  gateway.tickets.push({ status: 'ok', id: 'ticket-old-binding' });
  assert.equal((await social.flushNotifications({ limit: 10 })).sent, 1);
  assert.deepEqual((await pool.query<{ token: string; push_token_id: string | null; binding_revision: number | null }>(
    `SELECT token, push_token_id, binding_revision FROM social_notification_deliveries WHERE expo_ticket_id = 'ticket-old-binding'`,
  )).rows, [{ token: 'ExpoPushToken[reuse]', push_token_id: (await pool.query<{ id: string }>(
    `SELECT id FROM push_tokens WHERE token = 'ExpoPushToken[reuse]'`,
  )).rows[0]!.id, binding_revision: 1 }]);

  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[reuse]', deviceId: 'install-reuse', bindingRevision: 2,
  });
  gateway.receipts.set('ticket-old-binding', { status: 'error', code: 'DeviceNotRegistered', retryable: false, deadToken: true });
  assert.deepEqual(await social.reconcileReceipts({ limit: 10 }), { checked: 1, delivered: 0, retry: 0, dead: 1 });
  assert.deepEqual((await pool.query<{ binding_revision: number }>(
    `SELECT binding_revision FROM push_tokens
     WHERE account_id = 'alice' AND app_variant = 'ANDROID' AND token = 'ExpoPushToken[reuse]' AND revoked_at IS NULL`,
  )).rows, [{ binding_revision: 2 }]);
});



test('stale receipt lease cannot mutate delivery state or revoke its token', async (t) => {
  const { pool, lifecycle } = await setup(t);
  await addConsent(pool, 'alice');
  const gateway = new BlockingReceiptGateway();
  const social = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway,
    now: () => new Date('2026-10-04T15:00:00.000Z'),
  });
  await social.registerPushToken({
    accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[stale-receipt]', deviceId: 'install-stale', bindingRevision: 1,
  });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"stale","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), new Date('2026-10-04T15:00:00.000Z')],
  );
  gateway.tickets.push({ status: 'ok', id: 'ticket-stale-receipt' });
  assert.equal((await social.flushNotifications({ limit: 10 })).sent, 1);

  const pending = social.reconcileReceipts({ limit: 10 });
  await waitFor(() => gateway.requestedTicketIds.includes('ticket-stale-receipt'));
  const claimed = await pool.query<{ lease_id: string; lease_generation: number }>(
    `SELECT lease_id, lease_generation FROM social_notification_deliveries WHERE expo_ticket_id = 'ticket-stale-receipt'`,
  );
  await pool.query(
    `UPDATE social_notification_deliveries
     SET lease_id = 'newer-receipt-lease', lease_generation = lease_generation + 1
     WHERE expo_ticket_id = 'ticket-stale-receipt'`,
  );
  gateway.resolve(new Map([['ticket-stale-receipt', { status: 'error', code: 'DeviceNotRegistered', retryable: false, deadToken: true }]]));
  assert.deepEqual(await pending, { checked: 1, delivered: 0, retry: 0, dead: 0 });
  assert.notEqual(claimed.rows[0]!.lease_id, 'newer-receipt-lease');
  assert.deepEqual((await pool.query<{ status: string; lease_id: string; active: boolean }>(
    `SELECT delivery.status, delivery.lease_id, token.revoked_at IS NULL AS active
     FROM social_notification_deliveries delivery
     JOIN push_tokens token ON token.id = delivery.push_token_id
     WHERE delivery.expo_ticket_id = 'ticket-stale-receipt'`,
  )).rows, [{ status: 'PROCESSING', lease_id: 'newer-receipt-lease', active: true }]);
});

test('legacy synthetic receipt evidence never revokes current real tokens', async (t) => {
  const { pool, social, gateway, state } = await setup(t);
  await addConsent(pool, 'alice');
  await social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[current]' });
  const outboxId = randomUUID();
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at, expo_ticket_id)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"legacy","type":"MESSAGE"}}',
       'AWAITING_RECEIPT', $2, 'ticket-legacy')`,
    [outboxId, state.now],
  );
  await pool.query(
    `INSERT INTO social_notification_deliveries (
       id, outbox_id, account_id, app_variant, token, status, attempts, next_attempt_at,
       lease_generation, expo_ticket_id, created_at, updated_at
     ) VALUES ($1, $2, 'alice', 'ANDROID', $3, 'AWAITING_RECEIPT', 0, $4, 0, 'ticket-legacy', $4, $4)`,
    [randomUUID(), outboxId, `legacy:${outboxId}`, state.now],
  );
  gateway.receipts.set('ticket-legacy', { status: 'error', code: 'DeviceNotRegistered', retryable: false, deadToken: true });
  assert.deepEqual(await social.reconcileReceipts({ limit: 10 }), { checked: 1, delivered: 0, retry: 0, dead: 1 });
  assert.deepEqual((await pool.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM push_tokens
     WHERE account_id = 'alice' AND token = 'ExpoPushToken[current]' AND revoked_at IS NULL`,
  )).rows, [{ n: 1 }]);
});

test('slow gateway completion is fenced after lease expiry and second runner reclaim', async (t) => {
  const { pool, lifecycle, state } = await setup(t);
  await addConsent(pool, 'alice');
  const blockingGateway = new BlockingGateway();
  const first = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway: blockingGateway,
    now: () => state.now,
    leaseMs: 1_000,
  });
  const secondGateway = new StubGateway();
  const second = new PostgresSocialService(pool, {
    accountLifecycle: lifecycle,
    appVariant: 'ANDROID',
    gateway: secondGateway,
    now: () => state.now,
    leaseMs: 1_000,
  });
  await first.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[alice]' });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"slow","type":"MESSAGE"}}',
       'PENDING', $2)`,
    [randomUUID(), new Date('2026-10-04T15:00:00.000Z')],
  );

  const firstFlush = first.flushNotifications({ limit: 1 });
  await waitFor(() => blockingGateway.messages.length === 1);
  state.now = new Date('2026-10-04T15:01:00.000Z');
  secondGateway.tickets.push({ status: 'ok', id: 'ticket-second' });
  assert.deepEqual(await second.flushNotifications({ limit: 1 }), { claimed: 1, sent: 1, retry: 0, dead: 0, skipped: 0 });
  blockingGateway.resolveNext([{ status: 'ok', id: 'ticket-first-stale' }]);
  assert.deepEqual(await firstFlush, { claimed: 1, sent: 0, retry: 0, dead: 0, skipped: 0 });
  const tickets = await pool.query<{ expo_ticket_id: string | null; status: string }>(
    `SELECT expo_ticket_id, status FROM social_notification_deliveries ORDER BY updated_at DESC LIMIT 1`,
  );
  assert.deepEqual(tickets.rows[0], { expo_ticket_id: 'ticket-second', status: 'AWAITING_RECEIPT' });
});

test('outbox leases recover after restart and stop new duplicate claims while a lease is live', async (t) => {
  const { pool, social, gateway, state } = await setup(t);
  await addConsent(pool, 'alice');
  await social.registerPushToken({ accountId: 'alice', appVariant: 'ANDROID', token: 'ExpoPushToken[alice]' });
  await pool.query(
    `INSERT INTO notification_outbox (id, account_id, event_type, payload, status, next_attempt_at, lease_id, lease_expires_at)
     VALUES ($1, 'alice', 'MESSAGE',
       '{"title":"새 우편이 도착했어요","body":"친구 소식이 있어요","data":{"mailId":"z","type":"MESSAGE"}}',
       'PROCESSING', $2, 'old-runner', $3)`,
    [randomUUID(), new Date('2026-10-04T15:00:00.000Z'), new Date('2026-10-04T15:00:01.000Z')],
  );
  assert.equal((await social.flushNotifications({ limit: 10 })).claimed, 0, 'live lease is not stolen');
  state.now = new Date('2026-10-04T15:01:00.000Z');
  gateway.throwOnSend = true;
  const retried = await social.flushNotifications({ limit: 10 });
  assert.equal(retried.claimed, 1);
  assert.equal(retried.retry, 1);
  const row = await pool.query<{ status: string }>('SELECT status FROM notification_outbox');
  assert.deepEqual(row.rows[0], { status: 'RETRY' });
  const delivery = await pool.query<{ status: string; attempts: number }>('SELECT status, attempts FROM social_notification_deliveries');
  assert.deepEqual(delivery.rows[0], { status: 'RETRY', attempts: 1 });
});
