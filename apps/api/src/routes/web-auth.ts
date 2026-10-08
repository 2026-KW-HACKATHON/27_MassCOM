import { authLoginClientKey, optionalWebCookie, requireWebCookie } from '../http/request-auth.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import { WebAuthError } from '../web-auth.js';
import { resolveWebOrigin } from '../web-origin.js';
import type { RouteContext } from './context.js';

export async function handleWebAuth(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps } = ctx;
  const { webAuth, authLoginLimiter } = deps;
  const { trustProxyClientIp } = deps;
  const { webWwwEnabled } = deps;
  if (path === '/api/web/auth/start' && request.method === 'GET') {
    const origin = resolveWebOrigin(request.headers.host, webWwwEnabled);
    if (!webAuth) throw new RequestError(503, 'WEB_AUTH_NOT_CONFIGURED');
    if (authLoginLimiter) {
      const decision = authLoginLimiter.consume(authLoginClientKey(request, trustProxyClientIp));
      if (!decision.allowed) {
        response.setHeader('Retry-After', String(decision.retryAfterSeconds));
        sendJson(response, 429, { code: 'LOGIN_RATE_LIMITED' });
        return true;
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
    return true;
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
    return true;
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
    return true;
  }
  return false;
}
