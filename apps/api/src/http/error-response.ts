import type { ServerResponse } from 'node:http';

import { AccountDeletionError } from '../account-deletion.js';
import { AccountDeletionIntakeError } from '../account-deletion-intake.js';
import { ConsentError } from '../account-consent.js';
import { AuthSessionError } from '../auth-session.js';
import { BadgeRewardError } from '../badge-rewards.js';
import { CampaignEnrollmentError } from '../campaign-enrollment.js';
import { CampaignBenefitError } from '../campaign-benefits.js';
import { ClaimSlotError } from '../claim-slot-service.js';
import { CoinEconomyError } from '../coin-economy.js';
import { CollectibleProjectError } from '../collectible-project.js';
import { ExperienceError } from '../collection-experience.js';
import { CustomerIdentityError } from '../customer-identity.js';
import { FriendError } from '../friends.js';
import { FurnitureError } from '../furniture.js';
import { GoogleIdTokenError } from '../google-id-token.js';
import { GradeDrawError } from '../grade-draw.js';
import { MerchantAccessError } from '../merchant-access.js';
import { MerchantArtError } from '../merchant-art.js';
import { MerchantDiscoveryError } from '../merchant-discovery.js';
import { MerchantOperationError } from '../merchant-operations.js';
import { MerchantOverviewError } from '../merchant-overview-rules.js';
import { MerchantProfileError } from '../merchant-profile.js';
import { MileageShopError } from '../mileage-shop.js';
import { MintRequestError } from '../mint-request-service.js';
import { NotificationError } from '../notifications.js';
import { PlayError } from '../play.js';
import { RealWorldError } from '../real-world-contract.js';
import { ReversalError } from '../reversal.js';
import { RoomCommunityError } from '../room-community.js';
import { safeErrorMetadata } from '../security-log.js';
import { SocialError, socialErrorStatus } from '../social.js';
import { SocialHttpError } from '../social-http.js';
import { StoreTicketError } from '../store-tickets.js';
import { VisitorFeedbackError } from '../visitor-feedback.js';
import { WalletChallengeError } from '../wallet-challenge-service.js';
import { WebAuthError } from '../web-auth.js';
import { WebOriginError } from '../web-origin.js';
import { WebSessionError } from '../web-session.js';
import { AdminError } from '../postgres/admin.js';
import { StaffRegistrationError } from '../postgres/staff-registration.js';
import { ShowcaseAccessRequestError } from '../showcase/access-requests.js';
import { GuestTrialError } from '../showcase/guest-trials.js';
import { RequestError } from './request-error.js';
import { sendJson } from './response.js';

/** 서비스·요청 처리 중 던져진 오류를 HTTP 응답으로 바꾼다. 아는 오류는 상태·코드(필요하면 Retry-After)를, 모르는 오류는 500 INTERNAL_ERROR를 낸다. */
export function respondWithError(response: ServerResponse, error: unknown): void {
  if (error instanceof RealWorldError) {
    sendJson(response, error.status, { code: error.code, ...(error.retryable ? { retryable: true } : {}) });
    return;
  }
  if (error instanceof ExperienceError) {
    sendJson(response, error.code === 'ACCOUNT_DELETED' ? 410 : error.code === 'EXPERIENCE_FRIEND_NOT_FOUND' ? 404
      : error.code === 'EXPERIENCE_LOCKED' ? 403 : 400, { code: error.code });
    return;
  }
  if (error instanceof NotificationError) {
    sendJson(response, error.code === 'NOT_FOUND' ? 404 : 400, { code: error.code });
    return;
  }
  if (error instanceof MerchantOperationError) {
    sendJson(response, error.code === 'MERCHANT_OPERATION_FORBIDDEN' ? 403
      : error.code === 'MERCHANT_OPERATION_NOT_FOUND' || error.code === 'MERCHANT_OPERATION_STAFF_NOT_FOUND' ? 404
      : error.code === 'MERCHANT_OPERATION_CONFLICT' ? 409 : 400, { code: error.code });
    return;
  }
  if (error instanceof PlayError) {
    const status = error.code === 'ACCOUNT_DELETED' ? 410
      : error.code === 'PLAY_RUN_NOT_FOUND' || error.code === 'FRIEND_STUDIO_NOT_FOUND' ? 404
      : error.code === 'PLAY_RATE_LIMITED' ? 429
      : error.code === 'PLAY_RUN_EXPIRED' || error.code === 'STUDIO_VERSION_CONFLICT' ? 409 : 400;
    sendJson(response, status, { code: error.code });
    return;
  }
  if (error instanceof CoinEconomyError) {
    sendJson(response, error.code === 'ACCOUNT_DELETED' ? 410 : error.code === 'INVALID_REQUEST' ? 400
      : error.code === 'COIN_TICKET_NOT_FOUND' || error.code === 'COIN_REROLL_TICKET_NOT_FOUND'
        || error.code === 'COIN_REROLL_SOURCE_NOT_FOUND' || error.code === 'COIN_OWNED_DETAIL_NOT_FOUND'
        ? 404 : 409, { code: error.code }); return;
  }
  if (error instanceof GradeDrawError) {
    sendJson(response, error.code === 'ACCOUNT_DELETED' ? 410 : error.code === 'INVALID_REQUEST' ? 400
      : error.code === 'DRAW_RATE_LIMITED' ? 429 : 409, { code: error.code }); return;
  }
  if (error instanceof RoomCommunityError) {
    sendJson(response, error.code === 'ACCOUNT_DELETED' ? 410
      : error.code === 'ROOM_NOT_FOUND' || error.code === 'ROOM_STAMP_NOT_FOUND' ? 404
      : error.code === 'ROOM_RATE_LIMITED' ? 429 : error.code === 'ROOM_CONSENT_REQUIRED' ? 403
      : error.code === 'ROOM_STAMP_LIMIT' ? 409 : 400, { code: error.code }); return;
  }
  if (error instanceof FurnitureError) {
    sendJson(response, error.code === 'ACCOUNT_DELETED' ? 410
      : error.code === 'FURNITURE_UNAVAILABLE' ? 404
      : error.code === 'FURNITURE_REQUEST_CONFLICT' || error.code === 'FURNITURE_INSUFFICIENT_MILEAGE' ? 409 : 400,
    { code: error.code }); return;
  }
  if (error instanceof CollectibleProjectError) {
    const status = error.code === 'COLLECTIBLE_INVALID_PROJECT' ? 400
      : error.code === 'COLLECTIBLE_MEDIA_TOO_LARGE' ? 413
      : error.code === 'COLLECTIBLE_PROJECT_NOT_FOUND' || error.code === 'COLLECTIBLE_NOT_FOUND' ? 404
      : error.code === 'ACCOUNT_DELETED' ? 410 : 409;
    sendJson(response, status, { code: error.code });
    return;
  }
  if (error instanceof ClaimSlotError) {
    sendJson(response, statusForClaimSlot(error.code), { code: error.code });
    return;
  }
  if (error instanceof CustomerIdentityError) {
    sendJson(response, error.code === 'ACCOUNT_DELETED' || error.code === 'CUSTOMER_IDENTITY_EXPIRED' ? 410 : 409, { code: error.code });
    return;
  }
  if (error instanceof BadgeRewardError) {
    sendJson(response, statusForBadgeReward(error.code), { code: error.code });
    return;
  }
  if (error instanceof CampaignBenefitError) {
    const status = error.code === 'ACCOUNT_DELETED' ? 410
      : error.code === 'ADMIN_FORBIDDEN' || error.code === 'OWNER_FORBIDDEN' || error.code === 'BENEFIT_NOT_ELIGIBLE' ? 403
      : error.code === 'CAMPAIGN_NOT_FOUND' || error.code === 'BENEFIT_NOT_FOUND' ? 404
      : error.code === 'ADMIN_INVALID_INPUT' || error.code === 'ADMIN_DOCUMENT_REF_INVALID' ? 400 : 409;
    sendJson(response, status, { code: error.code });
    return;
  }
  if (error instanceof ReversalError) {
    sendJson(response, statusForReversal(error.code), { code: error.code });
    return;
  }
  if (error instanceof MileageShopError) {
    if (error.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    sendJson(response, statusForMileageShop(error.code), { code: error.code });
    return;
  }
  if (error instanceof MerchantDiscoveryError) {
    sendJson(response, 404, { code: error.code });
    return;
  }
  if (error instanceof VisitorFeedbackError) {
    sendJson(response, statusForVisitorFeedback(error.code), { code: error.code });
    return;
  }
  if (error instanceof ConsentError) {
    sendJson(response, error.code === 'ACCOUNT_DELETED' ? 410 : error.code === 'CONSENT_VERSION_MISMATCH' ? 409 : 400,
      { code: error.code });
    return;
  }
  if (error instanceof FriendError) {
    if (error.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    sendJson(response, statusForFriend(error.code), { code: error.code });
    return;
  }
  if (error instanceof StoreTicketError) {
    sendJson(response, error.code === 'STORE_TICKET_NOT_FOUND' ? 404 : 400, { code: error.code });
    return;
  }
  if (error instanceof SocialError || error instanceof SocialHttpError) {
    if (error instanceof SocialError && error.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    sendJson(response, error instanceof SocialHttpError ? error.status : socialErrorStatus(error.code), { code: error.code });
    return;
  }
  if (error instanceof MerchantArtError) {
    if (error.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    sendJson(response, statusForMerchantArt(error.code), {
      code: error.code,
      ...(error.code === 'AI_ART_TRIAL_DISABLED' ? { message: '체험 가게에서는 AI 그림을 만들 수 없어요.' } : {}),
    });
    return;
  }
  if (error instanceof MerchantAccessError) {
    sendJson(response, 403, { code: error.code });
    return;
  }
  if (error instanceof MerchantProfileError) {
    const status = error.code === 'MERCHANT_PROFILE_INVALID' ? 400
      : error.code === 'MERCHANT_PROFILE_VERSION_CONFLICT' ? 409 : 403;
    sendJson(response, status, { code: error.code });
    return;
  }
  if (error instanceof MerchantOverviewError) {
    sendJson(response, 404, { code: error.code });
    return;
  }
  if (error instanceof AdminError) {
    sendJson(response, statusForAdmin(error.code), { code: error.code });
    return;
  }
  if (error instanceof StaffRegistrationError) {
    const status = error.code === 'STAFF_FORBIDDEN' ? 403
      : error.code === 'STAFF_MERCHANT_NOT_FOUND' || error.code === 'STAFF_NOT_FOUND' ? 404
        : error.code === 'STAFF_CODE_INVALID' ? 400 : 409;
    sendJson(response, status, { code: error.code });
    return;
  }
  if (error instanceof GuestTrialError) {
    sendJson(response, error.code === 'GUEST_TRIAL_IP_LIMIT' ? 429 : 503, { code: error.code });
    return;
  }
  if (error instanceof ShowcaseAccessRequestError) {
    const status = error.code === 'SHOWCASE_APPROVER_REQUIRED' || error.code === 'SHOWCASE_ACCESS_SELF_DECISION' ? 403
      : error.code === 'SHOWCASE_ACCESS_REQUEST_NOT_FOUND' ? 404
        : error.code === 'ACCOUNT_DELETED' ? 410 : 409;
    sendJson(response, status, { code: error.code });
    return;
  }
  if (error instanceof WalletChallengeError) {
    sendJson(response, statusFor(error.code), { code: error.code });
    return;
  }
  if (error instanceof MintRequestError) {
    sendJson(response, statusForMintRequest(error.code), { code: error.code });
    return;
  }
  if (error instanceof AuthSessionError) {
    sendJson(response, statusForAuthSession(error.code), { code: error.code });
    return;
  }
  if (error instanceof GoogleIdTokenError) {
    sendJson(response, error.code === 'ID_TOKEN_KEY_SET_UNAVAILABLE' ? 503 : 401, {
      code: error.code,
    });
    return;
  }
  if (error instanceof WebOriginError) {
    sendJson(response, 403, { code: error.code });
    return;
  }
  if (error instanceof WebAuthError || error instanceof WebSessionError) {
    sendJson(response, error.code === 'WEB_AUTH_UPSTREAM_UNAVAILABLE' ? 503 : 401, {
      code: error.code,
      ...(error.code === 'WEB_AUTH_UPSTREAM_UNAVAILABLE'
        ? { message: 'Google 연결을 확인할 수 없습니다. 운영 웹으로 돌아가 새 로그인을 시작해 주세요.', next: '/app/' }
        : {}),
    });
    return;
  }
  if (error instanceof AccountDeletionError) {
    sendJson(response, statusForAccountDeletion(error.code), { code: error.code });
    return;
  }
  if (error instanceof AccountDeletionIntakeError) {
    sendJson(response, statusForDeletionIntake(error.code), { code: error.code });
    return;
  }
  if (error instanceof CampaignEnrollmentError) {
    sendJson(response, statusForCampaignEnrollment(error.code), { code: error.code });
    return;
  }
  if (error instanceof RequestError) {
    sendJson(response, error.status, { code: error.code });
    return;
  }

  console.error(safeErrorMetadata('api.unhandled', error));
  sendJson(response, 500, { code: 'INTERNAL_ERROR' });
}

function statusForAuthSession(code: string): number {
  if (code === 'IDENTITY_MISMATCH' || code === 'INVITE_REQUIRED') return 403;
  return 401;
}

function statusForAccountDeletion(code: string): number {
  if (code === 'REAUTHENTICATION_REQUIRED') return 401;
  if (code === 'ACCOUNT_REQUIRED') return 401;
  return 400;
}

function statusForDeletionIntake(code: string): number {
  if (code === 'DELETION_NO_ACTIVE_REQUEST' || code === 'DELETION_RECEIPT_NOT_FOUND' || code === 'DELETION_INTAKE_NOT_FOUND') return 404;
  if (code === 'DELETION_SELF_PROCESSING_REFUSED') return 403;
  if (code === 'DELETION_REJECT_REASON_INVALID') return 400;
  return 409;
}

function statusFor(code: string): number {
  if (code === 'ACCOUNT_AUTH_NOT_CONFIGURED') return 503;
  if (code === 'ACCOUNT_REQUIRED' || code === 'SIGNER_MISMATCH') return 401;
  if (code === 'ACCOUNT_MISMATCH') return 403;
  if (code === 'CHALLENGE_NOT_FOUND') return 404;
  if (code === 'SIGNATURE_EXPIRED') return 410;
  if (code === 'NONCE_ALREADY_USED' || code === 'NONCE_IN_PROGRESS') return 409;
  if (code === 'WALLET_BINDING_NOT_FOUND') return 404;
  if (code === 'ACCOUNT_DELETED') return 410;
  if (code === 'WALLET_ADDRESS_IN_USE' || code === 'WALLET_BINDING_CHANGED') return 409;
  return 400;
}

function statusForClaimSlot(code: string): number {
  if (code === 'CLAIM_TOKEN_EXPIRED' || code === 'CUSTOMER_IDENTITY_EXPIRED') return 410;
  if (code === 'ACCOUNT_DELETED') return 410;
  if (code === 'SHOWCASE_MERCHANT_NOT_FOUND') return 404;
  return 409;
}

function statusForBadgeReward(code: string): number {
  if (code === 'COUPON_NOT_FOUND') return 404;
  if (code === 'COUPON_SELF_REDEEM') return 403;
  if (code === 'ACCOUNT_DELETED') return 410;
  return 409;
}

function statusForFriend(code: string): number {
  if (code === 'FRIEND_CODE_NOT_FOUND' || code === 'FRIEND_NOT_FOUND' || code === 'FRIEND_NEIGHBOR_NOT_FOUND') return 404;
  if (code === 'FRIEND_CODE_RATE_LIMITED') return 429;
  if (code === 'FRIEND_NICKNAME_INVALID' || code === 'PROFILE_INTRO_INVALID') return 400;
  if (code === 'ACCOUNT_DELETED') return 410;
  return 409;
}

function statusForMerchantArt(code: string): number {
  if (code === 'AI_ART_ROUND_NOT_FOUND') return 404;
  if (code === 'AI_ART_DAILY_LIMIT') return 429;
  if (code === 'AI_ART_TRIAL_DISABLED') return 403;
  if (code === 'AI_ART_NOT_CONFIGURED' || code === 'AI_ART_BUDGET_EXHAUSTED') return 503;
  if (code === 'ACCOUNT_DELETED') return 410;
  return 409;
}

function statusForReversal(code: string): number {
  if (code === 'INVALID_REVERSAL_REASON' || code === 'INVALID_REVERSAL_NOTE') return 400;
  if (code === 'COUPON_SELF_UNDO') return 403;
  if (code === 'VISIT_NOT_FOUND' || code === 'COUPON_NOT_FOUND') return 404;
  if (code === 'ACCOUNT_DELETED') return 410;
  return 409;
}

function statusForMileageShop(code: string): number {
  if (code === 'INVALID_REQUEST') return 400;
  if (code === 'SHOP_INSUFFICIENT_MILEAGE') return 402;
  if (code === 'SHOP_ITEM_NOT_OWNED' || code === 'SHOP_CLOTHING_NOT_OWNED') return 404;
  if (code === 'ACCOUNT_DELETED') return 410;
  if (code === 'SHOP_RATE_LIMITED') return 429;
  // SHOP_GRADE_COMPLETE, SHOP_STATE_CHANGED, SHOP_REQUEST_CONFLICT
  return 409;
}

function statusForVisitorFeedback(code: string): number {
  if (code === 'VISITOR_FEEDBACK_NOT_ELIGIBLE') return 403;
  if (code === 'ACCOUNT_DELETED') return 410;
  // VISITOR_FEEDBACK_TAGS_INVALID, VISITOR_FEEDBACK_SUGGESTIONS_INVALID, VISITOR_FEEDBACK_NOTE_INVALID
  return 400;
}

function statusForAdmin(code: AdminError['code']): number {
  switch (code) {
    case 'ADMIN_FORBIDDEN':
    case 'ADMIN_SELF_ROLE_CHANGE':
      return 403;
    case 'ADMIN_MERCHANT_NOT_FOUND':
    case 'ADMIN_IDENTITY_NOT_FOUND':
    case 'ADMIN_COUPON_NOT_FOUND':
    case 'ADMIN_MEMBER_NOT_FOUND':
    case 'ADMIN_OFFER_NOT_FOUND':
    case 'ADMIN_CAMPAIGN_NOT_FOUND':
      return 404;
    case 'ADMIN_VERSION_CONFLICT':
    case 'ADMIN_PENDING_CLAIMS':
    case 'ADMIN_COUPON_NOT_VOIDABLE':
    case 'ADMIN_MERCHANT_NOT_READY':
    case 'ADMIN_MERCHANT_ALREADY_ACTIVE':
    case 'ADMIN_MERCHANT_NOT_ACTIVE':
    case 'ADMIN_ALREADY_OWNER':
    case 'ADMIN_OWNER_LIMIT':
    case 'ADMIN_OFFER_MILESTONE_TAKEN':
    case 'ADMIN_CAMPAIGN_NOT_PUBLISHABLE':
    case 'ADMIN_CAMPAIGN_NOT_PAUSABLE':
    case 'ADMIN_CAMPAIGN_NOT_EXTENDABLE':
    case 'ADMIN_CAMPAIGN_EXTENSION_LIMIT':
    case 'ADMIN_CAMPAIGN_ACTIVE_EXISTS':
      return 409;
    default:
      return 400;
  }
}

function statusForMintRequest(code: string): number {
  if (code === 'ENTITLEMENT_NOT_FOUND' || code === 'WALLET_BINDING_NOT_FOUND' || code === 'MINT_JOB_NOT_FOUND') {
    return 404;
  }
  if (code === 'CONSENT_REQUIRED' || code === 'CONSENT_VERSION_OUTDATED' || code === 'IDEMPOTENCY_KEY_REQUIRED') return 400;
  if (code === 'ACCOUNT_DELETED') return 410;
  return 409;
}

function statusForCampaignEnrollment(code: string): number {
  if (code === 'CAMPAIGN_NOT_FOUND') return 404;
  if (code === 'ACCOUNT_DELETED') return 410;
  if (code === 'CAMPAIGN_FULL' || code === 'CAMPAIGN_NOT_AVAILABLE') return 409;
  return 409;
}
