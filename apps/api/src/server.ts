import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { Pool, type PoolClient } from 'pg';

import { AccountDeletionError } from './account-deletion.js';
import type { AuthSessionService } from './auth-session.js';
import { OpenAiImageClient } from './ai-art-client.js';
import { aiArtStartupLine, resolveAiArtConfigOrDisabled } from './ai-art-rules.js';
import { PostgresStoreTicketService } from './postgres/store-tickets.js';
import { startNotificationsRunner } from './social.js';
import { handleSocialHttp, SocialHttpError } from './social-http.js';
import { PostgresSocialService } from './postgres/social.js';
import { PostgresRealWorldService } from './postgres/real-world.js';
import { PostgresRealWorldMediaStore } from './real-world-media.js';
import { TmapProvider } from './tmap-provider.js';
import { NaverProvider } from './naver-provider.js';
import { MapProvider } from './map-provider.js';
import { RealWorldError } from './real-world-contract.js';
import { handleRealWorldHttp } from './real-world-http.js';
import { ExpoPushGateway } from './expo-push-gateway.js';
import { PostgresCollectionExperienceService } from './postgres/collection-experience.js';
import { PostgresMerchantOperations } from './postgres/merchant-operations.js';
import { PostgresNotificationService, fcmConfigFromEnv } from './postgres/notifications.js';
import { startNotificationScheduler } from './notification-scheduler.js';
import { GoogleIdTokenVerifier } from './google-id-token.js';
import { WebAuthService, resolveWebAuthConfig } from './web-auth.js';
import { resolveWebOrigin } from './web-origin.js';
import { parseNftMintingMode } from './collection.js';
import {
  InMemoryChallengeStore,
  WalletChallengeError,
  WalletChallengeService,
  type ChallengeStore,
} from './wallet-challenge-service.js';
import { mintConsentVersionFromEnv, refuseMintRequestsWhilePreparing } from './mint-request-service.js';
import { RecommendationService } from './recommendation-service.js';
import { safeErrorMetadata } from './security-log.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresCustomerIdentityService } from './postgres/customer-identity.js';
import { PostgresCampaignEnrollmentService } from './postgres/campaign-enrollment.js';
import { PostgresCampaignBenefitService } from './postgres/campaign-benefits.js';
import { PostgresAccountConsentService } from './postgres/account-consent.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountDeletionIntakeService } from './postgres/account-deletion-intake.js';
import { PostgresAccountDeletionProcessingService } from './postgres/account-deletion-processing.js';
import { PostgresBadgeRewardService } from './postgres/badge-rewards.js';
import { PostgresFriendService } from './postgres/friends.js';
import { PostgresPlayService } from './postgres/play.js';
import { PostgresCoinEconomyService } from './postgres/coin-economy.js';
import { PostgresRoomCommunityService } from './postgres/room-community.js';
import { PostgresFurnitureService } from './postgres/furniture.js';
import { PostgresGradeDrawService } from './postgres/grade-draw.js';
import { PostgresMerchantOverviewService } from './postgres/merchant-overview.js';
import { PostgresCollectiblePreviewService, PostgresMerchantDetailViewService } from './postgres/merchant-discovery.js';
import { PostgresAdminFunnelService } from './postgres/admin-funnel.js';
import { AdminError, PostgresAdminService, assertPlatformAdmin } from './postgres/admin.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAuthSessionService } from './postgres/auth-session.js';
import { PostgresWebSessionStore } from './postgres/web-session.js';
import { resolveShowcaseInviteConfig } from './showcase/invite-config.js';
import { isPermittedShowcaseDatabaseName } from './showcase/local-seed.js';
import { ShowcaseAccessRequestService } from './showcase/access-requests.js';
import { ShowcaseGuestTrialService } from './showcase/guest-trials.js';
import { PostgresCollectionReader } from './postgres/collection.js';
import { PostgresCollectibleProjectService } from './postgres/collectible-project.js';
import { PostgresMerchantAccessControl } from './postgres/merchant-access.js';
import { PostgresMerchantProfileService } from './postgres/merchant-profile.js';
import { PostgresMerchantArtService } from './postgres/merchant-art.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { PostgresNftMetadataReader } from './postgres/nft-metadata.js';
import { PostgresStaffRegistration } from './postgres/staff-registration.js';
import { PostgresMintRequestService } from './postgres/mint-request-service.js';
import { PostgresReversalService } from './postgres/reversal.js';
import { PostgresMileageShopService } from './postgres/mileage-shop.js';
import { PostgresVisitorFeedbackService } from './postgres/visitor-feedback.js';
import { showcaseAllAccessOptions } from './showcase/all-access.js';
import { PostgresRecommendationSource } from './postgres/recommendation.js';
import { PostgresCourseService } from './postgres/courses.js';
import { PostgresChallengeStore } from './postgres/wallet-challenge-store.js';
import { PostgresWalletBindingStore } from './postgres/wallet-binding.js';
import { InMemoryWalletBindingStore, type WalletBindingStore } from './wallet-binding.js';
import { developmentHeaderAccountResolver, type AccountResolver, type ApiDeps, type ExperienceServices, type ReauthenticationGuard, type ResolvedApiDeps } from './api-deps.js';
import { createApiRuntime } from './api-runtime.js';
import { renderClaimQr } from './http/claim-qr.js';
import { FixedWindowAuthLoginLimiter, type AuthLoginLimiter } from './http/login-limiter.js';
import { decodePathParameter, readJson } from './http/request-body.js';
import { authLoginClientKey, requireBearerToken, requireWebCookie } from './http/request-auth.js';
import { RequestError } from './http/request-error.js';
import { respondWithError } from './http/error-response.js';
import { sendJson, setCommonHeaders } from './http/response.js';
import type { RouteContext } from './routes/context.js';
import { handleAccount } from './routes/account.js';
import { handleAccountDeletion } from './routes/account-deletion.js';
import { handleAuth } from './routes/auth.js';
import { handleCoinsRooms } from './routes/coins-rooms.js';
import { handleCustomer } from './routes/customer.js';
import { handleCourses } from './routes/courses.js';
import { handleDiscovery } from './routes/discovery.js';
import { handleExperience } from './routes/experience.js';
import { handleMerchantApp } from './routes/merchant-app.js';
import { handlePlay } from './routes/play.js';
import { handlePlayStudio } from './routes/play-studio.js';
import { handlePublicAssets } from './routes/public-assets.js';
import { handleShowcase } from './routes/showcase.js';
import { handleWalletClaims } from './routes/wallet-claims.js';
import { handleWebAdmin } from './routes/web-admin.js';
import { handleWebAuth } from './routes/web-auth.js';
import { handleWebCustomer } from './routes/web-customer.js';
import { handleWebMerchant } from './routes/web-merchant.js';

export { renderClaimQr, FixedWindowAuthLoginLimiter };
export type { AuthLoginLimiter };

export { developmentHeaderAccountResolver };
export type { AccountResolver, ExperienceServices, ReauthenticationGuard };
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

export function realWorldAdminCheck(accountLifecycle: PostgresAccountLifecycle):
  (client: PoolClient, accountId: string) => Promise<boolean> {
  return async (client, accountId) => {
    try { await assertPlatformAdmin(client, accountLifecycle, accountId); return true; }
    catch (error) {
      if (error instanceof AdminError && error.code === 'ADMIN_FORBIDDEN') return false;
      throw error;
    }
  };
}

export function createApiServer(input: ApiDeps) {
  // 호출자 객체를 복사해 한 번만 얼리고 기본값도 여기서만 정한다. 런타임과 경로 처리기는 같은 이 객체를 읽는다.
  const deps: ResolvedApiDeps = Object.freeze({
    ...input,
    trustProxyClientIp: input.trustProxyClientIp ?? false,
    webWwwEnabled: input.webWwwEnabled ?? false,
    experienceServices: input.experienceServices ?? {},
  });
  const { webAuth, admin, social, trustProxyClientIp, webWwwEnabled } = deps;
  const { realWorld, tmap, mapProvider } = deps.experienceServices;
  const runtime = createApiRuntime(deps);
  const {
    resolveAccountId, requireCurrentPlayConsent,
    socialWriteLimiter, discoveryEventLimiter,
    discoveryMapLimiter,
  } = runtime;
  return createServer(async (request, response) => {
    setCommonHeaders(response);

    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }

      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const routeContext: RouteContext = { request, response, path, deps, runtime };
      if (await handleRealWorldHttp({ request, response, path, realWorld, tmap, mapProvider,
        resolveAccountId: async () => resolveAccountId(request),
        resolveWebAccountId: async channel => {
          const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
          response.setHeader('x-robots-tag', 'noindex, nofollow');
          if (!webAuth) throw new RequestError(503, 'WEB_AUTH_NOT_CONFIGURED');
          if (request.method !== 'GET' && (request.headers.origin !== origin ||
              !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? ''))) {
            throw new RequestError(403, channel === 'admin' ? 'ADMIN_CSRF_FORBIDDEN' : 'MERCHANT_CSRF_FORBIDDEN');
          }
          const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
          if (channel === 'admin' && (!admin || !await admin.isAdmin(accountId))) throw new AdminError('ADMIN_FORBIDDEN');
          return accountId;
        },
        readBody: (maxBytes) => readJson(request, false, maxBytes), decode: decodePathParameter,
        send: (status, value) => sendJson(response, status, value as object),
        consumeEvent: () => {
          const decision = discoveryEventLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
          if (!decision.allowed) {
            response.setHeader('Retry-After', String(decision.retryAfterSeconds));
            throw new RealWorldError('EVENT_RATE_LIMITED', 429, true);
          }
        },
        consumeMap: () => {
          const decision = discoveryMapLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
          if (!decision.allowed) {
            response.setHeader('Retry-After', String(decision.retryAfterSeconds));
            throw new RealWorldError('MAP_CLIENT_RATE_LIMITED', 429, true);
          }
        },
      })) return;
      if (await handleWebAuth(routeContext)) return;
      if (await handleWebCustomer(routeContext)) return;
      if (await handleWebAdmin(routeContext)) return;
      if (await handleWebMerchant(routeContext)) return;
      if (await handleAccountDeletion(routeContext)) return;
      if (await handleAuth(routeContext)) return;
      if (await handleDiscovery(routeContext)) return;
      if (await handleExperience(routeContext)) return;
      if (await handlePlay(routeContext)) return;
      if (await handleCoinsRooms(routeContext)) return;
      if (await handlePlayStudio(routeContext)) return;
      if (await handleAccount(routeContext)) return;
      if (await handleSocialHttp({ request, response, path, service: social,
        resolveAccountId: async () => resolveAccountId(request), requireConsent: requireCurrentPlayConsent,
        readBody: () => readJson(request, true), decode: decodePathParameter,
        send: (status, result) => sendJson(response, status, result),
        consumeWrite: accountId => {
          const decision = socialWriteLimiter.consume(accountId);
          if (!decision.allowed) {
            response.setHeader('Retry-After', String(decision.retryAfterSeconds));
            throw new SocialHttpError(429, 'SOCIAL_WRITE_RATE_LIMITED');
          }
        },
      })) return;
      if (await handleCustomer(routeContext)) return;
      if (await handleCourses(routeContext)) return;
      if (await handleMerchantApp(routeContext)) return;
      if (await handleWalletClaims(routeContext)) return;
      if (await handlePublicAssets(routeContext)) return;
      if (await handleShowcase(routeContext)) return;

      sendJson(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
      respondWithError(response, error);
    }
  });
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
  const courses = pool ? new PostgresCourseService(pool, {
    includeDemo: Boolean(showcaseDeployment),
    ...(accountLifecycle ? { accountLifecycle } : {}),
  }) : undefined;
  const recommendations = pool
    ? new RecommendationService(new PostgresRecommendationSource(pool, undefined, courses))
    : undefined;
  const accountDeletions =
    pool && accountDeletionHmacSecret
      ? new PostgresAccountDeletionService(pool, {
          hmacSecret: accountDeletionHmacSecret,
          policyVersion: process.env.ACCOUNT_DELETION_POLICY_VERSION ?? 'account-deletion-v1',
          requireRecentSession: authMode.kind === 'production',
          ...(accountLifecycle ? { accountLifecycle } : {}),
        })
      : undefined;
  // #333: 시연 전부 체험 옵션은 시연 배치에서만 서비스에 넘긴다. 운영은 빈 객체라 옵션 기본값(꺼짐·보너스 0·재뽑기 30회) 그대로다.
  const allAccess = showcaseAllAccessOptions(Boolean(showcaseDeployment));
  const claimSlots =
    pool && process.env.MERCHANT_REFERENCE_HMAC_SECRET
      ? new PostgresClaimSlotService(pool, {
          referenceHmacSecret: process.env.MERCHANT_REFERENCE_HMAC_SECRET,
          ...(accountLifecycle ? { accountLifecycle } : {}),
          ...allAccess.claimSlots,
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
    ? new PostgresMileageShopService(pool, { accountLifecycle, ...allAccess.mileageShop })
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
  const social = pool && accountLifecycle
    ? new PostgresSocialService(pool, {
        accountLifecycle,
        appVariant: showcaseDeployment ? 'SHOWCASE_APP' : 'ANDROID',
        gateway: new ExpoPushGateway({ bearerCredential: process.env.EXPO_PUSH_ACCESS_TOKEN }),
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

  const fcmConfig = fcmConfigFromEnv();
  const notifications = pool && accountLifecycle
    ? new PostgresNotificationService(pool, { accountLifecycle, ...(fcmConfig ? { fcm: fcmConfig } : {}) }) : undefined;
  const adminService = pool && accountDeletionHmacSecret && webAuthConfig && !showcaseInvites
    ? new PostgresAdminService(pool, accountDeletionHmacSecret,
      process.env.MERCHANT_REFERENCE_HMAC_SECRET || accountDeletionHmacSecret) : undefined;
  const realWorld = pool ? new PostgresRealWorldService(pool, {
    ...(accountLifecycle ? { accountLifecycle } : {}),
    ...(adminService && accountLifecycle ? { isAdmin: realWorldAdminCheck(accountLifecycle) } : {}),
    includeDemo: Boolean(showcaseDeployment), mediaStore: new PostgresRealWorldMediaStore(pool),
  }) : undefined;
  const tmap = pool ? new TmapProvider({ appKey: process.env.TMAP_REST_APP_KEY ?? '' }) : undefined;
  const naver = pool ? new NaverProvider({
    mapsId: process.env.NAVER_MAP_CLIENT_ID ?? '', mapsSecret: process.env.NAVER_MAP_CLIENT_SECRET ?? '',
    searchId: process.env.NAVER_SEARCH_CLIENT_ID ?? '', searchSecret: process.env.NAVER_SEARCH_CLIENT_SECRET ?? '',
  }) : undefined;
  const play = pool && accountLifecycle ? new PostgresPlayService(pool, accountLifecycle) : undefined;
  // Required<>라서 키 하나라도 빠지면 컴파일되지 않는다(exactOptionalPropertyTypes: 값은 undefined여도 키는 반드시 적는다).
  const experienceServicesDeps: Required<ExperienceServices> = {
    gradeDraw: pool && accountLifecycle ? new PostgresGradeDrawService(pool, accountLifecycle, { ...allAccess.mileageShop }) : undefined,
    coinEconomy: pool && accountLifecycle ? new PostgresCoinEconomyService(pool, { accountLifecycle, ...allAccess.mileageShop }) : undefined,
    roomCommunity: pool && accountLifecycle && play ? new PostgresRoomCommunityService(pool, { accountLifecycle, play }) : undefined,
    furniture: pool && accountLifecycle ? new PostgresFurnitureService(pool, accountLifecycle,
      { ...allAccess.mileageShop }) : undefined,
    collectionExperience: pool && accountLifecycle ? new PostgresCollectionExperienceService(pool, accountLifecycle) : undefined,
    merchantOperations: pool && accountLifecycle ? new PostgresMerchantOperations(pool, { accountLifecycle }) : undefined,
    notifications,
    realWorld,
    tmap,
    mapProvider: tmap && naver ? new MapProvider(tmap, naver) : undefined,
  };
  const deps: Required<ApiDeps> = {
    service: configuredService(bindingStore, challengeStore),
    baseAccountResolver: accountResolver,
    merchantCatalog,
    merchantAccess,
    claimSlots,
    collection,
    recommendations,
    courses,
    mintRequests,
    accountDeletions,
    requireReauthentication: reauthenticationGuard,
    campaignEnrollments,
    campaignBenefits: pool && accountLifecycle ? new PostgresCampaignBenefitService(pool, { accountLifecycle }) : undefined,
    authSessions,
    authLoginLimiter,
    trustProxyClientIp: authMode.kind === 'production' && process.env.AUTH_TRUST_CADDY_FORWARDED_FOR === 'true',
    webAuth,
    webWwwEnabled: webAuthConfig?.wwwEnabled ?? false,
    customerIdentities,
    admin: adminService,
    deletionIntake: pool && accountDeletionHmacSecret && webAuth && !showcaseInvites
      ? new PostgresAccountDeletionIntakeService(pool, accountDeletionHmacSecret) : undefined,
    staffRegistration: pool && accountDeletionHmacSecret && webAuth && !showcaseInvites
      ? new PostgresStaffRegistration(pool, accountDeletionHmacSecret) : undefined,
    badges,
    friends,
    merchantArt,
    showcaseDeletionIntake: pool && accountDeletionHmacSecret && showcaseInvites
      ? new PostgresAccountDeletionIntakeService(pool, accountDeletionHmacSecret, { source: 'SHOWCASE_APP' }) : undefined,
    deletionProcessing: pool && accountDeletionHmacSecret && webAuth && !showcaseInvites
      ? new PostgresAccountDeletionProcessingService(pool, {
          hmacSecret: accountDeletionHmacSecret,
          policyVersion: process.env.ACCOUNT_DELETION_POLICY_VERSION ?? 'account-deletion-v1',
        }) : undefined,
    reversals,
    consent,
    nftMetadata: pool ? new PostgresNftMetadataReader(pool) : undefined,
    collectibleProjects: pool ? new PostgresCollectibleProjectService(pool, {
      staffMayManageArt: aiArtConfig.staffMayManage,
      ...(accountLifecycle ? { accountLifecycle } : {}),
    }) : undefined,
    mileageShop,
    accessRequests: pool && accountDeletionHmacSecret && showcaseDeployment
      ? new ShowcaseAccessRequestService(pool, { accountDeletionHmacSecret }) : undefined,
    // 로그인 없는 시연 웹 체험(#309)도 권한 요청과 같은 시연 배치에서만 만든다. 운영 로그인에서는 undefined라 경로가 404다.
    guestTrials: pool && accountDeletionHmacSecret && showcaseDeployment
      ? new ShowcaseGuestTrialService(pool, { accountDeletionHmacSecret }) : undefined,
    // 점주 가게 현황(#330)은 읽기 전용 집계라 pool만 있으면 만든다. 경로는 점주 웹(staffRegistration)이 있는 배치에서만 열린다.
    merchantOverview: pool ? new PostgresMerchantOverviewService(pool) : undefined,
    visitorFeedback,
    collectiblePreview: pool ? new PostgresCollectiblePreviewService(pool) : undefined,
    merchantDetailViews: pool ? new PostgresMerchantDetailViewService(pool) : undefined,
    adminFunnel: pool ? new PostgresAdminFunnelService(pool) : undefined,
    play,
    merchantProfile: pool ? new PostgresMerchantProfileService(pool, {
      staffMayManageArt: aiArtConfig.staffMayManage,
      ...(accountLifecycle ? { accountLifecycle } : {}),
    }) : undefined,
    experienceServices: experienceServicesDeps,
    storeTickets: pool && accountLifecycle && collection
      ? new PostgresStoreTicketService(pool, collection, accountLifecycle) : undefined,
    social,
  };
  const server = createApiServer(deps);
  let stopNotifications: (() => void) | undefined;
  server.once('close', () => stopNotifications?.());
  server.listen(port, bindHost, () => {
    if (notifications) stopNotifications = startNotificationScheduler(notifications, {
      onError: () => console.error('NOTIFICATION_SCHEDULER_FAILED'),
    });
    console.log(`wallet API listening on http://${bindHost}:${port}`);
  });
  const notificationsRunner = social ? startNotificationsRunner(social, {
    onError: (error) => console.error(safeErrorMetadata('notifications.runner', error)),
  }) : undefined;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await Promise.all([
        notificationsRunner?.stop(),
        new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
      ]);
      await pool?.end();
    } catch (error) {
      console.error(safeErrorMetadata('api.shutdown', error));
      process.exitCode = 1;
    }
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
}
