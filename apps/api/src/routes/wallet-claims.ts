import {
  decodePathParameter, readJson, requireHeader, requireNumber, requirePositiveInteger, requireString,
} from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import type { RouteContext } from './context.js';

export async function handleWalletClaims(ctx: RouteContext): Promise<boolean> {
  const { request, response, deps, runtime } = ctx;
  const { service, claimSlots, mintRequests, accountDeletions, requireReauthentication, campaignEnrollments } = deps;
  const { resolveAccountId } = runtime;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }

  if (request.method === 'GET' && request.url === '/wallets/active-binding') {
    const accountId = await resolveAccountId(request);
    sendJson(response, 200, { binding: (await service.getActiveBinding(accountId)) ?? null });
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }
  return false;
}
