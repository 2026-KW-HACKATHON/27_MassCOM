import assert from 'node:assert/strict';
import { type AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, type ConsentService } from './account-consent.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { SocialError, type MailDetail, type MailList, type SocialService, type SocialSnapshot } from './social.js';
import { InMemoryChallengeStore, WalletChallengeService } from './wallet-challenge-service.js';

type JsonResponse = {
  status: number;
  headers: Headers;
  body: unknown;
};

type Fixture = {
  baseUrl: string;
  calls: unknown[];
  consentCalls: string[];
};

const snapshot: SocialSnapshot = {
  businessDate: '2026-10-05',
  friendshipGift: {
    sendLimit: 5,
    sendCount: 0,
    sendRemaining: 5,
    rewardDailyCap: 25,
    rewardEarnedToday: 0,
    rewardRemainingToday: 25,
    rewardPerAction: 5,
  },
  friends: [],
  unreadMailCount: 0,
};

const mailDetail = (id: string): MailDetail => ({
  id,
  type: 'MESSAGE',
  direction: 'INBOX',
  title: '쪽지',
  preview: '안녕',
  fromNickname: 'Alice',
  toNickname: 'Bob',
  readAt: null,
  createdAt: '2026-10-05T00:00:00.000Z',
  body: '안녕',
});

const mailList: MailList = { mail: [mailDetail('mail-1')], nextCursor: null };

function challengeService(): WalletChallengeService {
  return new WalletChallengeService({
    store: new InMemoryChallengeStore(),
    domain: 'api.masscom.local',
    uri: 'https://api.masscom.local/wallet/verify',
    chainId: 84532,
    ttlMs: 300_000,
    nonce: () => 'socialhttpnonce1',
    challengeId: () => 'social-http-challenge',
  });
}

function consentFixture(requiredAccounts = new Set<string>()): ConsentService & { calls: string[] } {
  const calls: string[] = [];
  return {
    appSource: 'ANDROID',
    calls,
    status: async (accountId) => {
      calls.push(accountId);
      return {
        required: requiredAccounts.has(accountId),
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
      };
    },
    record: async () => {
      throw new Error('social HTTP tests must not record consent implicitly');
    },
  };
}

function socialFixture(calls: unknown[], overrides: Partial<SocialService> = {}): SocialService {
  return {
    getSocial: async (accountId) => {
      calls.push({ method: 'getSocial', accountId });
      return snapshot;
    },
    sendFriendshipGift: async (input) => {
      calls.push({ method: 'sendFriendshipGift', input });
      return {
        giftId: 'gift-1',
        friendshipId: input.friendshipId,
        status: 'PENDING',
        direction: 'SENT',
        senderReward: 0,
        receiverReward: 0,
        rewardRemainingToday: 25,
        sendRemaining: 4,
        replayed: false,
        createdAt: '2026-10-05T00:00:00.000Z',
        receivedAt: null,
      };
    },
    receiveFriendshipGift: async (input) => {
      calls.push({ method: 'receiveFriendshipGift', input });
      return {
        giftId: input.giftId,
        friendshipId: 'friendship-1',
        status: 'RECEIVED',
        direction: 'RECEIVED',
        senderReward: 0,
        receiverReward: 5,
        rewardRemainingToday: 20,
        sendRemaining: 5,
        replayed: false,
        createdAt: '2026-10-05T00:00:00.000Z',
        receivedAt: '2026-10-05T00:00:01.000Z',
      };
    },
    listMail: async (input) => {
      calls.push({ method: 'listMail', input });
      return mailList;
    },
    getMail: async (input) => {
      calls.push({ method: 'getMail', input });
      return mailDetail(input.mailId);
    },
    markMailRead: async (input) => {
      calls.push({ method: 'markMailRead', input });
      return { ...mailDetail(input.mailId), readAt: '2026-10-05T00:00:02.000Z' };
    },
    sendMessage: async (input) => {
      calls.push({ method: 'sendMessage', input });
      return { ...mailDetail('message-1'), direction: 'SENT', body: input.body, replayed: false };
    },
    createMealInvitation: async (input) => {
      calls.push({ method: 'createMealInvitation', input });
      return { ...mailDetail('invitation-1'), type: 'MEAL_INVITATION', replayed: false };
    },
    respondToMealInvitation: async (input) => {
      calls.push({ method: 'respondToMealInvitation', input });
      return { invitation: {
        invitationId: input.invitationId,
        merchant: { id: 'merchant-1', name: '가게', address: '서울' },
        date: '2026-10-05',
        schedule: { kind: 'CONFIRMED', time: '12:00' },
        status: input.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED',
        selectedTime: input.selectedTime ?? null,
        respondedAt: '2026-10-05T00:00:03.000Z',
      }, mail: mailDetail('response-1'), replayed: false };
    },
    registerPushToken: async (input) => {
      calls.push({ method: 'registerPushToken', input });
      return { status: 'REGISTERED' };
    },
    unregisterPushToken: async (input) => {
      calls.push({ method: 'unregisterPushToken', input });
      return { status: 'REMOVED' };
    },
    flushNotifications: async () => ({ claimed: 0, sent: 0, retry: 0, dead: 0, skipped: 0 }),
    reconcileReceipts: async () => ({ checked: 0, delivered: 0, retry: 0, dead: 0 }),
    ...overrides,
  };
}

async function fixture(t: TestContext, options: {
  consentRequired?: Set<string>;
  social?: (calls: unknown[]) => SocialService;
} = {}): Promise<Fixture> {
  const calls: unknown[] = [];
  const consent = consentFixture(options.consentRequired);
  const social = options.social?.(calls) ?? socialFixture(calls);
  const args: Parameters<typeof createApiServer> = [challengeService(), developmentHeaderAccountResolver];
  args[26] = consent;
  args[40] = social;
  assert.equal(args[0] instanceof WalletChallengeService, true);
  assert.equal(args[1], developmentHeaderAccountResolver);
  assert.equal(args[26], consent);
  assert.equal(args[40], social);
  const server = createApiServer(...args);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, calls, consentCalls: consent.calls };
}

async function request(baseUrl: string, method: string, path: string, options: {
  accountId?: string;
  body?: string;
  headers?: Record<string, string>;
} = {}): Promise<JsonResponse> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.accountId !== undefined) headers['x-account-id'] = options.accountId;
  if (options.body !== undefined && headers['content-type'] === undefined) headers['content-type'] = 'application/json';
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) init.body = options.body;
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) as unknown : undefined };
}

function json(body: object): string {
  return JSON.stringify(body);
}

test('social HTTP requires account auth and current consent before service access', async (t) => {
  const { baseUrl, calls, consentCalls } = await fixture(t, { consentRequired: new Set(['stale']) });

  const missingAuth = await request(baseUrl, 'GET', '/me/social');
  assert.equal(missingAuth.status, 401);
  assert.deepEqual(missingAuth.body, { code: 'ACCOUNT_REQUIRED' });
  assert.equal(missingAuth.headers.get('cache-control'), 'no-store');

  const staleConsent = await request(baseUrl, 'GET', '/me/social', { accountId: 'stale' });
  assert.equal(staleConsent.status, 403);
  assert.deepEqual(staleConsent.body, { code: 'CONSENT_REQUIRED' });

  const ok = await request(baseUrl, 'GET', '/me/social', { accountId: 'current' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.deepEqual(consentCalls, ['stale', 'current']);
  assert.deepEqual(calls, [{ method: 'getSocial', accountId: 'current' }]);
});

test('social HTTP rejects unknown routes and malformed JSON without entering social service', async (t) => {
  const { baseUrl, calls } = await fixture(t);

  const unknown = await request(baseUrl, 'GET', '/me/social/unknown', { accountId: 'alice' });
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { code: 'NOT_FOUND' });

  const invalidJson = await request(baseUrl, 'POST', '/me/friends/friend-1/messages', {
    accountId: 'alice',
    body: '{"requestId":',
  });
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(invalidJson.body, { code: 'INVALID_JSON_BODY' });
  assert.deepEqual(calls, []);
});

test('social HTTP accepts encoded path ids and rejects body account spoofing or unknown fields', async (t) => {
  const { baseUrl, calls } = await fixture(t);

  const spoofed = await request(baseUrl, 'POST', '/me/friends/friend%2Fencoded/messages', {
    accountId: 'alice',
    body: json({ requestId: 'msg-1', body: '안녕', accountId: 'mallory' }),
  });
  assert.equal(spoofed.status, 400);
  assert.deepEqual(spoofed.body, { code: 'INVALID_REQUEST' });

  const valid = await request(baseUrl, 'POST', '/me/friends/friend%2Fencoded/messages', {
    accountId: 'alice',
    body: json({ requestId: 'msg-2', body: '안녕' }),
  });
  assert.equal(valid.status, 201);
  assert.deepEqual(calls, [{
    method: 'sendMessage',
    input: { accountId: 'alice', friendshipId: 'friend/encoded', requestId: 'msg-2', body: '안녕' },
  }]);
});

test('social HTTP returns 200 for replayed message and invitation requests', async (t) => {
  const { baseUrl } = await fixture(t, {
    social: (calls) => socialFixture(calls, {
      sendMessage: async () => ({ ...mailDetail('message-replay'), direction: 'SENT', body: 'replay', replayed: true }),
      createMealInvitation: async () => ({ ...mailDetail('invite-replay'), type: 'MEAL_INVITATION', replayed: true }),
    }),
  });

  const messageReplay = await request(baseUrl, 'POST', '/me/friends/friend-1/messages', {
    accountId: 'alice',
    body: json({ requestId: 'msg-replay', body: 'replay' }),
  });
  assert.equal(messageReplay.status, 200);

  const inviteReplay = await request(baseUrl, 'POST', '/me/friends/friend-1/meal-invitations', {
    accountId: 'alice',
    body: json({ requestId: 'invite-replay', merchantId: 'shop-a', date: '2026-10-05', kind: 'CONFIRMED', time: '12:00' }),
  });
  assert.equal(inviteReplay.status, 200);
});

test('social HTTP validates decisions and encoded path syntax at the route boundary', async (t) => {
  const { baseUrl, calls } = await fixture(t);

  const badDecision = await request(baseUrl, 'POST', '/me/meal-invitations/invite-1/respond', {
    accountId: 'alice',
    body: json({ requestId: 'respond-1', decision: 'MAYBE' }),
  });
  assert.equal(badDecision.status, 400);
  assert.deepEqual(badDecision.body, { code: 'INVALID_REQUEST' });

  const badPath = await request(baseUrl, 'POST', '/me/meal-invitations/%E0%A4%A/respond', {
    accountId: 'alice',
    body: json({ requestId: 'respond-2', decision: 'ACCEPT' }),
  });
  assert.equal(badPath.status, 400);
  assert.deepEqual(badPath.body, { code: 'INVALID_PATH_PARAMETER' });
  assert.deepEqual(calls, []);
});

test('DELETE /me/push-tokens stays available when renewed consent is required', async (t) => {
  const { baseUrl, calls, consentCalls } = await fixture(t, { consentRequired: new Set(['stale']) });

  const response = await request(baseUrl, 'DELETE', '/me/push-tokens', {
    accountId: 'stale',
    body: json({ token: 'ExpoPushToken[stale]', appVariant: 'ANDROID' }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'REMOVED' });
  assert.deepEqual(consentCalls, []);
  assert.deepEqual(calls, [{
    method: 'unregisterPushToken',
    input: { accountId: 'stale', token: 'ExpoPushToken[stale]', appVariant: 'ANDROID' },
  }]);
});


test('push token HTTP accepts revision-fenced register/delete and validates revision shape', async (t) => {
  const { baseUrl, calls } = await fixture(t);

  const registered = await request(baseUrl, 'POST', '/me/push-tokens', {
    accountId: 'alice',
    body: json({ token: 'ExpoPushToken[alice]', appVariant: 'ANDROID', deviceId: 'install-1', bindingRevision: 1 }),
  });
  assert.equal(registered.status, 200);

  const removed = await request(baseUrl, 'DELETE', '/me/push-tokens', {
    accountId: 'alice',
    body: json({ token: 'ExpoPushToken[alice]', appVariant: 'ANDROID', deviceId: 'install-1', bindingRevision: 2 }),
  });
  assert.equal(removed.status, 200);

  const badRevision = await request(baseUrl, 'POST', '/me/push-tokens', {
    accountId: 'alice',
    body: json({ token: 'ExpoPushToken[alice]', appVariant: 'ANDROID', deviceId: 'install-1', bindingRevision: 0 }),
  });
  assert.equal(badRevision.status, 400);
  assert.deepEqual(badRevision.body, { code: 'INVALID_REQUEST' });

  const missingDevice = await request(baseUrl, 'DELETE', '/me/push-tokens', {
    accountId: 'alice',
    body: json({ token: 'ExpoPushToken[alice]', appVariant: 'ANDROID', bindingRevision: 3 }),
  });
  assert.equal(missingDevice.status, 400);
  assert.deepEqual(missingDevice.body, { code: 'INVALID_REQUEST' });

  const tooLarge = await request(baseUrl, 'POST', '/me/push-tokens', {
    accountId: 'alice',
    body: json({ token: 'ExpoPushToken[alice]', appVariant: 'ANDROID', deviceId: 'install-1', bindingRevision: 2_147_483_648 }),
  });
  assert.equal(tooLarge.status, 400);
  assert.deepEqual(tooLarge.body, { code: 'INVALID_REQUEST' });

  assert.deepEqual(calls.slice(0, 2), [
    { method: 'registerPushToken', input: { accountId: 'alice', token: 'ExpoPushToken[alice]', appVariant: 'ANDROID', deviceId: 'install-1', bindingRevision: 1 } },
    { method: 'unregisterPushToken', input: { accountId: 'alice', token: 'ExpoPushToken[alice]', appVariant: 'ANDROID', deviceId: 'install-1', bindingRevision: 2 } },
  ]);
});

test('social HTTP maps service errors to 403, 404, 409, and 429 with Retry-After', async (t) => {
  const { baseUrl } = await fixture(t, { social: (calls) => socialFixture(calls, {
    sendFriendshipGift: async ({ requestId }) => {
      if (requestId === 'forbidden') throw new SocialError('SOCIAL_FORBIDDEN');
      if (requestId === 'missing') throw new SocialError('SOCIAL_FRIENDSHIP_NOT_FOUND');
      if (requestId === 'conflict') throw new SocialError('SOCIAL_REQUEST_CONFLICT');
      throw new SocialError('SOCIAL_SEND_LIMIT_REACHED', 17);
    },
  }) });

  const cases = [
    ['forbidden', 403, { code: 'SOCIAL_FORBIDDEN' }, null],
    ['missing', 404, { code: 'SOCIAL_FRIENDSHIP_NOT_FOUND' }, null],
    ['conflict', 409, { code: 'SOCIAL_REQUEST_CONFLICT' }, null],
    ['limited', 429, { code: 'SOCIAL_SEND_LIMIT_REACHED' }, '17'],
  ] as const;

  for (const [requestId, status, body, retryAfter] of cases) {
    const response = await request(baseUrl, 'POST', '/me/friends/friend-1/gifts', {
      accountId: `account-${requestId}`,
      body: json({ requestId }),
    });
    assert.equal(response.status, status);
    assert.deepEqual(response.body, body);
    assert.equal(response.headers.get('retry-after'), retryAfter);
  }
});

test('social HTTP enforces the per-account 60 per minute write limit before social service entry', async (t) => {
  const { baseUrl, calls } = await fixture(t);

  for (let index = 0; index < 60; index += 1) {
    const response = await request(baseUrl, 'POST', '/me/push-tokens', {
      accountId: 'writer',
      body: json({ token: `ExpoPushToken[${index}]`, appVariant: 'ANDROID', deviceId: `device-${index}` }),
    });
    assert.equal(response.status, 200);
  }

  const limited = await request(baseUrl, 'POST', '/me/push-tokens', {
    accountId: 'writer',
    body: json({ token: 'ExpoPushToken[blocked]', appVariant: 'ANDROID' }),
  });
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.body, { code: 'SOCIAL_WRITE_RATE_LIMITED' });
  assert.match(limited.headers.get('retry-after') ?? '', /^\d+$/);
  assert.equal(limited.headers.get('cache-control'), 'no-store');
  assert.equal(calls.filter((call) => (call as { method?: string }).method === 'registerPushToken').length, 60);
});
