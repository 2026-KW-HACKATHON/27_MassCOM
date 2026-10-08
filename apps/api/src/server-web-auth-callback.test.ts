import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listen, send, walletService } from './http-test-support.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import { WebAuthError, type WebAuthHandler } from './web-auth.js';

// GET /api/web/auth/callback은 state 쿠키를 "한 번 쓰고 바로 지운다": 검증이 어디서 실패하든 응답에는 지우는 Set-Cookie와
// noindex가 붙어야 하고, 성공하면 [지우기, 세션] 두 쿠키가 이 순서로 나간다. 지우는 줄은 검증보다 앞에 있어야 해서 따로 고정한다.
const clearState = 'web_auth_state=; Path=/api/web/auth; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
const callbackHeaders = { host: 'masscom.kr', cookie: 'web_auth_state=state-1' };

function callbackFixture(complete: WebAuthHandler['complete']) {
  const completed: string[][] = [];
  const webAuth: WebAuthHandler = {
    start: async () => { throw new Error('not used'); },
    complete: async (code, state, cookieState, origin) => {
      completed.push([code, state, cookieState]);
      return complete(code, state, cookieState, origin);
    },
    resolveSession: async () => { throw new Error('not used'); },
    resolveSessionWithAge: async () => { throw new Error('not used'); },
    logout: async () => { throw new Error('not used'); },
  };
  const server = createApiServer({ service: walletService(), baseAccountResolver: developmentHeaderAccountResolver, webAuth });
  return { server, completed };
}

test('콜백 검증이 실패하면 state 쿠키를 지우고 noindex를 붙인 채 401로 끝나며 서비스는 부르지 않는다', async (t) => {
  const { server, completed } = callbackFixture(async () => ({ token: 'unused' }));
  const port = await listen(t, server);
  const cases: { name: string; url: string; headers: Record<string, string>; code: string }[] = [
    { name: 'state 없음', url: '/api/web/auth/callback?code=once', headers: callbackHeaders, code: 'WEB_AUTH_STATE_INVALID' },
    { name: 'code 없음', url: '/api/web/auth/callback?state=state-1', headers: callbackHeaders, code: 'WEB_AUTH_STATE_INVALID' },
    { name: 'state 중복', url: '/api/web/auth/callback?code=once&state=a&state=b', headers: callbackHeaders, code: 'WEB_AUTH_STATE_INVALID' },
    { name: 'state 쿠키 없음', url: '/api/web/auth/callback?code=once&state=state-1', headers: { host: 'masscom.kr' }, code: 'WEB_SESSION_INVALID' },
  ];
  for (const item of cases) {
    const response = await send(port, 'GET', item.url, { headers: item.headers });
    assert.equal(response.status, 401, item.name);
    assert.deepEqual(response.json, { code: item.code }, item.name);
    assert.deepEqual(response.headers['set-cookie'], [clearState], item.name);
    assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow', item.name);
  }
  assert.deepEqual(completed, []);
});

test('콜백에서 서비스가 state 불일치로 거절해도 state 쿠키는 지워진다', async (t) => {
  const { server, completed } = callbackFixture(async () => { throw new WebAuthError('WEB_AUTH_STATE_INVALID'); });
  const port = await listen(t, server);
  const response = await send(port, 'GET', '/api/web/auth/callback?code=once&state=other', { headers: callbackHeaders });
  assert.equal(response.status, 401);
  assert.deepEqual(response.json, { code: 'WEB_AUTH_STATE_INVALID' });
  assert.deepEqual(response.headers['set-cookie'], [clearState]);
  assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
  assert.deepEqual(completed, [['once', 'other', 'state-1']]);
});

test('콜백이 성공하면 state 지우기 다음에 세션 쿠키 순서로 두 쿠키를 내고 303으로 보낸다', async (t) => {
  const { server } = callbackFixture(async () => ({ token: 'secret-web-token', returnTo: '/account-deletion' }));
  const port = await listen(t, server);
  const response = await send(port, 'GET', '/api/web/auth/callback?code=once&state=state-1', { headers: callbackHeaders });
  assert.equal(response.status, 303);
  assert.deepEqual(response.headers['set-cookie'], [
    clearState,
    'web_session=secret-web-token; Path=/api/web; HttpOnly; Secure; SameSite=Lax',
  ]);
  assert.equal(response.headers.location, '/account-deletion');
  assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
});
