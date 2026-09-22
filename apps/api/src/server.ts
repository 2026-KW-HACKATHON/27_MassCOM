import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import {
  AccountDeletionError,
  type AccountDeletionService,
} from './account-deletion.js';
import { AuthSessionError, type AuthSessionService } from './auth-session.js';
import { ClaimSlotError, type ClaimSlotService } from './claim-slot-service.js';
import { GoogleIdTokenError, GoogleIdTokenVerifier } from './google-id-token.js';
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
import type { MerchantCatalog } from './merchant-catalog.js';
import { MintRequestError, type MintRequestService } from './mint-request-service.js';
import {
  RecommendationService,
  type RecommendationReader,
} from './recommendation-service.js';
import { safeErrorMetadata } from './security-log.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresCampaignEnrollmentService } from './postgres/campaign-enrollment.js';
import { PostgresAccountDeletionService } from './postgres/account-deletion.js';
import { PostgresAccountLifecycle } from './postgres/account-lifecycle.js';
import { PostgresAuthSessionService } from './postgres/auth-session.js';
import { PostgresCollectionReader } from './postgres/collection.js';
import { PostgresMerchantAccessControl } from './postgres/merchant-access.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';
import { PostgresMintRequestService } from './postgres/mint-request-service.js';
import { PostgresRecommendationSource } from './postgres/recommendation.js';
import { PostgresChallengeStore } from './postgres/wallet-challenge-store.js';
import { PostgresWalletBindingStore } from './postgres/wallet-binding.js';
import { InMemoryWalletBindingStore, type WalletBindingStore } from './wallet-binding.js';

const MAX_BODY_BYTES = 64 * 1024;

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
) => void | Promise<void>;

export const developmentHeaderAccountResolver: AccountResolver = requireAccountId;
export const createBearerAccountResolver =
  (sessions: AuthSessionService): AccountResolver =>
  (request) =>
    sessions.resolve(requireBearerToken(request));
export const createSessionReauthenticationGuard =
  (sessions: AuthSessionService): ReauthenticationGuard =>
  async (_accountId, request) => {
    await sessions.assertRecentlyAuthenticated(requireBearerToken(request));
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
) {
  return createServer(async (request, response) => {
    setCommonHeaders(response);

    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { status: 'ok' });
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
        const issued = await claimSlots.issue({
          merchantId,
          customerAccountId: requireString(body, 'customerAccountId'),
          merchantReference: requireString(body, 'merchantReference'),
          createdByAccountId: accountId,
        });
        sendJson(response, 201, issued);
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
        await requireReauthentication(accountId, request);
        const body = await readJson(request);
        const result = await accountDeletions.requestDeletion({
          accountId,
          confirmation: requireString(body, 'confirmation'),
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

      sendJson(response, 404, { code: 'NOT_FOUND' });
    } catch (error) {
      if (error instanceof ClaimSlotError) {
        sendJson(response, statusForClaimSlot(error.code), { code: error.code });
        return;
      }
      if (error instanceof MerchantAccessError) {
        sendJson(response, 403, { code: error.code });
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
      if (error instanceof AccountDeletionError) {
        sendJson(response, statusForAccountDeletion(error.code), { code: error.code });
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

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
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
  if (code === 'IDENTITY_MISMATCH') return 403;
  return 401;
}

function statusForAccountDeletion(code: string): number {
  if (code === 'REAUTHENTICATION_REQUIRED') return 401;
  if (code === 'ACCOUNT_REQUIRED') return 401;
  return 400;
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
  if (code === 'CLAIM_TOKEN_EXPIRED') return 410;
  if (code === 'ACCOUNT_DELETED') return 410;
  return 409;
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
  const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL })
    : undefined;
  const merchantCatalog = pool ? new PostgresMerchantCatalog(pool) : undefined;
  const merchantAccess = pool ? new PostgresMerchantAccessControl(pool) : undefined;
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
  const accountDeletions =
    pool && accountDeletionHmacSecret
      ? new PostgresAccountDeletionService(pool, {
          hmacSecret: accountDeletionHmacSecret,
          policyVersion: process.env.ACCOUNT_DELETION_POLICY_VERSION ?? 'account-deletion-v1',
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
  const campaignEnrollments = pool
    ? new PostgresCampaignEnrollmentService(pool, {
        ...(accountLifecycle ? { accountLifecycle } : {}),
      })
    : undefined;
  const authMode = resolveAuthMode(process.env);
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
  ).listen(port, bindHost, () => {
    console.log(`wallet API listening on http://${bindHost}:${port}`);
  });
}
