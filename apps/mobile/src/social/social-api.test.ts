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

const receivedGift = {
  giftId: '22222222-2222-4222-8222-222222222222',
  friendshipId: '11111111-1111-4111-8111-111111111111',
  status: 'RECEIVED', direction: 'RECEIVED', senderReward: 5, receiverReward: 5,
  rewardRemainingToday: 15, sendRemaining: 3, replayed: false,
  createdAt: '2026-10-09T01:00:00.000Z', receivedAt: '2026-10-09T02:00:00.000Z',
};
const replyGift = {
  ...receivedGift, giftId: '33333333-3333-4333-8333-333333333333',
  status: 'PENDING', direction: 'SENT', receiverReward: 0, receivedAt: null,
};

test('금색 하트는 인증과 재시도 키를 담은 원자 받기/답장 요청 한 개를 보낸다', async () => {
  const calls: { url: string; method?: string; accountId: string | null; body: unknown }[] = [];
  const client = createSocialApiClient({
    apiUrl: 'https://api.example.test/', credential,
    fetcher: async (input, init) => {
      calls.push({ url: String(input), method: init?.method, accountId: new Headers(init?.headers).get('x-account-id'), body: JSON.parse(String(init?.body)) });
      return Response.json({ received: receivedGift, reply: replyGift });
    },
  });
  const result = await client.receiveAndReplyFriendshipGift({ giftId: receivedGift.giftId, requestId: 'atomic-retry-key' });
  assert.equal(result.received.receiverReward + result.reply!.senderReward, 10);
  assert.deepEqual(calls, [{
    url: `https://api.example.test/me/friendship-gifts/${receivedGift.giftId}/receive-and-reply`,
    method: 'POST', accountId: 'account-a', body: { requestId: 'atomic-retry-key' },
  }]);
});

test('답장 보내기 한도를 소진하면 null 답장과 받기 보상을 파싱한다', async () => {
  const client = createSocialApiClient({
    apiUrl: 'https://api.example.test', credential,
    fetcher: async () => Response.json({ received: { ...receivedGift, sendRemaining: 0 }, reply: null }),
  });
  const result = await client.receiveAndReplyFriendshipGift({ giftId: receivedGift.giftId, requestId: 'receive-only' });
  assert.equal(result.reply, null);
  assert.equal(result.received.receiverReward, 5);
});

test('답장을 상대가 받은 뒤 재시도해도 수령 완료된 답장과 원래 보상을 복구한다', async () => {
  const replyReceivedAt = '2026-10-09T02:01:00.000Z';
  const client = createSocialApiClient({
    apiUrl: 'https://api.example.test', credential,
    fetcher: async () => Response.json({
      received: { ...receivedGift, replayed: true },
      reply: { ...replyGift, status: 'RECEIVED', receiverReward: 5, receivedAt: replyReceivedAt, replayed: true },
    }),
  });
  const result = await client.receiveAndReplyFriendshipGift({ giftId: receivedGift.giftId, requestId: 'lost-response-retry' });
  assert.equal(result.received.replayed, true);
  assert.equal(result.reply?.replayed, true);
  assert.equal(result.reply?.direction, 'SENT');
  assert.equal(result.reply?.status, 'RECEIVED');
  assert.equal(result.reply?.receivedAt, replyReceivedAt);
  assert.equal(result.received.receiverReward + result.reply!.senderReward, 10);
});

test('받기/답장 응답은 누락·다른 친구·잘못된 방향을 거부한다', async () => {
  for (const payload of [
    { received: receivedGift },
    { received: { ...receivedGift, direction: 'SENT' }, reply: replyGift },
    { received: receivedGift, reply: { ...replyGift, direction: 'RECEIVED' } },
    { received: receivedGift, reply: { ...replyGift, friendshipId: '44444444-4444-4444-8444-444444444444' } },
    { received: receivedGift, reply: { ...replyGift, giftId: receivedGift.giftId } },
    { received: { ...receivedGift, receivedAt: null }, reply: replyGift },
    { received: receivedGift, reply: { ...replyGift, status: 'RECEIVED', receivedAt: receivedGift.receivedAt } },
    { received: { ...receivedGift, replayed: true }, reply: { ...replyGift, status: 'RECEIVED', replayed: true } },
    { received: { ...receivedGift, replayed: true }, reply: { ...replyGift, status: 'RECEIVED', receivedAt: receivedGift.receivedAt } },
    { received: receivedGift, reply: { ...replyGift, replayed: true } },
    { received: receivedGift, reply: { ...replyGift, receivedAt: receivedGift.receivedAt } },
  ]) {
    const client = createSocialApiClient({ apiUrl: 'https://api.example.test', credential, fetcher: async () => Response.json(payload) });
    await assert.rejects(client.receiveAndReplyFriendshipGift({ giftId: receivedGift.giftId, requestId: 'invalid-response' }), /INVALID_RESPONSE/);
  }
});
