import type { FriendStamp } from '@/friends/friends-api';

/** 서버가 공개 목록에 있는 가게에만 준 ID로 상세 화면을 연결한다. */
export function friendStampDestination(stamp: FriendStamp) {
  if (stamp.merchantId === null) return undefined;
  return {
    pathname: '/merchants/[merchantId]' as const,
    params: { merchantId: stamp.merchantId, from: 'friend' as const },
  };
}
