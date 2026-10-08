import { decodePathParameter, readJson, requireOnlyKeys } from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import type { Studio } from '../play.js';
import type { RouteContext } from './context.js';

export async function handlePlayStudio(ctx: RouteContext): Promise<boolean> {
  const { request, response, deps, runtime } = ctx;
  const { play } = deps;
  const { resolveAccountId, requireCurrentPlayConsent, playFlowWriteLimiter } = runtime;
  if (request.method === 'PUT' && request.url === '/me/studio') {
    if (!play) throw new RequestError(503, 'PLAY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await requireCurrentPlayConsent(accountId);
    const decision = playFlowWriteLimiter.consume(accountId);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new RequestError(429, 'PLAY_FLOW_RATE_LIMITED');
    }
    const body = await readJson(request);
    requireOnlyKeys(body, ['studio', 'expectedRevision']);
    if (!body.studio || (body.expectedRevision !== undefined &&
      (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0))) throw new RequestError(400, 'STUDIO_INVALID');
    sendJson(response, 200, await play.saveStudio({ accountId, studio: body.studio as Studio,
      ...(body.expectedRevision !== undefined ? { expectedRevision: body.expectedRevision as number } : {}) }));
    return true;
  }
  const friendStudioMatch = request.url?.match(/^\/friends\/([^/]+)\/studio$/);
  if (request.method === 'GET' && friendStudioMatch) {
    if (!play) throw new RequestError(503, 'PLAY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await requireCurrentPlayConsent(accountId);
    sendJson(response, 200, await play.getFriendStudio({ accountId,
      friendshipId: decodePathParameter(friendStudioMatch[1]!) }));
    return true;
  }
  return false;
}
