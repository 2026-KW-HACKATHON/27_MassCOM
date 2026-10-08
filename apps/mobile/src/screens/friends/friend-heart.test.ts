import assert from 'node:assert/strict';
import test from 'node:test';

import type { FriendshipGiftResult, SocialApiClient, SocialFriend } from '@/social/social-api';
import { createFriendHeartAction, friendHeart } from './friend-heart';

const friend: SocialFriend = {
  friendshipId: '11111111-1111-4111-8111-111111111111', nickname: '친구', unreadMailCount: 0,
  gift: { pendingGiftId: null, pendingDirection: null, canSend: true, canReceive: false },
};
const incoming: SocialFriend = {
  ...friend, gift: { pendingGiftId: '22222222-2222-4222-8222-222222222222', pendingDirection: 'RECEIVED', canSend: false, canReceive: true },
};
const gift: FriendshipGiftResult = {
  giftId: '33333333-3333-4333-8333-333333333333', friendshipId: friend.friendshipId,
  status: 'PENDING', direction: 'SENT', senderReward: 5, receiverReward: 0,
  rewardRemainingToday: 20, sendRemaining: 4, replayed: false,
  createdAt: '2026-10-09T01:00:00.000Z', receivedAt: null,
};
const received: FriendshipGiftResult = { ...gift, giftId: incoming.gift.pendingGiftId!, status: 'RECEIVED', direction: 'RECEIVED', receiverReward: 5, receivedAt: '2026-10-09T02:00:00.000Z' };
type HeartApi = Pick<SocialApiClient, 'sendFriendshipGift' | 'receiveAndReplyFriendshipGift'>;
function api(overrides: Partial<HeartApi> = {}): HeartApi {
  return { sendFriendshipGift: async () => gift, receiveAndReplyFriendshipGift: async () => ({ received, reply: gift }), ...overrides };
}

test('하트는 보내기 가능 시 분홍색, 상대 수령 대기와 한도 소진 시 회색이다', () => {
  assert.equal(friendHeart(friend, 5).color, 'pink');
  assert.equal(friendHeart(friend, 0).action, null);
  assert.equal(friendHeart(undefined, 5).action, null);
  const outgoing: SocialFriend = { ...friend, gift: { ...friend.gift, pendingGiftId: gift.giftId, pendingDirection: 'SENT' } };
  assert.deepEqual(friendHeart(outgoing, 5), { color: 'gray', action: null, label: '친구가 우정을 받을 때까지 기다리는 중' });
});

test('금색 하트는 보내기 한도를 소진해도 받기를 허용한다', async () => {
  assert.equal(friendHeart(incoming, 0).color, 'gold');
  assert.equal(friendHeart(incoming, 0).action, 'receive');
  let receives = 0;
  const run = createFriendHeartAction(api({ receiveAndReplyFriendshipGift: async () => { receives++; return { received, reply: null }; } }));
  assert.match((await run(incoming, 0))!.notice, /마일리지 5P/);
  assert.equal(receives, 1);
});

test('금색 하트 한 번으로 원자 받기/답장 API만 호출하고 실제 보상을 합산한다', async () => {
  for (const [receiveReward, sendReward, total] of [[5, 5, 10], [5, 0, 5], [0, 0, 0]]) {
    let receives = 0;
    const run = createFriendHeartAction(api({
      sendFriendshipGift: async () => { throw new Error('별도의 답장 보내기를 호출하면 안 됨'); },
      receiveAndReplyFriendshipGift: async () => {
        receives++;
        return { received: { ...received, receiverReward: receiveReward! }, reply: { ...gift, senderReward: sendReward! } };
      },
    }));
    const result = await run(incoming, 5);
    assert.match(result!.notice, total ? new RegExp(`마일리지 ${total}P`) : /오늘 우정 보상 한도는 모두 채웠어요/);
    assert.equal(receives, 1);
  }
});

test('빠른 중복 누름은 한 요청만 보내며 실패 재시도는 같은 요청 ID를 쓴다', async () => {
  const requestIds: string[] = [];
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let count = 0;
  const run = createFriendHeartAction(api({ sendFriendshipGift: async (input) => {
    requestIds.push(input.requestId);
    await waiting;
    if (++count === 1) throw new Error('NETWORK_ERROR');
    return { ...gift, replayed: true };
  } }), () => 'stable-request');
  const first = run(friend, 5);
  assert.equal(await run(friend, 5), null);
  release();
  await assert.rejects(first, /NETWORK_ERROR/);
  const replay = await run(friend, 5);
  assert.deepEqual(requestIds, ['stable-request', 'stable-request']);
  assert.match(replay!.notice, /이미 처리된 우정/);
  assert.doesNotMatch(replay!.notice, /5P를 받았어요/);
});

test('금색 하트 네트워크 재시도 키도 유지하고 다음 선물에는 새 키를 쓴다', async () => {
  const requests: { giftId: string; requestId: string }[] = [];
  let sequence = 0;
  const run = createFriendHeartAction(api({ receiveAndReplyFriendshipGift: async (input) => {
    requests.push(input);
    if (requests.length === 1) throw new Error('NETWORK_ERROR');
    return { received, reply: gift };
  } }), () => `request-${++sequence}`);
  await assert.rejects(run(incoming, 5), /NETWORK_ERROR/);
  await run(incoming, 5);
  await run({ ...incoming, gift: { ...incoming.gift, pendingGiftId: 'new-gift' } }, 5);
  assert.deepEqual(requests.map((entry) => entry.requestId), ['request-1', 'request-1', 'request-2']);
});
