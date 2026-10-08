import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, type ConsentService } from './account-consent.js';
import { CourseError, type CourseService } from './course-rules.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { walletService, webHeaders } from './http-test-support.js';
import type { ApiDeps } from './api-deps.js';
import type { WebAuthHandler } from './web-auth.js';

async function request(server: Server, method: string, url: string, body?: unknown,
  headers: Record<string, string> = {}) {
  const incoming = new IncomingMessage(new Socket());
  incoming.method = method; incoming.url = url; incoming.httpVersion = '1.0';
  incoming.headers = { 'content-type': 'application/json', 'x-account-id': 'customer', ...headers };
  if (body !== undefined) incoming.push(JSON.stringify(body));
  incoming.push(null);
  const response = new ServerResponse(incoming), transport = new PassThrough();
  const chunks: Buffer[] = [];
  transport.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.assignSocket(transport as unknown as Socket);
  await new Promise<void>((resolve, reject) => {
    response.once('finish', resolve); response.once('error', reject);
    server.emit('request', incoming, response);
  });
  const payload = Buffer.concat(chunks).toString('utf8').split('\r\n\r\n')[1]!;
  return { status: response.statusCode, body: payload ? JSON.parse(payload) : undefined };
}

function fixture(options: { consentRequired?: boolean; replayed?: boolean; admin?: boolean; error?: CourseError } = {}) {
  const calls: unknown[][] = [];
  const capture = async (...args: unknown[]) => {
    calls.push(args); if (options.error) throw options.error;
    return { id: 'course', done: 2, total: 2 };
  };
  const courses = {
    list: async (...args: unknown[]) => [await capture(...args)], get: capture,
    unlock: async (...args: unknown[]) => ({ course: await capture(...args), replayed: options.replayed ?? false }),
    adminList: async (...args: unknown[]) => [await capture(...args)],
    adminCreate: capture, adminCheck: capture, adminPublish: capture, adminPause: capture,
  } as unknown as CourseService;
  const consent: ConsentService = { appSource: 'ANDROID', status: async () => ({
    required: options.consentRequired ?? false, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION,
  }), record: async () => { throw new Error('implicit consent'); } };
  const deps: ApiDeps = { service: walletService(), baseAccountResolver: developmentHeaderAccountResolver,
    courses, consent,
    webAuth: { resolveSession: async () => 'admin' } as unknown as WebAuthHandler,
    admin: { isAdmin: async () => options.admin ?? true } as unknown as ApiDeps['admin'],
  };
  return { server: createApiServer(deps), calls };
}

test('course GET reads remain available when optional play consent needs renewal', async () => {
  const { server, calls } = fixture({ consentRequired: true });
  assert.equal((await request(server, 'GET', '/me/courses')).status, 200);
  assert.equal((await request(server, 'GET', '/me/courses/course')).status, 200);
  assert.deepEqual(calls, [['customer'], ['customer', 'course']]);
  assert.equal((await request(server, 'POST', '/me/courses/course/unlock', {})).status, 403);
  assert.equal(calls.length, 2);
});

test('unlock rejects client completion assertions and returns created/replay statuses', async () => {
  const { server, calls } = fixture();
  assert.equal((await request(server, 'POST', '/me/courses/course/unlock', { done: true })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request(server, 'POST', '/me/courses/course/unlock', {})).status, 201);
  assert.deepEqual(calls, [['customer', 'course']]);
  assert.equal((await request(fixture({ replayed: true }).server, 'POST', '/me/courses/course/unlock', {})).status, 200);
  assert.equal((await request(server, 'POST', '/me/courses', {})).status, 405);
});

test('course writes share the existing per-account limiter', async () => {
  const { server, calls } = fixture();
  for (let i = 0; i < 60; i++) assert.equal((await request(server, 'POST', '/me/courses/course/unlock', {})).status, 201);
  const blocked = await request(server, 'POST', '/me/courses/course/unlock', {});
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'COURSE_WRITE_RATE_LIMITED');
  assert.equal(calls.length, 60);
});

test('admin course routes enforce existing session, role and CSRF before dispatch', async () => {
  const { server, calls } = fixture();
  assert.equal((await request(server, 'POST', '/api/web/admin/courses', {}, { ...webHeaders, origin: 'https://elsewhere.example' })).status, 403);
  assert.equal((await request(fixture({ admin: false }).server, 'GET', '/api/web/admin/courses', undefined, webHeaders)).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await request(server, 'GET', '/api/web/admin/courses', undefined, webHeaders)).status, 200);
  assert.equal((await request(server, 'POST', '/api/web/admin/courses', { title: '코스' }, webHeaders)).status, 201);
  assert.equal((await request(server, 'POST', '/api/web/admin/courses/course/check', { suggestedHour: 13 }, webHeaders)).status, 200);
  assert.deepEqual(calls.at(-1), ['admin', 'course', 13]);
  assert.equal((await request(server, 'POST', '/api/web/admin/courses/course/check', { suggestedHour: 24 }, webHeaders)).status, 400);
  assert.equal((await request(server, 'POST', '/api/web/admin/courses/course/publish', { complete: true }, webHeaders)).status, 400);
  assert.equal((await request(server, 'POST', '/api/web/admin/courses/course/publish', {}, webHeaders)).status, 200);
  assert.equal((await request(server, 'POST', '/api/web/admin/courses/course/pause', {}, webHeaders)).status, 200);
});

test('course errors retain explicit not-found, incomplete and checklist details', async () => {
  for (const [error, status] of [[new CourseError('COURSE_NOT_FOUND'), 404],
    [new CourseError('COURSE_INCOMPLETE'), 409], [new CourseError('ACCOUNT_DELETED'), 410],
    [new CourseError('COURSE_NOT_PUBLISHABLE', ['COURSE_CHECK_STALE']), 409]] as const) {
    const response = await request(fixture({ error }).server, 'GET', '/me/courses/course');
    assert.equal(response.status, status);
    assert.equal(response.body.code, error.code);
    if (error.reasons.length) assert.deepEqual(response.body.reasons, error.reasons);
  }
});
