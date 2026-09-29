import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  AccountDeletionError,
  type AccountDeletionService,
} from './account-deletion.js';
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
import { WebSessionError } from './web-session.js';
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
import type { CollectionReader } from './collection.js';
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
import type { MerchantCatalog } from './merchant-catalog.js';
import { MintRequestError, type MintRequestService } from './mint-request-service.js';
import {
  RecommendationService,
  type RecommendationReader,
} from './recommendation-service.js';
import { safeErrorMetadata } from './security-log.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresCustomerIdentityService } from './postgres/customer-identity.js';
import { PostgresCampaignEnrollmentService } from './postgres/campaign-enrollment.js';
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
import { PostgresCollectionReader } from './postgres/collection.js';
import { PostgresMerchantAccessControl } from './postgres/merchant-access.js';
import { PostgresMerchantArtService } from './postgres/merchant-art.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { PostgresStaffRegistration, StaffRegistrationError } from './postgres/staff-registration.js';
import { PostgresMintRequestService } from './postgres/mint-request-service.js';
import { PostgresRecommendationSource } from './postgres/recommendation.js';
import { PostgresChallengeStore } from './postgres/wallet-challenge-store.js';
import { PostgresWalletBindingStore } from './postgres/wallet-binding.js';
import { InMemoryWalletBindingStore, type WalletBindingStore } from './wallet-binding.js';

const MAX_BODY_BYTES = 64 * 1024;
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
  resolveAccountId: AccountResolver,
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
    Partial<Pick<PostgresAdminService, 'operationsStatus' | 'listCampaignDrafts' | 'createCampaignDraft'>>,
  deletionIntake?: AccountDeletionIntakeService,
  staffRegistration?: Pick<PostgresStaffRegistration, 'request' | 'approve' | 'revoke' | 'mine' | 'eligible' | 'list'>,
  badges?: BadgeRewardService,
  friends?: FriendService,
  merchantArt?: MerchantArtService,
  showcaseDeletionIntake?: AccountDeletionIntakeService,
  deletionProcessing?: AccountDeletionProcessingService,
) {
  // The receipt lookup needs no login, so it is throttled per client instead (a receipt has 80 bits, this only stops floods).
  const deletionStatusLimiter = new FixedWindowAuthLoginLimiter({ maxAttempts: 30, windowMs: 60_000 });
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
      if (path === '/api/web/badges' && request.method === 'GET') {
        const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
        if (!webAuth || !badges) throw new RequestError(503, 'WEB_BADGES_NOT_CONFIGURED');
        response.setHeader('x-robots-tag', 'noindex, nofollow');
        const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
        sendJson(response, 200, await badges.getBadges(accountId));
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
        // 계정 삭제 요청 처리(#194, D-051): 웹 로그인으로 접수된 요청만 운영자가 처리한다. 화면에는 마스킹한 계정 표지만 나간다.
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
          sendJson(response, 200, { merchants: await staffRegistration.mine(accountId) });
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
        const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
        const body = await readJson(request);
        if (path === '/api/web/account-deletion-intake/cancel') {
          sendJson(response, 200, await deletionIntake.cancel(accountId));
        } else {
          sendJson(response, 202, await deletionIntake.request(accountId, { reissue: body.reissue === true }));
        }
        return;
      }

      // 시연 앱 전용(#194, D-051): 시연 서버에서만 서비스가 만들어진다. 운영 API에는 이 경로가 없고 운영 앱은 웹 페이지를 쓴다.
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
          if (resolveAccountId !== developmentHeaderAccountResolver) throw new RequestError(403, 'CUSTOMER_IDENTITY_REQUIRED');
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
          sendJson(response, 202, await merchantArt.chooseDraft({ merchantId, roundId, index }));
        } else if (artRoute.kind === 'apply') {
          requireEmptyBody(await readJson(request, true));
          sendJson(response, 200, await merchantArt.apply({ merchantId, roundId }));
        } else {
          requireEmptyBody(await readJson(request, true));
          await merchantArt.reset(merchantId);
          sendJson(response, 200, { status: 'RESET' });
        }
        return;
      }

      sendJson(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
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
        sendJson(response, statusForMerchantArt(error.code), { code: error.code });
        return;
      }
      if (error instanceof MerchantAccessError) {
        sendJson(response, 403, { code: error.code });
        return;
      }
      if (error instanceof AdminError) {
        const status = error.code === 'ADMIN_FORBIDDEN' ? 403
          : error.code === 'ADMIN_MERCHANT_NOT_FOUND' || error.code === 'ADMIN_IDENTITY_NOT_FOUND' ? 404
            : error.code === 'ADMIN_VERSION_CONFLICT' || error.code === 'ADMIN_PENDING_CLAIMS' ? 409 : 400;
        sendJson(response, status, { code: error.code });
        return;
      }
      if (error instanceof StaffRegistrationError) {
        const status = error.code === 'STAFF_FORBIDDEN' ? 403
          : error.code === 'STAFF_MERCHANT_NOT_FOUND' || error.code === 'STAFF_NOT_FOUND' ? 404
            : error.code === 'STAFF_CODE_INVALID' ? 400 : 409;
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

async function readJson(request: IncomingMessage, allowEmpty = false): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
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
  if (Object.keys(body).some(key => !['name', 'story', 'roadAddress', 'minimumSpendWon', 'menuItems', 'businessHours', 'expectedVersion'].includes(key))) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return {
    name: requireString(body, 'name'), story: requireString(body, 'story', true),
    roadAddress: requireString(body, 'roadAddress'), minimumSpendWon: requireNumber(body, 'minimumSpendWon'),
    ...(body.menuItems === undefined ? {} : { menuItems: body.menuItems as NonNullable<MerchantInput['menuItems']> }),
    ...(body.businessHours === undefined ? {} : { businessHours: body.businessHours as string }),
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
  if (code === 'AI_ART_NOT_CONFIGURED' || code === 'AI_ART_BUDGET_EXHAUSTED') return 503;
  if (code === 'ACCOUNT_DELETED') return 410;
  return 409;
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

function requireEmptyBody(body: Record<string, unknown>): void {
  if (Object.keys(body).length > 0) throw new RequestError(400, 'INVALID_REQUEST');
}

function statusForMintRequest(code: string): number {
  if (code === 'ENTITLEMENT_NOT_FOUND' || code === 'WALLET_BINDING_NOT_FOUND' || code === 'MINT_JOB_NOT_FOUND') {
    return 404;
  }
  if (code === 'CONSENT_REQUIRED' || code === 'IDEMPOTENCY_KEY_REQUIRED') return 400;
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
  const collection = pool ? new PostgresCollectionReader(pool) : undefined;
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
  const mintRequests = pool
    ? new PostgresMintRequestService(pool, {
        supportedConsentVersion: process.env.NFT_MINT_CONSENT_VERSION ?? 'nft-mint-v1',
        ...(accountLifecycle ? { accountLifecycle } : {}),
      })
    : undefined;
  const authMode = resolveAuthMode(process.env);
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
  const friends = pool && accountLifecycle
    ? new PostgresFriendService(pool, { accountLifecycle })
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
      ? new PostgresAdminService(pool, accountDeletionHmacSecret) : undefined,
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
  ).listen(port, bindHost, () => {
    console.log(`wallet API listening on http://${bindHost}:${port}`);
  });
}
