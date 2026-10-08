import assert from 'node:assert/strict';
import { test } from 'node:test';

import { listen, positionalArgs, send, webHeaders } from './http-test-support.js';
import { createApiServer, developmentHeaderAccountResolver } from './server.js';

// 리팩터링 안전망: 요청 본문 읽기(readJson)의 한도와 형식 오류를 고정한다.
// 기본 한도는 64KiB, 점포 수집품 저장은 8MiB, 실제 점포 사진은 5MiB다. 한도를 넘으면 JSON 해석 전에 413이다.

const defaultLimit = 64 * 1024;
const account = { 'x-account-id': 'acct', 'content-type': 'application/json' };

function redeemFixture() {
  const calls: unknown[] = [];
  const claimSlots = { redeem: async (input: unknown) => { calls.push(input); return { redeemed: true }; } };
  const server = createApiServer(...positionalArgs(developmentHeaderAccountResolver, { claimSlots }) as Parameters<typeof createApiServer>);
  return { server, calls };
}

/** 정확히 `bytes` 바이트짜리 {"token":"…"} 본문. */
function tokenBody(bytes: number): string {
  const overhead = Buffer.byteLength('{"token":""}');
  return `{"token":"${'t'.repeat(bytes - overhead)}"}`;
}

test('기본 본문 한도는 64KiB: 정확히 한도면 통과하고 1바이트 넘으면 413 BODY_TOO_LARGE이며 서비스는 불리지 않는다', async (t) => {
  const { server, calls } = redeemFixture();
  const port = await listen(t, server);
  const atLimit = tokenBody(defaultLimit);
  assert.equal(Buffer.byteLength(atLimit), defaultLimit);
  const ok = await send(port, 'POST', '/claim-slots/redeem', { headers: account, body: atLimit });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { redeemed: true });
  assert.equal(calls.length, 1);

  const over = tokenBody(defaultLimit + 1);
  assert.equal(Buffer.byteLength(over), defaultLimit + 1);
  const refused = await send(port, 'POST', '/claim-slots/redeem', { headers: account, body: over });
  assert.equal(refused.status, 413);
  assert.deepEqual(refused.json, { code: 'BODY_TOO_LARGE' });
  assert.equal(calls.length, 1);
});

test('한도 검사는 JSON 해석보다 먼저다: 깨진 JSON이라도 너무 크면 413', async (t) => {
  const { server } = redeemFixture();
  const port = await listen(t, server);
  const result = await send(port, 'POST', '/claim-slots/redeem', { headers: account, body: 'x'.repeat(defaultLimit + 1) });
  assert.equal(result.status, 413);
  assert.deepEqual(result.json, { code: 'BODY_TOO_LARGE' });
});

test('깨진 JSON·객체가 아닌 JSON·빈 본문은 400 INVALID_JSON_BODY이고 서비스는 불리지 않는다', async (t) => {
  const { server, calls } = redeemFixture();
  const port = await listen(t, server);
  for (const body of ['', '{', 'not json', '[]', '[{"token":"a"}]', 'null', '"text"', '123', 'true', '{"token":"a"}x']) {
    const result = await send(port, 'POST', '/claim-slots/redeem', { headers: account, body });
    assert.deepEqual({ status: result.status, json: result.json }, { status: 400, json: { code: 'INVALID_JSON_BODY' } }, JSON.stringify(body));
  }
  const bodyless = await send(port, 'POST', '/claim-slots/redeem', { headers: account });
  assert.deepEqual({ status: bodyless.status, json: bodyless.json }, { status: 400, json: { code: 'INVALID_JSON_BODY' } });
  assert.deepEqual(calls, []);
});

test('유효한 JSON이라도 필수 필드가 문자열이 아니거나 비면 400 INVALID_REQUEST', async (t) => {
  const { server, calls } = redeemFixture();
  const port = await listen(t, server);
  for (const body of ['{}', '{"token":1}', '{"token":""}', '{"token":"   "}', '{"token":null}']) {
    const result = await send(port, 'POST', '/claim-slots/redeem', { headers: account, body });
    assert.deepEqual({ status: result.status, json: result.json }, { status: 400, json: { code: 'INVALID_REQUEST' } }, body);
  }
  assert.deepEqual(calls, []);
});

test('빈 본문을 허용하는 경로는 빈 본문만 {}로 보고, 공백 본문은 여전히 INVALID_JSON_BODY다', async (t) => {
  const friends = { rotateCode: async () => ({ rotated: true }) };
  const port = await listen(t, createApiServer(...positionalArgs(developmentHeaderAccountResolver, { friends }) as Parameters<typeof createApiServer>));
  const empty = await send(port, 'POST', '/me/friend-code/rotate', { headers: account });
  assert.deepEqual({ status: empty.status, json: empty.json }, { status: 200, json: { rotated: true } });
  const blank = await send(port, 'POST', '/me/friend-code/rotate', { headers: account, body: ' ' });
  assert.deepEqual({ status: blank.status, json: blank.json }, { status: 400, json: { code: 'INVALID_JSON_BODY' } });
  const extra = await send(port, 'POST', '/me/friend-code/rotate', { headers: account, body: '{"a":1}' });
  assert.deepEqual({ status: extra.status, json: extra.json }, { status: 400, json: { code: 'INVALID_REQUEST' } });
});

function collectibleFixture() {
  const calls: string[] = [];
  const services = {
    webAuth: { resolveSession: async () => 'owner', resolveSessionWithAge: async () => ({ accountId: 'owner', ageMs: 0 }) },
    staffRegistration: { mine: async () => [{ id: 'm1' }] },
    merchantAccess: { requirePermission: async () => ({ merchantId: 'm1', role: 'OWNER', permissions: [] }) },
    collectibleProjects: {
      create: async () => { calls.push('create'); return { created: true }; },
      publish: async () => { calls.push('publish'); return { published: true }; },
    },
  };
  return { server: createApiServer(...positionalArgs(developmentHeaderAccountResolver, services) as Parameters<typeof createApiServer>), calls };
}

test('점포 수집품 만들기·저장은 8MiB까지 받고 공개 같은 나머지 쓰기는 64KiB로 막는다', async (t) => {
  const { server, calls } = collectibleFixture();
  const port = await listen(t, server);
  const createUrl = '/api/web/merchant/merchants/m1/collectible-projects';
  const wrap = (bytes: number) => {
    const overhead = Buffer.byteLength('{"project":""}');
    return `{"project":"${'p'.repeat(bytes - overhead)}"}`;
  };
  const collectibleLimit = 8 * 1024 * 1024;
  const big = await send(port, 'POST', createUrl, { headers: webHeaders, body: wrap(collectibleLimit) });
  assert.deepEqual({ status: big.status, json: big.json }, { status: 201, json: { created: true } });
  const tooBig = await send(port, 'POST', createUrl, { headers: webHeaders, body: wrap(collectibleLimit + 1) });
  assert.deepEqual({ status: tooBig.status, json: tooBig.json }, { status: 413, json: { code: 'BODY_TOO_LARGE' } });
  assert.deepEqual(calls, ['create']);

  const publishUrl = `${createUrl}/p1/publish`;
  const publishBody = (bytes: number) => {
    const overhead = Buffer.byteLength('{"expectedVersion":1,"campaignId":""}');
    return `{"expectedVersion":1,"campaignId":"${'c'.repeat(bytes - overhead)}"}`;
  };
  const publishOk = await send(port, 'POST', publishUrl, { headers: webHeaders, body: publishBody(defaultLimit) });
  assert.deepEqual({ status: publishOk.status, json: publishOk.json }, { status: 200, json: { published: true } });
  const publishBig = await send(port, 'POST', publishUrl, { headers: webHeaders, body: publishBody(defaultLimit + 1) });
  assert.deepEqual({ status: publishBig.status, json: publishBig.json }, { status: 413, json: { code: 'BODY_TOO_LARGE' } });
  assert.deepEqual(calls, ['create', 'publish']);
});

test('실제 점포 사진 올리기는 5MiB까지 받고 넘으면 413, 같은 길의 다른 요청은 64KiB 한도다', async (t) => {
  t.mock.method(console, 'error', () => {});
  const realWorld = { profile: async () => ({ version: 1 }) };
  const services = {
    webAuth: { resolveSession: async () => 'owner' },
    experienceServices: { realWorld },
  };
  const port = await listen(t, createApiServer(...positionalArgs(developmentHeaderAccountResolver, services) as Parameters<typeof createApiServer>));
  const url = '/api/web/v1/merchant/merchants/m1/photos';
  const limit = 5 * 1024 * 1024;
  const wrap = (bytes: number) => {
    const overhead = Buffer.byteLength('{"expectedVersion":1,"kind":"STORE","caption":null,"rightsConfirmed":true,"mimeType":"image/png","base64":""}');
    return `{"expectedVersion":1,"kind":"STORE","caption":null,"rightsConfirmed":true,"mimeType":"image/png","base64":"${'A'.repeat(bytes - overhead)}"}`;
  };
  // 한도 안의 본문은 413이 아니라 형식 검사까지 간다: base64 길이가 4의 배수가 아니라서 400 PHOTO_INVALID.
  const withinLimit = await send(port, 'POST', url, { headers: webHeaders, body: wrap(4_000_001 + 109) });
  assert.deepEqual({ status: withinLimit.status, json: withinLimit.json }, { status: 400, json: { code: 'PHOTO_INVALID' } });
  // 정확히 한도인 본문도 413이 아니다. (지금은 base64 정규식이 500만 자 근처에서 호출 스택 초과로 던져 500이 된다. 그 500은 고정하지 않는다.)
  const atLimit = await send(port, 'POST', url, { headers: webHeaders, body: wrap(limit) });
  assert.notEqual(atLimit.status, 413);
  const over = await send(port, 'POST', url, { headers: webHeaders, body: wrap(limit + 1) });
  assert.deepEqual({ status: over.status, json: over.json }, { status: 413, json: { code: 'BODY_TOO_LARGE' } });
  const smallLimit = await send(port, 'DELETE', `${url}/ph1`, { headers: webHeaders, body: `{"expectedVersion":1,"pad":"${'x'.repeat(defaultLimit)}"}` });
  assert.deepEqual({ status: smallLimit.status, json: smallLimit.json }, { status: 413, json: { code: 'BODY_TOO_LARGE' } });
});
