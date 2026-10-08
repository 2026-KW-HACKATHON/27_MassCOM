import {
  createSocialRequestId,
  type SocialApiClient,
  type SocialFriend,
} from '@/social/social-api';

export type FriendHeart = {
  color: 'pink' | 'gray' | 'gold';
  action: 'send' | 'receive' | null;
  label: string;
};

export function friendHeart(friend: SocialFriend | undefined, sendRemaining: number): FriendHeart {
  if (!friend) return { color: 'gray', action: null, label: '우정 상태를 불러오는 중' };
  if (friend.gift.canReceive && friend.gift.pendingGiftId && friend.gift.pendingDirection === 'RECEIVED') {
    return { color: 'gold', action: 'receive', label: sendRemaining > 0 ? '우정 받고 답장 보내기' : '우정 받기, 오늘 답장 보내기 한도 도달' };
  }
  if (friend.gift.pendingDirection === 'SENT') return { color: 'gray', action: null, label: '친구가 우정을 받을 때까지 기다리는 중' };
  if (friend.gift.canSend && sendRemaining > 0) return { color: 'pink', action: 'send', label: '우정 보내기' };
  return { color: 'gray', action: null, label: '오늘 보낼 수 있는 우정을 모두 보냈어요' };
}

export function friendGiftVersion(friend?: SocialFriend): string {
  return JSON.stringify(friend?.gift);
}

/** A failed response keeps its request ID: a retry can recover the first result without awarding again. */
export function createFriendHeartAction(
  api: Pick<SocialApiClient, 'sendFriendshipGift' | 'receiveAndReplyFriendshipGift'>,
  requestId = createSocialRequestId,
) {
  let busy = false;
  let pending: { key: string; requestId: string } | undefined;
  return async (friend: SocialFriend, sendRemaining: number): Promise<{ notice: string } | null> => {
    const heart = friendHeart(friend, sendRemaining);
    if (busy || !heart.action) return null;
    const action = heart.action;
    const key = action === 'receive' ? `receive:${friend.gift.pendingGiftId}` : `send:${friend.friendshipId}`;
    if (pending?.key !== key) pending = { key, requestId: requestId(`friendship-${action}`) };
    busy = true;
    try {
      let reward: number;
      let replayed: boolean;
      let description: string;
      if (action === 'receive') {
        const result = await api.receiveAndReplyFriendshipGift({ giftId: friend.gift.pendingGiftId!, requestId: pending.requestId });
        reward = result.received.receiverReward + (result.reply?.senderReward ?? 0);
        replayed = result.received.replayed;
        description = result.reply ? '우정을 받고 답장을 보냈어요.' : '우정을 받았어요.';
      } else {
        const result = await api.sendFriendshipGift({ friendshipId: friend.friendshipId, requestId: pending.requestId });
        reward = result.senderReward;
        replayed = result.replayed;
        description = '우정을 보냈어요.';
      }
      pending = undefined;
      if (replayed) return { notice: `이미 처리된 우정이에요. 이 요청으로 받은 마일리지는 ${reward}P예요.` };
      return { notice: `${description} ${reward > 0 ? `마일리지 ${reward}P를 받았어요.` : '오늘 우정 보상 한도는 모두 채웠어요.'}` };
    } finally {
      busy = false;
    }
  };
}
