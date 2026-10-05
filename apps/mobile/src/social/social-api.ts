import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';

export type FriendshipGiftDirection = 'SENT' | 'RECEIVED';
export type MailType = 'MESSAGE' | 'MEAL_INVITATION' | 'MEAL_RESPONSE' | 'FRIENDSHIP_GIFT';
export type MailDirection = 'INBOX' | 'SENT';
export type MealSchedule =
  | { kind: 'CONFIRMED'; time: string }
  | { kind: 'RANGE'; startTime: string; endTime: string };

export type SocialFriend = {
  friendshipId: string;
  nickname: string;
  gift: {
    pendingGiftId: string | null;
    pendingDirection: FriendshipGiftDirection | null;
    canSend: boolean;
    canReceive: boolean;
  };
  unreadMailCount: number;
};

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
  friends: readonly SocialFriend[];
  unreadMailCount: number;
};

export type FriendshipGiftResult = {
  giftId: string;
  friendshipId: string;
  status: 'PENDING' | 'RECEIVED';
  direction: FriendshipGiftDirection;
  senderReward: number;
  receiverReward: number;
  rewardRemainingToday: number;
  sendRemaining: number;
  replayed: boolean;
  createdAt: string;
  receivedAt: string | null;
};

export type MailListItem = {
  id: string;
  type: MailType;
  direction: MailDirection;
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
  schedule: MealSchedule;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  selectedTime: string | null;
  respondedAt: string | null;
};

export type MailDetail = MailListItem & {
  body: string;
  mealInvitation?: MealInvitationView;
};

export type MailList = {
  mail: readonly MailListItem[];
  nextCursor: string | null;
};

export type CreateMealInvitationInput = {
  friendshipId: string;
  requestId: string;
  merchantId: string;
  date: string;
  schedule: MealSchedule;
};

export type MealInvitationResponse = {
  invitation: MealInvitationView;
  mail: MailDetail;
  replayed: boolean;
};

export type AppVariant = 'ANDROID' | 'SHOWCASE_APP';

export class SocialApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'SocialApiError';
  }
}

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

export type SocialApiClient = ReturnType<typeof createSocialApiClient>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxRetryAfterSeconds = 24 * 60 * 60;

export function createSocialApiClient(options: Options) {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string, init?: RequestInit): Promise<{ status: number; payload: unknown }> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) headers.set(name, value);
    let response: Response;
    try {
      response = await fetcher(`${apiUrl}${path}`, { ...init, headers });
    } catch {
      throw new SocialApiError(0, 'NETWORK_ERROR');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) await options.onSessionInvalid?.();
      throw new SocialApiError(
        response.status,
        code,
        response.status === 429 ? parseRetryAfter(response.headers.get('retry-after')) : undefined,
      );
    }
    return { status: response.status, payload };
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    async getSocial(): Promise<SocialSnapshot> {
      return parseSocialSnapshot((await request('/me/social')).payload);
    },
    async sendFriendshipGift(input: { friendshipId: string; requestId: string }): Promise<FriendshipGiftResult> {
      assertId(input.friendshipId);
      return parseGiftResult((await request(`/me/friends/${input.friendshipId}/gifts`, json('POST', { requestId: input.requestId }))).payload);
    },
    async receiveFriendshipGift(input: { giftId: string; requestId: string }): Promise<FriendshipGiftResult> {
      assertId(input.giftId);
      return parseGiftResult((await request(`/me/gifts/${input.giftId}/receive`, json('POST', { requestId: input.requestId }))).payload);
    },
    async listMail(cursor?: string): Promise<MailList> {
      const suffix = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
      return parseMailList((await request(`/me/mail${suffix}`)).payload);
    },
    async getMail(mailId: string): Promise<MailDetail> {
      assertId(mailId);
      return parseMailDetail((await request(`/me/mail/${mailId}`)).payload);
    },
    async markMailRead(mailId: string): Promise<MailDetail> {
      assertId(mailId);
      return parseMailDetail((await request(`/me/mail/${mailId}/read`, json('POST', {}))).payload);
    },
    async sendMessage(input: { friendshipId: string; requestId: string; body: string }): Promise<MailDetail> {
      assertId(input.friendshipId);
      return parseMailDetail((await request(`/me/friends/${input.friendshipId}/messages`, json('POST', {
        requestId: input.requestId,
        body: input.body,
      }))).payload);
    },
    async createMealInvitation(input: CreateMealInvitationInput): Promise<MailDetail> {
      assertId(input.friendshipId);
      const body = input.schedule.kind === 'CONFIRMED'
        ? { requestId: input.requestId, merchantId: input.merchantId, date: input.date, kind: 'CONFIRMED', time: input.schedule.time }
        : {
            requestId: input.requestId,
            merchantId: input.merchantId,
            date: input.date,
            kind: 'RANGE',
            startTime: input.schedule.startTime,
            endTime: input.schedule.endTime,
          };
      return parseMailDetail((await request(`/me/friends/${input.friendshipId}/meal-invitations`, json('POST', body))).payload);
    },
    async respondToMealInvitation(input: {
      invitationId: string;
      requestId: string;
      decision: 'ACCEPT' | 'DECLINE';
      selectedTime?: string;
    }): Promise<MealInvitationResponse> {
      assertId(input.invitationId);
      return parseMealInvitationResponse((await request(`/me/meal-invitations/${input.invitationId}/respond`, json('POST', {
        requestId: input.requestId,
        decision: input.decision,
        selectedTime: input.selectedTime,
      }))).payload);
    },
    async registerPushToken(input: { token: string; appVariant: AppVariant; deviceId?: string | null; bindingRevision?: number }): Promise<{ status: 'REGISTERED' }> {
      const payload = (await request('/me/push-tokens', json('POST', input))).payload;
      if (!isRecord(payload) || payload.status !== 'REGISTERED') throw invalidResponse();
      return { status: 'REGISTERED' };
    },
    async unregisterPushToken(input: { token: string; appVariant: AppVariant; deviceId?: string | null; bindingRevision?: number }): Promise<{ status: 'REMOVED' }> {
      const payload = (await request('/me/push-tokens', json('DELETE', input))).payload;
      if (!isRecord(payload) || payload.status !== 'REMOVED') throw invalidResponse();
      return { status: 'REMOVED' };
    },
  };
}

export function createSocialRequestId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
}

export function socialErrorMessage(error: unknown): string {
  if (!(error instanceof SocialApiError)) return '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
  switch (error.code) {
    case 'SOCIAL_GIFT_PENDING':
      return '친구가 아직 우정을 받지 않았어요. 받으면 다시 보낼 수 있어요.';
    case 'SOCIAL_SEND_LIMIT_REACHED':
      return error.retryAfterSeconds === undefined ? '오늘 보낼 수 있는 우정을 모두 보냈어요.' : `오늘 보낼 수 있는 우정을 모두 보냈어요. (${Math.ceil(error.retryAfterSeconds / 60)}분 뒤 다시 확인)`;
    case 'SOCIAL_FRIENDSHIP_NOT_FOUND':
    case 'SOCIAL_FORBIDDEN':
      return '지금은 이 친구에게 보낼 수 없어요. 목록을 새로 불러와 주세요.';
    case 'SOCIAL_MAIL_NOT_FOUND':
    case 'SOCIAL_INVITATION_NOT_FOUND':
      return '우편을 찾지 못했어요. 목록을 새로 불러와 주세요.';
    case 'SOCIAL_INVITATION_TERMINAL':
      return '이미 처리된 초대예요.';
    case 'SOCIAL_INVITATION_EXPIRED':
      return '이미 지난 초대예요.';
    case 'SOCIAL_REQUEST_CONFLICT':
      return '이전 요청과 다른 내용이에요. 화면을 새로 불러와 주세요.';
    case 'SOCIAL_PUSH_TOKEN_INVALID':
      return '이 기기의 알림 정보를 등록하지 못했어요.';
    case 'ACCOUNT_DELETED':
      return '삭제된 계정이라 이 기능을 쓸 수 없어요.';
    case 'SESSION_INVALID':
      return '로그인이 만료됐어요. 다시 로그인해 주세요.';
    case 'NETWORK_ERROR':
      return '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
    case 'INVALID_RESPONSE':
      return '서버 응답을 확인하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
    default:
      return '요청을 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
  }
}

export function parseSocialSnapshot(value: unknown): SocialSnapshot {
  if (!isRecord(value) || !Array.isArray(value.friends) || !isDate(value.businessDate) || !isRecord(value.friendshipGift)
    || !isNonNegativeInteger(value.unreadMailCount)) throw invalidResponse();
  const gift = value.friendshipGift;
  if (gift.sendLimit !== 5 || gift.rewardDailyCap !== 25 || gift.rewardPerAction !== 5
    || !isNonNegativeInteger(gift.sendCount) || !isNonNegativeInteger(gift.sendRemaining)
    || !isNonNegativeInteger(gift.rewardEarnedToday) || !isNonNegativeInteger(gift.rewardRemainingToday)) throw invalidResponse();
  return {
    businessDate: value.businessDate,
    friendshipGift: {
      sendLimit: 5,
      sendCount: gift.sendCount,
      sendRemaining: gift.sendRemaining,
      rewardDailyCap: 25,
      rewardEarnedToday: gift.rewardEarnedToday,
      rewardRemainingToday: gift.rewardRemainingToday,
      rewardPerAction: 5,
    },
    friends: value.friends.map(parseSocialFriend),
    unreadMailCount: value.unreadMailCount,
  };
}

export function parseMailList(value: unknown): MailList {
  if (!isRecord(value) || !Array.isArray(value.mail) || (value.nextCursor !== null && typeof value.nextCursor !== 'string')) throw invalidResponse();
  return { mail: value.mail.map(parseMailListItem), nextCursor: value.nextCursor };
}

export function parseMailDetail(value: unknown): MailDetail {
  const item = parseMailListItem(value);
  if (!isRecord(value) || typeof value.body !== 'string') throw invalidResponse();
  return {
    ...item,
    body: value.body,
    ...(value.mealInvitation === undefined ? null : { mealInvitation: parseMealInvitation(value.mealInvitation) }),
  };
}

function parseSocialFriend(value: unknown): SocialFriend {
  if (!isRecord(value) || !isId(value.friendshipId) || !isNonEmptyString(value.nickname) || !isRecord(value.gift)
    || !isNonNegativeInteger(value.unreadMailCount)) throw invalidResponse();
  const gift = value.gift;
  if ((gift.pendingGiftId !== null && !isId(gift.pendingGiftId)) || !isGiftDirectionOrNull(gift.pendingDirection)
    || typeof gift.canSend !== 'boolean' || typeof gift.canReceive !== 'boolean') throw invalidResponse();
  return {
    friendshipId: value.friendshipId,
    nickname: value.nickname,
    gift: {
      pendingGiftId: gift.pendingGiftId,
      pendingDirection: gift.pendingDirection,
      canSend: gift.canSend,
      canReceive: gift.canReceive,
    },
    unreadMailCount: value.unreadMailCount,
  };
}

function parseGiftResult(value: unknown): FriendshipGiftResult {
  if (!isRecord(value) || !isId(value.giftId) || !isId(value.friendshipId)
    || (value.status !== 'PENDING' && value.status !== 'RECEIVED') || !isGiftDirection(value.direction)
    || !isNonNegativeInteger(value.senderReward) || !isNonNegativeInteger(value.receiverReward)
    || !isNonNegativeInteger(value.rewardRemainingToday) || !isNonNegativeInteger(value.sendRemaining)
    || typeof value.replayed !== 'boolean' || !isIso(value.createdAt)
    || (value.receivedAt !== null && !isIso(value.receivedAt))) throw invalidResponse();
  return {
    giftId: value.giftId,
    friendshipId: value.friendshipId,
    status: value.status,
    direction: value.direction,
    senderReward: value.senderReward,
    receiverReward: value.receiverReward,
    rewardRemainingToday: value.rewardRemainingToday,
    sendRemaining: value.sendRemaining,
    replayed: value.replayed,
    createdAt: value.createdAt,
    receivedAt: value.receivedAt,
  };
}

function parseMailListItem(value: unknown): MailListItem {
  if (!isRecord(value) || !isId(value.id) || !isMailType(value.type) || !isMailDirection(value.direction)
    || !isNonEmptyString(value.title) || typeof value.preview !== 'string'
    || (value.fromNickname !== null && typeof value.fromNickname !== 'string')
    || (value.toNickname !== null && typeof value.toNickname !== 'string')
    || (value.readAt !== null && !isIso(value.readAt)) || !isIso(value.createdAt)) throw invalidResponse();
  return {
    id: value.id,
    type: value.type,
    direction: value.direction,
    title: value.title,
    preview: value.preview,
    fromNickname: value.fromNickname,
    toNickname: value.toNickname,
    readAt: value.readAt,
    createdAt: value.createdAt,
  };
}

function parseMealInvitation(value: unknown): MealInvitationView {
  if (!isRecord(value) || !isId(value.invitationId) || !isRecord(value.merchant) || !isDate(value.date)
    || !isRecord(value.schedule) || !isInvitationStatus(value.status)
    || (value.selectedTime !== null && !isHHmm(value.selectedTime)) || (value.respondedAt !== null && !isIso(value.respondedAt))) throw invalidResponse();
  const merchant = value.merchant;
  if (!isNonEmptyString(merchant.id) || !isNonEmptyString(merchant.name) || !isNonEmptyString(merchant.address)) throw invalidResponse();
  return {
    invitationId: value.invitationId,
    merchant: { id: merchant.id, name: merchant.name, address: merchant.address },
    date: value.date,
    schedule: parseSchedule(value.schedule),
    status: value.status,
    selectedTime: value.selectedTime,
    respondedAt: value.respondedAt,
  };
}

function parseMealInvitationResponse(value: unknown): MealInvitationResponse {
  if (!isRecord(value) || typeof value.replayed !== 'boolean') throw invalidResponse();
  return { invitation: parseMealInvitation(value.invitation), mail: parseMailDetail(value.mail), replayed: value.replayed };
}

function parseSchedule(value: Record<string, unknown>): MealSchedule {
  if (value.kind === 'CONFIRMED' && isHHmm(value.time)) return { kind: 'CONFIRMED', time: value.time };
  if (value.kind === 'RANGE' && isHHmm(value.startTime) && isHHmm(value.endTime)) return { kind: 'RANGE', startTime: value.startTime, endTime: value.endTime };
  throw invalidResponse();
}

function assertId(value: string): void {
  if (!isId(value)) throw new SocialApiError(404, 'SOCIAL_MAIL_NOT_FOUND');
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || !/^\d+$/.test(header.trim())) return undefined;
  return Math.min(maxRetryAfterSeconds, Math.max(1, Number(header.trim())));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function isHHmm(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isGiftDirection(value: unknown): value is FriendshipGiftDirection {
  return value === 'SENT' || value === 'RECEIVED';
}

function isGiftDirectionOrNull(value: unknown): value is FriendshipGiftDirection | null {
  return value === null || isGiftDirection(value);
}

function isMailType(value: unknown): value is MailType {
  return value === 'MESSAGE' || value === 'MEAL_INVITATION' || value === 'MEAL_RESPONSE' || value === 'FRIENDSHIP_GIFT';
}

function isMailDirection(value: unknown): value is MailDirection {
  return value === 'INBOX' || value === 'SENT';
}

function isInvitationStatus(value: unknown): value is MealInvitationView['status'] {
  return value === 'PENDING' || value === 'ACCEPTED' || value === 'DECLINED' || value === 'EXPIRED';
}

function invalidResponse(): SocialApiError {
  return new SocialApiError(200, 'INVALID_RESPONSE');
}
