import { decodePathParameter, readJson, requireEmptyBody } from '../http/request-body.js';
import { RequestError } from '../http/request-error.js';
import { sendJson } from '../http/response.js';
import type { RouteContext } from './context.js';

export async function handleCourses(ctx: RouteContext): Promise<boolean> {
  const { request, response, path, deps, runtime } = ctx;
  const match = path.match(/^\/me\/courses\/([^/]+)(\/unlock)?$/);
  if (path !== '/me/courses' && !match) return false;
  if (!deps.courses) throw new RequestError(503, 'COURSES_NOT_CONFIGURED');
  const accountId = await runtime.resolveAccountId(request);
  // 도감처럼 읽기는 선택 놀이 동의 없이 허용하고, 장면 열기는 현재 동의를 확인한다.
  if (request.method === 'GET' && !match?.[2]) {
    sendJson(response, 200, match
      ? { course: await deps.courses.get(accountId, decodePathParameter(match[1]!)) }
      : { courses: await deps.courses.list(accountId) });
    return true;
  }
  if (request.method !== 'POST' || !match?.[2]) throw new RequestError(405, 'METHOD_NOT_ALLOWED');
  await runtime.requireCurrentPlayConsent(accountId);
  const decision = runtime.coinWriteLimiter.consume(accountId);
  if (!decision.allowed) {
    response.setHeader('Retry-After', String(decision.retryAfterSeconds));
    throw new RequestError(429, 'COURSE_WRITE_RATE_LIMITED');
  }
  requireEmptyBody(await readJson(request));
  const result = await deps.courses.unlock(accountId, decodePathParameter(match[1]!));
  sendJson(response, result.replayed ? 200 : 201, result);
  return true;
}
