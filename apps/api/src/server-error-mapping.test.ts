import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AccountDeletionError } from './account-deletion.js';
import { AccountDeletionIntakeError, type AccountDeletionIntakeErrorCode } from './account-deletion-intake.js';
import { ConsentError } from './account-consent.js';
import { AuthSessionError } from './auth-session.js';
import { BadgeRewardError } from './badge-rewards.js';
import { CampaignEnrollmentError } from './campaign-enrollment.js';
import { ClaimSlotError } from './claim-slot-service.js';
import { CoinEconomyError, type CoinEconomyErrorCode } from './coin-economy.js';
import { CollectibleProjectError } from './collectible-project.js';
import { ExperienceError } from './collection-experience.js';
import { CustomerIdentityError } from './customer-identity.js';
import { FriendError } from './friends.js';
import { FurnitureError } from './furniture.js';
import { GoogleIdTokenError } from './google-id-token.js';
import { GradeDrawError } from './grade-draw.js';
import { MerchantAccessError } from './merchant-access.js';
import { MerchantArtError } from './merchant-art.js';
import { MerchantDiscoveryError } from './merchant-discovery.js';
import { MerchantOperationError } from './merchant-operations.js';
import { MerchantOverviewError } from './merchant-overview-rules.js';
import { MerchantProfileError } from './merchant-profile.js';
import { MileageShopError } from './mileage-shop.js';
import { MintRequestError } from './mint-request-service.js';
import { NotificationError } from './notifications.js';
import { PlayError } from './play.js';
import { RealWorldError } from './real-world-contract.js';
import { ReversalError } from './reversal.js';
import { RoomCommunityError } from './room-community.js';
import { SocialError } from './social.js';
import { SocialHttpError } from './social-http.js';
import { StoreTicketError } from './store-tickets.js';
import { VisitorFeedbackError } from './visitor-feedback.js';
import { WalletChallengeError } from './wallet-challenge-service.js';
import { WebAuthError } from './web-auth.js';
import { WebOriginError } from './web-origin.js';
import { WebSessionError } from './web-session.js';
import { AdminError } from './postgres/admin.js';
import { StaffRegistrationError } from './postgres/staff-registration.js';
import { GuestTrialError } from './showcase/guest-trials.js';
import { ShowcaseAccessRequestError } from './showcase/access-requests.js';
import { listen, send, walletService } from './http-test-support.js';
import { createApiServer, developmentHeaderAccountResolver } from './server-test-support.js';

// 리팩터링 안전망: 서비스가 던진 오류가 HTTP 상태·본문·Retry-After로 바뀌는 대응표(server.ts의 instanceof 사슬과 statusFor*)를
// 클래스마다 코드 하나하나 고정한다. 경로와 무관한 사슬이라 가장 단순한 GET /collection 으로 오류를 던진다.

type Case = { name: string; error: () => unknown; status: number; body: Record<string, unknown>; retryAfter?: string };

/** 상태 → 코드 목록 표로 클래스 하나의 대응을 적는다. 같은 코드가 두 번 나오면 표 오타라 바로 걸린다. */
function table<Code extends string>(
  name: string, make: (code: Code) => unknown, byStatus: Record<number, readonly Code[]>,
  extra?: (code: Code) => Record<string, unknown>,
): Case[] {
  const seen = new Set<string>();
  return Object.entries(byStatus).flatMap(([status, codes]) => codes.map((code) => {
    assert.ok(!seen.has(code), `${name} ${code} listed twice`);
    seen.add(code);
    return { name: `${name} ${code}`, error: () => make(code), status: Number(status), body: { code, ...extra?.(code) } };
  }));
}

const cases: Case[] = [
  // 실제 점포 탐색 오류는 오류가 가진 상태를 그대로 쓰고, retryable일 때만 본문에 붙인다.
  { name: 'RealWorldError default', error: () => new RealWorldError('RW_X'), status: 400, body: { code: 'RW_X' } },
  { name: 'RealWorldError status', error: () => new RealWorldError('RW_X', 404), status: 404, body: { code: 'RW_X' } },
  { name: 'RealWorldError retryable', error: () => new RealWorldError('RW_X', 503, true), status: 503, body: { code: 'RW_X', retryable: true } },
  ...table('ExperienceError', (code) => new ExperienceError(code), {
    410: ['ACCOUNT_DELETED'], 404: ['EXPERIENCE_FRIEND_NOT_FOUND'], 403: ['EXPERIENCE_LOCKED'], 400: ['EXPERIENCE_INVALID'],
  }),
  ...table('NotificationError', (code) => new NotificationError(code), { 404: ['NOT_FOUND'], 400: ['INVALID_NOTIFICATION'] }),
  ...table('MerchantOperationError', (code) => new MerchantOperationError(code), {
    403: ['MERCHANT_OPERATION_FORBIDDEN'], 404: ['MERCHANT_OPERATION_NOT_FOUND', 'MERCHANT_OPERATION_STAFF_NOT_FOUND'],
    409: ['MERCHANT_OPERATION_CONFLICT'], 400: ['MERCHANT_OPERATION_INVALID', 'MERCHANT_OPERATION_LIMIT'],
  }),
  ...table('PlayError', (code) => new PlayError(code), {
    410: ['ACCOUNT_DELETED'], 404: ['PLAY_RUN_NOT_FOUND', 'FRIEND_STUDIO_NOT_FOUND'], 429: ['PLAY_RATE_LIMITED'],
    409: ['PLAY_RUN_EXPIRED', 'STUDIO_VERSION_CONFLICT'], 400: ['PLAY_KIND_INVALID', 'SOME_UNLISTED_CODE'],
  }),
  ...table<CoinEconomyErrorCode>('CoinEconomyError', (code) => new CoinEconomyError(code), {
    410: ['ACCOUNT_DELETED'], 400: ['INVALID_REQUEST'],
    404: ['COIN_TICKET_NOT_FOUND', 'COIN_REROLL_TICKET_NOT_FOUND', 'COIN_REROLL_SOURCE_NOT_FOUND'],
    409: ['COIN_POOL_UNAVAILABLE', 'COIN_POOL_EXPIRED', 'COIN_POOL_LIMIT_REACHED', 'COIN_INSUFFICIENT_MILEAGE',
      'COIN_REQUEST_CONFLICT', 'COIN_TICKET_EXPIRED', 'COIN_SERIES_UNAVAILABLE', 'COIN_REROLL_TICKET_USED',
      'COIN_REROLL_SOURCE_LOCKED', 'COIN_REROLL_POOL_UNAVAILABLE', 'COIN_REROLL_NO_CANDIDATES', 'COIN_REROLL_RESULT_REVOKED',
      'COIN_SERIES_INCOMPLETE', 'COIN_SERIES_CAP_REACHED', 'COIN_PUBLICATION_UNAVAILABLE'],
  }),
  ...table('GradeDrawError', (code) => new GradeDrawError(code), {
    410: ['ACCOUNT_DELETED'], 400: ['INVALID_REQUEST'], 429: ['DRAW_RATE_LIMITED'],
    409: ['DRAW_STATE_CHANGED', 'DRAW_INSUFFICIENT_MILEAGE', 'DRAW_REQUEST_CONFLICT', 'DRAW_COIN_UNAVAILABLE'],
  }),
  ...table('RoomCommunityError', (code) => new RoomCommunityError(code), {
    410: ['ACCOUNT_DELETED'], 404: ['ROOM_NOT_FOUND', 'ROOM_STAMP_NOT_FOUND'], 429: ['ROOM_RATE_LIMITED'],
    403: ['ROOM_CONSENT_REQUIRED'], 409: ['ROOM_STAMP_LIMIT'], 400: ['ROOM_INVALID', 'SOME_UNLISTED_CODE'],
  }),
  ...table('FurnitureError', (code) => new FurnitureError(code), {
    410: ['ACCOUNT_DELETED'], 404: ['FURNITURE_UNAVAILABLE'], 409: ['FURNITURE_REQUEST_CONFLICT', 'FURNITURE_INSUFFICIENT_MILEAGE'],
    400: ['FURNITURE_INVALID', 'SOME_UNLISTED_CODE'],
  }),
  ...table('CollectibleProjectError', (code) => new CollectibleProjectError(code), {
    400: ['COLLECTIBLE_INVALID_PROJECT'], 413: ['COLLECTIBLE_MEDIA_TOO_LARGE'],
    404: ['COLLECTIBLE_PROJECT_NOT_FOUND', 'COLLECTIBLE_NOT_FOUND'], 410: ['ACCOUNT_DELETED'],
    409: ['COLLECTIBLE_VERSION_CONFLICT', 'COLLECTIBLE_PUBLISHED_IMMUTABLE', 'COLLECTIBLE_CAMPAIGN_UNAVAILABLE',
      'COLLECTIBLE_NOT_READY', 'COLLECTIBLE_PROJECT_LIMIT', 'COLLECTIBLE_NOT_PUBLISHED', 'COLLECTIBLE_PUBLICATION_LIMIT'],
  }),
  ...table('ClaimSlotError', (code) => new ClaimSlotError(code), {
    410: ['CLAIM_TOKEN_EXPIRED', 'CUSTOMER_IDENTITY_EXPIRED', 'ACCOUNT_DELETED'], 404: ['SHOWCASE_MERCHANT_NOT_FOUND'],
    409: ['CLAIM_SLOT_ALREADY_EXISTS', 'CLAIM_SLOT_NOT_REISSUABLE', 'CLAIM_TOKEN_UNAVAILABLE', 'CLAIM_CAMPAIGN_UNAVAILABLE',
      'CLAIM_MERCHANT_INACTIVE', 'CUSTOMER_IDENTITY_UNAVAILABLE'],
  }),
  ...table('CustomerIdentityError', (code) => new CustomerIdentityError(code), {
    410: ['ACCOUNT_DELETED', 'CUSTOMER_IDENTITY_EXPIRED'], 409: ['CUSTOMER_IDENTITY_UNAVAILABLE'],
  }),
  ...table('BadgeRewardError', (code) => new BadgeRewardError(code), {
    404: ['COUPON_NOT_FOUND'], 403: ['COUPON_SELF_REDEEM'], 410: ['ACCOUNT_DELETED'],
    409: ['REWARD_LOCKED', 'REWARD_OFFER_UNAVAILABLE', 'REWARD_CAPACITY_EXHAUSTED', 'COUPON_EXPIRED', 'COUPON_VOIDED'],
  }),
  ...table('ReversalError', (code) => new ReversalError(code), {
    400: ['INVALID_REVERSAL_REASON', 'INVALID_REVERSAL_NOTE'], 403: ['COUPON_SELF_UNDO'], 404: ['VISIT_NOT_FOUND', 'COUPON_NOT_FOUND'],
    410: ['ACCOUNT_DELETED'],
    409: ['VISIT_CANCEL_WINDOW_CLOSED', 'VISIT_REWARD_ALREADY_MINTED', 'VISIT_REWARD_COUPON_REDEEMED',
      'VISIT_REWARD_MINT_IN_PROGRESS', 'COUPON_UNDO_WINDOW_CLOSED', 'COUPON_NOT_REDEEMED', 'COUPON_REQUIREMENT_LOST'],
  }),
  ...table('MileageShopError', (code) => new MileageShopError(code), {
    400: ['INVALID_REQUEST'], 402: ['SHOP_INSUFFICIENT_MILEAGE'], 404: ['SHOP_ITEM_NOT_OWNED', 'SHOP_CLOTHING_NOT_OWNED'],
    410: ['ACCOUNT_DELETED'], 429: ['SHOP_RATE_LIMITED'], 409: ['SHOP_GRADE_COMPLETE', 'SHOP_STATE_CHANGED', 'SHOP_REQUEST_CONFLICT'],
  }),
  { name: 'MileageShopError Retry-After', error: () => new MileageShopError('SHOP_RATE_LIMITED', 7), status: 429,
    body: { code: 'SHOP_RATE_LIMITED' }, retryAfter: '7' },
  ...table('MerchantDiscoveryError', (code) => new MerchantDiscoveryError(code), {
    404: ['COLLECTIBLE_PREVIEW_NOT_FOUND', 'MERCHANT_NOT_FOUND'],
  }),
  ...table('VisitorFeedbackError', (code) => new VisitorFeedbackError(code), {
    403: ['VISITOR_FEEDBACK_NOT_ELIGIBLE'], 410: ['ACCOUNT_DELETED'],
    400: ['VISITOR_FEEDBACK_TAGS_INVALID', 'VISITOR_FEEDBACK_SUGGESTIONS_INVALID', 'VISITOR_FEEDBACK_NOTE_INVALID'],
  }),
  ...table('ConsentError', (code) => new ConsentError(code), {
    410: ['ACCOUNT_DELETED'], 409: ['CONSENT_VERSION_MISMATCH'], 400: ['CONSENT_INCOMPLETE'],
  }),
  ...table('FriendError', (code) => new FriendError(code), {
    404: ['FRIEND_CODE_NOT_FOUND', 'FRIEND_NOT_FOUND', 'FRIEND_NEIGHBOR_NOT_FOUND'], 429: ['FRIEND_CODE_RATE_LIMITED'],
    400: ['FRIEND_NICKNAME_INVALID', 'PROFILE_INTRO_INVALID'], 410: ['ACCOUNT_DELETED'], 409: ['FRIEND_SELF', 'FRIEND_LIMIT'],
  }),
  { name: 'FriendError Retry-After', error: () => new FriendError('FRIEND_CODE_RATE_LIMITED', 11), status: 429,
    body: { code: 'FRIEND_CODE_RATE_LIMITED' }, retryAfter: '11' },
  ...table('StoreTicketError', (code) => new StoreTicketError(code), { 404: ['STORE_TICKET_NOT_FOUND'], 400: ['INVALID_REQUEST'] }),
  ...table('SocialError', (code) => new SocialError(code), {
    400: ['INVALID_REQUEST', 'SOCIAL_PUSH_TOKEN_INVALID'], 403: ['SOCIAL_FORBIDDEN'],
    404: ['SOCIAL_FRIENDSHIP_NOT_FOUND', 'SOCIAL_MAIL_NOT_FOUND', 'SOCIAL_INVITATION_NOT_FOUND'],
    409: ['SOCIAL_GIFT_PENDING', 'SOCIAL_REQUEST_CONFLICT', 'SOCIAL_INVITATION_TERMINAL', 'SOCIAL_INVITATION_EXPIRED'],
    410: ['ACCOUNT_DELETED'], 429: ['SOCIAL_SEND_LIMIT_REACHED'],
  }),
  { name: 'SocialError Retry-After', error: () => new SocialError('SOCIAL_SEND_LIMIT_REACHED', 13), status: 429,
    body: { code: 'SOCIAL_SEND_LIMIT_REACHED' }, retryAfter: '13' },
  { name: 'SocialHttpError', error: () => new SocialHttpError(418, 'SOCIAL_TEAPOT'), status: 418, body: { code: 'SOCIAL_TEAPOT' } },
  ...table('MerchantArtError', (code) => new MerchantArtError(code), {
    404: ['AI_ART_ROUND_NOT_FOUND'], 429: ['AI_ART_DAILY_LIMIT'], 403: ['AI_ART_TRIAL_DISABLED'],
    503: ['AI_ART_NOT_CONFIGURED', 'AI_ART_BUDGET_EXHAUSTED'], 410: ['ACCOUNT_DELETED'], 409: ['AI_ART_ROUND_IN_PROGRESS', 'AI_ART_ROUND_STATE'],
  }, (code) => (code === 'AI_ART_TRIAL_DISABLED' ? { message: '체험 가게에서는 AI 그림을 만들 수 없어요.' } : {})),
  { name: 'MerchantArtError Retry-After', error: () => new MerchantArtError('AI_ART_DAILY_LIMIT', 3600), status: 429,
    body: { code: 'AI_ART_DAILY_LIMIT' }, retryAfter: '3600' },
  { name: 'MerchantAccessError', error: () => new MerchantAccessError('MERCHANT_ACCESS_DENIED'), status: 403,
    body: { code: 'MERCHANT_ACCESS_DENIED' } },
  ...table('MerchantProfileError', (code) => new MerchantProfileError(code), {
    400: ['MERCHANT_PROFILE_INVALID'], 409: ['MERCHANT_PROFILE_VERSION_CONFLICT'],
    403: ['MERCHANT_PROFILE_FORBIDDEN', 'MERCHANT_PROFILE_READ_ONLY'],
  }),
  { name: 'MerchantOverviewError', error: () => new MerchantOverviewError('MERCHANT_NOT_FOUND'), status: 404,
    body: { code: 'MERCHANT_NOT_FOUND' } },
  ...table('AdminError', (code) => new AdminError(code), {
    403: ['ADMIN_FORBIDDEN', 'ADMIN_SELF_ROLE_CHANGE'],
    404: ['ADMIN_MERCHANT_NOT_FOUND', 'ADMIN_IDENTITY_NOT_FOUND', 'ADMIN_COUPON_NOT_FOUND', 'ADMIN_MEMBER_NOT_FOUND',
      'ADMIN_OFFER_NOT_FOUND', 'ADMIN_CAMPAIGN_NOT_FOUND'],
    409: ['ADMIN_VERSION_CONFLICT', 'ADMIN_PENDING_CLAIMS', 'ADMIN_COUPON_NOT_VOIDABLE', 'ADMIN_MERCHANT_NOT_READY',
      'ADMIN_MERCHANT_ALREADY_ACTIVE', 'ADMIN_MERCHANT_NOT_ACTIVE', 'ADMIN_ALREADY_OWNER', 'ADMIN_OWNER_LIMIT',
      'ADMIN_OFFER_MILESTONE_TAKEN', 'ADMIN_CAMPAIGN_NOT_PUBLISHABLE', 'ADMIN_CAMPAIGN_NOT_PAUSABLE',
      'ADMIN_CAMPAIGN_NOT_EXTENDABLE', 'ADMIN_CAMPAIGN_EXTENSION_LIMIT', 'ADMIN_CAMPAIGN_ACTIVE_EXISTS'],
    400: ['ADMIN_INVALID_INPUT', 'ADMIN_DOCUMENT_REF_INVALID', 'ADMIN_CONSENT_INCOMPLETE', 'ADMIN_OFFER_TEXT_INVALID'],
  }),
  ...table('StaffRegistrationError', (code) => new StaffRegistrationError(code), {
    403: ['STAFF_FORBIDDEN'], 404: ['STAFF_MERCHANT_NOT_FOUND', 'STAFF_NOT_FOUND'], 400: ['STAFF_CODE_INVALID'], 409: ['STAFF_ALREADY_MEMBER'],
  }),
  ...table('GuestTrialError', (code) => new GuestTrialError(code), {
    429: ['GUEST_TRIAL_IP_LIMIT'], 503: ['SHOWCASE_HOST_DATABASE_REQUIRED', 'GUEST_TRIAL_BUSY', 'GUEST_TRIAL_UNAVAILABLE'],
  }),
  ...table('ShowcaseAccessRequestError', (code) => new ShowcaseAccessRequestError(code), {
    403: ['SHOWCASE_APPROVER_REQUIRED', 'SHOWCASE_ACCESS_SELF_DECISION'], 404: ['SHOWCASE_ACCESS_REQUEST_NOT_FOUND'],
    410: ['ACCOUNT_DELETED'], 409: ['SHOWCASE_HOST_DATABASE_REQUIRED', 'SHOWCASE_ACCESS_ALREADY_GRANTED', 'SHOWCASE_ACCESS_ALREADY_DECIDED'],
  }),
  ...table('WalletChallengeError', (code) => new WalletChallengeError(code), {
    503: ['ACCOUNT_AUTH_NOT_CONFIGURED'], 401: ['ACCOUNT_REQUIRED', 'SIGNER_MISMATCH'], 403: ['ACCOUNT_MISMATCH'],
    404: ['CHALLENGE_NOT_FOUND', 'WALLET_BINDING_NOT_FOUND'], 410: ['SIGNATURE_EXPIRED', 'ACCOUNT_DELETED'],
    409: ['NONCE_ALREADY_USED', 'NONCE_IN_PROGRESS', 'WALLET_ADDRESS_IN_USE', 'WALLET_BINDING_CHANGED'],
    400: ['ADDRESS_INVALID', 'SOME_UNLISTED_CODE'],
  }),
  ...table('MintRequestError', (code) => new MintRequestError(code), {
    404: ['ENTITLEMENT_NOT_FOUND', 'WALLET_BINDING_NOT_FOUND', 'MINT_JOB_NOT_FOUND'],
    400: ['CONSENT_REQUIRED', 'CONSENT_VERSION_OUTDATED', 'IDEMPOTENCY_KEY_REQUIRED'], 410: ['ACCOUNT_DELETED'],
    409: ['ENTITLEMENT_NOT_MINTABLE', 'ENTITLEMENT_EXPIRED', 'WALLET_BINDING_CHANGED', 'CHAIN_MISMATCH', 'IDEMPOTENCY_CONFLICT',
      'MINT_PENDING', 'CAPACITY_UNAVAILABLE', 'NFT_MINTING_PREPARING'],
  }),
  ...table('AuthSessionError', (code) => new AuthSessionError(code), {
    403: ['IDENTITY_MISMATCH', 'INVITE_REQUIRED'], 401: ['SESSION_REQUIRED', 'SESSION_INVALID', 'REAUTHENTICATION_REQUIRED'],
  }),
  ...table('GoogleIdTokenError', (code) => new GoogleIdTokenError(code), {
    503: ['ID_TOKEN_KEY_SET_UNAVAILABLE'], 401: ['ID_TOKEN_INVALID', 'ID_TOKEN_EXPIRED', 'ID_TOKEN_AUDIENCE_MISMATCH'],
  }),
  { name: 'WebOriginError', error: () => new WebOriginError(), status: 403, body: { code: 'WEB_ORIGIN_FORBIDDEN' } },
  ...table('WebAuthError', (code) => new WebAuthError(code), {
    401: ['WEB_AUTH_STATE_INVALID', 'WEB_AUTH_NONCE_INVALID', 'WEB_AUTH_ACCOUNT_NOT_FOUND', 'WEB_AUTH_CODE_INVALID', 'WEB_AUTH_ORIGIN_INVALID'],
  }),
  { name: 'WebAuthError WEB_AUTH_UPSTREAM_UNAVAILABLE', error: () => new WebAuthError('WEB_AUTH_UPSTREAM_UNAVAILABLE'), status: 503,
    body: { code: 'WEB_AUTH_UPSTREAM_UNAVAILABLE', message: 'Google 연결을 확인할 수 없습니다. 운영 웹으로 돌아가 새 로그인을 시작해 주세요.', next: '/app/' } },
  ...table('WebSessionError', (code) => new WebSessionError(code), {
    401: ['WEB_SESSION_INVALID', 'WEB_SESSION_ACCOUNT_REQUIRED', 'WEB_SESSION_REAUTH_REQUIRED'],
  }),
  ...table('AccountDeletionError', (code) => new AccountDeletionError(code), {
    401: ['REAUTHENTICATION_REQUIRED', 'ACCOUNT_REQUIRED'], 400: ['DELETION_CONFIRMATION_INVALID', 'SOME_UNLISTED_CODE'],
  }),
  ...table<AccountDeletionIntakeErrorCode>('AccountDeletionIntakeError', (code) => new AccountDeletionIntakeError(code), {
    404: ['DELETION_NO_ACTIVE_REQUEST', 'DELETION_RECEIPT_NOT_FOUND', 'DELETION_INTAKE_NOT_FOUND'],
    403: ['DELETION_SELF_PROCESSING_REFUSED'], 400: ['DELETION_REJECT_REASON_INVALID'],
    409: ['DELETION_CANCEL_WINDOW_CLOSED', 'DELETION_INTAKE_NOT_PENDING', 'DELETION_COOLING_OFF', 'DELETION_LEGACY_NEEDS_REFILE',
      'DELETION_BUSY'],
  }),
  ...table('CampaignEnrollmentError', (code) => new CampaignEnrollmentError(code), {
    404: ['CAMPAIGN_NOT_FOUND'], 410: ['ACCOUNT_DELETED'], 409: ['CAMPAIGN_NOT_AVAILABLE', 'CAMPAIGN_FULL'],
  }),
];

function serverThrowing(thrown: { next: unknown }) {
  const collection = { getCollection: async () => { throw thrown.next; } };
  return createApiServer(walletService(), developmentHeaderAccountResolver, undefined, undefined, undefined,
    collection as unknown as Parameters<typeof createApiServer>[5]);
}

test('서비스 오류 클래스·코드마다 HTTP 상태, 본문, Retry-After가 지금 대응표와 같다', async (t) => {
  const thrown: { next: unknown } = { next: undefined };
  const port = await listen(t, serverThrowing(thrown));
  const mismatches: unknown[] = [];
  for (const entry of cases) {
    thrown.next = entry.error();
    const result = await send(port, 'GET', '/collection', { headers: { 'x-account-id': 'acct' } });
    const actual = { status: result.status, body: result.json, retryAfter: result.headers['retry-after'] };
    const expected = { status: entry.status, body: entry.body, retryAfter: entry.retryAfter };
    try { assert.deepEqual(actual, expected); } catch { mismatches.push({ case: entry.name, actual, expected }); }
  }
  assert.deepEqual(mismatches, []);
  assert.ok(cases.length >= 270, `cases: ${cases.length}`);
});

test('모르는 오류는 500 INTERNAL_ERROR이고 서버에는 코드만 남기며 본문에 내부 정보를 싣지 않는다', async (t) => {
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  const thrown: { next: unknown } = { next: new Error('database password is hunter2') };
  const port = await listen(t, serverThrowing(thrown));
  const result = await send(port, 'GET', '/collection', { headers: { 'x-account-id': 'acct' } });
  assert.equal(result.status, 500);
  assert.deepEqual(result.json, { code: 'INTERNAL_ERROR' });
  assert.equal(result.text.includes('hunter2'), false);
  assert.equal(logged.length, 1);
  assert.equal(JSON.stringify(logged).includes('hunter2'), false);
  thrown.next = 'not even an Error';
  assert.deepEqual((await send(port, 'GET', '/collection', { headers: { 'x-account-id': 'acct' } })).json, { code: 'INTERNAL_ERROR' });
});

test('오류 응답도 공통 헤더(no-store, JSON, nosniff)를 달고 나간다', async (t) => {
  const thrown: { next: unknown } = { next: new CoinEconomyError('COIN_TICKET_EXPIRED') };
  const port = await listen(t, serverThrowing(thrown));
  const result = await send(port, 'GET', '/collection', { headers: { 'x-account-id': 'acct' } });
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
});
