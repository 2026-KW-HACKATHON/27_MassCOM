import { requireWebCookie } from '../http/request-auth.js';
import { decodePathParameter, readConsentBody, readJson } from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import { resolveWebOrigin } from '../web-origin.js';
import type { RouteContext } from './context.js';

export async function handleWebCustomer(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const { webAuth, collection, collectibleProjects, badges, consent } = deps;
  const { webWwwEnabled } = deps;
  const { resolveAccountId } = runtime;
  if (path === '/api/web/collection' && request.method === 'GET') {
    const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
    if (!webAuth || !collection) throw new RequestError(503, 'WEB_COLLECTION_NOT_CONFIGURED');
    response.setHeader('x-robots-tag', 'noindex, nofollow');
    const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
    sendJson(response, 200, await collection.getCollection(accountId));
    return true;
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
    return true;
  }
  if (path === '/api/web/badges' && request.method === 'GET') {
    const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
    if (!webAuth || !badges) throw new RequestError(503, 'WEB_BADGES_NOT_CONFIGURED');
    response.setHeader('x-robots-tag', 'noindex, nofollow');
    const accountId = await webAuth.resolveSession(requireWebCookie(request, 'web_session'), origin);
    sendJson(response, 200, await badges.getBadges(accountId));
    return true;
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
    return true;
  }
  return false;
}
