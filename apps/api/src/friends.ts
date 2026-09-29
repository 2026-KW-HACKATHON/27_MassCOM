import type { FriendsSnapshot, FriendView } from './friends-rules.js';

export type { FriendMeView, FriendsSnapshot, FriendView } from './friends-rules.js';

export type AddedFriend = { friend: FriendView; created: boolean };

export interface FriendService {
  list(accountId: string): Promise<FriendsSnapshot>;
  addByCode(input: { accountId: string; code: string }): Promise<AddedFriend>;
  remove(input: { accountId: string; friendshipId: string }): Promise<void>;
  rotateCode(accountId: string): Promise<{ code: string }>;
  setNickname(input: { accountId: string; nickname: string }): Promise<{ nickname: string }>;
}

export type FriendErrorCode =
  | 'FRIEND_SELF'
  | 'FRIEND_CODE_NOT_FOUND'
  | 'FRIEND_LIMIT'
  | 'FRIEND_CODE_RATE_LIMITED'
  | 'FRIEND_NOT_FOUND'
  | 'FRIEND_NICKNAME_INVALID'
  | 'ACCOUNT_DELETED';

export class FriendError extends Error {
  constructor(readonly code: FriendErrorCode, readonly retryAfterSeconds?: number) {
    super(code);
    this.name = 'FriendError';
  }
}
