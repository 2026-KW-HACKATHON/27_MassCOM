import type { IncomingMessage } from 'node:http';

import type { AccountDeletionService } from './account-deletion.js';
import type { AccountDeletionIntakeService, AccountDeletionProcessingService } from './account-deletion-intake.js';
import type { ConsentService } from './account-consent.js';
import type { AdminFunnelReader } from './admin-funnel.js';
import type { AuthSessionService } from './auth-session.js';
import type { BadgeRewardService } from './badge-rewards.js';
import type { CampaignEnrollmentService } from './campaign-enrollment.js';
import type { CampaignBenefitService } from './campaign-benefits.js';
import type { ClaimSlotService } from './claim-slot-service.js';
import type { CoinEconomyService } from './coin-economy.js';
import type { CollectibleProjectService } from './collectible-project.js';
import type { CollectionExperienceService } from './collection-experience.js';
import type { CollectionReader } from './collection.js';
import type { CourseService } from './course-rules.js';
import type { CustomerIdentityService } from './customer-identity.js';
import type { FriendService } from './friends.js';
import type { FurnitureService } from './furniture.js';
import type { GradeDrawService } from './grade-draw.js';
import type { AuthLoginLimiter } from './http/login-limiter.js';
import { requireAccountId } from './http/request-auth.js';
import type { MapProvider } from './map-provider.js';
import type { MerchantAccessControl } from './merchant-access.js';
import type { MerchantArtService } from './merchant-art.js';
import type { MerchantCatalog } from './merchant-catalog.js';
import type { CollectiblePreviewService, MerchantDetailViewService } from './merchant-discovery.js';
import type { MerchantOperations } from './merchant-operations.js';
import type { MerchantOverviewReader } from './merchant-overview-rules.js';
import type { MerchantProfileService } from './merchant-profile.js';
import type { MileageShopService } from './mileage-shop.js';
import type { MintRequestService } from './mint-request-service.js';
import type { NftMetadataReader } from './nft-metadata.js';
import type { NotificationService } from './notifications.js';
import type { PlayService } from './play.js';
import type { PostgresAdminService } from './postgres/admin.js';
import type { PostgresRealWorldService } from './postgres/real-world.js';
import type { PostgresStaffRegistration } from './postgres/staff-registration.js';
import type { RecommendationReader } from './recommendation-service.js';
import type { ReversalService } from './reversal.js';
import type { RoomCommunityService } from './room-community.js';
import type { ShowcaseAccessRequestService } from './showcase/access-requests.js';
import type { ShowcaseGuestTrialService } from './showcase/guest-trials.js';
import type { SocialService } from './social.js';
import type { StoreTicketService } from './store-tickets.js';
import type { TmapProvider } from './tmap-provider.js';
import type { VisitorFeedbackService } from './visitor-feedback.js';
import type { WalletChallengeService } from './wallet-challenge-service.js';
import type { WebAuthHandler } from './web-auth.js';

export type AccountResolver = (request: IncomingMessage) => string | Promise<string>;
export type ReauthenticationGuard = (
  accountId: string,
  request: IncomingMessage,
) => string | void | Promise<string | void>;

export const developmentHeaderAccountResolver: AccountResolver = requireAccountId;

export type ExperienceServices = {
  furniture?: FurnitureService | undefined;
  gradeDraw?: GradeDrawService | undefined;
  coinEconomy?: CoinEconomyService | undefined;
  roomCommunity?: RoomCommunityService | undefined;
  collectionExperience?: CollectionExperienceService | undefined;
  merchantOperations?: MerchantOperations | undefined;
  notifications?: NotificationService | undefined;
  realWorld?: PostgresRealWorldService | undefined;
  tmap?: TmapProvider | undefined;
  mapProvider?: MapProvider | undefined;
};

export type AdminServices = Pick<PostgresAdminService, 'isAdmin' | 'listMerchants' | 'createMerchant' | 'updateMerchant' | 'hideMerchant'> &
    Partial<Pick<PostgresAdminService, 'operationsStatus' | 'listCampaignDrafts' | 'createCampaignDraft' |
    'listMerchantCoupons' | 'voidCoupon' | 'publishMerchant' | 'listOwners' | 'promoteOwner' | 'demoteOwner' |
    'listRewardOffers' | 'createRewardOffer' | 'pauseRewardOffer' | 'listCampaigns' | 'publishCampaign' |
    'pauseCampaign' | 'extendCampaign'>>;

/**
 * createApiServer가 받는 의존성. 키 이름이 곧 서비스 이름이고 service·baseAccountResolver만 필수다.
 * exactOptionalPropertyTypes라서 선택 키는 `?: T | undefined`로 적어 `undefined`를 그대로 넘길 수 있다.
 */
export type ApiDeps = {
  service: WalletChallengeService;
  baseAccountResolver: AccountResolver;
  merchantCatalog?: MerchantCatalog | undefined;
  merchantAccess?: MerchantAccessControl | undefined;
  claimSlots?: ClaimSlotService | undefined;
  collection?: CollectionReader | undefined;
  recommendations?: RecommendationReader | undefined;
  courses?: CourseService | undefined;
  mintRequests?: MintRequestService | undefined;
  accountDeletions?: AccountDeletionService | undefined;
  requireReauthentication?: ReauthenticationGuard | undefined;
  campaignEnrollments?: CampaignEnrollmentService | undefined;
  campaignBenefits?: CampaignBenefitService | undefined;
  authSessions?: AuthSessionService | undefined;
  authLoginLimiter?: AuthLoginLimiter | undefined;
  trustProxyClientIp?: boolean | undefined;
  webAuth?: WebAuthHandler | undefined;
  webWwwEnabled?: boolean | undefined;
  customerIdentities?: CustomerIdentityService | undefined;
  admin?: AdminServices | undefined;
  deletionIntake?: AccountDeletionIntakeService | undefined;
  staffRegistration?: Pick<PostgresStaffRegistration, 'request' | 'approve' | 'revoke' | 'mine' | 'eligible' | 'list'> | undefined;
  badges?: BadgeRewardService | undefined;
  friends?: FriendService | undefined;
  merchantArt?: MerchantArtService | undefined;
  showcaseDeletionIntake?: AccountDeletionIntakeService | undefined;
  deletionProcessing?: AccountDeletionProcessingService | undefined;
  reversals?: ReversalService | undefined;
  consent?: ConsentService | undefined;
  nftMetadata?: NftMetadataReader | undefined;
  collectibleProjects?: CollectibleProjectService | undefined;
  mileageShop?: MileageShopService | undefined;
  accessRequests?: Pick<ShowcaseAccessRequestService, 'mine' | 'request' | 'listPending' | 'decide'> | undefined;
  guestTrials?: Pick<ShowcaseGuestTrialService, 'start' | 'resolve'> | undefined;
  merchantOverview?: MerchantOverviewReader | undefined;
  visitorFeedback?: VisitorFeedbackService | undefined;
  collectiblePreview?: CollectiblePreviewService | undefined;
  merchantDetailViews?: MerchantDetailViewService | undefined;
  adminFunnel?: AdminFunnelReader | undefined;
  play?: PlayService | undefined;
  merchantProfile?: MerchantProfileService | undefined;
  experienceServices?: ExperienceServices | undefined;
  storeTickets?: StoreTicketService | undefined;
  social?: SocialService | undefined;
};

/** createApiServer가 기본값(꺼짐·빈 객체)을 한 번 채우고 얼린 deps. 런타임과 경로 처리기는 이 값을 `??` 없이 그대로 읽는다. */
export type ResolvedApiDeps = ApiDeps & {
  trustProxyClientIp: boolean;
  webWwwEnabled: boolean;
  experienceServices: ExperienceServices;
};
