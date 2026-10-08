import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as serverModule from './server.js';
import {
  createApiServer, developmentHeaderAccountResolver,
  type AccountResolver, type AuthLoginLimiter, type AuthMode, type ExperienceServices, type ReauthenticationGuard,
  type ShowcaseDeployment,
} from './server.js';
import { listen, positionalArgs, send } from './http-test-support.js';

// 리팩터링 안전망: server.ts는 진입점(package.json start*, api.Dockerfile, qa-local.sh)이자 테스트가 가져다 쓰는 공개 표면이다.
// 내용을 다른 모듈로 옮겨도 이 표면은 그대로여야 한다.

test('server.ts가 내보내는 값은 지금 목록과 같다', () => {
  const functions = [
    'FixedWindowAuthLoginLimiter', 'authLoginLimit', 'authLoginWindowMs', 'authSessionCleanupBatchSize', 'createApiServer',
    'createBearerAccountResolver', 'createSessionReauthenticationGuard', 'developmentHeaderAccountResolver',
    'developmentHeaderReauthenticationGuard', 'googleJwksMaxStaleMs', 'realWorldAdminCheck', 'renderClaimQr',
    'resolveApiBindHost', 'resolveAuthMode', 'resolveShowcaseDeployment', 'sessionTtlMs',
  ];
  assert.deepEqual(Object.keys(serverModule).sort(), functions);
  for (const name of functions) assert.equal(typeof (serverModule as Record<string, unknown>)[name], 'function', name);
});

// 내보내는 형식은 런타임에 보이지 않는다. 이름이 사라지거나 모양이 바뀌면 이 파일이 타입 검사에서 깨진다.
type ExportedTypes = [AccountResolver, ReauthenticationGuard, AuthLoginLimiter, ExperienceServices, AuthMode, ShowcaseDeployment];
const typeSurface: ExportedTypes = [
  () => 'account', () => undefined, { consume: () => ({ allowed: true, retryAfterSeconds: 0 }) }, {},
  { kind: 'demo' }, 'hosted',
];

test('내보낸 형식이 그대로 쓰인다', () => {
  assert.equal(typeSurface.length, 6);
});

const same: AccountResolver = (request) => developmentHeaderAccountResolver(request);

test('developmentHeaderAccountResolver는 함수 정체성으로 구분된다: 체험 세션 Bearer는 이 해석기일 때만 풀린다', async (t) => {
  const resolved: string[] = [];
  const guestTrials = { start: async () => { throw new Error('unused'); },
    resolve: async (token: string) => { resolved.push(token); return `guest:${token}`; } };
  const collection = { getCollection: async (accountId: string) => ({ accountId }) };
  const services = { guestTrials, collection };
  const dev = await listen(t, createApiServer(...positionalArgs(developmentHeaderAccountResolver, services) as Parameters<typeof createApiServer>));
  const wrapped = await listen(t, createApiServer(...positionalArgs(same, services) as Parameters<typeof createApiServer>));

  const headerOnly = await send(dev, 'GET', '/collection', { headers: { 'x-account-id': 'acct' } });
  assert.deepEqual({ status: headerOnly.status, json: headerOnly.json }, { status: 200, json: { accountId: 'acct' } });
  const bearer = await send(dev, 'GET', '/collection', { headers: { authorization: 'Bearer tok-1', 'x-account-id': 'acct' } });
  assert.deepEqual({ status: bearer.status, json: bearer.json }, { status: 200, json: { accountId: 'guest:tok-1' } });
  assert.deepEqual(resolved, ['tok-1']);

  const ignoredBearer = await send(wrapped, 'GET', '/collection', { headers: { authorization: 'Bearer tok-2', 'x-account-id': 'acct' } });
  assert.deepEqual({ status: ignoredBearer.status, json: ignoredBearer.json }, { status: 200, json: { accountId: 'acct' } });
  assert.deepEqual(resolved, ['tok-1']);
});

test('점주 앱 수령 슬롯의 옛 customerAccountId 방식은 개발용 헤더 해석기에서만 열린다(함수 정체성 비교)', async (t) => {
  const issued = { claimSlotId: 'slot-1', token: 'tok', tokenVersion: 1, expiresAt: '2026-10-09T00:00:00.000Z' };
  const calls: unknown[] = [];
  const services = {
    merchantAccess: { requirePermission: async () => ({ merchantId: 'm1', role: 'OWNER', permissions: [] }) },
    claimSlots: { issue: async (input: unknown) => { calls.push(input); return issued; } },
  };
  const url = '/merchant/merchants/m1/claim-slots';
  const body = JSON.stringify({ customerAccountId: 'customer-1', merchantReference: 'ref-1' });
  const headers = { 'x-account-id': 'staff', 'content-type': 'application/json' };
  const dev = await listen(t, createApiServer(...positionalArgs(developmentHeaderAccountResolver, services) as Parameters<typeof createApiServer>));
  const opened = await send(dev, 'POST', url, { headers, body });
  assert.deepEqual({ status: opened.status, json: opened.json }, { status: 201, json: issued });
  assert.equal(calls.length, 1);

  const wrapped = await listen(t, createApiServer(...positionalArgs(same, services) as Parameters<typeof createApiServer>));
  const closed = await send(wrapped, 'POST', url, { headers, body });
  assert.deepEqual({ status: closed.status, json: closed.json }, { status: 403, json: { code: 'CUSTOMER_IDENTITY_REQUIRED' } });
  assert.equal(calls.length, 1);
});
