import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ApiDeps } from './api-deps.js';
import { listen, send, walletService } from './http-test-support.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';
import type { WebAuthHandler } from './web-auth.js';

test('createApiServer는 만들 때의 deps만 쓴다: 만든 뒤 호출자 객체를 바꿔도 서버에는 반영되지 않는다', async (t) => {
  const input: ApiDeps = { service: walletService(), baseAccountResolver: developmentHeaderAccountResolver };
  const server = createApiServer(input);
  // 만든 뒤에 webAuth를 끼워 넣는다. 복사해 얼린 deps를 쓰면 서버는 여전히 웹 로그인이 설정되지 않은 상태다.
  input.webAuth = { start: async () => { throw new Error('must not be used'); } } as unknown as WebAuthHandler;
  const port = await listen(t, server);
  const response = await send(port, 'GET', '/api/web/auth/start', { headers: { host: 'masscom.kr' } });
  assert.equal(response.status, 503);
  assert.deepEqual(response.json, { code: 'WEB_AUTH_NOT_CONFIGURED' });
});
