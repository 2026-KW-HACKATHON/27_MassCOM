export type SocialAppVariant = 'ANDROID' | 'SHOWCASE_APP';

export type SocialSnapshot = {
  businessDate: string;
  friendshipGift: {
    sendLimit: 5;
    sendCount: number;
    sendRemaining: number;
    rewardDailyCap: 25;
    rewardEarnedToday: number;
    rewardRemainingToday: number;
    rewardPerAction: 5;
  };
  friends: {
    friendshipId: string;
    nickname: string;
    gift: {
      pendingGiftId: string | null;
      pendingDirection: 'SENT' | 'RECEIVED' | null;
      canSend: boolean;
      canReceive: boolean;
    };
    unreadMailCount: number;
  }[];
  unreadMailCount: number;
};

export type FriendshipGiftResult = {
  giftId: string;
  friendshipId: string;
  status: 'PENDING' | 'RECEIVED';
  direction: 'SENT' | 'RECEIVED';
  senderReward: number;
  receiverReward: number;
  rewardRemainingToday: number;
  sendRemaining: number;
  replayed: boolean;
  createdAt: string;
  receivedAt: string | null;
};

export type FriendshipGiftReceiveAndReplyResult = {
  received: FriendshipGiftResult;
  reply: FriendshipGiftResult | null;
};

export type MailType = 'MESSAGE' | 'MEAL_INVITATION' | 'MEAL_RESPONSE' | 'FRIENDSHIP_GIFT';

export type MailSummary = {
  id: string;
  type: MailType;
  direction: 'INBOX' | 'SENT';
  title: string;
  preview: string;
  fromNickname: string | null;
  toNickname: string | null;
  readAt: string | null;
  createdAt: string;
};

export type MealInvitationView = {
  invitationId: string;
  merchant: { id: string; name: string; address: string };
  date: string;
  schedule:
    | { kind: 'CONFIRMED'; time: string }
    | { kind: 'RANGE'; startTime: string; endTime: string };
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  selectedTime: string | null;
  respondedAt: string | null;
};

export type MailDetail = MailSummary & {
  body: string;
  mealInvitation?: MealInvitationView;
};

export type MailMutationResult = MailDetail & {
  replayed: boolean;
};

export type MailList = {
  mail: MailSummary[];
  nextCursor: string | null;
};

export type CreateMealInvitationInput = {
  merchantId: string;
  date: string;
  kind: 'CONFIRMED' | 'RANGE';
  time?: string;
  startTime?: string;
  endTime?: string;
};

export type MealInvitationResponse = {
  invitation: MealInvitationView;
  mail: MailDetail;
  replayed: boolean;
};

export type NotificationFlushResult = {
  claimed: number;
  sent: number;
  retry: number;
  dead: number;
  skipped: number;
};

export type NotificationReceiptResult = {
  checked: number;
  delivered: number;
  retry: number;
  dead: number;
};

export interface SocialService {
  getSocial(accountId: string): Promise<SocialSnapshot>;
  sendFriendshipGift(input: { accountId: string; friendshipId: string; requestId: string }): Promise<FriendshipGiftResult>;
  receiveFriendshipGift(input: { accountId: string; giftId: string; requestId: string }): Promise<FriendshipGiftResult>;
  receiveAndReplyFriendshipGift(input: { accountId: string; giftId: string; requestId: string }): Promise<FriendshipGiftReceiveAndReplyResult>;
  listMail(input: { accountId: string; cursor?: string }): Promise<MailList>;
  getMail(input: { accountId: string; mailId: string }): Promise<MailDetail>;
  markMailRead(input: { accountId: string; mailId: string }): Promise<MailDetail>;
  sendMessage(input: { accountId: string; friendshipId: string; requestId: string; body: string }): Promise<MailMutationResult>;
  createMealInvitation(input: CreateMealInvitationInput & {
    accountId: string;
    friendshipId: string;
    requestId: string;
  }): Promise<MailMutationResult>;
  respondToMealInvitation(input: {
    accountId: string;
    invitationId: string;
    requestId: string;
    decision: 'ACCEPT' | 'DECLINE';
    selectedTime?: string;
  }): Promise<MealInvitationResponse>;
  registerPushToken(input: {
    accountId: string;
    token: string;
    appVariant: SocialAppVariant;
    deviceId?: string | null;
    bindingRevision?: number;
  }): Promise<{ status: 'REGISTERED' }>;
  unregisterPushToken(input: {
    accountId: string;
    token: string;
    appVariant: SocialAppVariant;
    deviceId?: string | null;
    bindingRevision?: number;
  }): Promise<{ status: 'REMOVED' }>;
  flushNotifications(input?: { limit?: number }): Promise<NotificationFlushResult>;
  reconcileReceipts(input?: { limit?: number }): Promise<NotificationReceiptResult>;
}

export type SocialErrorCode =
  | 'INVALID_REQUEST'
  | 'SOCIAL_FRIENDSHIP_NOT_FOUND'
  | 'SOCIAL_FORBIDDEN'
  | 'SOCIAL_GIFT_PENDING'
  | 'SOCIAL_SEND_LIMIT_REACHED'
  | 'SOCIAL_REQUEST_CONFLICT'
  | 'SOCIAL_MAIL_NOT_FOUND'
  | 'SOCIAL_INVITATION_NOT_FOUND'
  | 'SOCIAL_INVITATION_TERMINAL'
  | 'SOCIAL_INVITATION_EXPIRED'
  | 'SOCIAL_PUSH_TOKEN_INVALID'
  | 'ACCOUNT_DELETED';

export class SocialError extends Error {
  constructor(readonly code: SocialErrorCode, readonly retryAfterSeconds?: number) {
    super(code);
    this.name = 'SocialError';
  }
}

export function socialErrorStatus(code: SocialErrorCode): number {
  switch (code) {
    case 'INVALID_REQUEST':
    case 'SOCIAL_PUSH_TOKEN_INVALID':
      return 400;
    case 'SOCIAL_FORBIDDEN':
      return 403;
    case 'SOCIAL_FRIENDSHIP_NOT_FOUND':
    case 'SOCIAL_MAIL_NOT_FOUND':
    case 'SOCIAL_INVITATION_NOT_FOUND':
      return 404;
    case 'SOCIAL_GIFT_PENDING':
    case 'SOCIAL_REQUEST_CONFLICT':
    case 'SOCIAL_INVITATION_TERMINAL':
    case 'SOCIAL_INVITATION_EXPIRED':
      return 409;
    case 'SOCIAL_SEND_LIMIT_REACHED':
      return 429;
    case 'ACCOUNT_DELETED':
      return 410;
  }
}

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

export type PushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; code: string; retryable: boolean };

export type PushReceipt =
  | { status: 'ok' }
  | { status: 'error'; code: string; retryable: boolean; deadToken?: boolean };

export interface PushGateway {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  getReceipts(ticketIds: string[]): Promise<Map<string, PushReceipt>>;
}

export type NotificationsRunner = {
  stop(): Promise<void>;
  drain(): Promise<void>;
};

export function startNotificationsRunner(
  service: Pick<SocialService, 'flushNotifications' | 'reconcileReceipts'>,
  options: {
    intervalMs?: number;
    batchSize?: number;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
    onError?: (error: unknown) => void;
  } = {},
): NotificationsRunner {
  const intervalMs = options.intervalMs ?? 30_000;
  const batchSize = options.batchSize ?? 50;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  let stopped = false;
  let running = false;
  let queued = false;
  let inFlight: Promise<void> = Promise.resolve();

  const tick = () => {
    if (stopped) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    inFlight = (async () => {
      try {
        do {
          queued = false;
          await service.flushNotifications({ limit: batchSize });
          await service.reconcileReceipts({ limit: batchSize });
        } while (queued && !stopped);
      } catch (error) {
        queued = false;
        options.onError?.(error);
      } finally {
        running = false;
      }
    })();
  };

  tick();
  const timer = setIntervalFn(tick, intervalMs);
  return {
    async stop() {
      stopped = true;
      clearIntervalFn(timer);
      await inFlight;
    },
    async drain() {
      await inFlight;
    },
  };
}
