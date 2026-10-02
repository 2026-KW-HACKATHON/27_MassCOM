import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  AccountDeletionError,
  type AccountDeletionService,
} from './account-deletion.js';
import { ConsentError, type ConsentService } from './account-consent.js';
import { AuthSessionError, type AuthSessionService } from './auth-session.js';
import { BadgeRewardError, type BadgeRewardService } from './badge-rewards.js';
import { OpenAiImageClient } from './ai-art-client.js';
import { aiArtStartupLine, resolveAiArtConfigOrDisabled } from './ai-art-rules.js';
import { isRewardMilestone } from './badge-rules.js';
import { ClaimSlotError, type ClaimSlotService } from './claim-slot-service.js';
import { CustomerIdentityError, type CustomerIdentityService } from './customer-identity.js';
import { FriendError, type FriendService } from './friends.js';
import { GoogleIdTokenError, GoogleIdTokenVerifier } from './google-id-token.js';
import { WebAuthError, WebAuthService, resolveWebAuthConfig, type WebAuthHandler } from './web-auth.js';
import { WebSessionError, freshWebSessionMs } from './web-session.js';
import { WebOriginError, resolveWebOrigin } from './web-origin.js';
import {
  AccountDeletionIntakeError,
  type AccountDeletionIntakeService,
  type AccountDeletionProcessingService,
} from './account-deletion-intake.js';
import {
  CampaignEnrollmentError,
  type CampaignEnrollmentService,
} from './campaign-enrollment.js';
import { parseNftMintingMode, type CollectionReader } from './collection.js';
import { collectibleBodyLimit, CollectibleProjectError, type CollectibleProjectService } from './collectible-project.js';
import {
  InMemoryChallengeStore,
  WalletChallengeError,
  WalletChallengeService,
  type ChallengeStore,
} from './wallet-challenge-service.js';
import {
  MerchantAccessError,
  type MerchantAccessControl,
} from './merchant-access.js';
import { MerchantArtError, type MerchantArtService } from './merchant-art.js';
import { DEFAULT_STAMP_V1_PNG } from './nft-default-stamp.js';
import { matchNftMetadataRoute, type NftMetadataReader } from './nft-metadata.js';
import type { MerchantCatalog } from './merchant-catalog.js';
import {
  MintRequestError, mintConsentVersionFromEnv, refuseMintRequestsWhilePreparing, type MintRequestService,
} from './mint-request-service.js';
import { ReversalError, type ReversalService } from './reversal.js';
import { MileageShopError, type MileageShopService } from './mileage-shop.js';
import { isMileageGrade } from './mileage-rules.js';
import { VisitorFeedbackError, type VisitorFeedbackService } from './visitor-feedback.js';
import {
  RecommendationService,
  type RecommendationReader,
} from './recommendation-service.js';
import { safeErrorMetadata } from './security-log.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresCustomerIdentityService } from './postgres/customer-identity.js';
import { PostgresCampaignEnrollmentService } from './postgres/campaign-enrollment.js';
import { PostgresAccountConsentService } from './postgres/account-consent.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountDeletionIntakeService } from './postgres/account-deletion-intake.js';
import { PostgresAccountDeletionProcessingService } from './postgres/account-deletion-processing.js';
import { PostgresBadgeRewardService } from './postgres/badge-rewards.js';
import { PostgresFriendService } from './postgres/friends.js';
import { AdminError, PostgresAdminService, type AdminCampaignDraftInput, type MerchantInput } from './postgres/admin.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAuthSessionService } from './postgres/auth-session.js';
import { PostgresWebSessionStore } from './postgres/web-session.js';
import { resolveShowcaseInviteConfig } from './showcase/invite-config.js';
import { isPermittedShowcaseDatabaseName } from './showcase/local-seed.js';
import { ShowcaseAccessRequestError, ShowcaseAccessRequestService } from './showcase/access-requests.js';
import { GuestTrialError, ShowcaseGuestTrialService } from './showcase/guest-trials.js';
import { PostgresCollectionReader } from './postgres/collection.js';
import { PostgresCollectibleProjectService } from './postgres/collectible-project.js';
import { PostgresMerchantAccessControl } from './postgres/merchant-access.js';
import { PostgresMerchantArtService } from './postgres/merchant-art.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { PostgresNftMetadataReader } from './postgres/nft-metadata.js';
import { PostgresStaffRegistration, StaffRegistrationError } from './postgres/staff-registration.js';
import { PostgresMintRequestService } from './postgres/mint-request-service.js';
import { PostgresReversalService } from './postgres/reversal.js';
import { PostgresMileageShopService } from './postgres/mileage-shop.js';
import { PostgresVisitorFeedbackService } from './postgres/visitor-feedback.js';
import { PostgresRecommendationSource } from './postgres/recommendation.js';
import { PostgresChallengeStore } from './postgres/wallet-challenge-store.js';
import { PostgresWalletBindingStore } from './postgres/wallet-binding.js';
import { InMemoryWalletBindingStore, type WalletBindingStore } from './wallet-binding.js';

const MAX_BODY_BYTES = 64 * 1024;
// 토큰 메타데이터·가게 그림은 하루만 캐시한다: 운영자가 거부 목록으로 내리면 늦어도 하루 안에 사라진다(Issue #254).
// 판이 붙은 기본 도장만 바이트가 영원히 같아 immutable이다.
const nftMetadataCacheControl = 'public, max-age=86400';
const qrCode = createRequire(import.meta.url)('qrcode') as {
  toString(value: string, options: { type: 'svg'; margin: number }): Promise<string>;
};

export async function renderClaimQr(token: string, render = qrCode.toString): Promise<
  { qrSvgDataUrl: string } | { qrRenderFailed: true }
> {
  try {
    const svg = await render(token, { type: 'svg', margin: 2 });
    return { qrSvgDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
  } catch { return { qrRenderFailed: true }; }
}

export type AuthLoginLimiter = {
  consume(key: string): { allowed: boolean; retryAfterSeconds: number };
};

type LoginLimiterOptions = {
  maxAttempts: number;
  windowMs: number;
  maxEntries?: number;
  now?: () => Date;
};

export class FixedWindowAuthLoginLimiter implements AuthLoginLimiter {
  private readonly buckets = new Map<string, { count: number; startedAt: number }>();
  private readonly maxEntries: number;
  private readonly now: () => Date;

  constructor(private readonly options: LoginLimiterOptions) {
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts <= 0) {
      throw new Error('auth login max attempts must be a positive safe integer');
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
      throw new Error('auth login window must be a positive safe integer');
    }
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? (() => new Date());
  }

  consume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now().getTime();
    const existing = this.buckets.get(key);
    if (!existing || now - existing.startedAt >= this.options.windowMs) {
      if (!existing && this.buckets.size >= this.maxEntries) {
        const oldest = this.buckets.keys().next().value as string | undefined;
        if (oldest) this.buckets.delete(oldest);
      }
      this.buckets.set(key, { count: 1, startedAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (existing.count >= this.options.maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.startedAt + this.options.windowMs - now) / 1000),
        ),
      };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export type AccountResolver = (request: IncomingMessage) => string | Promise<string>;
export type ReauthenticationGuard = (
  accountId: string,
  request: IncomingMessage,
) => string | void | Promise<string | void>;

export const developmentHeaderAccountResolver: AccountResolver = requireAccountId;
export const createBearerAccountResolver =
  (sessions: AuthSessionService): AccountResolver =>
  (request) =>
    sessions.resolve(requireBearerToken(request));
export const createSessionReauthenticationGuard =
  (sessions: AuthSessionService): ReauthenticationGuard =>
  async (_accountId, request) => {
    const sessionToken = requireBearerToken(request);
    await sessions.assertRecentlyAuthenticated(sessionToken);
    return sessionToken;
  };
export const developmentHeaderReauthenticationGuard: ReauthenticationGuard = (
  _accountId,
  request,
) => {
  if (request.headers['x-demo-reauthenticated'] !== 'true') {
    throw new AccountDeletionError('REAUTHENTICATION_REQUIRED');
  }
};

export function createApiServer(
  service: WalletChallengeService,
  baseAccountResolver: AccountResolver,
  merchantCatalog?: MerchantCatalog,
  merchantAccess?: MerchantAccessControl,
  claimSlots?: ClaimSlotService,
  collection?: CollectionReader,
  recommendations?: RecommendationReader,
  mintRequests?: MintRequestService,
  accountDeletions?: AccountDeletionService,
  requireReauthentication?: ReauthenticationGuard,
  campaignEnrollments?: CampaignEnrollmentService,
  authSessions?: AuthSessionService,
  authLoginLimiter?: AuthLoginLimiter,
  trustProxyClientIp = false,
  webAuth?: WebAuthHandler,
  webWwwEnabled = false,
  customerIdentities?: CustomerIdentityService,
  admin?: Pick<PostgresAdminService, 'isAdmin' | 'listMerchants' | 'createMerchant' | 'updateMerchant' | 'hideMerchant'> &
    Partial<Pick<PostgresAdminService, 'operationsStatus' | 'listCampaignDrafts' | 'createCampaignDraft' |
      'listMerchantCoupons' | 'voidCoupon' | 'publishMerchant' | 'listOwners' | 'promoteOwner' | 'demoteOwner' |
      'listRewardOffers' | 'createRewardOffer' | 'pauseRewardOffer' | 'listCampaigns' | 'publishCampaign' |
      'pauseCampaign'>>,
  deletionIntake?: AccountDeletionIntakeService,
  staffRegistration?: Pick<PostgresStaffRegistration, 'request' | 'approve' | 'revoke' | 'mine' | 'eligible' | 'list'>,
  badges?: BadgeRewardService,
  friends?: FriendService,
  merchantArt?: MerchantArtService,
  showcaseDeletionIntake?: AccountDeletionIntakeService,
  deletionProcessing?: AccountDeletionProcessingService,
  reversals?: ReversalService,
  consent?: ConsentService,
  nftMetadata?: NftMetadataReader,
  collectibleProjects?: CollectibleProjectService,
  mileageShop?: MileageShopService,
  accessRequests?: Pick<ShowcaseAccessRequestService, 'mine' | 'request' | 'listPending' | 'decide'>,
  guestTrials?: Pick<ShowcaseGuestTrialService, 'start' | 'resolve'>,
  visitorFeedback?: VisitorFeedbackService,
) {
  // 로컬 시연(DEMO 헤더) 배치에서는 체험 세션 Bearer도 받는다(#309). Authorization이 없으면 기존 헤더 해석 그대로이고,
  // 운영·hosted 해석기(Bearer 세션)는 이미 같은 auth_sessions 행으로 체험 세션을 푼다.
  const resolveAccountId: AccountResolver = guestTrials && baseAccountResolver === developmentHeaderAccountResolver
    ? (request) => request.headers.authorization === undefined
      ? baseAccountResolver(request) : guestTrials.resolve(requireBearerToken(request))
    : baseAccountResolver;
  // 로그인 없는 체험 시작의 짧은 폭주 제한: IP당 15분에 20번(#309). 심사장처럼 한 NAT를 여럿이 나눠 써도 막히지 않게 넉넉히 두고,
  // 한 IP의 끝나지 않은 체험 수(30)와 전역 상한(300)은 서비스가 트랜잭션 안에서 따로 지킨다.
  const guestTrialLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 20, windowMs: 15 * 60 * 1000 });
  // The receipt lookup needs no login, so it is throttled per client instead (a receipt has 80 bits, this only stops floods).
  const deletionStatusLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 30, windowMs: 60_000 });
  // 계정당 5회/시간(#294). IP가 아니라 계정으로 거는 건 승인 전 계정도 로그인은 됐기 때문이다.
  const showcaseAccessRequestLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 5, windowMs: 60 * 60 * 1000 });
  // 계정당 10회/시간(#295). 가상 점포 방문이라 점주 쪽 쿨다운은 없지만, 발급 자체를 계정별로 묶어 둔다.
  const showcaseTestVisitLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 10, windowMs: 60 * 60 * 1000 });
  // 방문 후 가게 특징·바라는 점·의견 저장은 계정당 30회/시간(#334). 같은 가게를 고쳐 쓰는 것도 한 번으로 센다.
  const visitorFeedbackWriteLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 30, windowMs: 60 * 60 * 1000 });
  // Media-bearing collectible writes (create/save/copy/publish parse up to 8 MiB and decode every image) are throttled per store.
  const collectibleWriteLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 20, windowMs: 60_000 });
  const consumeDeletionStatus = (request: IncomingMessage, response: ServerResponse): boolean => {
    const decision = deletionStatusLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
    if (decision.allowed) return true;
    response.setHeader('Retry-After', String(decision.retryAfterSeconds));
    sendJson(response, 429, { code: 'DELETION_STATUS_RATE_LIMITED' });
    return false;
  };
  return createServer(async (request, response) => {
    setCommonHeaders(response);

    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }

      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (path === '/api/web/auth/start' && request.method === 'GET') {
        const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
        if (!webAuth) throw new RequestError(503, 'WEB_AUTH_NOT_CONFIGURED');
        if (authLoginLimiter) {
          const decision = authLoginLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
          if (!decision.allowed) {
            response.setHeader('Retry-After', String(decision.retryAfterSeconds));
            sendJson(response, 429, { code: 'LOGIN_RATE_LIMITED' });
            return;
          }
        }
        const returnTo = new URL(request.url!, 'http://localhost').searchParams.get('returnTo') === 'account-deletion'
          ? '/account-deletion' : undefined;
        const started = await webAuth.start(origin, returnTo);
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        response.setHeader('set-cookie', `web_auth_state=${started.state}; Path=/api/web/auth; Max-Age=300; HttpOnly; Secure; SameSite=Lax`);
        response.setHeader('location', started.location);
        response.writeHead(302);
        response.end();
        return;
      }
      if (path === '/api/web/auth/callback' && request.method === 'GET') {
        const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
        if (!webAuth) throw new RequestError(503, 'WEB_AUTH_NOT_CONFIGURED');
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        response.setHeader('set-cookie', 'web_auth_state=; Path=/api/web/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
        const query = new URL(request.url!, 'http://localhost').searchParams;
        if (query.getAll('code').length !== 1 || query.getAll('state').length !== 1) {
          throw new WebAuthError('WEB_AUTH_STATE_INVALID');
        }
        const session = await webAuth.complete(
          query.get('code')!, query.get('state')!, requireWebCookie(request, 'web_auth_state'),
          origin,
        );
        response.setHeader('set-cookie', [
          'web_auth_state=; Path=/api/web/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
          `web_session=${session.token}; Path=/api/web; HttpOnly; Secure; SameSite=Lax`,
        ]);
        response.setHeader('location', session.returnTo === '/merchant/' ? '/merchant/'
          : session.returnTo === '/admin/' ? '/admin/'
          : session.returnTo === '/account-deletion' ? '/account-deletion' : '/app/');
        response.writeHead(303);
        response.end();
        return;
      }
      if (path === '/api/web/collection' && request.method === 'GET') {
        const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
        if (!webAuth || !collection) throw new RequestError(503, 'WEB_COLLECTION_NOT_CONFIGURED');
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
        sendJson(response, 200, await collection.getCollection(accountId));
        return;
      }
      const acquiredCollectible = path.match(/^\/(api\/web\/)?collectibles\/([^/]+)$/);
      if (acquiredCollectible && request.method === 'GET') {
        if (!collectibleProjects) throw new RequestError(503, 'COLLECTIBLE_PROJECTS_NOT_CONFIGURED');
        let accountId: string;
        if (acquiredCollectible[1]) {
          const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
          if (!webAuth) throw new RequestError(503, 'WEB_COLLECTION_NOT_CONFIGURED');
          response.setHeader('x-robots-tag', 'noindex, nofollow');
          accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
        } else accountId = await resolveAccountId(request);
        sendJson(response, 200, await collectibleProjects.getAcquired({ accountId, entitlementId: decodePathParameter(acquiredCollectible[2]!) }));
        return;
      }
      if (path === '/api/web/badges' && request.method === 'GET') {
        const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
        if (!webAuth || !badges) throw new RequestError(503, 'WEB_BADGES_NOT_CONFIGURED');
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
        sendJson(response, 200, await badges.getBadges(accountId));
        return;
      }
      if (path === '/api/web/consent') {
        // 조회는 쿠키만 보고, 기록은 계정 삭제 접수와 같은 출처·본문 형식 검사를 거친다(다른 사이트가 쿠키로 동의를 넣지 못하게).
        if (request.method !== 'GET' && request.method !== 'POST') throw new RequestError(405, 'METHOD_NOT_ALLOWED');
        const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
        if (request.method === 'POST' && (request.headers.origin !== origin ||
            !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? ''))) {
          throw new RequestError(403, 'ORIGIN_FORBIDDEN');
        }
        if (!webAuth || !consent) throw new RequestError(503, 'WEB_CONSENT_NOT_CONFIGURED');
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
        if (request.method === 'GET') {
          sendJson(response, 200, await consent.status(accountId));
        } else {
          sendJson(response, 200, await consent.record({
            accountId, source: 'WEB', ...readConsentBody(await readJson(request)),
          }));
        }
        return;
      }
      if (path.startsWith('/api/web/admin/')) {
        const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        if (!webAuth || !admin) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
        if (path === '/api/web/admin/auth/start' && request.method === 'GET') {
          if (authLoginLimiter) {
            const decision = authLoginLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
            if (!decision.allowed) {
              response.setHeader('Retry-After', String(decision.retryAfterSeconds));
              sendJson(response, 429, { code: 'LOGIN_RATE_LIMITED' });
              return;
            }
          }
          const started = await webAuth.start(origin, '/admin/');
          response.setHeader('set-cookie', `web_auth_state=${started.state}; Path=/api/web/auth; Max-Age=300; HttpOnly; Secure; SameSite=Lax`);
          response.setHeader('location', started.location);
          response.writeHead(302).end();
          return;
        }
        if (request.method !== 'GET') {
          if (request.headers.origin !== origin ||
              !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
            throw new RequestError(403, 'ADMIN_CSRF_FORBIDDEN');
          }
        }
        const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
        if (!(await admin.isAdmin(accountId))) throw new AdminError('ADMIN_FORBIDDEN');
        if (path === '/api/web/admin/me' && request.method === 'GET') {
          sendJson(response, 200, { admin: true });
          return;
        }
        if (path === '/api/web/admin/operations-status' && request.method === 'GET') {
          if (!admin.operationsStatus) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          sendJson(response, 200, await admin.operationsStatus(accountId));
          return;
        }
        if (path === '/api/web/admin/campaign-drafts') {
          if (request.method === 'GET') {
            if (!admin.listCampaignDrafts) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
            sendJson(response, 200, { drafts: await admin.listCampaignDrafts(accountId) });
            return;
          }
          if (request.method === 'POST') {
            if (!admin.createCampaignDraft) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
            const body = await readJson(request);
            if (Object.keys(body).some(key => !['merchantId', 'title', 'startsAt', 'endsAt',
              'enrollmentCapacity', 'rewardGoals'].includes(key)) || !Array.isArray(body.rewardGoals)) {
              throw new RequestError(400, 'INVALID_REQUEST');
            }
            const input: AdminCampaignDraftInput = {
              merchantId: requireString(body, 'merchantId'), title: requireString(body, 'title'),
              startsAt: requireString(body, 'startsAt'), endsAt: requireString(body, 'endsAt'),
              enrollmentCapacity: requirePositiveInteger(body, 'enrollmentCapacity'),
              rewardGoals: body.rewardGoals as AdminCampaignDraftInput['rewardGoals'],
            };
            sendJson(response, 201, { draft: await admin.createCampaignDraft(accountId, input) });
            return;
          }
        }
        // 계정 삭제 요청 처리(#194, D-052): 웹 로그인으로 접수된 요청만 운영자가 처리한다. 화면에는 마스킹한 계정 표지만 나간다.
        if (path === '/api/web/admin/account-deletion-intakes' && request.method === 'GET') {
          if (!deletionProcessing) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          sendJson(response, 200, { intakes: await deletionProcessing.list({ kind: 'admin', accountId }) });
          return;
        }
        const deletionActionMatch = path.match(/^\/api\/web\/admin\/account-deletion-intakes\/([^/]+)\/(process|reject)$/);
        if (deletionActionMatch && request.method === 'POST') {
          if (!deletionProcessing) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          const body = await readJson(request);
          const intakeId = decodePathParameter(deletionActionMatch[1]!);
          const operator = { kind: 'admin' as const, accountId };
          if (deletionActionMatch[2] === 'process') {
            requireEmptyBody(body);
            sendJson(response, 200, { intake: await deletionProcessing.process(operator, intakeId) });
          } else {
            if (Object.keys(body).some(key => key !== 'reason')) throw new RequestError(400, 'INVALID_REQUEST');
            sendJson(response, 200, { intake: await deletionProcessing.reject(operator, intakeId, requireString(body, 'reason')) });
          }
          return;
        }
        if (path === '/api/web/admin/account-deletions/reconcile' && request.method === 'POST') {
          if (!deletionProcessing) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          requireEmptyBody(await readJson(request));
          sendJson(response, 200, await deletionProcessing.reconcile({ kind: 'admin', accountId }));
          return;
        }
        const couponListMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/coupons$/);
        if (couponListMatch && request.method === 'GET') {
          if (!admin.listMerchantCoupons) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          sendJson(response, 200, { coupons: await admin.listMerchantCoupons(accountId, decodePathParameter(couponListMatch[1]!)) });
          return;
        }
        const couponVoidMatch = path.match(/^\/api\/web\/admin\/coupons\/([^/]+)\/void$/);
        if (couponVoidMatch && request.method === 'POST') {
          if (!admin.voidCoupon) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          const body = await readJson(request);
          if (Object.keys(body).some(key => key !== 'reason' && key !== 'note')) throw new RequestError(400, 'INVALID_REQUEST');
          sendJson(response, 200, await admin.voidCoupon(accountId, decodePathParameter(couponVoidMatch[1]!),
            { reason: body.reason, note: body.note }));
          return;
        }
        const staffMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/staff$/);
        if (staffMatch && staffRegistration) {
          const merchantId = decodePathParameter(staffMatch[1]!);
          if (request.method === 'GET') {
            sendJson(response, 200, { staff: await staffRegistration.list(accountId, merchantId) });
            return;
          }
          if (request.method === 'POST') {
            const body = await readJson(request);
            await staffRegistration.approve(accountId, merchantId, requireString(body, 'code'));
            sendJson(response, 200, { status: 'APPROVED' });
            return;
          }
        }
        const revokeMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/staff\/([^/]+)\/revoke$/);
        if (revokeMatch && request.method === 'POST' && staffRegistration) {
          await readJson(request);
          await staffRegistration.revoke(accountId, decodePathParameter(revokeMatch[1]!), decodePathParameter(revokeMatch[2]!));
          sendJson(response, 200, { status: 'REVOKED' });
          return;
        }
        // 실제 점포 운영 시작(#246, D-054): 공개·점주·보상 혜택·캠페인 공개. 참조 번호만 받고 개인정보는 받지 않는다.
        const publishMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/publish$/);
        if (publishMatch && request.method === 'POST') {
          if (!admin.publishMerchant) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          const body = await readJson(request);
          requireOnlyKeys(body, ['expectedVersion', 'consentDocumentRef']);
          sendJson(response, 200, { merchant: await admin.publishMerchant(accountId, decodePathParameter(publishMatch[1]!),
            requireNumber(body, 'expectedVersion'), body.consentDocumentRef) });
          return;
        }
        const ownersMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/owners$/);
        if (ownersMatch && request.method === 'GET') {
          if (!admin.listOwners) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          sendJson(response, 200, { owners: await admin.listOwners(accountId, decodePathParameter(ownersMatch[1]!)) });
          return;
        }
        const ownerChangeMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/members\/([^/]+)\/(promote|demote)-owner$/);
        if (ownerChangeMatch && request.method === 'POST') {
          if (!admin.promoteOwner || !admin.demoteOwner) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          // 점주 권한은 가게 그림 같은 비용 권한까지 여는 변경이라, 삭제 접수(D-053 (8))처럼 10분 안에 한 로그인만 받는다.
          const session = await webAuth.resolveSessionWithAge(requireWebCookie(request, 'web_session'), origin);
          if (session.accountId !== accountId || session.ageMs > freshWebSessionMs) {
            throw new WebSessionError('WEB_SESSION_REAUTH_REQUIRED');
          }
          const body = await readJson(request);
          const merchantId = decodePathParameter(ownerChangeMatch[1]!);
          const target = decodePathParameter(ownerChangeMatch[2]!);
          if (ownerChangeMatch[3] === 'promote') {
            requireOnlyKeys(body, ['verificationDocumentRef']);
            sendJson(response, 200, { member: await admin.promoteOwner(accountId, merchantId, target,
              body.verificationDocumentRef) });
          } else {
            requireOnlyKeys(body, ['reason', 'verificationDocumentRef']);
            sendJson(response, 200, { member: await admin.demoteOwner(accountId, merchantId, target,
              { reason: body.reason, verificationDocumentRef: body.verificationDocumentRef }) });
          }
          return;
        }
        if (path === '/api/web/admin/reward-offers') {
          if (request.method === 'GET') {
            if (!admin.listRewardOffers) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
            sendJson(response, 200, { offers: await admin.listRewardOffers(accountId) });
            return;
          }
          if (request.method === 'POST') {
            if (!admin.createRewardOffer) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
            const body = await readJson(request);
            requireOnlyKeys(body, ['merchantId', 'milestone', 'title', 'detail', 'validDays', 'issuanceCap',
              'consentDocumentRef', 'consent']);
            sendJson(response, 201, { offer: await admin.createRewardOffer(accountId, {
              merchantId: body.merchantId, milestone: body.milestone, title: body.title, detail: body.detail,
              validDays: body.validDays, issuanceCap: body.issuanceCap, consentDocumentRef: body.consentDocumentRef,
              consent: body.consent,
            }) });
            return;
          }
        }
        const offerPauseMatch = path.match(/^\/api\/web\/admin\/reward-offers\/([^/]+)\/pause$/);
        if (offerPauseMatch && request.method === 'POST') {
          if (!admin.pauseRewardOffer) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          requireEmptyBody(await readJson(request));
          sendJson(response, 200, await admin.pauseRewardOffer(accountId, decodePathParameter(offerPauseMatch[1]!)));
          return;
        }
        if (path === '/api/web/admin/campaigns' && request.method === 'GET') {
          if (!admin.listCampaigns) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          sendJson(response, 200, { campaigns: await admin.listCampaigns(accountId) });
          return;
        }
        const campaignActionMatch = path.match(/^\/api\/web\/admin\/campaigns\/([^/]+)\/(publish|pause)$/);
        if (campaignActionMatch && request.method === 'POST') {
          if (!admin.publishCampaign || !admin.pauseCampaign) throw new RequestError(503, 'WEB_ADMIN_NOT_CONFIGURED');
          requireEmptyBody(await readJson(request));
          const campaignId = decodePathParameter(campaignActionMatch[1]!);
          sendJson(response, 200, campaignActionMatch[2] === 'publish'
            ? await admin.publishCampaign(accountId, campaignId) : await admin.pauseCampaign(accountId, campaignId));
          return;
        }
        if (path === '/api/web/admin/merchants') {
          if (request.method === 'GET') {
            sendJson(response, 200, { merchants: await admin.listMerchants(accountId) });
            return;
          }
          if (request.method === 'POST') {
            const body = await readJson(request);
            sendJson(response, 201, { merchant: await admin.createMerchant(accountId, adminMerchantInput(body)) });
            return;
          }
        }
        const editMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)$/);
        if (editMatch && request.method === 'PATCH') {
          const body = await readJson(request);
          sendJson(response, 200, { merchant: await admin.updateMerchant(
            accountId, decodePathParameter(editMatch[1]!), requireNumber(body, 'expectedVersion'), adminMerchantInput(body),
          ) });
          return;
        }
        const hideMatch = path.match(/^\/api\/web\/admin\/merchants\/([^/]+)\/hide$/);
        if (hideMatch && request.method === 'POST') {
          const body = await readJson(request);
          sendJson(response, 200, { merchant: await admin.hideMerchant(
            accountId, decodePathParameter(hideMatch[1]!), requireNumber(body, 'expectedVersion'),
          ) });
          return;
        }
        throw new RequestError(404, 'NOT_FOUND');
      }
      if (path.startsWith('/api/web/merchant/')) {
        const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        if (!webAuth || !staffRegistration) throw new RequestError(503, 'WEB_MERCHANT_NOT_CONFIGURED');
        if (path === '/api/web/merchant/auth/start' && request.method === 'GET') {
          if (authLoginLimiter) {
            const decision = authLoginLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
            if (!decision.allowed) {
              response.setHeader('Retry-After', String(decision.retryAfterSeconds));
              sendJson(response, 429, { code: 'LOGIN_RATE_LIMITED' });
              return;
            }
          }
          const started = await webAuth.start(origin, '/merchant/');
          response.setHeader('set-cookie', `web_auth_state=${started.state}; Path=/api/web/auth; Max-Age=300; HttpOnly; Secure; SameSite=Lax`);
          response.setHeader('location', started.location);
          response.writeHead(302).end();
          return;
        }
        if (request.method !== 'GET' && (request.headers.origin !== origin ||
            !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? ''))) {
          throw new RequestError(403, 'MERCHANT_CSRF_FORBIDDEN');
        }
        const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
        if (path === '/api/web/merchant/me' && request.method === 'GET') {
          sendJson(response, 200, { merchants: await staffRegistration.mine(accountId),
            accountScope: createHash('sha256').update(`collectible-editor:${accountId}`).digest('hex') });
          return;
        }
        const collectibleCampaigns = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/collectible-campaigns$/);
        if (collectibleCampaigns && request.method === 'GET') {
          if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
          const merchantId = decodePathParameter(collectibleCampaigns[1]!);
          await merchantAccess.requirePermission({ accountId, merchantId, permission: 'MANAGE_ART' });
          if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
          if (!collectibleProjects) throw new RequestError(503, 'COLLECTIBLE_PROJECTS_NOT_CONFIGURED');
          sendJson(response, 200, { campaigns: await collectibleProjects.listCampaigns({ merchantId, accountId }) });
          return;
        }
        const webCollectibleRoute = matchCollectibleProjectRoute(request.method, path, '/api/web/merchant/merchants/');
        if (webCollectibleRoute) {
          if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
          const merchantId = decodePathParameter(webCollectibleRoute.merchantId);
          await merchantAccess.requirePermission({ accountId, merchantId, permission: 'MANAGE_ART' });
          if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
          if (!collectibleProjects) throw new RequestError(503, 'COLLECTIBLE_PROJECTS_NOT_CONFIGURED');
          if (['create', 'save', 'copy', 'publish'].includes(webCollectibleRoute.kind)) {
            const decision = collectibleWriteLimiter.consume(merchantId);
            if (!decision.allowed) {
              response.setHeader('Retry-After', String(decision.retryAfterSeconds));
              sendJson(response, 429, { code: 'COLLECTIBLE_RATE_LIMITED' });
              return;
            }
          }
          await runCollectibleProjectRoute(collectibleProjects, webCollectibleRoute, merchantId, accountId, request, response);
          return;
        }
        if (path === '/api/web/merchant/registration-merchants' && request.method === 'GET') {
          sendJson(response, 200, { merchants: await staffRegistration.eligible(accountId) });
          return;
        }
        if (path === '/api/web/merchant/registration-requests' && request.method === 'POST') {
          const body = await readJson(request);
          sendJson(response, 201, await staffRegistration.request(accountId, requireString(body, 'merchantId')));
          return;
        }
        const webReversal = matchReversalRoute(request.method, path, '/api/web/merchant/merchants/');
        if (webReversal) {
          if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
          if (!reversals) throw new RequestError(503, 'REVERSALS_NOT_CONFIGURED');
          const merchantId = decodePathParameter(webReversal.merchantId);
          await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
          if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
            throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
          }
          sendJson(response, 200, await runReversalRoute(reversals, webReversal, merchantId, accountId, request));
          return;
        }
        // 그 가게 점주·직원만 보는 손님 의견 요약(#334): 태그·바라는 점 개수와 최근 의견 50건(가린 손님 표시와 날짜만).
        const webVisitorFeedback = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/visitor-feedback$/);
        if (webVisitorFeedback && request.method === 'GET') {
          if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
          if (!visitorFeedback) throw new RequestError(503, 'VISITOR_FEEDBACK_NOT_CONFIGURED');
          const merchantId = decodePathParameter(webVisitorFeedback[1]!);
          await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
          if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
            throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
          }
          sendJson(response, 200, await visitorFeedback.merchantSummary(merchantId));
          return;
        }
        const claimMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/(customer-identities\/resolve|claim-slots)$/);
        const reissueMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/claim-slots\/([^/]+)\/reissue$/);
        if (reissueMatch && request.method === 'POST') {
          if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
          if (!claimSlots) throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
          const merchantId = decodePathParameter(reissueMatch[1]!);
          await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
          if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
            throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
          }
          const body = await readJson(request);
          if (Object.keys(body).some(key => key !== 'expectedTokenVersion')) {
            throw new RequestError(400, 'INVALID_REQUEST');
          }
          const issued = await claimSlots.reissue({
            merchantId, claimSlotId: decodePathParameter(reissueMatch[2]!),
            expectedTokenVersion: requirePositiveInteger(body, 'expectedTokenVersion'),
            requestedByAccountId: accountId,
          });
          sendJson(response, 200, { ...issued, ...await renderClaimQr(issued.token) });
          return;
        }
        const couponLookupMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/coupons\/lookup$/);
        const couponRedeemMatch = path.match(/^\/api\/web\/merchant\/merchants\/([^/]+)\/coupons\/([^/]+)\/redeem$/);
        if ((couponLookupMatch || couponRedeemMatch) && request.method === 'POST') {
          if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
          if (!badges) throw new RequestError(503, 'BADGE_REWARDS_NOT_CONFIGURED');
          const merchantId = decodePathParameter((couponLookupMatch ?? couponRedeemMatch)![1]!);
          await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
          if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
            throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
          }
          const customerIdentityToken = requireIdentityTokenBody(await readJson(request));
          if (couponLookupMatch) {
            sendJson(response, 200, await badges.lookupCoupons({
              token: customerIdentityToken, merchantId, staffAccountId: accountId,
            }));
          } else {
            sendJson(response, 200, await badges.redeemCoupon({
              token: customerIdentityToken, merchantId, staffAccountId: accountId,
              couponId: decodePathParameter(couponRedeemMatch![2]!),
            }));
          }
          return;
        }
        if (claimMatch && request.method === 'POST') {
          if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
          const merchantId = decodePathParameter(claimMatch[1]!);
          await merchantAccess.requirePermission({ accountId, merchantId, permission: 'CONFIRM_VISIT' });
          if (!(await staffRegistration.mine(accountId)).some(merchant => merchant.id === merchantId)) {
            throw new MerchantAccessError('MERCHANT_ACCESS_DENIED');
          }
          const body = await readJson(request);
          if ('customerAccountId' in body) throw new RequestError(400, 'INVALID_REQUEST');
          const customerIdentityToken = requireString(body, 'customerIdentityToken');
          if (claimMatch[2] === 'customer-identities/resolve') {
            if (!customerIdentities) throw new RequestError(503, 'CUSTOMER_IDENTITY_NOT_CONFIGURED');
            sendJson(response, 200, await customerIdentities.resolve({
              token: customerIdentityToken, merchantId, staffAccountId: accountId,
            }));
          } else {
            if (!claimSlots) throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
            if (body.useConfirmed !== true) throw new RequestError(400, 'INVALID_REQUEST');
            const issued = await claimSlots.issue({
              merchantId, customerIdentityToken, merchantReference: requireString(body, 'merchantReference'),
              createdByAccountId: accountId,
            });
            if ('replayed' in issued) {
              sendJson(response, 200, { claimSlotId: issued.claimSlotId, tokenVersion: issued.tokenVersion,
                expiresAt: issued.expiresAt, replayed: true });
            } else {
              sendJson(response, 201, { ...issued, ...await renderClaimQr(issued.token) });
            }
          }
          return;
        }
        throw new RequestError(404, 'NOT_FOUND');
      }
      if (path === '/api/web/logout') {
        if (request.method !== 'POST') throw new RequestError(405, 'METHOD_NOT_ALLOWED');
        const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
        if (request.headers.origin !== origin) throw new RequestError(403, 'ORIGIN_FORBIDDEN');
        if (!webAuth) throw new RequestError(503, 'WEB_AUTH_NOT_CONFIGURED');
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        const sessionToken = optionalWebCookie(request, 'web_session');
        if (sessionToken) await webAuth.logout(sessionToken, origin);
        response.setHeader('set-cookie', 'web_session=; Path=/api/web; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
        response.writeHead(204);
        response.end();
        return;
      }
      if (path === '/api/web/account-deletion-intake' || path === '/api/web/account-deletion-intake/cancel' ||
          path === '/api/web/account-deletion-status') {
        if (request.method !== 'POST') throw new RequestError(405, 'METHOD_NOT_ALLOWED');
        const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
        if (request.headers.origin !== origin ||
            !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
          throw new RequestError(403, 'ORIGIN_FORBIDDEN');
        }
        if (!deletionIntake) throw new RequestError(503, 'WEB_DELETION_INTAKE_NOT_CONFIGURED');
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        if (path === '/api/web/account-deletion-status') {
          // 접수번호만으로 조회한다(삭제 뒤에는 로그인할 계정이 없다). 접수번호는 본문에서만 받고 URL에는 두지 않는다.
          if (!consumeDeletionStatus(request, response)) return;
          const body = await readJson(request);
          if (Object.keys(body).some(key => key !== 'receipt')) throw new RequestError(400, 'INVALID_REQUEST');
          sendJson(response, 200, await deletionIntake.status(requireString(body, 'receipt')));
          return;
        }
        if (!webAuth) throw new RequestError(503, 'WEB_DELETION_INTAKE_NOT_CONFIGURED');
        // 접수·다시 받기·취소는 방금 한 로그인이어야 한다. 이 세션 쿠키는 /app/·/merchant/·/admin/과 함께 쓰여서, 브라우저에
        // 오래 남은 로그인으로 남의 접수번호를 무효로 만들거나 삭제를 접수하지 못하게 한다(조회는 접수번호만 쓴다).
        const session = await webAuth.resolveSessionWithAge(requireWebCookie(request, 'web_session'), origin);
        if (session.ageMs > freshWebSessionMs) throw new WebSessionError('WEB_SESSION_REAUTH_REQUIRED');
        const accountId = session.accountId;
        const body = await readJson(request);
        if (path === '/api/web/account-deletion-intake/cancel') {
          sendJson(response, 200, await deletionIntake.cancel(accountId));
        } else {
          sendJson(response, 202, await deletionIntake.request(accountId, { reissue: body.reissue === true }));
        }
        return;
      }

      // 시연 앱 전용(#194, D-052): 시연 서버에서만 서비스가 만들어진다. 운영 API에는 이 경로가 없고 운영 앱은 웹 페이지를 쓴다.
      if (showcaseDeletionIntake && (path === '/account-deletion-intake' ||
          path === '/account-deletion-intake/cancel' || path === '/account-deletion-status')) {
        if (path === '/account-deletion-status') {
          if (request.method !== 'POST') throw new RequestError(405, 'METHOD_NOT_ALLOWED');
          if (!consumeDeletionStatus(request, response)) return;
          const body = await readJson(request);
          if (Object.keys(body).some(key => key !== 'receipt')) throw new RequestError(400, 'INVALID_REQUEST');
          sendJson(response, 200, await showcaseDeletionIntake.status(requireString(body, 'receipt')));
          return;
        }
        if (path === '/account-deletion-intake' && request.method === 'GET') {
          const accountId = await resolveAccountId(request);
          sendJson(response, 200, { request: await showcaseDeletionIntake.current(accountId) });
          return;
        }
        if (request.method !== 'POST') throw new RequestError(405, 'METHOD_NOT_ALLOWED');
        const accountId = await resolveAccountId(request);
        const body = await readJson(request, true);
        if (path === '/account-deletion-intake/cancel') {
          sendJson(response, 200, await showcaseDeletionIntake.cancel(accountId));
        } else {
          sendJson(response, 202, await showcaseDeletionIntake.request(accountId, { reissue: body.reissue === true }));
        }
        return;
      }

      if (request.method === 'POST' && request.url === '/auth/google') {
        if (authLoginLimiter) {
          const decision = authLoginLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
          if (!decision.allowed) {
            response.setHeader('Retry-After', String(decision.retryAfterSeconds));
            sendJson(response, 429, { code: 'LOGIN_RATE_LIMITED' });
            return;
          }
        }
        const sessions = requireAuthSessions(authSessions);
        const body = await readJson(request);
        sendJson(response, 200, await sessions.signInWithGoogle(requireString(body, 'idToken')));
        return;
      }

      // 로그인 없는 시연 웹 체험(#309). guestTrials는 시연 배치에서만 있다: 운영에서는 이 블록을 건너뛰어 맨 아래의 알 수 없는 경로와
      // 같은 404가 된다.
      if (guestTrials && request.method === 'POST' && request.url === '/auth/guest-trial') {
        const clientKey = authLoginClientKey(request, trustProxyClientIp);
        const decision = guestTrialLimiter.consume(clientKey);
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          sendJson(response, 429, { code: 'GUEST_TRIAL_RATE_LIMITED' });
          return;
        }
        requireEmptyBody(await readJson(request, true));
        sendJson(response, 200, await guestTrials.start({ clientKey }));
        return;
      }

      if (request.method === 'POST' && request.url === '/auth/logout') {
        const sessions = requireAuthSessions(authSessions);
        await sessions.logout(requireBearerToken(request));
        sendJson(response, 200, { status: 'LOGGED_OUT' });
        return;
      }

      if (request.method === 'POST' && request.url === '/auth/reauthenticate') {
        const sessions = requireAuthSessions(authSessions);
        const sessionToken = requireBearerToken(request);
        const body = await readJson(request);
        await sessions.reauthenticate(sessionToken, requireString(body, 'idToken'));
        sendJson(response, 200, { status: 'REAUTHENTICATED' });
        return;
      }

      if (request.method === 'GET' && request.url === '/merchants') {
        if (!merchantCatalog) {
          throw new RequestError(503, 'MERCHANT_CATALOG_NOT_CONFIGURED');
        }
        sendJson(response, 200, { merchants: await merchantCatalog.listPublicMerchants() });
        return;
      }

      if (request.method === 'GET' && request.url === '/collection') {
        if (!collection) {
          throw new RequestError(503, 'COLLECTION_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        sendJson(response, 200, await collection.getCollection(accountId));
        return;
      }

      if (request.method === 'POST' && request.url === '/customer/identity-tokens') {
        if (!customerIdentities) throw new RequestError(503, 'CUSTOMER_IDENTITY_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        sendJson(response, 201, await customerIdentities.create(accountId));
        return;
      }

      if (request.method === 'POST' && request.url === '/customer/identity-tokens/revoke') {
        if (!customerIdentities) throw new RequestError(503, 'CUSTOMER_IDENTITY_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        await customerIdentities.revoke({ accountId, token: requireString(body, 'token') });
        sendJson(response, 200, { status: 'REVOKED' });
        return;
      }

      if (request.method === 'GET' && request.url === '/me/badges') {
        if (!badges) throw new RequestError(503, 'BADGE_REWARDS_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        sendJson(response, 200, await badges.getBadges(accountId));
        return;
      }

      const openRewardMatch = request.url?.match(/^\/me\/badges\/rewards\/([^/]+)\/open$/);
      if (request.method === 'POST' && openRewardMatch) {
        if (!badges) throw new RequestError(503, 'BADGE_REWARDS_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const milestoneText = decodePathParameter(openRewardMatch[1]!);
        const milestone = Number(milestoneText);
        const body = await readJson(request, true);
        if (Object.keys(body).length > 0 || !/^[1-9]$/.test(milestoneText) || !isRewardMilestone(milestone)) {
          throw new RequestError(400, 'INVALID_REQUEST');
        }
        sendJson(response, 200, await badges.openReward({ accountId, milestone }));
        return;
      }

      if (request.url === '/me/consent' && (request.method === 'GET' || request.method === 'POST')) {
        if (!consent) throw new RequestError(503, 'CONSENT_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        if (request.method === 'GET') {
          sendJson(response, 200, await consent.status(accountId));
        } else {
          sendJson(response, 200, await consent.record({
            accountId, source: consent.appSource, ...readConsentBody(await readJson(request)),
          }));
        }
        return;
      }

      if (request.method === 'GET' && request.url === '/me/friends') {
        if (!friends) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        sendJson(response, 200, await friends.list(accountId));
        return;
      }

      if (request.method === 'POST' && request.url === '/me/friends') {
        if (!friends) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        // 코드는 사람이 붙여넣은 값이라 공백·하이픈이 섞일 수 있지만 터무니없이 긴 값은 거절한다.
        const code = requireString(body, 'code');
        if (Object.keys(body).some(key => key !== 'code') || code.length > 32) {
          throw new RequestError(400, 'INVALID_REQUEST');
        }
        const added = await friends.addByCode({ accountId, code });
        sendJson(response, added.created ? 201 : 200, added);
        return;
      }

      const friendMatch = request.url?.match(/^\/me\/friends\/([^/]+)$/);
      if (request.method === 'DELETE' && friendMatch) {
        if (!friends) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        await friends.remove({ accountId, friendshipId: decodePathParameter(friendMatch[1]!) });
        sendJson(response, 200, { status: 'REMOVED' });
        return;
      }

      if (request.method === 'POST' && request.url === '/me/friend-code/rotate') {
        if (!friends) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const body = await readJson(request, true);
        if (Object.keys(body).length > 0) throw new RequestError(400, 'INVALID_REQUEST');
        sendJson(response, 200, await friends.rotateCode(accountId));
        return;
      }

      if (request.method === 'PUT' && request.url === '/me/profile') {
        if (!friends) throw new RequestError(503, 'FRIENDS_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        // 빈 문자열도 서비스가 FRIEND_NICKNAME_INVALID로 거절하도록 넘긴다.
        const nickname = requireString(body, 'nickname', true);
        if (Object.keys(body).some(key => key !== 'nickname')) throw new RequestError(400, 'INVALID_REQUEST');
        sendJson(response, 200, await friends.setNickname({ accountId, nickname }));
        return;
      }

      if (request.method === 'GET' && request.url === '/shop') {
        if (!mileageShop) throw new RequestError(503, 'MILEAGE_SHOP_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        sendJson(response, 200, await mileageShop.getShop(accountId));
        return;
      }

      if (request.method === 'GET' && path === '/shop/history') {
        if (!mileageShop) throw new RequestError(503, 'MILEAGE_SHOP_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const cursor = new URL(request.url!, 'http://localhost').searchParams.get('cursor');
        sendJson(response, 200, await mileageShop.getHistory({
          accountId, ...(cursor !== null ? { cursor } : {}),
        }));
        return;
      }

      if (request.method === 'POST' && request.url === '/shop/rerolls') {
        if (!mileageShop) throw new RequestError(503, 'MILEAGE_SHOP_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        if (Object.keys(body).some((key) => !['grade', 'requestId', 'expectedRemaining'].includes(key))) {
          throw new RequestError(400, 'INVALID_REQUEST');
        }
        const grade = requireString(body, 'grade');
        if (!isMileageGrade(grade)) throw new RequestError(400, 'INVALID_REQUEST');
        const requestId = requireString(body, 'requestId');
        if (requestId.length > 128) throw new RequestError(400, 'INVALID_REQUEST');
        const expectedRemaining = requireNumber(body, 'expectedRemaining');
        if (expectedRemaining < 0) throw new RequestError(400, 'INVALID_REQUEST');
        sendJson(response, 201, await mileageShop.reroll({ accountId, grade, requestId, expectedRemaining }));
        return;
      }

      if (request.method === 'PUT' && request.url === '/shop/avatar') {
        if (!mileageShop) throw new RequestError(503, 'MILEAGE_SHOP_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        if (Object.keys(body).some((key) => key !== 'itemId')) throw new RequestError(400, 'INVALID_REQUEST');
        const itemId = body.itemId;
        if (itemId !== null && typeof itemId !== 'string') throw new RequestError(400, 'INVALID_REQUEST');
        sendJson(response, 200, await mileageShop.setAvatar({ accountId, itemId }));
        return;
      }

      // 방문한 가게에 남기는 특징 태그·바라는 점·짧은 의견(#334). 공개 집계는 /merchants의 visitorTags이고 바라는 점·의견은 점주에게만 간다.
      const visitorFeedbackMatch = path.match(/^\/me\/merchant-feedback\/([^/]+)$/);
      if (visitorFeedbackMatch && (request.method === 'GET' || request.method === 'PUT')) {
        if (!visitorFeedback) throw new RequestError(503, 'VISITOR_FEEDBACK_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const merchantId = decodePathParameter(visitorFeedbackMatch[1]!);
        if (request.method === 'GET') {
          sendJson(response, 200, await visitorFeedback.getMine(accountId, merchantId));
          return;
        }
        const decision = visitorFeedbackWriteLimiter.consume(accountId);
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          sendJson(response, 429, { code: 'VISITOR_FEEDBACK_RATE_LIMITED' });
          return;
        }
        const body = await readJson(request);
        requireOnlyKeys(body, ['tags', 'suggestions', 'note']);
        sendJson(response, 200, await visitorFeedback.upsert(accountId, merchantId, {
          tags: body.tags, suggestions: body.suggestions, note: body.note,
        }));
        return;
      }

      if (request.method === 'GET' && request.url === '/recommendations') {
        if (!recommendations) {
          throw new RequestError(503, 'RECOMMENDATIONS_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        sendJson(response, 200, {
          recommendations: await recommendations.listRecommendations(accountId),
        });
        return;
      }

      if (
        request.method === 'GET' &&
        /^\/merchant\/merchants\/[^/]+\/context$/.test(request.url ?? '')
      ) {
        if (!merchantAccess) {
          throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        const merchantId = decodePathParameter(request.url!.split('/')[3]!);
        const grant = await merchantAccess.requirePermission({
          accountId,
          merchantId,
          permission: 'VIEW_MERCHANT',
        });
        sendJson(response, 200, grant);
        return;
      }

      if (
        request.method === 'POST' &&
        /^\/merchant\/merchants\/[^/]+\/claim-slots$/.test(request.url ?? '')
      ) {
        if (!merchantAccess) {
          throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        const merchantId = decodePathParameter(request.url!.split('/')[3]!);
        await merchantAccess.requirePermission({
          accountId,
          merchantId,
          permission: 'CONFIRM_VISIT',
        });
        if (!claimSlots) {
          throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
        }
        const body = await readJson(request);
        if ('customerIdentityToken' in body) {
          if (body.useConfirmed !== true || 'customerAccountId' in body) throw new RequestError(400, 'INVALID_REQUEST');
          const issued = await claimSlots.issue({ merchantId,
            customerIdentityToken: requireString(body, 'customerIdentityToken'),
            merchantReference: requireString(body, 'merchantReference'),
            createdByAccountId: accountId });
          sendJson(response, 'replayed' in issued ? 200 : 201, issued);
        } else {
          if ('useConfirmed' in body) throw new RequestError(400, 'INVALID_REQUEST');
          if (baseAccountResolver !== developmentHeaderAccountResolver) throw new RequestError(403, 'CUSTOMER_IDENTITY_REQUIRED');
          const issued = await claimSlots.issue({ merchantId,
            customerAccountId: requireString(body, 'customerAccountId'),
            merchantReference: requireString(body, 'merchantReference'),
            createdByAccountId: accountId });
          sendJson(response, 201, issued);
        }
        return;
      }

      const identityResolveMatch = request.url?.match(/^\/merchant\/merchants\/([^/]+)\/customer-identities\/resolve$/);
      if (request.method === 'POST' && identityResolveMatch) {
        if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
        if (!customerIdentities) throw new RequestError(503, 'CUSTOMER_IDENTITY_NOT_CONFIGURED');
        const staffAccountId = await resolveAccountId(request);
        const merchantId = decodePathParameter(identityResolveMatch[1]!);
        await merchantAccess.requirePermission({ accountId: staffAccountId, merchantId, permission: 'CONFIRM_VISIT' });
        const body = await readJson(request);
        sendJson(response, 200, await customerIdentities.resolve({
          token: requireString(body, 'customerIdentityToken'), merchantId, staffAccountId,
        }));
        return;
      }

      const couponLookupMatch = request.url?.match(/^\/merchant\/merchants\/([^/]+)\/coupons\/lookup$/);
      const couponRedeemMatch = request.url?.match(/^\/merchant\/merchants\/([^/]+)\/coupons\/([^/]+)\/redeem$/);
      if (request.method === 'POST' && (couponLookupMatch || couponRedeemMatch)) {
        if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
        if (!badges) throw new RequestError(503, 'BADGE_REWARDS_NOT_CONFIGURED');
        const staffAccountId = await resolveAccountId(request);
        const merchantId = decodePathParameter((couponLookupMatch ?? couponRedeemMatch)![1]!);
        await merchantAccess.requirePermission({ accountId: staffAccountId, merchantId, permission: 'CONFIRM_VISIT' });
        const customerIdentityToken = requireIdentityTokenBody(await readJson(request));
        if (couponLookupMatch) {
          sendJson(response, 200, await badges.lookupCoupons({
            token: customerIdentityToken, merchantId, staffAccountId,
          }));
        } else {
          sendJson(response, 200, await badges.redeemCoupon({
            token: customerIdentityToken, merchantId, staffAccountId,
            couponId: decodePathParameter(couponRedeemMatch![2]!),
          }));
        }
        return;
      }

      const mobileReversal = matchReversalRoute(request.method, path, '/merchant/merchants/');
      if (mobileReversal) {
        if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
        if (!reversals) throw new RequestError(503, 'REVERSALS_NOT_CONFIGURED');
        const staffAccountId = await resolveAccountId(request);
        const merchantId = decodePathParameter(mobileReversal.merchantId);
        await merchantAccess.requirePermission({ accountId: staffAccountId, merchantId, permission: 'CONFIRM_VISIT' });
        sendJson(response, 200, await runReversalRoute(reversals, mobileReversal, merchantId, staffAccountId, request));
        return;
      }

      const reissueMatch = request.url?.match(
        /^\/merchant\/merchants\/([^/]+)\/claim-slots\/([^/]+)\/reissue$/,
      );
      if (request.method === 'POST' && reissueMatch) {
        if (!merchantAccess) {
          throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
        }
        if (!claimSlots) {
          throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        const merchantId = decodePathParameter(reissueMatch[1]!);
        await merchantAccess.requirePermission({
          accountId,
          merchantId,
          permission: 'CONFIRM_VISIT',
        });
        const body = await readJson(request);
        const issued = await claimSlots.reissue({
          merchantId,
          claimSlotId: decodePathParameter(reissueMatch[2]!),
          expectedTokenVersion: requirePositiveInteger(body, 'expectedTokenVersion'),
          requestedByAccountId: accountId,
        });
        sendJson(response, 200, issued);
        return;
      }

      if (request.method === 'POST' && request.url === '/claim-slots/redeem') {
        if (!claimSlots) {
          throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        const redeemed = await claimSlots.redeem({
          accountId,
          token: requireString(body, 'token'),
        });
        sendJson(response, 200, redeemed);
        return;
      }

      if (request.method === 'POST' && request.url === '/claim-slots/preview') {
        if (!claimSlots) {
          throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        const preview = await claimSlots.preview({
          accountId,
          token: requireString(body, 'token'),
        });
        sendJson(response, 200, preview);
        return;
      }

      if (request.method === 'POST' && request.url === '/wallet/challenges') {
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        const challenge = await service.createChallenge({
          accountId,
          address: requireString(body, 'address'),
          chainId: requireNumber(body, 'chainId'),
        });
        sendJson(response, 201, challenge);
        return;
      }

      if (request.method === 'POST' && request.url === '/wallet/verify') {
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        const verification = await service.verifyChallenge({
          accountId,
          challengeId: requireString(body, 'challengeId'),
          message: requireString(body, 'message'),
          signature: requireString(body, 'signature', true),
          currentAddress: requireString(body, 'currentAddress'),
        });
        sendJson(response, 200, verification);
        return;
      }

      if (request.method === 'GET' && request.url === '/wallets/active-binding') {
        const accountId = await resolveAccountId(request);
        sendJson(response, 200, { binding: (await service.getActiveBinding(accountId)) ?? null });
        return;
      }

      const disconnectWalletMatch = request.url?.match(/^\/wallets\/([^/]+)\/binding$/);
      if (request.method === 'DELETE' && disconnectWalletMatch) {
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        await service.disconnectBinding({
          accountId,
          bindingId: decodePathParameter(disconnectWalletMatch[1]!),
          bindingVersion: requirePositiveInteger(body, 'bindingVersion'),
        });
        sendJson(response, 200, { status: 'DISCONNECTED' });
        return;
      }

      const mintRequestMatch = request.url?.match(/^\/entitlements\/([^/]+)\/mint$/);
      if (request.method === 'POST' && mintRequestMatch) {
        if (!mintRequests) {
          throw new RequestError(503, 'MINT_REQUEST_SERVICE_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        const body = await readJson(request);
        const result = await mintRequests.requestMint({
          accountId,
          entitlementId: decodePathParameter(mintRequestMatch[1]!),
          walletBindingId: requireString(body, 'walletBindingId'),
          bindingVersion: requirePositiveInteger(body, 'bindingVersion'),
          consentVersion: requireString(body, 'consentVersion'),
          idempotencyKey: requireHeader(request, 'idempotency-key'),
        });
        sendJson(response, 202, result);
        return;
      }

      const mintJobMatch = request.url?.match(/^\/mint-jobs\/([^/]+)$/);
      if (request.method === 'GET' && mintJobMatch) {
        if (!mintRequests) {
          throw new RequestError(503, 'MINT_REQUEST_SERVICE_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        sendJson(
          response,
          200,
          await mintRequests.getMintJob({
            accountId,
            jobId: decodePathParameter(mintJobMatch[1]!),
          }),
        );
        return;
      }

      if (request.method === 'POST' && request.url === '/account-deletion-requests') {
        if (!accountDeletions) {
          throw new RequestError(503, 'ACCOUNT_DELETION_NOT_CONFIGURED');
        }
        if (!requireReauthentication) {
          throw new RequestError(503, 'REAUTHENTICATION_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        const sessionToken = await requireReauthentication(accountId, request);
        const body = await readJson(request);
        const result = await accountDeletions.requestDeletion({
          accountId,
          confirmation: requireString(body, 'confirmation'),
          ...(sessionToken ? { sessionToken } : {}),
        });
        await service.forgetAccount(accountId);
        sendJson(response, 202, result);
        return;
      }

      const enrollmentMatch = request.url?.match(/^\/campaigns\/([^/]+)\/enrollments$/);
      if (request.method === 'POST' && enrollmentMatch) {
        if (!campaignEnrollments) {
          throw new RequestError(503, 'CAMPAIGN_ENROLLMENT_SERVICE_NOT_CONFIGURED');
        }
        const accountId = await resolveAccountId(request);
        const campaignId = decodePathParameter(enrollmentMatch[1]!);
        const enrollment = await campaignEnrollments.enroll({ campaignId, accountId });
        sendJson(response, enrollment.created ? 201 : 200, enrollment);
        return;
      }

      // 공개 NFT 메타데이터(Issue #254, D-060): 발행 확정 때 고정한 바이트 그대로 하루 캐시한다(거부 목록이 하루 안에 반영; 기본 도장만 immutable). 지갑·탐색기가 다른 출처에서
      // 읽으므로 404에도 CORS를 연다. 확정 전·없는 토큰은 404라 체인에서 보이는 것 이상을 알려 주지 않는다.
      if (path.startsWith('/nft-metadata/') && (request.method === 'GET' || request.method === 'HEAD')) {
        response.setHeader('access-control-allow-origin', '*');
        const route = matchNftMetadataRoute(path);
        if (!route) throw new RequestError(404, 'NOT_FOUND');
        if (route.kind === 'default-stamp') {
          sendBinary(response, DEFAULT_STAMP_V1_PNG, 'image/png', 'public, max-age=31536000, immutable');
          return;
        }
        if (!nftMetadata) throw new RequestError(503, 'NFT_METADATA_NOT_CONFIGURED');
        if (route.kind === 'image') {
          const image = await nftMetadata.findImage(route.sha256);
          if (!image) throw new RequestError(404, 'NOT_FOUND');
          sendBinary(response, image, 'image/webp', nftMetadataCacheControl);
          return;
        }
        const metadata = await nftMetadata.findTokenMetadata(route.seriesId, route.tokenId);
        if (!metadata) throw new RequestError(404, 'NOT_FOUND');
        const body = Buffer.from(metadata, 'utf8');
        response.setHeader('cache-control', nftMetadataCacheControl);
        response.setHeader('content-length', String(body.length));
        response.writeHead(200);
        response.end(body);
        return;
      }

      // 현재 적용된 가게 그림. 파일 이름이 내용의 sha256이라 바뀌지 않으므로 오래 캐시한다. JSON만 내는 서버에서 이 경로만 이진 응답이다.
      const publicArtMatch = request.method === 'GET' ? path.match(/^\/merchant-art\/([0-9a-f]{64})\.webp$/) : null;
      if (publicArtMatch) {
        if (!merchantArt) throw new RequestError(503, 'AI_ART_NOT_CONFIGURED');
        const image = await merchantArt.getPublicImage(publicArtMatch[1]!);
        if (!image) throw new RequestError(404, 'NOT_FOUND');
        sendBinary(response, image, 'image/webp', 'public, max-age=31536000, immutable');
        return;
      }

      // 사장님 AI 가게 그림(D-048): 기존 고객 Bearer 인증 + 가게 멤버십의 MANAGE_ART 권한.
      const artMatch = path.match(/^\/merchant\/merchants\/([^/]+)\/art(\/.*)?$/);
      const artRoute = artMatch ? matchMerchantArtRoute(request.method, artMatch[2] ?? '') : undefined;
      if (artMatch && artRoute) {
        if (!merchantAccess) throw new RequestError(503, 'MERCHANT_ACCESS_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const merchantId = decodePathParameter(artMatch[1]!);
        await merchantAccess.requirePermission({ accountId, merchantId, permission: 'MANAGE_ART' });
        if (!merchantArt) throw new RequestError(503, 'AI_ART_NOT_CONFIGURED');
        const roundId = 'roundId' in artRoute ? decodePathParameter(artRoute.roundId) : '';
        if (artRoute.kind === 'state') {
          sendJson(response, 200, await merchantArt.getState(merchantId));
        } else if (artRoute.kind === 'create') {
          requireEmptyBody(await readJson(request, true));
          sendJson(response, 202, await merchantArt.createRound({ merchantId, accountId }));
        } else if (artRoute.kind === 'get') {
          sendJson(response, 200, await merchantArt.getRound({ merchantId, roundId }));
        } else if (artRoute.kind === 'choose') {
          const body = await readJson(request);
          if (Object.keys(body).some(key => key !== 'index')) throw new RequestError(400, 'INVALID_REQUEST');
          const index = requireNumber(body, 'index');
          if (index < 0 || index > 3) throw new RequestError(400, 'INVALID_REQUEST');
          sendJson(response, 202, await merchantArt.chooseDraft({ merchantId, roundId, index, accountId }));
        } else if (artRoute.kind === 'apply') {
          requireEmptyBody(await readJson(request, true));
          sendJson(response, 200, await merchantArt.apply({ merchantId, roundId, accountId }));
        } else {
          requireEmptyBody(await readJson(request, true));
          await merchantArt.reset({ merchantId, accountId });
          sendJson(response, 200, { status: 'RESET' });
        }
        return;
      }

      if (request.url === '/showcase/access-requests/mine' && request.method === 'GET') {
        if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');
        const accountId = await resolveAccountId(request);
        sendJson(response, 200, await accessRequests.mine(accountId));
        return;
      }

      if (request.url === '/showcase/access-requests' && request.method === 'POST') {
        if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');
        const accountId = await resolveAccountId(request);
        const decision = showcaseAccessRequestLimiter.consume(accountId);
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          sendJson(response, 429, { code: 'SHOWCASE_ACCESS_RATE_LIMITED' });
          return;
        }
        requireEmptyBody(await readJson(request, true));
        const { created, request: view } = await accessRequests.request(accountId);
        sendJson(response, created ? 201 : 200, { request: view });
        return;
      }

      if (request.url === '/showcase/admin/access-requests' && request.method === 'GET') {
        if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');
        const accountId = await resolveAccountId(request);
        sendJson(response, 200, await accessRequests.listPending(accountId));
        return;
      }

      const accessRequestDecisionMatch = request.url?.match(
        /^\/showcase\/admin\/access-requests\/([^/]+)\/(approve|reject)$/,
      );
      if (request.method === 'POST' && accessRequestDecisionMatch) {
        if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');
        const accountId = await resolveAccountId(request);
        requireEmptyBody(await readJson(request, true));
        const requestId = decodePathParameter(accessRequestDecisionMatch[1]!);
        const decision = accessRequestDecisionMatch[2] === 'approve' ? 'APPROVED' : 'REJECTED';
        await accessRequests.decide(accountId, requestId, decision);
        sendJson(response, 200, { status: decision });
        return;
      }

      // 시연 전용 "테스트 방문 만들기"(#295): 운영 API에는 경로 자체가 없다(accessRequests와 같은 showcaseDeployment 판정).
      if (request.url === '/showcase/test-visits' && request.method === 'POST') {
        if (!accessRequests) throw new RequestError(404, 'NOT_FOUND');
        if (!claimSlots) throw new RequestError(503, 'CLAIM_SLOT_SERVICE_NOT_CONFIGURED');
        const accountId = await resolveAccountId(request);
        const decision = showcaseTestVisitLimiter.consume(accountId);
        if (!decision.allowed) {
          response.setHeader('Retry-After', String(decision.retryAfterSeconds));
          sendJson(response, 429, { code: 'SHOWCASE_TEST_VISIT_RATE_LIMITED' });
          return;
        }
        const body = await readJson(request);
        requireOnlyKeys(body, ['merchantId']);
        const merchantId = requireString(body, 'merchantId');
        const issued = await claimSlots.issueShowcaseTestSlot({ merchantId, accountId });
        const redeemed = await claimSlots.redeem({ accountId, token: issued.token });
        sendJson(response, 201, redeemed);
        return;
      }

      sendJson(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
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
  });
}

function optionalWebCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  const matches = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

function requireWebCookie(request: IncomingMessage, name: string): string {
  const cookie = optionalWebCookie(request, name);
  if (!cookie) throw new WebSessionError('WEB_SESSION_INVALID');
  return cookie;
}

function authLoginClientKey(request: IncomingMessage, trustProxyClientIp: boolean): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (trustProxyClientIp && typeof forwardedFor === 'string' && isIP(forwardedFor)) {
    return forwardedFor;
  }
  return request.socket.remoteAddress ?? 'unknown';
}

// Malformed percent-encoding is the caller's mistake, not a server fault.
function decodePathParameter(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RequestError(400, 'INVALID_PATH_PARAMETER');
  }
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'RequestError';
  }
}

function requireAccountId(request: IncomingMessage): string {
  const value = request.headers['x-account-id'];
  const accountId = Array.isArray(value) ? value[0] : value;
  if (!accountId?.trim()) {
    throw new WalletChallengeError('ACCOUNT_REQUIRED');
  }
  return accountId;
}

async function readJson(request: IncomingMessage, allowEmpty = false, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new RequestError(413, 'BODY_TOO_LARGE');
    }
    chunks.push(buffer);
  }

  if (allowEmpty && totalBytes === 0) return {};

  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new RequestError(400, 'INVALID_JSON_BODY');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    throw new RequestError(400, 'INVALID_JSON_BODY');
  }
}

function requireString(body: Record<string, unknown>, field: string, allowEmpty = false): string {
  const value = body[field];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return value;
}

function requireNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return value;
}

function adminMerchantInput(body: Record<string, unknown>): MerchantInput {
  if (Object.keys(body).some(key => !['name', 'story', 'roadAddress', 'minimumSpendWon', 'menuItems', 'businessHours',
    'neighborhood', 'category', 'expectedVersion'].includes(key))) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return {
    name: requireString(body, 'name'), story: requireString(body, 'story', true),
    roadAddress: requireString(body, 'roadAddress'), minimumSpendWon: requireNumber(body, 'minimumSpendWon'),
    ...(body.menuItems === undefined ? {} : { menuItems: body.menuItems as NonNullable<MerchantInput['menuItems']> }),
    ...(body.businessHours === undefined ? {} : { businessHours: body.businessHours as string }),
    // 동네·업종 검사는 서비스(merchant-profile-rules)가 한다. 키가 없으면 그대로 둔다(옛 관리자 웹 호환).
    ...(body.neighborhood === undefined ? {} : { neighborhood: body.neighborhood as string | null }),
    ...(body.category === undefined ? {} : { category: body.category as string | null }),
  };
}

// 쿠폰 조회·사용은 식별 토큰 하나만 받는다. 계정 ID 같은 알 수 없는 키는 거절한다.
function requireIdentityTokenBody(body: Record<string, unknown>): string {
  if (Object.keys(body).some(key => key !== 'customerIdentityToken')) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return requireString(body, 'customerIdentityToken');
}

function requirePositiveInteger(body: Record<string, unknown>, field: string): number {
  const value = requireNumber(body, field);
  if (value <= 0) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return value;
}

function requireAuthSessions(sessions: AuthSessionService | undefined): AuthSessionService {
  if (!sessions) throw new RequestError(503, 'ACCOUNT_AUTH_NOT_CONFIGURED');
  return sessions;
}

function requireBearerToken(request: IncomingMessage): string {
  const value = request.headers.authorization;
  const header = Array.isArray(value) ? value[0] : value;
  const bearer = header?.match(/^Bearer (\S+)$/)?.[1];
  if (!bearer) throw new AuthSessionError('SESSION_REQUIRED');
  return bearer;
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

function requireHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  const selected = Array.isArray(value) ? value[0] : value;
  if (!selected?.trim()) throw new RequestError(400, 'IDEMPOTENCY_KEY_REQUIRED');
  return selected;
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
  if (code === 'FRIEND_CODE_NOT_FOUND' || code === 'FRIEND_NOT_FOUND') return 404;
  if (code === 'FRIEND_CODE_RATE_LIMITED') return 429;
  if (code === 'FRIEND_NICKNAME_INVALID') return 400;
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

type CollectibleProjectRoute = { merchantId: string; kind: 'list' | 'create' | 'get' | 'save' | 'publish' | 'copy' | 'unpublish' | 'delete'; projectId?: string };
function matchCollectibleProjectRoute(method: string | undefined, path: string, prefix: string): CollectibleProjectRoute | undefined {
  if (!path.startsWith(prefix)) return undefined;
  const match = path.slice(prefix.length).match(/^([^/]+)\/collectible-projects(?:\/([^/]+)(?:\/(publish|copy|unpublish|delete))?)?$/);
  if (!match) return undefined;
  const merchantId = match[1]!; const projectId = match[2]; const action = match[3];
  if (!projectId && method === 'GET') return { merchantId, kind: 'list' };
  if (!projectId && method === 'POST') return { merchantId, kind: 'create' };
  if (projectId && !action && (method === 'GET' || method === 'PUT')) return { merchantId, projectId, kind: method === 'GET' ? 'get' : 'save' };
  if (projectId && method === 'POST' && (action === 'publish' || action === 'copy' || action === 'unpublish' || action === 'delete')) return { merchantId, projectId, kind: action };
  return undefined;
}
async function runCollectibleProjectRoute(
  projects: CollectibleProjectService, route: CollectibleProjectRoute, merchantId: string, accountId: string,
  request: IncomingMessage, response: ServerResponse,
): Promise<void> {
  const input = { merchantId, accountId };
  if (route.kind === 'list') { sendJson(response, 200, { projects: await projects.list(input) }); return; }
  const projectId = route.projectId ? decodePathParameter(route.projectId) : '';
  if (route.kind === 'get') { sendJson(response, 200, await projects.get({ ...input, projectId })); return; }
  const body = await readJson(request, false, route.kind === 'save' || route.kind === 'create' ? collectibleBodyLimit : MAX_BODY_BYTES);
  const allowed = route.kind === 'create' ? ['project'] : route.kind === 'save' ? ['expectedVersion','project']
    : route.kind === 'publish' ? ['expectedVersion','campaignId'] : ['expectedVersion'];
  if (Object.keys(body).some(key => !allowed.includes(key)) || allowed.some(key => !(key in body))) throw new RequestError(400, 'INVALID_REQUEST');
  if (route.kind === 'create') { sendJson(response, 201, await projects.create({ ...input, project: body.project })); return; }
  const expectedVersion = requirePositiveInteger(body, 'expectedVersion');
  if (route.kind === 'save') sendJson(response, 200, await projects.save({ ...input, projectId, expectedVersion, project: body.project }));
  else if (route.kind === 'copy') sendJson(response, 201, await projects.copy({ ...input, projectId, expectedVersion }));
  else if (route.kind === 'unpublish') sendJson(response, 200, await projects.unpublish({ ...input, projectId, expectedVersion }));
  else if (route.kind === 'delete') sendJson(response, 200, await projects.remove({ ...input, projectId, expectedVersion }));
  else sendJson(response, 200, await projects.publish({ ...input, projectId, expectedVersion, campaignId: requireString(body, 'campaignId') }));
}

type ReversalRoute =
  | { kind: 'recent-visits' | 'recent-coupons'; merchantId: string }
  | { kind: 'cancel-visit'; merchantId: string; visitId: string }
  | { kind: 'undo-coupon'; merchantId: string; couponId: string };

// 방문 취소·쿠폰 사용 되돌리기 경로표(앱과 점주 웹이 접두사만 다르다). 알 수 없는 경로·메서드는 undefined라 다른 경로처럼 처리된다.
// ID는 아직 디코딩하지 않은 값이고 권한을 확인한 뒤에 디코딩한다.
function matchReversalRoute(method: string | undefined, path: string, prefix: string): ReversalRoute | undefined {
  if (!path.startsWith(prefix)) return undefined;
  const parts = path.slice(prefix.length).split('/');
  const [merchantId, first, second, third] = parts;
  if (!merchantId) return undefined;
  if (parts.length === 2 && method === 'GET') {
    if (first === 'recent-visits') return { kind: 'recent-visits', merchantId };
    if (first === 'recent-coupon-redemptions') return { kind: 'recent-coupons', merchantId };
  }
  if (parts.length === 4 && method === 'POST' && second) {
    if (first === 'visits' && third === 'cancel') return { kind: 'cancel-visit', merchantId, visitId: second };
    if (first === 'coupons' && third === 'undo-redeem') return { kind: 'undo-coupon', merchantId, couponId: second };
  }
  return undefined;
}

async function runReversalRoute(
  reversals: ReversalService,
  route: ReversalRoute,
  merchantId: string,
  staffAccountId: string,
  request: IncomingMessage,
): Promise<object> {
  switch (route.kind) {
    case 'recent-visits':
      return reversals.listRecentVisits({ merchantId, staffAccountId });
    case 'recent-coupons':
      return reversals.listRecentCouponRedemptions({ merchantId, staffAccountId });
    case 'cancel-visit': {
      const body = await readJson(request);
      if (Object.keys(body).some(key => key !== 'reason' && key !== 'note')) throw new RequestError(400, 'INVALID_REQUEST');
      return reversals.cancelVisit({
        merchantId, staffAccountId, visitEventId: decodePathParameter(route.visitId),
        reason: body.reason, note: body.note,
      });
    }
    case 'undo-coupon':
      requireEmptyBody(await readJson(request, true));
      return reversals.undoCouponRedemption({ merchantId, staffAccountId, couponId: decodePathParameter(route.couponId) });
  }
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
  if (code === 'SHOP_ITEM_NOT_OWNED') return 404;
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

type MerchantArtRoute =
  | { kind: 'state' | 'create' | 'reset' }
  | { kind: 'get' | 'choose' | 'apply'; roundId: string };

// 가게 그림 경로표. 알 수 없는 경로·메서드는 undefined라 다른 경로처럼 404로 떨어진다. roundId는 아직 디코딩하지 않은 값이고
// 인증 뒤에 디코딩한 다음 서비스가 UUID를 검사한다.
function matchMerchantArtRoute(method: string | undefined, tail: string): MerchantArtRoute | undefined {
  if (tail === '') {
    return method === 'GET' ? { kind: 'state' } : method === 'DELETE' ? { kind: 'reset' } : undefined;
  }
  if (tail === '/rounds') return method === 'POST' ? { kind: 'create' } : undefined;
  const round = tail.match(/^\/rounds\/([^/]+)(?:\/(choose|apply))?$/);
  if (!round) return undefined;
  const roundId = round[1]!;
  if (round[2] === undefined) return method === 'GET' ? { kind: 'get', roundId } : undefined;
  return method === 'POST' ? { kind: round[2] as 'choose' | 'apply', roundId } : undefined;
}

const consentBodyKeys = ['termsVersion', 'privacyVersion', 'ageConfirmed', 'termsAccepted', 'privacyAccepted'] as const;

/** 정확히 다섯 키만 받는다: 알 수 없는 키·빠진 키·잘못된 자료형은 400. 값이 true인지·버전이 현재인지는 서비스가 판단한다. */
function readConsentBody(body: Record<string, unknown>): {
  termsVersion: string; privacyVersion: string; ageConfirmed: boolean; termsAccepted: boolean; privacyAccepted: boolean;
} {
  const keys = Object.keys(body);
  if (keys.length !== consentBodyKeys.length || consentBodyKeys.some((key) => !Object.hasOwn(body, key))) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  const { termsVersion, privacyVersion, ageConfirmed, termsAccepted, privacyAccepted } = body;
  if (typeof termsVersion !== 'string' || typeof privacyVersion !== 'string' || termsVersion.length > 64 ||
      privacyVersion.length > 64 || typeof ageConfirmed !== 'boolean' || typeof termsAccepted !== 'boolean' ||
      typeof privacyAccepted !== 'boolean') {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return { termsVersion, privacyVersion, ageConfirmed, termsAccepted, privacyAccepted };
}

function requireEmptyBody(body: Record<string, unknown>): void {
  if (Object.keys(body).length > 0) throw new RequestError(400, 'INVALID_REQUEST');
}

function requireOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new RequestError(400, 'INVALID_REQUEST');
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

function setCommonHeaders(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('x-content-type-options', 'nosniff');
}

function sendJson(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

// 모든 응답이 JSON이라는 규칙의 유일한 예외다(공개 가게 그림). nosniff는 공통 헤더에서 이미 붙어 있다.
function sendBinary(response: ServerResponse, body: Buffer, contentType: string, cacheControl: string): void {
  response.setHeader('content-type', contentType);
  response.setHeader('cache-control', cacheControl);
  // HEAD에도 GET과 같은 길이를 알린다.
  response.setHeader('content-length', String(body.length));
  response.writeHead(200);
  response.end(body);
}

const maxSessionTtlMs = 365 * 24 * 60 * 60 * 1000;

export function sessionTtlMs(raw: string | undefined): number {
  if (raw === undefined) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > maxSessionTtlMs) {
    throw new Error('AUTH_SESSION_TTL_MS must be a positive integer of milliseconds, at most one year');
  }
  return value;
}

export function authLoginLimit(raw: string | undefined): number {
  return boundedPositiveInteger(raw, 60, 'AUTH_LOGIN_RATE_LIMIT_MAX', 10_000);
}

export function authLoginWindowMs(raw: string | undefined): number {
  return boundedPositiveInteger(raw, 60_000, 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS', 60 * 60 * 1000);
}

export function googleJwksMaxStaleMs(raw: string | undefined): number {
  return boundedIntegerRange(
    raw,
    24 * 60 * 60 * 1000,
    'GOOGLE_JWKS_MAX_STALE_MS',
    10 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
  );
}

export function authSessionCleanupBatchSize(raw: string | undefined): number {
  return boundedPositiveInteger(raw, 100, 'AUTH_SESSION_CLEANUP_BATCH_SIZE', 10_000);
}

function boundedPositiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  maximum: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return parsed;
}

function boundedIntegerRange(
  raw: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

export type AuthMode =
  | { kind: 'production'; audiences: readonly string[] }
  | { kind: 'demo' }
  | { kind: 'unconfigured' };

// The DEMO header boundary is loopback-only by design, so it can never coexist with real login.
export function resolveAuthMode(env: Record<string, string | undefined>): AuthMode {
  const audiences = (env.GOOGLE_OAUTH_CLIENT_IDS ?? '')
    .split(',')
    .map((clientId) => clientId.trim())
    .filter((clientId) => clientId.length > 0);
  const demoConfigured = env.ALLOW_INSECURE_DEMO_ACCOUNT === 'true';
  // Client ids state the intent to run real login; a missing database must stop the server rather
  // than quietly leave the DEMO header in charge.
  if (audiences.length > 0 && !env.DATABASE_URL) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_IDS is set but DATABASE_URL is missing; production login cannot start ' +
        'and must not fall back to the DEMO account header',
    );
  }
  const productionConfigured = audiences.length > 0;

  if (productionConfigured && demoConfigured) {
    throw new Error(
      'ALLOW_INSECURE_DEMO_ACCOUNT and GOOGLE_OAUTH_CLIENT_IDS are both configured; ' +
        'the insecure DEMO account header cannot run alongside production login',
    );
  }
  if (productionConfigured) return { kind: 'production', audiences };
  if (demoConfigured) {
    if (resolveApiBindHost(env.API_BIND_HOST) !== '127.0.0.1') {
      throw new Error('DEMO account header requires a loopback API bind');
    }
    return { kind: 'demo' };
  }
  return { kind: 'unconfigured' };
}

export type ShowcaseDeployment = 'hosted' | 'local';

// #294: 시연 전용 API(권한 요청)는 hosted(SHOWCASE_MODE)나 local(demo + 시연 DB 이름)에서만 연다. 운영 DB·운영 로그인에서는
// 항상 undefined라 다른 시연 전용 라우트처럼 404가 된다. local 쪽 DB 이름은 호출자가 미리 조회해서 넘긴다(여기는 순수 함수).
export function resolveShowcaseDeployment(
  authMode: AuthMode,
  hostedConfigured: boolean,
  currentDatabaseName: string | undefined,
): ShowcaseDeployment | undefined {
  if (hostedConfigured) return 'hosted';
  if (authMode.kind === 'demo' && currentDatabaseName !== undefined &&
      isPermittedShowcaseDatabaseName(currentDatabaseName)) {
    return 'local';
  }
  return undefined;
}

function configuredService(
  bindingStore: WalletBindingStore,
  challengeStore: ChallengeStore,
): WalletChallengeService {
  const chainId = Number(process.env.WALLET_CHAIN_ID ?? '84532');
  return new WalletChallengeService({
    store: challengeStore,
    domain: process.env.SIWE_DOMAIN ?? 'api.masscom.local',
    uri: process.env.SIWE_URI ?? 'https://api.masscom.local/wallet/verify',
    chainId,
    ttlMs: Number(process.env.WALLET_CHALLENGE_TTL_MS ?? 5 * 60 * 1000),
    bindingStore,
  });
}

export function resolveApiBindHost(raw: string | undefined): '127.0.0.1' | '0.0.0.0' {
  const host = raw ?? '127.0.0.1';
  if (host === '127.0.0.1' || host === '0.0.0.0') return host;
  throw new Error('API_BIND_HOST must be 127.0.0.1 or 0.0.0.0');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const bindHost = resolveApiBindHost(process.env.API_BIND_HOST);
  const showcaseInvites = resolveShowcaseInviteConfig(process.env);
  const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL })
    : undefined;
  if (showcaseInvites) {
    const result = await pool!.query<{ name: string }>('SELECT current_database() AS name');
    if (result.rows[0]?.name !== 'masscom_showcase') {
      throw new Error('SHOWCASE_DATABASE_MISMATCH');
    }
  }
  const merchantCatalog = pool ? new PostgresMerchantCatalog(pool) : undefined;
  // 가게 그림 설정이 잘못돼도 API는 시작한다(기능만 꺼짐). 값은 로그에 적지 않는다.
  const resolvedAiArt = resolveAiArtConfigOrDisabled(process.env);
  const aiArtConfig = resolvedAiArt.config;
  const merchantAccess = pool
    ? new PostgresMerchantAccessControl(pool, { staffMayManageArt: aiArtConfig.staffMayManage })
    : undefined;
  // 운영 compose는 PREPARING(발행 준비 중)을 넘기고 시연은 넘기지 않아 발행 동작이 그대로다(#246, D-054).
  const nftMinting = parseNftMintingMode(process.env.NFT_MINTING_MODE);
  const collection = pool ? new PostgresCollectionReader(pool, { nftMinting }) : undefined;
  const recommendations = pool
    ? new RecommendationService(new PostgresRecommendationSource(pool))
    : undefined;
  const accountDeletionHmacSecret = process.env.ACCOUNT_DELETION_HMAC_SECRET;
  const accountLifecycle =
    pool && accountDeletionHmacSecret
      ? new PostgresAccountLifecycle({ hmacSecret: accountDeletionHmacSecret })
      : undefined;
  const bindingStore = pool
    ? new PostgresWalletBindingStore(pool, {
        ...(accountLifecycle ? { accountLifecycle } : {}),
      })
    : new InMemoryWalletBindingStore();
  const challengeStore: ChallengeStore = pool
    ? new PostgresChallengeStore(pool)
    : new InMemoryChallengeStore();
  const postgresMintRequests = pool
    ? new PostgresMintRequestService(pool, {
        // 비어 있으면 nft-mint-v2, v2보다 낮은 판은 시작을 거절한다(Issue #254).
        supportedConsentVersion: mintConsentVersionFromEnv(process.env.NFT_MINT_CONSENT_VERSION),
        ...(accountLifecycle ? { accountLifecycle } : {}),
      })
    : undefined;
  // 발행 준비 중(운영)에는 새 발행 요청을 거절하고 작업 조회만 둔다(D-054).
  const mintRequests = postgresMintRequests && nftMinting === 'PREPARING'
    ? refuseMintRequestsWhilePreparing(postgresMintRequests) : postgresMintRequests;
  const authMode = resolveAuthMode(process.env);
  // local 배치 판정만 DB 이름 조회가 필요하다(hosted는 이미 위에서 확인했다). 운영 로그인에서는 절대 조회하지 않는다(#294).
  const currentShowcaseDatabaseName =
    !showcaseInvites && authMode.kind === 'demo' && pool
      ? (await pool.query<{ name: string }>('SELECT current_database() AS name')).rows[0]?.name
      : undefined;
  const showcaseDeployment = resolveShowcaseDeployment(authMode, Boolean(showcaseInvites), currentShowcaseDatabaseName);
  const accountDeletions =
    pool && accountDeletionHmacSecret
      ? new PostgresAccountDeletionService(pool, {
          hmacSecret: accountDeletionHmacSecret,
          policyVersion: process.env.ACCOUNT_DELETION_POLICY_VERSION ?? 'account-deletion-v1',
          requireRecentSession: authMode.kind === 'production',
          ...(accountLifecycle ? { accountLifecycle } : {}),
        })
      : undefined;
  const claimSlots =
    pool && process.env.MERCHANT_REFERENCE_HMAC_SECRET
      ? new PostgresClaimSlotService(pool, {
          referenceHmacSecret: process.env.MERCHANT_REFERENCE_HMAC_SECRET,
          ...(accountLifecycle ? { accountLifecycle } : {}),
        })
      : undefined;
  const customerIdentities = pool && accountLifecycle
    ? new PostgresCustomerIdentityService(pool, {
        accountLifecycle,
      })
    : undefined;
  const badges = pool && accountLifecycle
    ? new PostgresBadgeRewardService(pool, { accountLifecycle })
    : undefined;
  // 점원 화면의 고객 가림 표시는 수령 슬롯 참조와 같은 비밀에서 만든다(32바이트 이상은 claimSlots가 이미 요구한다).
  const reversals = pool && accountLifecycle && process.env.MERCHANT_REFERENCE_HMAC_SECRET
    ? new PostgresReversalService(pool, {
        labelHmacSecret: process.env.MERCHANT_REFERENCE_HMAC_SECRET, accountLifecycle,
      })
    : undefined;
  const friends = pool && accountLifecycle
    ? new PostgresFriendService(pool, { accountLifecycle })
    : undefined;
  // 운영·시연 모두 pool·accountLifecycle만 있으면 동작한다(시연 전용 게이트 없음, design-298.md).
  const mileageShop = pool && accountLifecycle
    ? new PostgresMileageShopService(pool, { accountLifecycle })
    : undefined;
  // 방문 후 가게 특징·바라는 점·의견(#334). 점주 요약의 가림 표시는 방문 취소 화면(reversals)과 같은 비밀에서 만든다.
  const visitorFeedback = pool && accountLifecycle && process.env.MERCHANT_REFERENCE_HMAC_SECRET
    ? new PostgresVisitorFeedbackService(pool, {
        accountLifecycle, labelHmacSecret: process.env.MERCHANT_REFERENCE_HMAC_SECRET,
      })
    : undefined;
  // 동의 기록(D-059): 앱 경로 값은 시연 서버면 SHOWCASE_APP, 운영이면 ANDROID다. 쓰기 요청은 막지 않고 required만 알린다.
  const consent = pool && accountLifecycle
    ? new PostgresAccountConsentService(pool, {
        accountLifecycle, appSource: showcaseInvites ? 'SHOWCASE_APP' : 'ANDROID',
      })
    : undefined;
  // OPENAI_API_KEY가 비어 있으면 client가 없어 생성 API만 503 AI_ART_NOT_CONFIGURED이고 조회·되돌리기·공개 그림은 그대로 동작한다.
  const merchantArt = pool
    ? new PostgresMerchantArtService(pool, {
        config: aiArtConfig,
        ...(aiArtConfig.apiKey
          ? {
              client: new OpenAiImageClient({
                apiKey: aiArtConfig.apiKey,
                baseUrl: aiArtConfig.baseUrl,
                draftModel: aiArtConfig.draftModel,
                finalModel: aiArtConfig.finalModel,
              }),
            }
          : {}),
        staffMayManageArt: aiArtConfig.staffMayManage,
        ...(accountLifecycle ? { accountLifecycle } : {}),
      })
    : undefined;
  console.log(aiArtStartupLine(resolvedAiArt));
  const campaignEnrollments = pool
    ? new PostgresCampaignEnrollmentService(pool, {
        ...(accountLifecycle ? { accountLifecycle } : {}),
      })
    : undefined;
  // Showcase staff eligibility is separate from customer login: every verified
  // subject of the dedicated Google audience may receive a customer session.
  const authSessions =
    pool && authMode.kind === 'production'
      ? new PostgresAuthSessionService(pool, {
          verifier: new GoogleIdTokenVerifier({
            audiences: authMode.audiences,
            jwksMaxStaleMs: googleJwksMaxStaleMs(process.env.GOOGLE_JWKS_MAX_STALE_MS),
          }),
          sessionTtlMs: sessionTtlMs(process.env.AUTH_SESSION_TTL_MS),
          cleanupBatchSize: authSessionCleanupBatchSize(
            process.env.AUTH_SESSION_CLEANUP_BATCH_SIZE,
          ),
          ...(accountLifecycle ? { accountLifecycle } : {}),
        })
      : undefined;
  const authLoginLimiter = authSessions
    ? new FixedWindowAuthLoginLimiter({
        maxAttempts: authLoginLimit(process.env.AUTH_LOGIN_RATE_LIMIT_MAX),
        windowMs: authLoginWindowMs(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS),
      })
    : undefined;
  const webAuthConfig = resolveWebAuthConfig(process.env);
  if (webAuthConfig && (authMode.kind !== 'production' || !pool || !accountDeletionHmacSecret || showcaseInvites)) {
    throw new Error('WEB_AUTH_CONFIGURATION_INVALID');
  }
  const webIdTokenVerifier = webAuthConfig
    ? new GoogleIdTokenVerifier({ audiences: [webAuthConfig.clientId] })
    : undefined;
  const webAuth = webAuthConfig && pool && accountDeletionHmacSecret
    ? new WebAuthService(
        pool,
        new PostgresWebSessionStore(pool, {
          hmacSecret: accountDeletionHmacSecret,
          ttlMs: 24 * 60 * 60 * 1000,
        }),
        {
          ...webAuthConfig,
          verifyIdToken: (token) => webIdTokenVerifier!.verify(token),
        },
      )
    : undefined;
  const accountResolver: AccountResolver = authSessions
    ? createBearerAccountResolver(authSessions)
    : authMode.kind === 'demo'
      ? developmentHeaderAccountResolver
      : () => {
          throw new WalletChallengeError('ACCOUNT_AUTH_NOT_CONFIGURED');
        };
  const reauthenticationGuard: ReauthenticationGuard | undefined = authSessions
    ? createSessionReauthenticationGuard(authSessions)
    : authMode.kind === 'demo'
      ? developmentHeaderReauthenticationGuard
      : undefined;

  createApiServer(
    configuredService(bindingStore, challengeStore),
    accountResolver,
    merchantCatalog,
    merchantAccess,
    claimSlots,
    collection,
    recommendations,
    mintRequests,
    accountDeletions,
    reauthenticationGuard,
    campaignEnrollments,
    authSessions,
    authLoginLimiter,
    authMode.kind === 'production' && process.env.AUTH_TRUST_CADDY_FORWARDED_FOR === 'true',
    webAuth,
    webAuthConfig?.wwwEnabled ?? false,
    customerIdentities,
    pool && accountDeletionHmacSecret && webAuthConfig && !showcaseInvites
      ? new PostgresAdminService(pool, accountDeletionHmacSecret,
        process.env.MERCHANT_REFERENCE_HMAC_SECRET || accountDeletionHmacSecret) : undefined,
    pool && accountDeletionHmacSecret && webAuth && !showcaseInvites
      ? new PostgresAccountDeletionIntakeService(pool, accountDeletionHmacSecret) : undefined,
    pool && accountDeletionHmacSecret && webAuth && !showcaseInvites
      ? new PostgresStaffRegistration(pool, accountDeletionHmacSecret) : undefined,
    badges,
    friends,
    merchantArt,
    pool && accountDeletionHmacSecret && showcaseInvites
      ? new PostgresAccountDeletionIntakeService(pool, accountDeletionHmacSecret, { source: 'SHOWCASE_APP' }) : undefined,
    pool && accountDeletionHmacSecret && webAuth && !showcaseInvites
      ? new PostgresAccountDeletionProcessingService(pool, {
          hmacSecret: accountDeletionHmacSecret,
          policyVersion: process.env.ACCOUNT_DELETION_POLICY_VERSION ?? 'account-deletion-v1',
        }) : undefined,
    reversals,
    consent,
    pool ? new PostgresNftMetadataReader(pool) : undefined,
    pool ? new PostgresCollectibleProjectService(pool, {
      staffMayManageArt: aiArtConfig.staffMayManage,
      ...(accountLifecycle ? { accountLifecycle } : {}),
    }) : undefined,
    mileageShop,
    pool && accountDeletionHmacSecret && showcaseDeployment
      ? new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret }) : undefined,
    // 로그인 없는 시연 웹 체험(#309)도 권한 요청과 같은 시연 배치에서만 만든다. 운영 로그인에서는 undefined라 경로가 404다.
    pool && accountDeletionHmacSecret && showcaseDeployment
      ? new ShowcaseGuestTrialService(pool, { accountDeletionHmacSecret }) : undefined,
    visitorFeedback,
  ).listen(port, bindHost, () => {
    console.log(`wallet API listening on http://${bindHost}:${port}`);
  });
}
