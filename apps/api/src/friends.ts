import type { FriendsSnapshot, FriendView } from './friends-rules.js';

export type { FriendMeView, FriendsSnapshot, FriendView } from './friends-rules.js';

export type AddedFriend = { friend: FriendView; created: boolean };

export interface FriendService {
  list(accountId: string): Promise<FriendsSnapshot>;
  addByCode(input: { accountId: string; code: string }): Promise<AddedFriend>;
  addNeighbor?(input: { accountId: string; roomId: string }): Promise<AddedFriend>;
  remove(input: { accountId: string; friendshipId: string }): Promise<void>;
  rotateCode(accountId: string): Promise<{ code: string }>;
  setNickname(input: { accountId: string; nickname: string }): Promise<{ nickname: string }>;
  setProfile?(input: { accountId: string; nickname?: string; intro?: string }): Promise<{ nickname: string; intro: string }>;
}

export type FriendErrorCode =
  | 'FRIEND_SELF'
  | 'FRIEND_CODE_NOT_FOUND'
  | 'FRIEND_LIMIT'
  | 'FRIEND_CODE_RATE_LIMITED'
  | 'FRIEND_NOT_FOUND'
  | 'FRIEND_NEIGHBOR_NOT_FOUND'
  | 'FRIEND_NICKNAME_INVALID'
  | 'PROFILE_INTRO_INVALID'
  | 'ACCOUNT_DELETED';

export class FriendError extends Error {
  constructor(readonly code: FriendErrorCode, readonly retryAfterSeconds?: number) {
    super(code);
    this.name = 'FriendError';
  }
}
