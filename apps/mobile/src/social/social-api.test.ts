import assert from 'node:assert/strict';
import test from 'node:test';

import { createSocialApiClient, parseMailDetail, parseSocialSnapshot, SocialApiError } from './social-api';

const credential = { kind: 'demo' as const, accountId: 'account-a', allowInsecureReauthentication: false };

test('parses the social snapshot contract without account IDs or emails', () => {
  const snapshot = parseSocialSnapshot({
    businessDate: '2026-10-05',
    friendshipGift: {
      sendLimit: 5,
      sendCount: 2,
      sendRemaining: 3,
      rewardDailyCap: 25,
      rewardEarnedToday: 10,
      rewardRemainingToday: 15,
      rewardPerAction: 5,
    },
    unreadMailCount: 1,
    friends: [{
      friendshipId: '11111111-1111-4111-8111-111111111111',
      nickname: '친구',
      gift: {
        pendingGiftId: '22222222-2222-4222-8222-222222222222',
        pendingDirection: 'RECEIVED',
        canSend: false,
        canReceive: true,
      },
      unreadMailCount: 1,
    }],
  });

  assert.equal(snapshot.friendshipGift.sendLimit, 5);
  assert.equal(snapshot.friends[0]?.gift.canReceive, true);
});

test('rejects malformed social replies instead of rendering private accidental fields', () => {
  assert.throws(() => parseSocialSnapshot({
    businessDate: '2026-10-05',
    friendshipGift: {
      sendLimit: 4,
      sendCount: 0,
      sendRemaining: 4,
      rewardDailyCap: 25,
      rewardEarnedToday: 0,
      rewardRemainingToday: 25,
      rewardPerAction: 5,
    },
    unreadMailCount: 0,
    friends: [],
  }), /INVALID_RESPONSE/);
});

test('parses range meal invitation detail with sender/receiver-only presentation fields', () => {
  const detail = parseMailDetail({
    id: '33333333-3333-4333-8333-333333333333',
    type: 'MEAL_INVITATION',
    direction: 'INBOX',
    title: '같이 밥 먹기',
    preview: '초대가 도착했어요',
    fromNickname: '친구',
    toNickname: null,
    readAt: null,
    createdAt: '2026-10-05T01:00:00.000Z',
    body: '친구가 식사 초대를 보냈어요.',
    mealInvitation: {
      invitationId: '44444444-4444-4444-8444-444444444444',
      merchant: { id: 'merchant-a', name: '월계분식', address: '서울 노원구 월계로 1' },
      date: '2026-10-06',
      schedule: { kind: 'RANGE', startTime: '12:00', endTime: '14:00' },
      status: 'PENDING',
      selectedTime: null,
      respondedAt: null,
    },
  });

  assert.equal(detail.mealInvitation?.schedule.kind, 'RANGE');
  assert.equal(detail.mealInvitation?.merchant.address, '서울 노원구 월계로 1');
});

test('social client sends every mutating route with a requestId and credential headers', async () => {
  const calls: { url: string; method?: string; auth: string | null; body?: unknown }[] = [];
  const client = createSocialApiClient({
    apiUrl: 'https://api.example.test/',
    credential,
    fetcher: async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method,
        auth: new Headers(init?.headers).get('x-account-id'),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json({
        giftId: '55555555-5555-4555-8555-555555555555',
        friendshipId: '11111111-1111-4111-8111-111111111111',
        status: 'PENDING',
        direction: 'SENT',
        senderReward: 5,
        receiverReward: 0,
        rewardRemainingToday: 20,
        sendRemaining: 4,
        replayed: false,
        createdAt: '2026-10-05T01:00:00.000Z',
        receivedAt: null,
      });
    },
  });

  await client.sendFriendshipGift({ friendshipId: '11111111-1111-4111-8111-111111111111', requestId: 'request-1' });

  assert.deepEqual(calls, [{
    url: 'https://api.example.test/me/friends/11111111-1111-4111-8111-111111111111/gifts',
    method: 'POST',
    auth: 'account-a',
    body: { requestId: 'request-1' },
  }]);
});

test('social client maps server errors without leaking raw response details', async () => {
  const client = createSocialApiClient({
    apiUrl: 'https://api.example.test',
    credential,
    fetcher: async () => Response.json({ code: 'SOCIAL_FORBIDDEN', email: 'hidden@example.test' }, { status: 403 }),
  });

  await assert.rejects(client.getSocial(), (error) => error instanceof SocialApiError && error.code === 'SOCIAL_FORBIDDEN');
});
