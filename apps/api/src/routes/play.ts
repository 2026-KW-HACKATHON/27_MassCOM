import { decodePathParameter, readJson } from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import { isGameKind, type GameAction } from '../play-rules.js';
import type { RouteContext } from './context.js';

export async function handlePlay(ctx: RouteContext): Promise<boolean> {
  const { request, response, deps, runtime } = ctx;
  const { play } = deps;
  const { resolveAccountId, requireCurrentPlayConsent, playFinishLimiter, playFlowWriteLimiter } = runtime;
  if (request.method === 'GET' && request.url === '/me/play') {
    if (!play) throw new RequestError(503, 'PLAY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await requireCurrentPlayConsent(accountId);
    sendJson(response, 200, await play.getPlay(accountId));
    return true;
  }
  if (request.method === 'POST' && request.url === '/me/play/runs') {
    if (!play) throw new RequestError(503, 'PLAY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await requireCurrentPlayConsent(accountId);
    const body = await readJson(request);
    if (Object.keys(body).some(key => key !== 'kind' && key !== 'rulesVersion') || !isGameKind(body.kind) ||
        (body.rulesVersion !== undefined && body.rulesVersion !== 1 && body.rulesVersion !== 2)) {
      throw new RequestError(400, 'PLAY_KIND_INVALID');
    }
    sendJson(response, 201, await play.start({ accountId, kind: body.kind, rulesVersion: body.rulesVersion ?? 1 }));
    return true;
  }
  const finishPlayMatch = request.url?.match(/^\/me\/play\/runs\/([^/]+)\/finish$/);
  if (request.method === 'POST' && finishPlayMatch) {
    if (!play) throw new RequestError(503, 'PLAY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    const decision = playFinishLimiter.consume(accountId);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new RequestError(429, 'PLAY_FLOW_RATE_LIMITED');
    }
    await requireCurrentPlayConsent(accountId);
    const body = await readJson(request);
    if (Object.keys(body).join(',') !== 'actions' || !Array.isArray(body.actions) ||
        body.actions.some((action) => !action || typeof action !== 'object' || Array.isArray(action) ||
          Object.keys(action).sort().join(',') !== 'at,choice')) {
      throw new RequestError(400, 'PLAY_ACTIONS_INVALID');
    }
    sendJson(response, 200, await play.finish({ accountId,
      runId: decodePathParameter(finishPlayMatch[1]!), actions: body.actions as GameAction[] }));
    return true;
  }
  if (request.method === 'POST' && request.url === '/me/play/events') {
    if (!play) throw new RequestError(503, 'PLAY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await requireCurrentPlayConsent(accountId);
    const decision = playFlowWriteLimiter.consume(accountId);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      throw new RequestError(429, 'PLAY_FLOW_RATE_LIMITED');
    }
    const body = await readJson(request);
    if (Object.keys(body).join(',') !== 'event' ||
        (body.event !== 'share-open' && body.event !== 'image-created')) {
      throw new RequestError(400, 'PLAY_EVENT_INVALID');
    }
    await play.recordEvent({ accountId, event: body.event });
    response.writeHead(204).end();
    return true;
  }
  if (request.method === 'GET' && request.url === '/me/studio') {
    if (!play) throw new RequestError(503, 'PLAY_NOT_CONFIGURED');
    const accountId = await resolveAccountId(request);
    await requireCurrentPlayConsent(accountId);
    sendJson(response, 200, await play.getStudio(accountId));
    return true;
  }
  return false;
}
