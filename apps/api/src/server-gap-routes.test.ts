import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION, type ConsentService } from './account-consent.js';
import { MileageShopError } from './mileage-shop.js';
import { listen, positionalArgs, send, webHeaders } from './http-test-support.js';
import { createApiServer, developmentHeaderAccountResolver } from './server-test-support.js';

// 리팩터링 안전망: 기존 시험이 건드리지 않던 경로(관리자 웹의 방 신고·도장 숨기기·코인 시리즈·티켓 지급·풀 중지,
// 마일리지 상점의 재뽑기·아바타·옷)와 "알려진 경로에서 메서드가 틀리면 405" 규칙을 지금 모습 그대로 고정한다.

type Calls = { name: string; input: unknown }[];

function recorder(calls: Calls, name: string, result: unknown = { ok: true }) {
  return async (input?: unknown) => { calls.push({ name, input }); return result; };
}

function adminFixture(options: { admin?: boolean; withCoins?: boolean; withRooms?: boolean } = {}) {
  const calls: Calls = [];
  const services = {
    webAuth: { resolveSession: async (cookie: string) => { calls.push({ name: 'resolveSession', input: cookie }); return 'admin-1'; } },
    admin: { isAdmin: async (accountId: string) => { calls.push({ name: 'isAdmin', input: accountId }); return options.admin ?? true; } },
    ...(options.withCoins === false ? {} : {
      coinEconomy: {
        publishPool: recorder(calls, 'publishPool', { pool: 'p' }), publishSeries: recorder(calls, 'publishSeries', { series: 's' }),
        grantTicket: recorder(calls, 'grantTicket', { ticket: 't' }), grantRerollTicket: recorder(calls, 'grantRerollTicket', { replayed: false }),
        pausePool: recorder(calls, 'pausePool', { paused: true }),
      },
    }),
    ...(options.withRooms === false ? {} : {
      roomCommunity: { listReports: recorder(calls, 'listReports', [{ reportId: 'r1' }]), moderateStamp: recorder(calls, 'moderateStamp', undefined) },
    }),
  };
  const experienceServices = { coinEconomy: services.coinEconomy, roomCommunity: services.roomCommunity };
  const server = createApiServer(...positionalArgs(developmentHeaderAccountResolver, {
    webAuth: services.webAuth, admin: services.admin, experienceServices,
  }) as Parameters<typeof createApiServer>);
  return { server, calls };
}

const body = (value: unknown) => JSON.stringify(value);
const result = (response: { status: number; json: unknown }) => ({ status: response.status, json: response.json });

test('관리자 웹 방 신고 목록: 관리자 세션의 계정만 서비스에 넘기고, 서비스·권한·세션이 없으면 각각 503·403·401', async (t) => {
  const { server, calls } = adminFixture();
  const port = await listen(t, server);
  const url = '/api/web/admin/room-reports';
  assert.deepEqual(result(await send(port, 'GET', url, { headers: webHeaders })), { status: 200, json: { reports: [{ reportId: 'r1' }] } });
  assert.deepEqual(calls.filter((call) => call.name === 'listReports'), [{ name: 'listReports', input: 'admin-1' }]);
  assert.deepEqual(result(await send(port, 'GET', url, { headers: { host: 'masscom.kr' } })), { status: 401, json: { code: 'WEB_SESSION_INVALID' } });
  assert.deepEqual(result(await send(port, 'POST', url, { headers: webHeaders, body: '{}' })), { status: 404, json: { code: 'NOT_FOUND' } });

  const notAdmin = adminFixture({ admin: false });
  const notAdminPort = await listen(t, notAdmin.server);
  assert.deepEqual(result(await send(notAdminPort, 'GET', url, { headers: webHeaders })), { status: 403, json: { code: 'ADMIN_FORBIDDEN' } });
  assert.equal(notAdmin.calls.some((call) => call.name === 'listReports'), false);

  const noRooms = adminFixture({ withRooms: false });
  const noRoomsPort = await listen(t, noRooms.server);
  assert.deepEqual(result(await send(noRoomsPort, 'GET', url, { headers: webHeaders })),
    { status: 503, json: { code: 'ROOM_COMMUNITY_NOT_CONFIGURED' } });
});

test('관리자 웹 도장 숨기기: 빈 본문 POST만 받고 204, 출처가 다르면 CSRF 403, 잘못된 퍼센트 인코딩은 400', async (t) => {
  const { server, calls } = adminFixture();
  const port = await listen(t, server);
  const url = '/api/web/admin/room-stamps/stamp-1/hide';
  const hidden = await send(port, 'POST', url, { headers: webHeaders, body: '{}' });
  assert.deepEqual({ status: hidden.status, text: hidden.text }, { status: 204, text: '' });
  assert.deepEqual(calls.filter((call) => call.name === 'moderateStamp'),
    [{ name: 'moderateStamp', input: { actorAccountId: 'admin-1', stampId: 'stamp-1' } }]);
  assert.deepEqual(result(await send(port, 'POST', url, { headers: webHeaders, body: '{"stampId":"other"}' })),
    { status: 400, json: { code: 'INVALID_REQUEST' } });
  assert.deepEqual(result(await send(port, 'POST', '/api/web/admin/room-stamps/%E0%A4%A/hide', { headers: webHeaders, body: '{}' })),
    { status: 400, json: { code: 'INVALID_PATH_PARAMETER' } });
  assert.deepEqual(result(await send(port, 'POST', url, { headers: { ...webHeaders, origin: 'https://evil.example' }, body: '{}' })),
    { status: 403, json: { code: 'ADMIN_CSRF_FORBIDDEN' } });
  assert.deepEqual(result(await send(port, 'GET', url, { headers: webHeaders })), { status: 404, json: { code: 'NOT_FOUND' } });
  assert.equal(calls.filter((call) => call.name === 'moderateStamp').length, 1);
  // 도장 숨기기 제한(분당 60회, 계정별)은 본문을 읽기 전에 센다: 빈 본문 요청이 60번 지나면 61번째는 429다.
  for (let index = 0; index < 59; index += 1) await send(port, 'POST', url, { headers: webHeaders, body: '{}' });
  assert.deepEqual(result(await send(port, 'POST', url, { headers: webHeaders, body: '{}' })), { status: 429, json: { code: 'ROOM_RATE_LIMITED' } });
});

test('관리자 웹 코인 시리즈·티켓 지급·풀 중지: 행위자는 세션 계정으로 덮어쓰고 모르는 키는 400', async (t) => {
  const { server, calls } = adminFixture();
  const port = await listen(t, server);
  const series = { merchantId: 'm1', title: 'series', endsAt: '2026-12-31', baseCoins: 3, prismCoins: 1,
    baseCoupon: 'a', prismCoupon: 'b', consentDocumentRef: 'doc-1', consent: true };
  const created = await send(port, 'POST', '/api/web/admin/coin-series', { headers: webHeaders, body: body({ ...series, actorAccountId: undefined }) });
  assert.deepEqual(result(created), { status: 201, json: { series: 's' } });
  assert.deepEqual(calls.at(-1), { name: 'publishSeries', input: { ...series, actorAccountId: 'admin-1' } });
  assert.deepEqual(result(await send(port, 'POST', '/api/web/admin/coin-series', { headers: webHeaders, body: body({ ...series, actorAccountId: 'forged' }) })),
    { status: 400, json: { code: 'INVALID_REQUEST' } });

  const grant = { accountId: 'customer-1', poolId: 'pool-1', requestId: 'req-1' };
  assert.deepEqual(result(await send(port, 'POST', '/api/web/admin/coin-tickets/grant', { headers: webHeaders, body: body(grant) })),
    { status: 201, json: { ticket: 't' } });
  assert.deepEqual(calls.at(-1), { name: 'grantTicket', input: { actorAccountId: 'admin-1', ...grant } });
  assert.deepEqual(result(await send(port, 'POST', '/api/web/admin/coin-tickets/grant', { headers: webHeaders, body: body({ ...grant, extra: 1 }) })),
    { status: 400, json: { code: 'INVALID_REQUEST' } });
  assert.deepEqual(result(await send(port, 'POST', '/api/web/admin/coin-tickets/grant', { headers: webHeaders, body: body({ accountId: 'customer-1', poolId: 'pool-1' }) })),
    { status: 400, json: { code: 'INVALID_REQUEST' } });

  assert.deepEqual(result(await send(port, 'POST', '/api/web/admin/coin-pools/pool%2D1/pause', { headers: webHeaders, body: '{}' })),
    { status: 200, json: { paused: true } });
  assert.deepEqual(calls.at(-1), { name: 'pausePool', input: { actorAccountId: 'admin-1', poolId: 'pool-1' } });
  assert.deepEqual(result(await send(port, 'POST', '/api/web/admin/coin-pools/pool-1/pause', { headers: webHeaders, body: '{"poolId":"x"}' })),
    { status: 400, json: { code: 'INVALID_REQUEST' } });
  assert.deepEqual(result(await send(port, 'POST', '/api/web/admin/coin-unknown', { headers: webHeaders, body: '{}' })),
    { status: 404, json: { code: 'NOT_FOUND' } });
  assert.deepEqual(result(await send(port, 'GET', '/api/web/admin/coin-series', { headers: webHeaders })), { status: 404, json: { code: 'NOT_FOUND' } });
});

test('관리자 웹 코인 쓰기: 서비스 없음은 503, 제한(시간당 60회)은 본문 검사보다 먼저 세어 Retry-After와 함께 429', async (t) => {
  const missing = adminFixture({ withCoins: false });
  const missingPort = await listen(t, missing.server);
  assert.deepEqual(result(await send(missingPort, 'POST', '/api/web/admin/coin-series', { headers: webHeaders, body: '{}' })),
    { status: 503, json: { code: 'COIN_ECONOMY_NOT_CONFIGURED' } });

  const { server } = adminFixture();
  const port = await listen(t, server);
  for (let index = 0; index < 60; index += 1) {
    const rejected = await send(port, 'POST', '/api/web/admin/coin-series', { headers: webHeaders, body: '' });
    assert.deepEqual(result(rejected), { status: 400, json: { code: 'INVALID_JSON_BODY' } });
  }
  const limited = await send(port, 'POST', '/api/web/admin/coin-pools/pool-1/pause', { headers: webHeaders, body: '{}' });
  assert.deepEqual(result(limited), { status: 429, json: { code: 'COIN_WRITE_RATE_LIMITED' } });
  assert.match(String(limited.headers['retry-after']), /^\d+$/);
});

// ---- 마일리지 상점 쓰기 ----

function shopFixture() {
  const calls: Calls = [];
  const mileageShop = {
    reroll: async (input: unknown) => { calls.push({ name: 'reroll', input }); return { replayed: false, granted: true }; },
    setAvatar: async (input: unknown) => { calls.push({ name: 'setAvatar', input }); return { avatar: 'a1' }; },
    setClothing: async (input: unknown) => { calls.push({ name: 'setClothing', input }); return { equippedClothing: 'c1' }; },
  };
  const server = createApiServer(...positionalArgs(developmentHeaderAccountResolver, { mileageShop }) as Parameters<typeof createApiServer>);
  return { server, calls, mileageShop };
}

const shopHeaders = { 'x-account-id': 'acct', 'content-type': 'application/json' };

test('POST /shop/rerolls: 허용 키·등급·requestId(128자)·expectedRemaining(0 이상 정수)를 검사하고 새로 만든 건 201, 재전송은 200', async (t) => {
  const { server, calls, mileageShop } = shopFixture();
  const port = await listen(t, server);
  const valid = { grade: 'SILVER', requestId: 'req-1', expectedRemaining: 3 };
  assert.deepEqual(result(await send(port, 'POST', '/shop/rerolls', { headers: shopHeaders, body: body(valid) })),
    { status: 201, json: { replayed: false, granted: true } });
  assert.deepEqual(calls, [{ name: 'reroll', input: { accountId: 'acct', ...valid } }]);
  assert.equal((await send(port, 'POST', '/shop/rerolls', { headers: shopHeaders, body: body({ ...valid, expectedRemaining: 0 }) })).status, 201);
  assert.equal((await send(port, 'POST', '/shop/rerolls', { headers: shopHeaders, body: body({ ...valid, requestId: 'r'.repeat(128) }) })).status, 201);
  calls.length = 0;

  for (const invalid of [
    { ...valid, accountId: 'other' }, { ...valid, grade: 'PLATINUM' }, { ...valid, grade: 'silver' }, { ...valid, grade: 1 },
    { ...valid, requestId: 'r'.repeat(129) }, { ...valid, requestId: '   ' }, { ...valid, requestId: 5 },
    { ...valid, expectedRemaining: -1 }, { ...valid, expectedRemaining: 1.5 }, { ...valid, expectedRemaining: '3' },
    { grade: 'SILVER', requestId: 'req-1' }, { requestId: 'req-1', expectedRemaining: 3 },
  ]) {
    const response = await send(port, 'POST', '/shop/rerolls', { headers: shopHeaders, body: body(invalid) });
    assert.deepEqual(result(response), { status: 400, json: { code: 'INVALID_REQUEST' } }, body(invalid));
  }
  assert.deepEqual(calls, []);

  Object.assign(mileageShop, { reroll: async () => ({ replayed: true }) });
  assert.equal((await send(port, 'POST', '/shop/rerolls', { headers: shopHeaders, body: body(valid) })).status, 200);
  Object.assign(mileageShop, { reroll: async () => { throw new MileageShopError('SHOP_REQUEST_CONFLICT'); } });
  assert.deepEqual(result(await send(port, 'POST', '/shop/rerolls', { headers: shopHeaders, body: body(valid) })),
    { status: 409, json: { code: 'SHOP_REQUEST_CONFLICT' } });
  assert.deepEqual(result(await send(port, 'POST', '/shop/rerolls', { headers: { 'content-type': 'application/json' }, body: body(valid) })),
    { status: 401, json: { code: 'ACCOUNT_REQUIRED' } });
});

for (const [path, method, field] of [['/shop/avatar', 'setAvatar', 'avatar'], ['/shop/clothing', 'setClothing', 'equippedClothing']] as const) {
  test(`PUT ${path}: itemId 하나만 받고(문자열 또는 null) 계정은 인증된 계정으로 고정`, async (t) => {
    const { server, calls, mileageShop } = shopFixture();
    const port = await listen(t, server);
    const set = await send(port, 'PUT', path, { headers: shopHeaders, body: body({ itemId: 'item-1' }) });
    assert.equal(set.status, 200);
    assert.deepEqual(Object.keys(set.json as object), [field]);
    assert.equal(set.status, 200);
    assert.deepEqual(calls.at(-1), { name: method, input: { accountId: 'acct', itemId: 'item-1' } });
    await send(port, 'PUT', path, { headers: shopHeaders, body: body({ itemId: null }) });
    assert.deepEqual(calls.at(-1), { name: method, input: { accountId: 'acct', itemId: null } });
    const before = calls.length;
    for (const invalid of [{}, { itemId: 5 }, { itemId: ['a'] }, { itemId: {} }, { itemId: 'a', accountId: 'other' }, { itemId: true }]) {
      const response = await send(port, 'PUT', path, { headers: shopHeaders, body: body(invalid) });
      assert.deepEqual(result(response), { status: 400, json: { code: 'INVALID_REQUEST' } }, body(invalid));
    }
    assert.equal(calls.length, before);
    Object.assign(mileageShop, { [method]: async () => { throw new MileageShopError(path === '/shop/avatar' ? 'SHOP_ITEM_NOT_OWNED' : 'SHOP_CLOTHING_NOT_OWNED'); } });
    assert.equal((await send(port, 'PUT', path, { headers: shopHeaders, body: body({ itemId: 'x' }) })).status, 404);
    assert.deepEqual(result(await send(port, 'POST', path, { headers: shopHeaders, body: body({ itemId: 'x' }) })), { status: 404, json: { code: 'NOT_FOUND' } });
    assert.equal((await send(port, 'PUT', path, { headers: { 'content-type': 'application/json' }, body: body({ itemId: 'x' }) })).status, 401);
  });
}

// ---- 알려진 경로에서 메서드가 틀리면 405, 모르는 경로는 404 ----

function methodFixture() {
  const consent: ConsentService = {
    appSource: 'ANDROID',
    status: async () => ({ required: false, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION }),
    record: async () => { throw new Error('implicit consent'); },
  };
  const unused = async () => { throw new Error('service must not be called'); };
  const deletionIntake = { status: unused, current: unused, cancel: unused, request: unused };
  const experienceServices = {
    furniture: { get: unused, purchase: unused }, gradeDraw: { getShop: unused, draw: unused },
    coinEconomy: { getShop: unused, getCollection: unused }, roomCommunity: { getSettings: unused, visitors: unused },
  };
  return createApiServer(...positionalArgs(developmentHeaderAccountResolver,
    { consent, showcaseDeletionIntake: deletionIntake, experienceServices }) as Parameters<typeof createApiServer>);
}

test('알려진 경로에 메서드가 틀리면 405 METHOD_NOT_ALLOWED, 아예 모르는 경로는 404 NOT_FOUND', async (t) => {
  const port = await listen(t, methodFixture());
  const headers = { 'x-account-id': 'acct', 'content-type': 'application/json' };
  const rows: [string, string, number, string][] = [
    ['PUT', '/me/furniture', 405, 'METHOD_NOT_ALLOWED'], ['POST', '/me/furniture', 405, 'METHOD_NOT_ALLOWED'],
    ['GET', '/me/furniture/purchases', 405, 'METHOD_NOT_ALLOWED'],
    ['PUT', '/shop/draw-pools', 405, 'METHOD_NOT_ALLOWED'], ['POST', '/shop/draw-pools', 405, 'METHOD_NOT_ALLOWED'],
    ['GET', '/shop/draws', 405, 'METHOD_NOT_ALLOWED'],
    ['POST', '/coin-shop', 405, 'METHOD_NOT_ALLOWED'], ['POST', '/me/coins', 405, 'METHOD_NOT_ALLOWED'],
    ['PUT', '/coin-shop', 405, 'METHOD_NOT_ALLOWED'], ['GET', '/coin-tickets/t1/use', 405, 'METHOD_NOT_ALLOWED'],
    ['GET', '/coin-series/s1/claim', 405, 'METHOD_NOT_ALLOWED'], ['DELETE', '/coin-shop/purchases', 405, 'METHOD_NOT_ALLOWED'],
    ['PATCH', '/me/room-visitors', 405, 'METHOD_NOT_ALLOWED'], ['POST', '/me/room-visitors', 405, 'METHOD_NOT_ALLOWED'],
    ['DELETE', '/me/room-publication', 405, 'METHOD_NOT_ALLOWED'],
    ['PUT', '/account-deletion-intake', 405, 'METHOD_NOT_ALLOWED'], ['GET', '/account-deletion-status', 405, 'METHOD_NOT_ALLOWED'],
    ['DELETE', '/account-deletion-intake/cancel', 405, 'METHOD_NOT_ALLOWED'], ['GET', '/account-deletion-intake/cancel', 405, 'METHOD_NOT_ALLOWED'],
    ['GET', '/coin-tickets/t1', 404, 'NOT_FOUND'], ['GET', '/rooms', 404, 'NOT_FOUND'], ['POST', '/account-deletion-intake/other', 404, 'NOT_FOUND'],
  ];
  const mismatches: unknown[] = [];
  for (const [method, url, status, code] of rows) {
    const response = await send(port, method, url, { headers, body: '{}' });
    const actual = { status: response.status, code: (response.json as { code?: string } | undefined)?.code };
    try { assert.deepEqual(actual, { status, code }); } catch { mismatches.push({ request: `${method} ${url}`, actual, expected: { status, code } }); }
  }
  assert.deepEqual(mismatches, []);
});
