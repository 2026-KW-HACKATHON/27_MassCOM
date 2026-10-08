import { authLoginClientKey, requireAuthSessions, requireBearerToken } from '../http/request-auth.js';
import { readJson, requireEmptyBody, requireString } from '../http/request-body.js';
import { sendJson } from '../http/response.js';
import type { RouteContext } from './context.js';

export async function handleAuth(ctx: RouteContext): Promise<boolean> {
  const { request, response, deps, runtime } = ctx;
  const { authSessions, authLoginLimiter, guestTrials } = deps;
  const { trustProxyClientIp } = deps;
  const { guestTrialLimiter } = runtime;
  if (request.method === 'POST' && request.url === '/auth/google') {
    if (authLoginLimiter) {
      const decision = authLoginLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
      if (!decision.allowed) {
        response.setHeader('Retry-After', String(decision.retryAfterSeconds));
        sendJson(response, 429, { code: 'LOGIN_RATE_LIMITED' });
        return true;
      }
    }
    const sessions = requireAuthSessions(authSessions);
    const body = await readJson(request);
    sendJson(response, 200, await sessions.signInWithGoogle(requireString(body, 'idToken')));
    return true;
  }

  // 로그인 없는 시연 웹 체험(#309). guestTrials는 시연 배치에서만 있다: 운영에서는 이 블록을 건너뛰어 맨 아래의 알 수 없는 경로와
  // 같은 404가 된다.
  if (guestTrials && request.method === 'POST' && request.url === '/auth/guest-trial') {
    const clientKey = authLoginClientKey(request, trustProxyClientIp);
    const decision = guestTrialLimiter.consume(clientKey);
    if (!decision.allowed) {
      response.setHeader('Retry-After', String(decision.retryAfterSeconds));
      sendJson(response, 429, { code: 'GUEST_TRIAL_RATE_LIMITED' });
      return true;
    }
    requireEmptyBody(await readJson(request, true));
    sendJson(response, 200, await guestTrials.start({ clientKey }));
    return true;
  }

  if (request.method === 'POST' && request.url === '/auth/logout') {
    const sessions = requireAuthSessions(authSessions);
    await sessions.logout(requireBearerToken(request));
    sendJson(response, 200, { status: 'LOGGED_OUT' });
    return true;
  }

  if (request.method === 'POST' && request.url === '/auth/reauthenticate') {
    const sessions = requireAuthSessions(authSessions);
    const sessionToken = requireBearerToken(request);
    const body = await readJson(request);
    await sessions.reauthenticate(sessionToken, requireString(body, 'idToken'));
    sendJson(response, 200, { status: 'REAUTHENTICATED' });
    return true;
  }
  return false;
}
