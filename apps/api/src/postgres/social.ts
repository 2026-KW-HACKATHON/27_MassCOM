import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../account-consent.js';
import { defaultNicknamePrefix } from '../friends-rules.js';
import {
  SocialError,
  type CreateMealInvitationInput,
  type FriendshipGiftResult,
  type MailDetail,
  type MailList,
  type MailMutationResult,
  type MailSummary,
  type MailType,
  type MealInvitationResponse,
  type MealInvitationView,
  type NotificationFlushResult,
  type NotificationReceiptResult,
  type PushGateway,
  type PushMessage,
  type PushReceipt,
  type PushTicket,
  type SocialAppVariant,
  type SocialService,
  type SocialSnapshot,
} from '../social.js';
import {
  buildGenericPushPayload,
  compareHHmm,
  computeReward,
  friendshipGiftDailySendLimit,
  friendshipGiftRewardAmount,
  friendshipGiftRewardDailyCap,
  kstBusinessDate,
  mailPageSize,
  parseMealInvitation,
  parseMealResponse,
  parseMessageBody,
  type ParsedMealInvitation,
  validateRequestId,
} from '../social-rules.js';
import { AccountLifecycleError, type PostgresAccountLifecycle } from './account-lifecycle.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenMaxLength = 512;
const defaultLeaseMs = 30_000;
const maxAttempts = 5;

type Queryable = Pool | PoolClient;
type JsonObject = Record<string, unknown>;

type FriendshipRow = {
  id: string;
  account_low: string;
  account_high: string;
};

type GiftRow = {
  id: string;
  friendship_id: string;
  sender_account_id: string;
  receiver_account_id: string;
  sender_request_id: string;
  receiver_request_id: string | null;
  sent_business_date: Date | string;
  status: 'PENDING' | 'RECEIVED';
  sender_reward_amount: number;
  receiver_reward_amount: number;
  created_at: Date;
  received_at: Date | null;
};

type MailRow = {
  id: string;
  type: MailType;
  sender_account_id: string | null;
  receiver_account_id: string;
  friendship_id: string | null;
  request_id: string | null;
  title: string;
  body: string;
  payload: JsonObject;
  read_at: Date | null;
  created_at: Date;
  from_nickname?: string | null;
  to_nickname?: string | null;
};

type InvitationRow = {
  id: string;
  friendship_id: string;
  sender_account_id: string;
  receiver_account_id: string;
  request_id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_address: string;
  invite_date: Date | string;
  schedule_kind: 'CONFIRMED' | 'RANGE';
  confirmed_time: string | null;
  range_start_time: string | null;
  range_end_time: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  selected_time: string | null;
  response_request_id: string | null;
  responded_at: Date | null;
  created_at: Date;
};

type OutboxRow = {
  id: string;
  account_id: string;
  mail_id: string | null;
  event_type: string;
  payload: JsonObject;
  attempts: number;
  lease_id: string;
  lease_generation: number;
};

type DeliveryRow = {
  id: string;
  outbox_id: string;
  account_id: string;
  app_variant: SocialAppVariant;
  token: string;
  status: 'PROCESSING' | 'AWAITING_RECEIPT' | 'RETRY' | 'SENT' | 'DEAD' | 'CANCELLED';
  attempts: number;
  lease_id: string | null;
  lease_generation: number;
  expo_ticket_id: string | null;
  push_token_id: string | null;
  binding_revision: number | null;
};

export class PostgresSocialService implements SocialService {
  private readonly now: () => Date;
  private readonly nextId: () => string;
  private readonly accountLifecycle: PostgresAccountLifecycle;
  private readonly appVariant: SocialAppVariant;
  private readonly gateway: PushGateway;
  private readonly leaseMs: number;
  private readonly beforeDispatchAuthorization: (() => Promise<void>) | undefined;
  private readonly beforePushTokenAuthorization: ((operation: 'register' | 'unregister') => Promise<void>) | undefined;
  private readonly beforeReceiptAggregateUpdate: (() => Promise<void>) | undefined;
  private readonly failReceiptCompletionAfterTerminal: boolean;

  constructor(
    private readonly pool: Pool,
    options: {
      accountLifecycle: PostgresAccountLifecycle;
      appVariant: SocialAppVariant;
      gateway: PushGateway;
      now?: () => Date;
      nextId?: () => string;
      leaseMs?: number;
      beforeDispatchAuthorization?: () => Promise<void>;
      beforePushTokenAuthorization?: (operation: 'register' | 'unregister') => Promise<void>;
      beforeReceiptAggregateUpdate?: () => Promise<void>;
      failReceiptCompletionAfterTerminal?: boolean;
    },
  ) {
    this.accountLifecycle = options.accountLifecycle;
    this.appVariant = options.appVariant;
    this.gateway = options.gateway;
    this.now = options.now ?? (() => new Date());
    this.nextId = options.nextId ?? randomUUID;
    this.leaseMs = options.leaseMs ?? defaultLeaseMs;
    this.beforeDispatchAuthorization = options.beforeDispatchAuthorization;
    this.beforePushTokenAuthorization = options.beforePushTokenAuthorization;
    this.beforeReceiptAggregateUpdate = options.beforeReceiptAggregateUpdate;
    this.failReceiptCompletionAfterTerminal = options.failReceiptCompletionAfterTerminal ?? false;
  }

  async getSocial(accountId: string): Promise<SocialSnapshot> {
    const today = kstBusinessDate(this.now());
    const [friendRows, pendingRows, unreadRows, rewardEarned, sendCount] = await Promise.all([
      this.pool.query<FriendshipRow & { friend_account_id: string; nickname: string | null }>(
        `SELECT friendship.id, friendship.account_low, friendship.account_high,
                CASE WHEN friendship.account_low = $1 THEN friendship.account_high ELSE friendship.account_low END AS friend_account_id,
                profile.nickname
         FROM friendships friendship
         LEFT JOIN explorer_profiles profile
           ON profile.account_id = CASE WHEN friendship.account_low = $1 THEN friendship.account_high ELSE friendship.account_low END
         WHERE friendship.account_low = $1 OR friendship.account_high = $1
         ORDER BY coalesce(profile.nickname, $2) COLLATE "C", friendship.id`,
        [accountId, defaultNicknamePrefix],
      ),
      this.pool.query<GiftRow>(
        `SELECT * FROM friendship_gifts
         WHERE status = 'PENDING' AND (sender_account_id = $1 OR receiver_account_id = $1)`,
        [accountId],
      ),
      this.pool.query<{ friendship_id: string | null; n: number }>(
        `SELECT friendship_id, count(*)::integer AS n FROM social_mail
         WHERE receiver_account_id = $1 AND read_at IS NULL
         GROUP BY friendship_id`,
        [accountId],
      ),
      this.friendshipRewardEarned(this.pool, accountId, today),
      this.sendCount(this.pool, accountId, today),
    ]);
    const pendingByFriendship = new Map<string, GiftRow>();
    for (const row of pendingRows.rows) {
      // 양방향 대기 선물이 함께 있어도 받을 선물을 우선 표시한다.
      if (row.receiver_account_id === accountId || !pendingByFriendship.has(row.friendship_id)) {
        pendingByFriendship.set(row.friendship_id, row);
      }
    }
    const unreadByFriendship = new Map(unreadRows.rows.map((row) => [row.friendship_id, row.n]));
    const unreadMailCount = unreadRows.rows.reduce((sum, row) => sum + row.n, 0);
    return {
      businessDate: today,
      friendshipGift: {
        sendLimit: friendshipGiftDailySendLimit,
        sendCount,
        sendRemaining: Math.max(0, friendshipGiftDailySendLimit - sendCount),
        rewardDailyCap: friendshipGiftRewardDailyCap,
        rewardEarnedToday: rewardEarned,
        rewardRemainingToday: Math.max(0, friendshipGiftRewardDailyCap - rewardEarned),
        rewardPerAction: friendshipGiftRewardAmount,
      },
      friends: friendRows.rows.map((row) => {
        const pending = pendingByFriendship.get(row.id);
        return {
          friendshipId: row.id,
          nickname: row.nickname ?? defaultNicknamePrefix,
          gift: {
            pendingGiftId: pending?.id ?? null,
            pendingDirection: pending
              ? pending.sender_account_id === accountId ? 'SENT' : 'RECEIVED'
              : null,
            canSend: sendCount < friendshipGiftDailySendLimit && !pending,
            canReceive: pending?.receiver_account_id === accountId,
          },
          unreadMailCount: unreadByFriendship.get(row.id) ?? 0,
        };
      }),
      unreadMailCount,
    };
  }

  async sendFriendshipGift(input: {
    accountId: string;
    friendshipId: string;
    requestId: string;
  }): Promise<FriendshipGiftResult> {
    const requestId = parseRequestId(input.requestId);
    if (!uuidPattern.test(input.friendshipId)) throw new SocialError('SOCIAL_FRIENDSHIP_NOT_FOUND');
    return this.transaction(async (client) => {
      const replay = async () => {
        const row = (await client.query<GiftRow>(
          `SELECT * FROM friendship_gifts WHERE sender_account_id = $1 AND sender_request_id = $2`,
          [input.accountId, requestId],
        )).rows[0];
        if (!row) return null;
        if (row.friendship_id !== input.friendshipId) throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        return this.giftResult(client, row, input.accountId, true);
      };
      const existing = await replay();
      if (existing) return existing;

      const friendship = await this.requireFriendship(client, input.friendshipId, input.accountId);
      const other = otherAccount(friendship, input.accountId);
      await this.accountLifecycle.assertAllActive(client, [input.accountId, other]);
      const lockedReplay = await replay();
      if (lockedReplay) return lockedReplay;
      await this.requireFriendship(client, input.friendshipId, input.accountId);

      const pending = await client.query(
        `SELECT 1 FROM friendship_gifts
         WHERE friendship_id = $1 AND sender_account_id = $2 AND receiver_account_id = $3 AND status = 'PENDING'`,
        [input.friendshipId, input.accountId, other],
      );
      if (pending.rowCount !== null && pending.rowCount > 0) throw new SocialError('SOCIAL_GIFT_PENDING');

      const today = kstBusinessDate(this.now());
      if (await this.sendCount(client, input.accountId, today) >= friendshipGiftDailySendLimit) {
        throw new SocialError('SOCIAL_SEND_LIMIT_REACHED');
      }
      const giftId = this.nextId();
      const now = this.now();
      const reward = computeReward(await this.friendshipRewardEarned(client, input.accountId, today));
      await client.query<GiftRow>(
        `INSERT INTO friendship_gifts (
           id, friendship_id, sender_account_id, receiver_account_id, sender_request_id,
           sent_business_date, status, sender_reward_amount, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6::date, 'PENDING', $7, $8)`,
        [giftId, input.friendshipId, input.accountId, other, requestId, today, reward, now],
      );
      if (reward > 0) await this.insertCredit(client, input.accountId, reward, `friendship-gift-send:${giftId}`, today, now);
      const mailId = await this.insertMail(client, {
        sender: input.accountId,
        receiver: other,
        friendshipId: input.friendshipId,
        type: 'FRIENDSHIP_GIFT',
        title: '우정 선물이 도착했어요',
        body: '친구가 우정을 보냈어요.',
        payload: { giftId },
      });
      await this.enqueueNotification(client, other, mailId, 'FRIENDSHIP_GIFT');
      const row = (await client.query<GiftRow>('SELECT * FROM friendship_gifts WHERE id = $1', [giftId])).rows[0]!;
      return this.giftResult(client, row, input.accountId, false);
    });
  }

  async receiveFriendshipGift(input: {
    accountId: string;
    giftId: string;
    requestId: string;
  }): Promise<FriendshipGiftResult> {
    const requestId = parseRequestId(input.requestId);
    if (!uuidPattern.test(input.giftId)) throw new SocialError('SOCIAL_FORBIDDEN');
    return this.transaction(async (client) => {
      const gift = await this.requireGiftForReceiver(client, input.giftId, input.accountId);
      const friendship = await this.requireFriendship(client, gift.friendship_id, input.accountId);
      await this.accountLifecycle.assertAllActive(client, [gift.sender_account_id, gift.receiver_account_id]);
      await this.requireFriendship(client, friendship.id, input.accountId);

      const fresh = await this.requireGiftForReceiver(client, input.giftId, input.accountId);
      if (fresh.status === 'RECEIVED') {
        if (fresh.receiver_request_id === requestId) return this.giftResult(client, fresh, input.accountId, true);
        throw new SocialError('SOCIAL_REQUEST_CONFLICT');
      }
      const today = kstBusinessDate(this.now());
      const now = this.now();
      const reward = computeReward(await this.friendshipRewardEarned(client, input.accountId, today));
      const updated = await client.query<GiftRow>(
        `UPDATE friendship_gifts
         SET status = 'RECEIVED', receiver_request_id = $2, receiver_reward_amount = $3, received_at = $4
         WHERE id = $1 AND status = 'PENDING'
         RETURNING *`,
        [input.giftId, requestId, reward, now],
      );
      const row = updated.rows[0];
      if (!row) throw new SocialError('SOCIAL_REQUEST_CONFLICT');
      if (reward > 0) await this.insertCredit(client, input.accountId, reward, `friendship-gift-receive:${input.giftId}`, today, now);
      return this.giftResult(client, row, input.accountId, false);
    });
  }

  async listMail(input: { accountId: string; cursor?: string }): Promise<MailList> {
    let cursorCreatedAt: Date | null = null;
    let cursorId: string | null = null;
    if (input.cursor !== undefined) {
      if (!uuidPattern.test(input.cursor)) throw new SocialError('INVALID_REQUEST');
      const cursor = await this.pool.query<{ created_at: Date }>(
        `SELECT created_at FROM social_mail
         WHERE id = $1 AND (receiver_account_id = $2 OR sender_account_id = $2)`,
        [input.cursor, input.accountId],
      );
      if (!cursor.rows[0]) throw new SocialError('INVALID_REQUEST');
      cursorCreatedAt = cursor.rows[0].created_at;
      cursorId = input.cursor;
    }
    const rows = await this.pool.query<MailRow>(
      mailSelectSql(`
        WHERE (mail.receiver_account_id = $1 OR mail.sender_account_id = $1)
          AND (
            $2::timestamptz IS NULL
            OR (mail.created_at, mail.id) < ($2::timestamptz, $3::uuid)
          )
        ORDER BY mail.created_at DESC, mail.id DESC
        LIMIT $4
      `),
      [input.accountId, cursorCreatedAt, cursorId, mailPageSize + 1],
    );
    const page = rows.rows.slice(0, mailPageSize);
    return {
      mail: page.map((row) => summarizeMail(row, input.accountId)),
      nextCursor: rows.rows.length > mailPageSize ? page[page.length - 1]!.id : null,
    };
  }

  async getMail(input: { accountId: string; mailId: string }): Promise<MailDetail> {
    return this.mailDetail(input.accountId, input.mailId);
  }

  async markMailRead(input: { accountId: string; mailId: string }): Promise<MailDetail> {
    if (!uuidPattern.test(input.mailId)) throw new SocialError('SOCIAL_MAIL_NOT_FOUND');
    await this.pool.query(
      `UPDATE social_mail SET read_at = coalesce(read_at, $3)
       WHERE id = $1 AND receiver_account_id = $2`,
      [input.mailId, input.accountId, this.now()],
    );
    return this.mailDetail(input.accountId, input.mailId);
  }

  async sendMessage(input: {
    accountId: string;
    friendshipId: string;
    requestId: string;
    body: string;
  }): Promise<MailMutationResult> {
    const requestId = parseRequestId(input.requestId);
    const body = parseMessageBody(input.body);
    if (!body) throw new SocialError('INVALID_REQUEST');
    return this.transaction(async (client) => {
      const replay = async () => {
        const existing = await this.mailBySenderRequest(client, input.accountId, requestId);
        if (!existing) return null;
        if (existing.type !== 'MESSAGE' || existing.friendship_id !== input.friendshipId || existing.body !== body) {
          throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        }
        return { ...await this.mailDetail(input.accountId, existing.id, client), replayed: true };
      };
      const existing = await replay();
      if (existing) return existing;
      const friendship = await this.requireFriendship(client, input.friendshipId, input.accountId);
      const other = otherAccount(friendship, input.accountId);
      await this.accountLifecycle.assertAllActive(client, [input.accountId, other]);
      const lockedReplay = await replay();
      if (lockedReplay) return lockedReplay;
      await this.requireFriendship(client, input.friendshipId, input.accountId);
      const mailId = await this.insertMail(client, {
        sender: input.accountId,
        receiver: other,
        friendshipId: input.friendshipId,
        requestId,
        type: 'MESSAGE',
        title: '친구 쪽지',
        body,
        payload: {},
      });
      await this.enqueueNotification(client, other, mailId, 'MESSAGE');
      return { ...await this.mailDetail(input.accountId, mailId, client), replayed: false };
    });
  }

  async createMealInvitation(input: CreateMealInvitationInput & {
    accountId: string;
    friendshipId: string;
    requestId: string;
  }): Promise<MailMutationResult> {
    const requestId = parseRequestId(input.requestId);
    const parsed = parseMealInvitation(input, this.now());
    if (!parsed) throw new SocialError('INVALID_REQUEST');
    return this.transaction(async (client) => {
      const replay = async () => {
        const existing = await this.mailBySenderRequest(client, input.accountId, requestId);
        if (!existing) return null;
        if (existing.type !== 'MEAL_INVITATION' || existing.friendship_id !== input.friendshipId) {
          throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        }
        const invitationId = typeof existing.payload.invitationId === 'string' ? existing.payload.invitationId : null;
        if (!invitationId) throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        const existingInvitation = await client.query<InvitationRow>('SELECT * FROM meal_invitations WHERE id = $1', [invitationId]);
        const invitationRow = existingInvitation.rows[0];
        if (!invitationRow || !sameParsedInvitation(parsed, invitationRow)) {
          throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        }
        return { ...await this.mailDetail(input.accountId, existing.id, client), replayed: true };
      };
      const existing = await replay();
      if (existing) return existing;
      const friendship = await this.requireFriendship(client, input.friendshipId, input.accountId);
      const other = otherAccount(friendship, input.accountId);
      await this.accountLifecycle.assertAllActive(client, [input.accountId, other]);
      const lockedReplay = await replay();
      if (lockedReplay) return lockedReplay;
      await this.requireFriendship(client, input.friendshipId, input.accountId);
      const merchant = await client.query<{ id: string; name: string; road_address: string }>(
        `SELECT m.id, m.name, m.road_address FROM merchants m
         WHERE m.id = $1 AND m.status = 'ACTIVE' AND m.published_at IS NOT NULL
           AND ($2::boolean OR NOT m.is_demo)
           AND NOT EXISTS (SELECT 1 FROM showcase_guest_trials t WHERE t.merchant_id = m.id)`,
        [parsed.merchantId, this.appVariant === 'SHOWCASE_APP'],
      );
      const merchantRow = merchant.rows[0];
      if (!merchantRow) throw new SocialError('INVALID_REQUEST');
      const invitationId = this.nextId();
      const now = this.now();
      await client.query(
        `INSERT INTO meal_invitations (
           id, friendship_id, sender_account_id, receiver_account_id, request_id,
           merchant_id, merchant_name, merchant_address, invite_date, schedule_kind,
           confirmed_time, range_start_time, range_end_time, status, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12, $13, 'PENDING', $14)`,
        [
          invitationId, input.friendshipId, input.accountId, other, requestId,
          merchantRow.id, merchantRow.name, merchantRow.road_address, parsed.date, parsed.schedule.kind,
          parsed.schedule.kind === 'CONFIRMED' ? parsed.schedule.time : null,
          parsed.schedule.kind === 'RANGE' ? parsed.schedule.startTime : null,
          parsed.schedule.kind === 'RANGE' ? parsed.schedule.endTime : null,
          now,
        ],
      );
      const mailId = await this.insertMail(client, {
        sender: input.accountId,
        receiver: other,
        friendshipId: input.friendshipId,
        requestId,
        type: 'MEAL_INVITATION',
        title: '같이 밥 먹기 초대',
        body: '친구가 식사 초대를 보냈어요.',
        payload: { invitationId },
      });
      await this.enqueueNotification(client, other, mailId, 'MEAL_INVITATION');
      return { ...await this.mailDetail(input.accountId, mailId, client), replayed: false };
    });
  }

  async respondToMealInvitation(input: {
    accountId: string;
    invitationId: string;
    requestId: string;
    decision: 'ACCEPT' | 'DECLINE';
    selectedTime?: string;
  }): Promise<MealInvitationResponse> {
    const requestId = parseRequestId(input.requestId);
    if (!uuidPattern.test(input.invitationId)) throw new SocialError('SOCIAL_INVITATION_NOT_FOUND');
    return this.transaction(async (client) => {
      const invitation = await this.requireInvitationForReceiver(client, input.invitationId, input.accountId);
      const parsedInvite = invitationToParsed(invitation);
      const response = parseMealResponse(input, parsedInvite);
      if (!response) throw new SocialError('INVALID_REQUEST');
      await this.accountLifecycle.assertAllActive(client, [invitation.sender_account_id, invitation.receiver_account_id]);
      await this.requireFriendship(client, invitation.friendship_id, input.accountId);

      const fresh = await this.requireInvitationForReceiver(client, input.invitationId, input.accountId);
      if (fresh.status !== 'PENDING') {
        if (fresh.response_request_id === requestId) {
          const mail = await this.responseMailForInvitation(client, fresh.sender_account_id, fresh.id);
          return { invitation: serializeInvitation(fresh), mail: await this.mailDetail(input.accountId, mail.id, client), replayed: true };
        }
        throw new SocialError('SOCIAL_INVITATION_TERMINAL');
      }
      if (isInvitationExpired(fresh, this.now())) throw new SocialError('SOCIAL_INVITATION_EXPIRED');
      const now = this.now();
      const updated = await client.query<InvitationRow>(
        `UPDATE meal_invitations
         SET status = $2, selected_time = $3, response_request_id = $4, responded_at = $5
         WHERE id = $1 AND status = 'PENDING'
         RETURNING *`,
        [input.invitationId, response.kind === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED', response.selectedTime, requestId, now],
      );
      const row = updated.rows[0];
      if (!row) throw new SocialError('SOCIAL_INVITATION_TERMINAL');
      const mailId = await this.insertMail(client, {
        sender: input.accountId,
        receiver: row.sender_account_id,
        friendshipId: row.friendship_id,
        requestId,
        type: 'MEAL_RESPONSE',
        title: response.kind === 'ACCEPT' ? '식사 초대를 수락했어요' : '식사 초대를 거절했어요',
        body: response.kind === 'ACCEPT' ? '친구가 식사 초대를 수락했어요.' : '친구가 식사 초대를 거절했어요.',
        payload: { invitationId: row.id },
      });
      await this.enqueueNotification(client, row.sender_account_id, mailId, 'MEAL_RESPONSE');
      const mail = await this.mailDetail(input.accountId, mailId, client);
      return { invitation: serializeInvitation(row), mail, replayed: false };
    });
  }

  async registerPushToken(input: {
    accountId: string;
    token: string;
    appVariant: SocialAppVariant;
    deviceId?: string | null;
    bindingRevision?: number;
  }): Promise<{ status: 'REGISTERED' }> {
    if (input.appVariant !== this.appVariant) throw new SocialError('SOCIAL_PUSH_TOKEN_INVALID');
    const token = parseToken(input.token);
    const bindingRevision = normalizeBindingRevision(input.bindingRevision);
    if (bindingRevision !== undefined && !input.deviceId) throw new SocialError('INVALID_REQUEST');
    await this.beforePushTokenAuthorization?.('register');
    return this.transaction(async (client) => {
      const discoveredAccounts = new Set<string>([input.accountId]);
      if (input.deviceId) {
        const discoveredDevice = await client.query<{ account_id: string }>(
          `SELECT account_id FROM push_tokens WHERE app_variant = $1 AND device_id = $2`,
          [input.appVariant, input.deviceId],
        );
        for (const row of discoveredDevice.rows) discoveredAccounts.add(row.account_id);
      }
      const discoveredToken = await client.query<{ account_id: string }>(
        `SELECT account_id FROM push_tokens WHERE app_variant = $1 AND token = $2`,
        [input.appVariant, token],
      );
      for (const row of discoveredToken.rows) discoveredAccounts.add(row.account_id);
      await this.accountLifecycle.assertAllActive(client, [...discoveredAccounts]);

      if (input.deviceId) await lockPushDevice(client, input.appVariant, input.deviceId);
      const bindings = input.deviceId
        ? await client.query<{ account_id: string; token: string; binding_revision: number; revoked_at: Date | null }>(
          `SELECT account_id, token, binding_revision, revoked_at
           FROM push_tokens
           WHERE app_variant = $1 AND device_id = $2
           ORDER BY binding_revision DESC, (revoked_at IS NULL) DESC, updated_at DESC, id DESC
           FOR UPDATE`,
          [input.appVariant, input.deviceId],
        )
        : { rows: [] as { account_id: string; token: string; binding_revision: number; revoked_at: Date | null }[] };
      const current = bindings.rows[0];
      const tokenHistory = await client.query<{ account_id: string; binding_revision: number; revoked_at: Date | null }>(
        `SELECT account_id, binding_revision, revoked_at
         FROM push_tokens
         WHERE app_variant = $1 AND token = $2
         ORDER BY binding_revision DESC, (revoked_at IS NULL) DESC, updated_at DESC, id DESC
         FOR UPDATE`,
        [input.appVariant, token],
      );
      const currentTokenOwner = tokenHistory.rows.find((row) => row.revoked_at === null);
      const rereadAccounts = new Set<string>([input.accountId]);
      for (const row of bindings.rows) rereadAccounts.add(row.account_id);
      for (const row of tokenHistory.rows) rereadAccounts.add(row.account_id);
      if ([...rereadAccounts].some((accountId) => !discoveredAccounts.has(accountId))) {
        throw new SocialError('SOCIAL_REQUEST_CONFLICT');
      }
      if (bindingRevision === undefined) {
        if (current && current.binding_revision > 0) throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        if (tokenHistory.rows.some((row) => row.binding_revision > 0)) throw new SocialError('SOCIAL_REQUEST_CONFLICT');
      }
      if (bindingRevision !== undefined && current) {
        if (bindingRevision < current.binding_revision) throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        if (bindingRevision === current.binding_revision
          && (current.revoked_at !== null || current.account_id !== input.accountId || current.token !== token)) {
          throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        }
      }
      if (currentTokenOwner && currentTokenOwner.account_id !== input.accountId) {
        if (bindingRevision === undefined || bindingRevision <= currentTokenOwner.binding_revision) {
          throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        }
      }
      await client.query(
        `UPDATE push_tokens
         SET revoked_at = coalesce(revoked_at, $4), updated_at = $4
         WHERE app_variant = $1 AND token = $2 AND account_id <> $3 AND revoked_at IS NULL
           AND ($5::integer IS NOT NULL AND binding_revision < $5)`,
        [input.appVariant, token, input.accountId, this.now(), bindingRevision ?? null],
      );
      if (input.deviceId) {
        await client.query(
          `UPDATE push_tokens
           SET revoked_at = coalesce(revoked_at, $3), updated_at = $3
           WHERE app_variant = $1 AND device_id = $2 AND token <> $4 AND revoked_at IS NULL
             AND ($5::integer IS NOT NULL AND binding_revision <= $5)`,
          [input.appVariant, input.deviceId, this.now(), token, bindingRevision ?? null],
        );
      }
      await client.query(
        `INSERT INTO push_tokens (id, account_id, app_variant, token, device_id, binding_revision, created_at, updated_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7, NULL)
         ON CONFLICT (account_id, app_variant, token)
         DO UPDATE SET device_id = EXCLUDED.device_id,
                       binding_revision = GREATEST(push_tokens.binding_revision, EXCLUDED.binding_revision),
                       updated_at = EXCLUDED.updated_at,
                       revoked_at = CASE
                         WHEN EXCLUDED.binding_revision >= push_tokens.binding_revision THEN NULL
                         ELSE push_tokens.revoked_at
                       END
         WHERE EXCLUDED.binding_revision >= push_tokens.binding_revision`,
        [this.nextId(), input.accountId, input.appVariant, token, input.deviceId ?? null, bindingRevision ?? 0, this.now()],
      );
      return { status: 'REGISTERED' as const };
    });
  }

  async unregisterPushToken(input: {
    accountId: string;
    token: string;
    appVariant: SocialAppVariant;
    deviceId?: string | null;
    bindingRevision?: number;
  }): Promise<{ status: 'REMOVED' }> {
    if (input.appVariant !== this.appVariant) throw new SocialError('SOCIAL_PUSH_TOKEN_INVALID');
    const token = parseToken(input.token);
    const bindingRevision = normalizeBindingRevision(input.bindingRevision);
    if (bindingRevision !== undefined && !input.deviceId) throw new SocialError('INVALID_REQUEST');
    await this.beforePushTokenAuthorization?.('unregister');
    await this.transaction(async (client) => {
      const discoveredAccounts = new Set<string>([input.accountId]);
      if (input.deviceId) {
        const discoveredDevice = await client.query<{ account_id: string }>(
          `SELECT account_id FROM push_tokens WHERE app_variant = $1 AND device_id = $2`,
          [input.appVariant, input.deviceId],
        );
        for (const row of discoveredDevice.rows) discoveredAccounts.add(row.account_id);
      }
      const discoveredToken = await client.query<{ account_id: string }>(
        `SELECT account_id FROM push_tokens WHERE app_variant = $1 AND token = $2`,
        [input.appVariant, token],
      );
      for (const row of discoveredToken.rows) discoveredAccounts.add(row.account_id);
      await this.accountLifecycle.lockAllForDeletion(client, [...discoveredAccounts]);

      let current: { account_id: string; binding_revision: number; revoked_at: Date | null } | undefined;
      let bindings: { rows: { account_id: string; binding_revision: number; revoked_at: Date | null }[] } = { rows: [] };
      if (input.deviceId) {
        await lockPushDevice(client, input.appVariant, input.deviceId);
        bindings = await client.query<{ account_id: string; binding_revision: number; revoked_at: Date | null }>(
          `SELECT account_id, binding_revision, revoked_at
           FROM push_tokens
           WHERE app_variant = $1 AND device_id = $2
           ORDER BY binding_revision DESC, (revoked_at IS NULL) DESC, updated_at DESC, id DESC
           FOR UPDATE`,
          [input.appVariant, input.deviceId],
        );
        current = bindings.rows[0];
      }
      const tokenRows = await client.query<{ account_id: string; binding_revision: number }>(
        `SELECT account_id, binding_revision FROM push_tokens
         WHERE app_variant = $1 AND token = $2
         ORDER BY binding_revision DESC
         FOR UPDATE`,
        [input.appVariant, token],
      );
      const rereadAccounts = new Set<string>([input.accountId]);
      for (const row of bindings.rows) rereadAccounts.add(row.account_id);
      for (const row of tokenRows.rows) rereadAccounts.add(row.account_id);
      if ([...rereadAccounts].some((accountId) => !discoveredAccounts.has(accountId))) {
        throw new SocialError('SOCIAL_REQUEST_CONFLICT');
      }
      if (bindingRevision === undefined) {
        if (current && current.binding_revision > 0) throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        if (tokenRows.rows.some((row) => row.account_id === input.accountId && row.binding_revision > 0)) {
          throw new SocialError('SOCIAL_REQUEST_CONFLICT');
        }
      }
      if (bindingRevision !== undefined && current && bindingRevision < current.binding_revision) return;
      if (current?.revoked_at === null && current.account_id !== input.accountId) {
        if (bindingRevision === undefined || bindingRevision <= current.binding_revision) return;
      }
      const scopedTargetRows = input.deviceId
        ? await client.query<{ binding_revision: number }>(
          `SELECT binding_revision FROM push_tokens
           WHERE account_id = $1 AND app_variant = $2 AND token = $3 AND device_id = $4
           ORDER BY binding_revision DESC
           FOR UPDATE`,
          [input.accountId, input.appVariant, token, input.deviceId],
        )
        : { rows: tokenRows.rows.filter((row) => row.account_id === input.accountId).map((row) => ({ binding_revision: row.binding_revision })) };
      if (bindingRevision === undefined && scopedTargetRows.rows.some((row) => row.binding_revision > 0)) {
        throw new SocialError('SOCIAL_REQUEST_CONFLICT');
      }
      const updated = await client.query(
        `UPDATE push_tokens
         SET revoked_at = coalesce(revoked_at, $4), updated_at = $4,
             binding_revision = CASE
               WHEN $6::integer IS NULL THEN binding_revision
               ELSE GREATEST(binding_revision, $6)
             END
         WHERE account_id = $1 AND app_variant = $2 AND token = $3
           AND ($5::text IS NULL OR device_id = $5)
           AND (($6::integer IS NULL AND binding_revision = 0) OR ($6::integer IS NOT NULL AND binding_revision <= $6))`,
        [input.accountId, input.appVariant, token, this.now(), input.deviceId ?? null, bindingRevision ?? null],
      );
      if (updated.rowCount === 0 && input.deviceId && bindingRevision !== undefined) {
        await client.query(
          `INSERT INTO push_tokens (id, account_id, app_variant, token, device_id, binding_revision, created_at, updated_at, revoked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7)
           ON CONFLICT (account_id, app_variant, token)
           DO UPDATE SET device_id = EXCLUDED.device_id,
                         binding_revision = GREATEST(push_tokens.binding_revision, EXCLUDED.binding_revision),
                         updated_at = EXCLUDED.updated_at,
                         revoked_at = CASE
                           WHEN EXCLUDED.binding_revision > push_tokens.binding_revision THEN EXCLUDED.revoked_at
                           ELSE push_tokens.revoked_at
                         END
           WHERE EXCLUDED.binding_revision > push_tokens.binding_revision`,
          [this.nextId(), input.accountId, input.appVariant, token, input.deviceId, bindingRevision, this.now()],
        );
      }
    });
    return { status: 'REMOVED' };
  }

  async flushNotifications(input: { limit?: number } = {}): Promise<NotificationFlushResult> {
    const limit = normalizeLimit(input.limit);
    let claimed = 0;
    let sent = 0;
    let retry = 0;
    let dead = 0;
    let skipped = 0;
    for (let index = 0; index < limit; index++) {
      const claim = await this.claimOutboxForDispatch();
      if (!claim) break;
      claimed++;
      if (claim.kind === 'skipped') {
        skipped++;
        dead++;
        continue;
      }
      const payload = notificationPayload(claim.outbox.payload);
      try {
        const messages: PushMessage[] = claim.deliveries.map((delivery) => ({
          to: delivery.token,
          title: payload.title,
          body: payload.body,
          data: payload.data,
        }));
        const tickets = await this.gateway.send(messages);
        for (let ticketIndex = 0; ticketIndex < claim.deliveries.length; ticketIndex++) {
          const ticket = tickets[ticketIndex] ?? { status: 'error' as const, code: 'GATEWAY_TICKET_MISSING', retryable: true };
          const result = await this.recordDeliveryTicket(claim, claim.deliveries[ticketIndex]!, ticket);
          if (result === 'sent') sent++;
          if (result === 'retry') retry++;
          if (result === 'dead') dead++;
        }
        await this.refreshOutboxFromDeliveries(claim.outbox.id, claim.outbox.lease_id, claim.outbox.lease_generation);
      } catch {
        for (const delivery of claim.deliveries) {
          if (await this.scheduleDeliveryRetry(delivery, 'GATEWAY_NETWORK', claim.outbox.lease_id, claim.outbox.lease_generation)) {
            retry++;
          }
        }
        await this.refreshOutboxFromDeliveries(claim.outbox.id, claim.outbox.lease_id, claim.outbox.lease_generation);
      }
    }
    return { claimed, sent, retry, dead, skipped };
  }

  async reconcileReceipts(input: { limit?: number } = {}): Promise<NotificationReceiptResult> {
    const limit = normalizeLimit(input.limit);
    const leaseId = this.nextId();
    const now = this.now();
    await this.pool.query(
      `UPDATE social_notification_deliveries
       SET status = 'AWAITING_RECEIPT', lease_id = NULL, lease_expires_at = NULL, updated_at = $1
       WHERE status = 'PROCESSING' AND expo_ticket_id IS NOT NULL AND lease_expires_at <= $1`,
      [now],
    );
    const candidates = (await this.pool.query<DeliveryRow>(
      `SELECT id, outbox_id, account_id, app_variant, token, status, attempts,
              lease_id, lease_generation, expo_ticket_id, push_token_id, binding_revision
       FROM social_notification_deliveries
       WHERE status = 'AWAITING_RECEIPT' AND expo_ticket_id IS NOT NULL
       ORDER BY updated_at, id
       LIMIT $1`,
      [limit],
    )).rows;
    if (candidates.length === 0) return { checked: 0, delivered: 0, retry: 0, dead: 0 };

    const client = await this.pool.connect();
    let rows: DeliveryRow[];
    try {
      await client.query('BEGIN');
      await this.accountLifecycle.assertAllActive(client, candidates.map((row) => row.account_id));
      const tokenIds = [...new Set(candidates.flatMap((row) => row.push_token_id ? [row.push_token_id] : []))];
      if (tokenIds.length > 0) {
        await client.query(
          `SELECT id FROM push_tokens
           WHERE id = ANY($1::uuid[])
           ORDER BY app_variant, coalesce(device_id, ''), token, id
           FOR UPDATE`,
          [tokenIds],
        );
      }
      rows = (await client.query<DeliveryRow>(
        `UPDATE social_notification_deliveries delivery
         SET status = 'PROCESSING', lease_id = $2, lease_expires_at = $3, updated_at = $4
         WHERE delivery.id = ANY($1::uuid[]) AND delivery.status = 'AWAITING_RECEIPT' AND delivery.expo_ticket_id IS NOT NULL
         RETURNING id, outbox_id, account_id, app_variant, token, status, attempts, lease_id, lease_generation, expo_ticket_id, push_token_id, binding_revision`,
        [candidates.map((row) => row.id), leaseId, new Date(now.getTime() + this.leaseMs), now],
      )).rows;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) return { checked: 0, delivered: 0, retry: 0, dead: 0 };
      throw error;
    } finally {
      client.release();
    }

    const ticketIds = rows.flatMap((row) => row.expo_ticket_id ? [row.expo_ticket_id] : []);
    if (ticketIds.length === 0) return { checked: 0, delivered: 0, retry: 0, dead: 0 };
    const receipts = await this.gateway.getReceipts(ticketIds);
    let delivered = 0;
    let retry = 0;
    let dead = 0;
    for (const row of rows) {
      if (!row.expo_ticket_id) continue;
      const result = await this.completeReceiptDelivery(row, receipts.get(row.expo_ticket_id) ?? null, leaseId);
      if (result === 'delivered') delivered++;
      if (result === 'retry') retry++;
      if (result === 'dead') dead++;
    }
    return { checked: ticketIds.length, delivered, retry, dead };
  }

  private async claimOutboxForDispatch(): Promise<
    | { kind: 'ready'; outbox: OutboxRow; deliveries: DeliveryRow[] }
    | { kind: 'skipped'; outbox: OutboxRow; reason: string }
    | null
  > {
    const leaseId = this.nextId();
    const now = this.now();
    const candidate = (await this.pool.query<OutboxRow>(
      `SELECT id, account_id, mail_id, event_type, payload, attempts,
              coalesce(lease_id, '') AS lease_id, lease_generation
       FROM notification_outbox
       WHERE (
         (status IN ('PENDING', 'RETRY', 'PROCESSING')
           AND next_attempt_at <= $1
           AND (status <> 'PROCESSING' OR lease_expires_at <= $1))
         OR
         (status = 'AWAITING_RECEIPT' AND EXISTS (
           SELECT 1 FROM social_notification_deliveries delivery
           WHERE delivery.outbox_id = notification_outbox.id
             AND delivery.status = 'RETRY'
             AND delivery.next_attempt_at <= $1
         ))
       )
       ORDER BY created_at, id
       LIMIT 1`,
      [now],
    )).rows[0];
    if (!candidate) return null;

    const existingBefore = await this.pool.query<{ n: number }>(
      'SELECT count(*)::integer AS n FROM social_notification_deliveries WHERE outbox_id = $1',
      [candidate.id],
    );
    const hasExistingDeliveries = (existingBefore.rows[0]?.n ?? 0) > 0;
    const preparedTokens = hasExistingDeliveries
      ? []
      : (await this.pool.query<{ id: string; token: string; binding_revision: number }>(
        `SELECT id, token, binding_revision FROM push_tokens
         WHERE account_id = $1 AND app_variant = $2 AND revoked_at IS NULL
         ORDER BY updated_at DESC`,
        [candidate.account_id, this.appVariant],
      )).rows;
    const preparedRetryDeliveries = hasExistingDeliveries
      ? (await this.pool.query<DeliveryRow>(
        `SELECT id, outbox_id, account_id, app_variant, token, status, attempts,
                lease_id, lease_generation, expo_ticket_id, push_token_id, binding_revision
         FROM social_notification_deliveries
         WHERE outbox_id = $1 AND (
           (status = 'RETRY' AND next_attempt_at <= $2)
           OR (status = 'PROCESSING' AND expo_ticket_id IS NULL AND lease_expires_at <= $2)
         )
         ORDER BY updated_at, id`,
        [candidate.id, now],
      )).rows
      : [];

    await this.beforeDispatchAuthorization?.();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const invalidReason = await this.dispatchInvalidReason(client, candidate);
      if (invalidReason) {
        const claimedDead = await client.query<OutboxRow>(
          `UPDATE notification_outbox outbox
           SET status = 'PROCESSING', lease_id = $2, lease_expires_at = $3,
               lease_generation = lease_generation + 1, updated_at = $4
           WHERE outbox.id = $5 AND (
             (status IN ('PENDING', 'RETRY', 'PROCESSING')
               AND next_attempt_at <= $1
               AND (status <> 'PROCESSING' OR lease_expires_at <= $1))
             OR
             (status = 'AWAITING_RECEIPT' AND EXISTS (
               SELECT 1 FROM social_notification_deliveries delivery
               WHERE delivery.outbox_id = outbox.id
                 AND delivery.status = 'RETRY'
                 AND delivery.next_attempt_at <= $1
             ))
           )
           RETURNING id, account_id, mail_id, event_type, payload, attempts, lease_id, lease_generation`,
          [now, leaseId, new Date(now.getTime() + this.leaseMs), now, candidate.id],
        );
        const outbox = claimedDead.rows[0];
        if (!outbox) {
          await client.query('COMMIT');
          return null;
        }
        await this.markOutboxDeadFenced(client, outbox, invalidReason);
        await client.query('COMMIT');
        return { kind: 'skipped', outbox, reason: invalidReason };
      }

      if (hasExistingDeliveries) {
        const tokenIds = [...new Set(preparedRetryDeliveries.flatMap((delivery) => delivery.push_token_id ? [delivery.push_token_id] : []))];
        if (tokenIds.length > 0) {
          await client.query(
            `SELECT id FROM push_tokens
             WHERE id = ANY($1::uuid[])
             ORDER BY app_variant, coalesce(device_id, ''), token, id
             FOR UPDATE`,
            [tokenIds],
          );
        }
      } else {
        const tokenIds = preparedTokens.map((token) => token.id);
        if (tokenIds.length > 0) {
          await client.query(
            `SELECT id FROM push_tokens
             WHERE id = ANY($1::uuid[])
             ORDER BY app_variant, coalesce(device_id, ''), token, id
             FOR UPDATE`,
            [tokenIds],
          );
        }
      }

      const claimed = await client.query<OutboxRow>(
        `UPDATE notification_outbox outbox
         SET status = 'PROCESSING',
             lease_id = $2,
             lease_expires_at = $3,
             lease_generation = lease_generation + 1,
             updated_at = $4
         WHERE outbox.id = $5 AND (
           (status IN ('PENDING', 'RETRY', 'PROCESSING')
             AND next_attempt_at <= $1
             AND (status <> 'PROCESSING' OR lease_expires_at <= $1))
           OR
           (status = 'AWAITING_RECEIPT' AND EXISTS (
             SELECT 1 FROM social_notification_deliveries delivery
             WHERE delivery.outbox_id = outbox.id
               AND delivery.status = 'RETRY'
               AND delivery.next_attempt_at <= $1
           ))
         )
         RETURNING id, account_id, mail_id, event_type, payload, attempts, lease_id, lease_generation`,
        [now, leaseId, new Date(now.getTime() + this.leaseMs), now, candidate.id],
      );
      const outbox = claimed.rows[0];
      if (!outbox) {
        await client.query('COMMIT');
        return null;
      }
      await client.query(
        `UPDATE social_notification_deliveries
         SET status = 'RETRY', lease_id = NULL, lease_expires_at = NULL, updated_at = $2, last_error_code = 'STALE_PROCESSING'
         WHERE outbox_id = $1 AND status = 'PROCESSING' AND expo_ticket_id IS NULL AND lease_expires_at <= $2`,
        [outbox.id, now],
      );

      let deliveries: DeliveryRow[];
      if (hasExistingDeliveries) {
        await client.query(
          `UPDATE social_notification_deliveries delivery
           SET status = 'CANCELLED', lease_id = NULL, lease_expires_at = NULL,
               updated_at = $2, last_error_code = 'TOKEN_REVOKED'
           WHERE delivery.outbox_id = $1 AND delivery.status = 'RETRY'
             AND NOT EXISTS (
               SELECT 1 FROM push_tokens token
               WHERE token.account_id = delivery.account_id
                 AND token.app_variant = delivery.app_variant
                 AND token.token = delivery.token
                 AND (delivery.push_token_id IS NULL OR token.id = delivery.push_token_id)
                 AND (delivery.binding_revision IS NULL OR token.binding_revision = delivery.binding_revision)
                 AND token.revoked_at IS NULL
             )`,
          [outbox.id, now],
        );
        const retryRows = await client.query<DeliveryRow>(
          `UPDATE social_notification_deliveries delivery
           SET status = 'PROCESSING', lease_id = $2, lease_generation = $3,
               lease_expires_at = $4, authorized_at = $5, updated_at = $5
           WHERE delivery.outbox_id = $1 AND delivery.status = 'RETRY' AND delivery.next_attempt_at <= $5
             AND EXISTS (
               SELECT 1 FROM push_tokens token
               WHERE token.account_id = delivery.account_id
                 AND token.app_variant = delivery.app_variant
                 AND token.token = delivery.token
                 AND (delivery.push_token_id IS NULL OR token.id = delivery.push_token_id)
                 AND (delivery.binding_revision IS NULL OR token.binding_revision = delivery.binding_revision)
                 AND token.revoked_at IS NULL
             )
           RETURNING id, outbox_id, account_id, app_variant, token, status, attempts, lease_id, lease_generation, expo_ticket_id, push_token_id, binding_revision`,
          [outbox.id, leaseId, outbox.lease_generation, new Date(now.getTime() + this.leaseMs), now],
        );
        deliveries = retryRows.rows;
      } else {
        const preparedIds = preparedTokens.map((token) => token.id);
        const tokenRows = preparedIds.length === 0
          ? { rows: [] as { id: string; token: string; binding_revision: number }[] }
          : await client.query<{ id: string; token: string; binding_revision: number }>(
            `SELECT id, token, binding_revision FROM push_tokens
             WHERE account_id = $1 AND app_variant = $2 AND revoked_at IS NULL AND id = ANY($3::uuid[])
             ORDER BY updated_at DESC
             FOR UPDATE`,
            [outbox.account_id, this.appVariant, preparedIds],
          );
        deliveries = [];
        for (const tokenRow of tokenRows.rows) {
          const inserted = await client.query<DeliveryRow>(
            `INSERT INTO social_notification_deliveries (
               id, outbox_id, account_id, app_variant, token, status, attempts,
               next_attempt_at, lease_id, lease_generation, lease_expires_at, authorized_at,
               push_token_id, binding_revision, created_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, 'PROCESSING', 0, $6, $7, $8, $9, $6, $10, $11, $6, $6)
             RETURNING id, outbox_id, account_id, app_variant, token, status, attempts, lease_id, lease_generation, expo_ticket_id, push_token_id, binding_revision`,
            [
              this.nextId(), outbox.id, outbox.account_id, this.appVariant, tokenRow.token,
              now, leaseId, outbox.lease_generation, new Date(now.getTime() + this.leaseMs),
              tokenRow.id, tokenRow.binding_revision,
            ],
          );
          deliveries.push(inserted.rows[0]!);
        }
      }
      if (deliveries.length === 0) {
        await this.markOutboxDeadFenced(client, outbox, 'NO_TOKENS');
        await client.query('COMMIT');
        return { kind: 'skipped', outbox, reason: 'NO_TOKENS' };
      }
      await client.query('COMMIT');
      return { kind: 'ready', outbox, deliveries };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) return null;
      throw error;
    } finally {
      client.release();
    }
  }

  private async dispatchInvalidReason(client: PoolClient, outbox: OutboxRow): Promise<string | null> {
    try {
      await this.accountLifecycle.assertActive(client, outbox.account_id);
    } catch (error) {
      if (error instanceof AccountLifecycleError) return 'ACCOUNT_DELETED';
      throw error;
    }
    const consent = await client.query(
      `SELECT 1 FROM account_consents
       WHERE account_id = $1 AND terms_version = $2 AND privacy_version = $3`,
      [outbox.account_id, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION],
    );
    if (consent.rowCount === 0) return 'CONSENT_REQUIRED';
    if (outbox.mail_id) {
      const mail = await client.query<{ friendship_id: string | null; sender_account_id: string | null }>(
        'SELECT friendship_id, sender_account_id FROM social_mail WHERE id = $1 AND receiver_account_id = $2',
        [outbox.mail_id, outbox.account_id],
      );
      if (mail.rowCount === 0) return 'MAIL_NOT_FOUND';
      const row = mail.rows[0]!;
      // remove()도 수신 계정 잠금을 잡으므로 이 검사부터 발송 승인 commit까지 관계 해제와 직렬화된다.
      const friendship = await client.query(
        `SELECT 1 FROM friendships WHERE id = $1
         AND ((account_low = $2 AND account_high = $3) OR (account_low = $3 AND account_high = $2))
         FOR KEY SHARE`,
        [row.friendship_id, row.sender_account_id, outbox.account_id],
      );
      if (friendship.rowCount === 0) return 'FRIENDSHIP_REMOVED';
    }
    return null;
  }

  private async recordDeliveryTicket(
    claim: { outbox: OutboxRow },
    delivery: DeliveryRow,
    ticket: PushTicket,
  ): Promise<'sent' | 'retry' | 'dead' | 'stale'> {
    if (ticket.status === 'ok') {
      const updated = await this.pool.query(
        `UPDATE social_notification_deliveries delivery
         SET status = 'AWAITING_RECEIPT', attempts = attempts + 1, expo_ticket_id = $4,
             lease_id = NULL, lease_expires_at = NULL, updated_at = $5, last_error_code = NULL
         WHERE delivery.id = $1 AND delivery.status = 'PROCESSING'
           AND delivery.lease_id = $2 AND delivery.lease_generation = $3
           AND EXISTS (
             SELECT 1 FROM notification_outbox outbox
             WHERE outbox.id = delivery.outbox_id
               AND outbox.lease_id = $2
               AND outbox.lease_generation = $3
               AND outbox.status = 'PROCESSING'
           )`,
        [delivery.id, claim.outbox.lease_id, claim.outbox.lease_generation, ticket.id, this.now()],
      );
      return updated.rowCount === 1 ? 'sent' : 'stale';
    }
    if (ticket.retryable) {
      return await this.scheduleDeliveryRetry(delivery, ticket.code, claim.outbox.lease_id, claim.outbox.lease_generation)
        ? 'retry'
        : 'stale';
    }
    return await this.markDeliveryDead(delivery, ticket.code, claim.outbox.lease_id) ? 'dead' : 'stale';
  }

  private async completeReceiptDelivery(
    delivery: DeliveryRow,
    receipt: PushReceipt | null,
    leaseId: string,
  ): Promise<'delivered' | 'retry' | 'dead' | 'stale'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await this.accountLifecycle.assertActive(client, delivery.account_id);
      } catch (error) {
        if (error instanceof AccountLifecycleError) {
          await client.query('COMMIT');
          return 'stale';
        }
        throw error;
      }
      if (delivery.push_token_id) {
        await client.query(
          `SELECT id FROM push_tokens
           WHERE id = $1
           ORDER BY app_variant, coalesce(device_id, ''), token, id
           FOR UPDATE`,
          [delivery.push_token_id],
        );
      }
      const outbox = (await client.query<OutboxRow>(
        `SELECT id, account_id, mail_id, event_type, payload, attempts,
                coalesce(lease_id, '') AS lease_id, lease_generation
         FROM notification_outbox
         WHERE id = $1
         FOR UPDATE`,
        [delivery.outbox_id],
      )).rows[0];
      if (!outbox) {
        await client.query('COMMIT');
        return 'stale';
      }
      const current = (await client.query<DeliveryRow>(
        `SELECT id, outbox_id, account_id, app_variant, token, status, attempts,
                lease_id, lease_generation, expo_ticket_id, push_token_id, binding_revision
         FROM social_notification_deliveries
         WHERE id = $1 AND status = 'PROCESSING' AND lease_id = $2 AND lease_generation = $3
           AND expo_ticket_id = $4
         FOR UPDATE`,
        [delivery.id, leaseId, delivery.lease_generation, delivery.expo_ticket_id],
      )).rows[0];
      if (!current) {
        await client.query('COMMIT');
        return 'stale';
      }

      let result: 'delivered' | 'retry' | 'dead' | 'stale' = 'stale';
      if (!receipt) {
        await this.returnMissingReceiptInTransaction(client, current, leaseId);
      } else if (receipt.status === 'ok') {
        result = await this.markDeliverySentInTransaction(client, current, leaseId) ? 'delivered' : 'stale';
      } else if (receipt.retryable && !receipt.deadToken) {
        result = await this.scheduleDeliveryRetryInTransaction(client, current, receipt.code, leaseId, current.lease_generation) ? 'retry' : 'stale';
      } else {
        result = await this.markDeliveryDeadInTransaction(client, current, receipt.code, leaseId) ? 'dead' : 'stale';
        if (result === 'dead') {
          if (this.failReceiptCompletionAfterTerminal) throw new Error('TEST_RECEIPT_COMPLETION_AFTER_TERMINAL');
          if (receipt.deadToken && current.push_token_id && current.binding_revision !== null) {
            await client.query(
              `UPDATE push_tokens SET revoked_at = coalesce(revoked_at, $4), updated_at = $4
               WHERE id = $1 AND app_variant = $2 AND token = $3 AND binding_revision = $5 AND revoked_at IS NULL`,
              [current.push_token_id, current.app_variant, current.token, this.now(), current.binding_revision],
            );
          }
        }
      }
      await this.refreshOutboxFromDeliveriesInTransaction(client, current.outbox_id, false);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async markDeliverySent(delivery: DeliveryRow, leaseId: string): Promise<boolean> {
    const updated = await this.pool.query(
      `UPDATE social_notification_deliveries
       SET status = 'SENT', lease_id = NULL, lease_expires_at = NULL, updated_at = $3, last_error_code = NULL
       WHERE id = $1 AND status = 'PROCESSING' AND lease_id = $2 AND lease_generation = $4`,
      [delivery.id, leaseId, this.now(), delivery.lease_generation],
    );
    return updated.rowCount === 1;
  }

  private async markDeliveryDead(delivery: DeliveryRow, errorCode: string, leaseId: string): Promise<boolean> {
    const updated = await this.pool.query(
      `UPDATE social_notification_deliveries
       SET status = 'DEAD', lease_id = NULL, lease_expires_at = NULL, updated_at = $4, last_error_code = $3
       WHERE id = $1 AND status = 'PROCESSING' AND lease_id = $2 AND lease_generation = $5`,
      [delivery.id, leaseId, errorCode, this.now(), delivery.lease_generation],
    );
    return updated.rowCount === 1;
  }

  private async returnMissingReceipt(delivery: DeliveryRow, leaseId: string): Promise<void> {
    await this.pool.query(
      `UPDATE social_notification_deliveries
       SET status = 'AWAITING_RECEIPT', lease_id = NULL, lease_expires_at = NULL, updated_at = $3
       WHERE id = $1 AND status = 'PROCESSING' AND lease_id = $2 AND lease_generation = $4`,
      [delivery.id, leaseId, this.now(), delivery.lease_generation],
    );
  }

  private async markDeliverySentInTransaction(client: Queryable, delivery: DeliveryRow, leaseId: string): Promise<boolean> {
    const updated = await client.query(
      `UPDATE social_notification_deliveries
       SET status = 'SENT', lease_id = NULL, lease_expires_at = NULL, updated_at = $3, last_error_code = NULL
       WHERE id = $1 AND status = 'PROCESSING' AND lease_id = $2 AND lease_generation = $4`,
      [delivery.id, leaseId, this.now(), delivery.lease_generation],
    );
    return updated.rowCount === 1;
  }

  private async markDeliveryDeadInTransaction(client: Queryable, delivery: DeliveryRow, errorCode: string, leaseId: string): Promise<boolean> {
    const updated = await client.query(
      `UPDATE social_notification_deliveries
       SET status = 'DEAD', lease_id = NULL, lease_expires_at = NULL, updated_at = $4, last_error_code = $3
       WHERE id = $1 AND status = 'PROCESSING' AND lease_id = $2 AND lease_generation = $5`,
      [delivery.id, leaseId, errorCode, this.now(), delivery.lease_generation],
    );
    return updated.rowCount === 1;
  }

  private async returnMissingReceiptInTransaction(client: Queryable, delivery: DeliveryRow, leaseId: string): Promise<void> {
    await client.query(
      `UPDATE social_notification_deliveries
       SET status = 'AWAITING_RECEIPT', lease_id = NULL, lease_expires_at = NULL, updated_at = $3
       WHERE id = $1 AND status = 'PROCESSING' AND lease_id = $2 AND lease_generation = $4`,
      [delivery.id, leaseId, this.now(), delivery.lease_generation],
    );
  }

  private async scheduleDeliveryRetryInTransaction(
    client: Queryable,
    delivery: DeliveryRow,
    errorCode: string,
    leaseId: string,
    leaseGeneration: number,
  ): Promise<boolean> {
    const attempts = delivery.attempts + 1;
    if (attempts >= maxAttempts) return this.markDeliveryDeadInTransaction(client, delivery, errorCode, leaseId);
    const now = this.now();
    const delayMs = Math.min(60 * 60 * 1000, 2 ** Math.max(0, attempts - 1) * 30_000);
    const updated = await client.query(
      `UPDATE social_notification_deliveries
       SET status = 'RETRY', attempts = $4, next_attempt_at = $5, lease_id = NULL, lease_expires_at = NULL,
           last_error_code = $6, updated_at = $7
       WHERE id = $1 AND status = 'PROCESSING' AND lease_id = $2 AND lease_generation = $3`,
      [delivery.id, leaseId, leaseGeneration, attempts, new Date(now.getTime() + delayMs), errorCode, now],
    );
    return updated.rowCount === 1;
  }

  private async requireFriendship(client: Queryable, friendshipId: string, accountId: string): Promise<FriendshipRow> {
    if (!uuidPattern.test(friendshipId)) throw new SocialError('SOCIAL_FRIENDSHIP_NOT_FOUND');
    const found = await client.query<FriendshipRow>(
      `SELECT id, account_low, account_high FROM friendships
       WHERE id = $1 AND (account_low = $2 OR account_high = $2)`,
      [friendshipId, accountId],
    );
    const row = found.rows[0];
    if (!row) throw new SocialError('SOCIAL_FRIENDSHIP_NOT_FOUND');
    return row;
  }

  private async requireGiftForReceiver(client: Queryable, giftId: string, accountId: string): Promise<GiftRow> {
    const found = await client.query<GiftRow>(
      `SELECT * FROM friendship_gifts WHERE id = $1 AND receiver_account_id = $2`,
      [giftId, accountId],
    );
    const row = found.rows[0];
    if (!row) throw new SocialError('SOCIAL_FORBIDDEN');
    return row;
  }

  private async requireInvitationForReceiver(client: Queryable, invitationId: string, accountId: string): Promise<InvitationRow> {
    const found = await client.query<InvitationRow>(
      `SELECT * FROM meal_invitations WHERE id = $1 AND receiver_account_id = $2`,
      [invitationId, accountId],
    );
    const row = found.rows[0];
    if (!row) throw new SocialError('SOCIAL_INVITATION_NOT_FOUND');
    return row;
  }

  private async responseMailForInvitation(client: Queryable, accountId: string, invitationId: string): Promise<MailRow> {
    const found = await client.query<MailRow>(
      mailSelectSql(`WHERE mail.receiver_account_id = $1 AND mail.type = 'MEAL_RESPONSE' AND mail.payload->>'invitationId' = $2`),
      [accountId, invitationId],
    );
    const row = found.rows[0];
    if (!row) throw new SocialError('SOCIAL_MAIL_NOT_FOUND');
    return row;
  }

  private async mailBySenderRequest(client: Queryable, accountId: string, requestId: string): Promise<MailRow | null> {
    const found = await client.query<MailRow>(
      'SELECT * FROM social_mail WHERE sender_account_id = $1 AND request_id = $2',
      [accountId, requestId],
    );
    return found.rows[0] ?? null;
  }

  private async mailDetail(accountId: string, mailId: string, db: Queryable = this.pool): Promise<MailDetail> {
    if (!uuidPattern.test(mailId)) throw new SocialError('SOCIAL_MAIL_NOT_FOUND');
    const rows = await db.query<MailRow>(
      mailSelectSql('WHERE mail.id = $1 AND (mail.receiver_account_id = $2 OR mail.sender_account_id = $2)'),
      [mailId, accountId],
    );
    const row = rows.rows[0];
    if (!row) throw new SocialError('SOCIAL_MAIL_NOT_FOUND');
    const detail = detailFromRow(row, accountId);
    const invitationId = typeof row.payload.invitationId === 'string' ? row.payload.invitationId : null;
    if (!invitationId) return detail;
    const invitation = await db.query<InvitationRow>('SELECT * FROM meal_invitations WHERE id = $1', [invitationId]);
    const invitationRow = invitation.rows[0];
    return {
      ...detail,
      ...(invitationRow ? { mealInvitation: serializeInvitation(invitationRow) } : {}),
    };
  }

  private async insertMail(client: PoolClient, input: {
    sender: string | null;
    receiver: string;
    friendshipId: string | null;
    requestId?: string;
    type: MailType;
    title: string;
    body: string;
    payload: JsonObject;
  }): Promise<string> {
    const id = this.nextId();
    await client.query(
      `INSERT INTO social_mail (
         id, type, sender_account_id, receiver_account_id, friendship_id, request_id,
         title, body, payload, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        id, input.type, input.sender, input.receiver, input.friendshipId, input.requestId ?? null,
        input.title, input.body, JSON.stringify(input.payload), this.now(),
      ],
    );
    return id;
  }

  private async enqueueNotification(client: PoolClient, accountId: string, mailId: string, type: MailType): Promise<void> {
    await client.query(
      `INSERT INTO notification_outbox (
         id, account_id, mail_id, event_type, payload, status, next_attempt_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, 'PENDING', $6, $6, $6)`,
      [this.nextId(), accountId, mailId, type, JSON.stringify(buildGenericPushPayload({ mailId, type })), this.now()],
    );
  }

  private async insertCredit(
    client: PoolClient,
    accountId: string,
    amount: number,
    sourceId: string,
    businessDate: string,
    createdAt: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO mileage_credits (id, account_id, amount, reason, source_id, business_date, created_at)
       VALUES ($1, $2, $3, 'FRIENDSHIP', $4, $5::date, $6)
       ON CONFLICT (account_id, reason, source_id) DO NOTHING`,
      [this.nextId(), accountId, amount, sourceId, businessDate, createdAt],
    );
  }

  private async friendshipRewardEarned(db: Queryable, accountId: string, businessDate: string): Promise<number> {
    const row = await db.query<{ amount: number }>(
      `SELECT coalesce(sum(amount), 0)::integer AS amount FROM mileage_credits
       WHERE account_id = $1 AND reason = 'FRIENDSHIP' AND business_date = $2::date`,
      [accountId, businessDate],
    );
    return row.rows[0]?.amount ?? 0;
  }

  private async sendCount(db: Queryable, accountId: string, businessDate: string): Promise<number> {
    const row = await db.query<{ n: number }>(
      `SELECT count(*)::integer AS n FROM friendship_gifts
       WHERE sender_account_id = $1 AND sent_business_date = $2::date`,
      [accountId, businessDate],
    );
    return row.rows[0]?.n ?? 0;
  }

  private async giftResult(db: Queryable, gift: GiftRow, viewer: string, replayed: boolean): Promise<FriendshipGiftResult> {
    const today = kstBusinessDate(this.now());
    const [rewardEarned, sendCount] = await Promise.all([
      this.friendshipRewardEarned(db, viewer, today),
      this.sendCount(db, viewer, today),
    ]);
    return {
      giftId: gift.id,
      friendshipId: gift.friendship_id,
      status: gift.status,
      direction: gift.sender_account_id === viewer ? 'SENT' : 'RECEIVED',
      senderReward: gift.sender_reward_amount,
      receiverReward: gift.receiver_reward_amount,
      rewardRemainingToday: Math.max(0, friendshipGiftRewardDailyCap - rewardEarned),
      sendRemaining: Math.max(0, friendshipGiftDailySendLimit - sendCount),
      replayed,
      createdAt: gift.created_at.toISOString(),
      receivedAt: gift.received_at?.toISOString() ?? null,
    };
  }

  private async scheduleRetry(id: string, attempts: number, errorCode: string): Promise<void> {
    const now = this.now();
    if (attempts >= maxAttempts) {
      await this.markOutboxDead(id, errorCode);
      return;
    }
    const delayMs = Math.min(60 * 60 * 1000, 2 ** Math.max(0, attempts - 1) * 30_000);
    await this.pool.query(
      `UPDATE notification_outbox
       SET status = 'RETRY', attempts = $2, next_attempt_at = $3, lease_id = NULL, lease_expires_at = NULL,
           last_error_code = $4, updated_at = $5
       WHERE id = $1`,
      [id, attempts, new Date(now.getTime() + delayMs), errorCode, now],
    );
  }

  private async markOutboxDead(id: string, errorCode: string): Promise<void> {
    await this.pool.query(
      `UPDATE notification_outbox
       SET status = 'DEAD', lease_id = NULL, lease_expires_at = NULL, last_error_code = $2, updated_at = $3
       WHERE id = $1`,
      [id, errorCode, this.now()],
    );
  }

  private async scheduleDeliveryRetry(
    delivery: DeliveryRow,
    errorCode: string,
    leaseId: string,
    leaseGeneration: number,
  ): Promise<boolean> {
    const attempts = delivery.attempts + 1;
    if (attempts >= maxAttempts) return this.markDeliveryDead(delivery, errorCode, leaseId);
    const now = this.now();
    const delayMs = Math.min(60 * 60 * 1000, 2 ** Math.max(0, attempts - 1) * 30_000);
    const updated = await this.pool.query(
      `UPDATE social_notification_deliveries
       SET status = 'RETRY', attempts = $4, next_attempt_at = $5, lease_id = NULL, lease_expires_at = NULL,
           last_error_code = $6, updated_at = $7
       WHERE id = $1 AND status = 'PROCESSING' AND lease_id = $2 AND lease_generation = $3`,
      [delivery.id, leaseId, leaseGeneration, attempts, new Date(now.getTime() + delayMs), errorCode, now],
    );
    return updated.rowCount === 1;
  }

  private async markOutboxDeadFenced(client: Queryable, outbox: OutboxRow, errorCode: string): Promise<void> {
    await client.query(
      `UPDATE notification_outbox
       SET status = 'DEAD', lease_id = NULL, lease_expires_at = NULL, last_error_code = $4, updated_at = $5
       WHERE id = $1 AND lease_id = $2 AND lease_generation = $3`,
      [outbox.id, outbox.lease_id, outbox.lease_generation, errorCode, this.now()],
    );
  }

  private async refreshOutboxFromDeliveries(outboxId: string, leaseId?: string, leaseGeneration?: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.refreshOutboxFromDeliveriesInTransaction(client, outboxId, true, leaseId, leaseGeneration);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async refreshOutboxFromDeliveriesInTransaction(
    client: Queryable,
    outboxId: string,
    fenced: boolean,
    leaseId?: string,
    leaseGeneration?: number,
  ): Promise<void> {
    const outbox = await client.query<{ id: string; lease_id: string | null; lease_generation: number; status: string; lease_expires_at: Date | null }>(
      'SELECT id, lease_id, lease_generation, status, lease_expires_at FROM notification_outbox WHERE id = $1 FOR UPDATE',
      [outboxId],
    );
    if (outbox.rowCount === 0) return;
    if (fenced && leaseId && leaseGeneration !== undefined) {
      const row = outbox.rows[0]!;
      if (row.lease_id !== leaseId || row.lease_generation !== leaseGeneration) return;
    }
    const aggregate = await client.query<{
      awaiting: number;
      processing: number;
      retry: number;
      sent: number;
      dead: number;
      cancelled: number;
      next_attempt_at: Date | null;
      last_error_code: string | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE status = 'AWAITING_RECEIPT')::integer AS awaiting,
         count(*) FILTER (WHERE status = 'PROCESSING')::integer AS processing,
         count(*) FILTER (WHERE status = 'RETRY')::integer AS retry,
         count(*) FILTER (WHERE status = 'SENT')::integer AS sent,
         count(*) FILTER (WHERE status = 'DEAD')::integer AS dead,
         count(*) FILTER (WHERE status = 'CANCELLED')::integer AS cancelled,
         min(next_attempt_at) FILTER (WHERE status = 'RETRY') AS next_attempt_at,
         max(last_error_code) FILTER (WHERE status IN ('RETRY', 'DEAD', 'CANCELLED')) AS last_error_code
       FROM social_notification_deliveries
       WHERE outbox_id = $1`,
      [outboxId],
    );
    await this.beforeReceiptAggregateUpdate?.();
    const row = aggregate.rows[0];
    if (!row) return;
    let status: 'PROCESSING' | 'AWAITING_RECEIPT' | 'RETRY' | 'SENT' | 'DEAD' | 'CANCELLED';
    let nextAttemptAt = this.now();
    if (row.processing > 0) status = 'PROCESSING';
    else if (row.retry > 0) {
      status = 'RETRY';
      nextAttemptAt = row.next_attempt_at ?? nextAttemptAt;
    } else if (row.awaiting > 0) status = 'AWAITING_RECEIPT';
    else if (row.sent > 0) status = 'SENT';
    else if (row.cancelled > 0 && row.dead === 0) status = 'CANCELLED';
    else status = 'DEAD';
    const shouldClearLease = fenced || row.processing === 0;
    await client.query(
      `UPDATE notification_outbox
       SET status = $2, next_attempt_at = $3,
           lease_id = CASE WHEN $6::boolean THEN NULL ELSE lease_id END,
           lease_expires_at = CASE WHEN $6::boolean THEN NULL ELSE lease_expires_at END,
           last_error_code = $4, updated_at = $5
       WHERE id = $1`,
      [outboxId, status, nextAttemptAt, row.last_error_code, this.now(), shouldClearLease],
    );
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof AccountLifecycleError) throw new SocialError('ACCOUNT_DELETED');
      throw error;
    } finally {
      client.release();
    }
  }
}

function parseRequestId(value: unknown): string {
  const requestId = validateRequestId(value);
  if (!requestId) throw new SocialError('INVALID_REQUEST');
  return requestId;
}

async function lockPushDevice(client: Queryable, appVariant: SocialAppVariant, deviceId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`push-token:${appVariant}:${deviceId}`]);
}

function normalizeBindingRevision(revision: number | undefined): number | undefined {
  if (revision === undefined) return undefined;
  if (!Number.isSafeInteger(revision) || revision <= 0 || revision > 2_147_483_647) throw new SocialError('INVALID_REQUEST');
  return revision;
}

function parseToken(value: unknown): string {
  if (typeof value !== 'string') throw new SocialError('SOCIAL_PUSH_TOKEN_INVALID');
  const token = value.trim();
  if (token.length < 1 || token.length > tokenMaxLength) throw new SocialError('SOCIAL_PUSH_TOKEN_INVALID');
  return token;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new SocialError('INVALID_REQUEST');
  return limit;
}

function otherAccount(friendship: FriendshipRow, accountId: string): string {
  return friendship.account_low === accountId ? friendship.account_high : friendship.account_low;
}

function mailSelectSql(whereAndOrder: string): string {
  return `
    SELECT mail.*,
           sender_profile.nickname AS from_nickname,
           receiver_profile.nickname AS to_nickname
    FROM social_mail mail
    LEFT JOIN explorer_profiles sender_profile ON sender_profile.account_id = mail.sender_account_id
    LEFT JOIN explorer_profiles receiver_profile ON receiver_profile.account_id = mail.receiver_account_id
    ${whereAndOrder}
  `;
}

function summarizeMail(row: MailRow, accountId: string): MailSummary {
  return {
    id: row.id,
    type: row.type,
    direction: row.receiver_account_id === accountId ? 'INBOX' : 'SENT',
    title: row.title,
    preview: row.body.slice(0, 80),
    fromNickname: row.from_nickname ?? (row.sender_account_id ? defaultNicknamePrefix : null),
    toNickname: row.to_nickname ?? defaultNicknamePrefix,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function detailFromRow(row: MailRow, accountId: string): MailDetail {
  const base = summarizeMail(row, accountId);
  const invitation = mealInvitationFromPayload(row.payload);
  return {
    ...base,
    body: row.body,
    ...(invitation ? { mealInvitation: invitation } : {}),
  };
}

function mealInvitationFromPayload(payload: JsonObject): MealInvitationView | undefined {
  const candidate = payload.mealInvitation;
  if (!candidate || typeof candidate !== 'object') return undefined;
  return candidate as MealInvitationView;
}

function invitationToParsed(row: InvitationRow) {
  return {
    merchantId: row.merchant_id,
    date: dateString(row.invite_date),
    schedule: row.schedule_kind === 'CONFIRMED'
      ? { kind: 'CONFIRMED' as const, time: row.confirmed_time! }
      : { kind: 'RANGE' as const, startTime: row.range_start_time!, endTime: row.range_end_time! },
  };
}

function sameParsedInvitation(parsed: ParsedMealInvitation, row: InvitationRow): boolean {
  if (parsed.merchantId !== row.merchant_id || parsed.date !== dateString(row.invite_date)) return false;
  if (parsed.schedule.kind !== row.schedule_kind) return false;
  if (parsed.schedule.kind === 'CONFIRMED') return parsed.schedule.time === timeString(row.confirmed_time);
  return parsed.schedule.startTime === timeString(row.range_start_time)
    && parsed.schedule.endTime === timeString(row.range_end_time);
}

function isInvitationExpired(row: InvitationRow, now: Date): boolean {
  if (row.status !== 'PENDING') return false;
  const invite = invitationToParsed(row);
  const today = kstBusinessDate(now);
  if (invite.date < today) return true;
  if (invite.date > today) return false;
  const currentTime = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16);
  const expiresAt = invite.schedule.kind === 'CONFIRMED' ? invite.schedule.time : invite.schedule.endTime;
  return compareHHmm(currentTime, expiresAt) > 0;
}

function timeString(value: string | null): string | null {
  return value?.slice(0, 5) ?? null;
}

function serializeInvitation(row: InvitationRow): MealInvitationView {
  return {
    invitationId: row.id,
    merchant: { id: row.merchant_id, name: row.merchant_name, address: row.merchant_address },
    date: dateString(row.invite_date),
    schedule: row.schedule_kind === 'CONFIRMED'
      ? { kind: 'CONFIRMED', time: row.confirmed_time! }
      : { kind: 'RANGE', startTime: row.range_start_time!, endTime: row.range_end_time! },
    status: row.status,
    selectedTime: row.selected_time,
    respondedAt: row.responded_at?.toISOString() ?? null,
  };
}

function dateString(value: Date | string): string {
  if (!(value instanceof Date)) return value;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function notificationPayload(payload: JsonObject): { title: string; body: string; data: Record<string, string> } {
  if (typeof payload.title === 'string' && typeof payload.body === 'string' && isStringRecord(payload.data)) {
    return { title: payload.title, body: payload.body, data: payload.data };
  }
  return { title: '새 우편이 도착했어요', body: '친구 소식이 있어요', data: {} };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object'
    && Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string');
}
