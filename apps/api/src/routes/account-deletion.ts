import { requireWebCookie } from '../http/request-auth.js';
import { readJson, requireString } from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import { resolveWebOrigin } from '../web-origin.js';
import { WebSessionError, freshWebSessionMs } from '../web-session.js';
import type { RouteContext } from './context.js';

export async function handleAccountDeletion(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const { webAuth, deletionIntake, showcaseDeletionIntake } = deps;
  const webWwwEnabled = deps.webWwwEnabled ?? false;
  const { resolveAccountId, consumeDeletionStatus } = runtime;
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
      if (!consumeDeletionStatus(request, response)) return true;
      const body = await readJson(request);
      if (Object.keys(body).some(key => key !== 'receipt')) throw new RequestError(400, 'INVALID_REQUEST');
      sendJson(response, 200, await deletionIntake.status(requireString(body, 'receipt')));
      return true;
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
    return true;
  }

  // 시연 앱 전용(#194, D-052): 시연 서버에서만 서비스가 만들어진다. 운영 API에는 이 경로가 없고 운영 앱은 웹 페이지를 쓴다.
  if (showcaseDeletionIntake && (path === '/account-deletion-intake' ||
      path === '/account-deletion-intake/cancel' || path === '/account-deletion-status')) {
    if (path === '/account-deletion-status') {
      if (request.method !== 'POST') throw new RequestError(405, 'METHOD_NOT_ALLOWED');
      if (!consumeDeletionStatus(request, response)) return true;
      const body = await readJson(request);
      if (Object.keys(body).some(key => key !== 'receipt')) throw new RequestError(400, 'INVALID_REQUEST');
      sendJson(response, 200, await showcaseDeletionIntake.status(requireString(body, 'receipt')));
      return true;
    }
    if (path === '/account-deletion-intake' && request.method === 'GET') {
      const accountId = await resolveAccountId(request);
      sendJson(response, 200, { request: await showcaseDeletionIntake.current(accountId) });
      return true;
    }
    if (request.method !== 'POST') throw new RequestError(405, 'METHOD_NOT_ALLOWED');
    const accountId = await resolveAccountId(request);
    const body = await readJson(request, true);
    if (path === '/account-deletion-intake/cancel') {
      sendJson(response, 200, await showcaseDeletionIntake.cancel(accountId));
    } else {
      sendJson(response, 202, await showcaseDeletionIntake.request(accountId, { reissue: body.reissue === true }));
    }
    return true;
  }
  return false;
}
