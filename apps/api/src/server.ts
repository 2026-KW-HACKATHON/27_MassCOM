import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { ClaimSlotError, type ClaimSlotService } from './claim-slot-service.js';
import {
  InMemoryChallengeStore,
  WalletChallengeError,
  WalletChallengeService,
} from './wallet-challenge-service.js';
import {
  MerchantAccessError,
  type MerchantAccessControl,
} from './merchant-access.js';
import type { MerchantCatalog } from './merchant-catalog.js';
import { PostgresClaimSlotService } from './postgres/claim-slot-service.js';
import { PostgresMerchantAccessControl } from './postgres/merchant-access.js';
import { PostgresMerchantCatalog } from './postgres/merchant-catalog.js';

const MAX_BODY_BYTES = 64 * 1024;

export type AccountResolver = (request: IncomingMessage) => string | Promise<string>;

export const developmentHeaderAccountResolver: AccountResolver = requireAccountId;

export function createApiServer(
  service: WalletChallengeService,
  resolveAccountId: AccountResolver,
  merchantCatalog?: MerchantCatalog,
  merchantAccess?: MerchantAccessControl,
  claimSlots?: ClaimSlotService,
) {
  return createServer(async (request, response) => {
    setCommonHeaders(response);

    try {
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }

      if (request.method === 'GET' && request.url === '/merchants') {
        if (!merchantCatalog) {
          throw new RequestError(503, 'MERCHANT_CATALOG_NOT_CONFIGURED');
        }
        sendJson(response, 200, { merchants: await merchantCatalog.listPublicMerchants() });
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
        const merchantId = decodeURIComponent(request.url!.split('/')[3]!);
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
        const merchantId = decodeURIComponent(request.url!.split('/')[3]!);
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
        const merchantId = decodeURIComponent(reissueMatch[1]!);
        await merchantAccess.requirePermission({
          accountId,
          merchantId,
          permission: 'CONFIRM_VISIT',
        });
        const issued = await claimSlots.reissue({
          merchantId,
          claimSlotId: decodeURIComponent(reissueMatch[2]!),
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
      if (error instanceof RequestError) {
        sendJson(response, error.status, { code: error.code });
        return;
      }

      console.error('unhandled API error', error);
      sendJson(response, 500, { code: 'INTERNAL_ERROR' });
    }
  });
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

function statusFor(code: string): number {
  if (code === 'ACCOUNT_AUTH_NOT_CONFIGURED') return 503;
  if (code === 'ACCOUNT_REQUIRED' || code === 'SIGNER_MISMATCH') return 401;
  if (code === 'ACCOUNT_MISMATCH') return 403;
  if (code === 'CHALLENGE_NOT_FOUND') return 404;
  if (code === 'SIGNATURE_EXPIRED') return 410;
  if (code === 'NONCE_ALREADY_USED' || code === 'NONCE_IN_PROGRESS') return 409;
  return 400;
}

function statusForClaimSlot(code: string): number {
  if (code === 'CLAIM_TOKEN_EXPIRED') return 410;
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

function configuredService(): WalletChallengeService {
  const chainId = Number(process.env.WALLET_CHAIN_ID ?? '84532');
  return new WalletChallengeService({
    store: new InMemoryChallengeStore(),
    domain: process.env.SIWE_DOMAIN ?? 'api.masscom.local',
    uri: process.env.SIWE_URI ?? 'https://api.masscom.local/wallet/verify',
    chainId,
    ttlMs: Number(process.env.WALLET_CHALLENGE_TTL_MS ?? 5 * 60 * 1000),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL })
    : undefined;
  const merchantCatalog = pool ? new PostgresMerchantCatalog(pool) : undefined;
  const merchantAccess = pool ? new PostgresMerchantAccessControl(pool) : undefined;
  const claimSlots = pool ? new PostgresClaimSlotService(pool) : undefined;
  const accountResolver: AccountResolver =
    process.env.ALLOW_INSECURE_DEMO_ACCOUNT === 'true'
      ? developmentHeaderAccountResolver
      : () => {
          throw new WalletChallengeError('ACCOUNT_AUTH_NOT_CONFIGURED');
        };

  createApiServer(
    configuredService(),
    accountResolver,
    merchantCatalog,
    merchantAccess,
    claimSlots,
  ).listen(port, '127.0.0.1', () => {
    console.log(`wallet API listening on http://127.0.0.1:${port}`);
  });
}
