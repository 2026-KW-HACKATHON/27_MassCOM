import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const html = readFileSync(resolve(import.meta.dirname, '../../docs/account-deletion.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'account deletion page must include its request flow');

async function submit(fetcher) {
  const button = { disabled: false };
  const status = { textContent: '' };
  let handler;
  const form = {
    addEventListener: (_name, callback) => { handler = callback; },
    querySelector: () => button,
  };
  runInNewContext(script, {
    document: { getElementById: (id) => id === 'deletion-request' ? form : status },
    fetch: fetcher,
  });
  await handler({ preventDefault() {} });
  return { status: status.textContent, button };
}

test('page posts an empty JSON request and reports receipt without claiming deletion', async () => {
  let called = false;
  const result = await submit(async (path, options) => {
    called = true;
    assert.equal(path, '/api/web/account-deletion-intake');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{}');
    assert.equal(options.credentials, 'same-origin');
    return { status: 202, json: async () => ({ status: 'REQUESTED' }) };
  });
  assert.equal(called, true);
  assert.match(result.status, /접수되어 있습니다/);
  assert.match(result.status, /실제 계정 삭제는 아직/);
  assert.equal(result.button.disabled, false);
});

test('page directs an unauthenticated visitor to Google login', async () => {
  const result = await submit(async () => ({ status: 401 }));
  assert.match(result.status, /Google 계정으로 로그인/);
});

test('page reports service and network errors as unconfirmed requests', async () => {
  const unavailable = await submit(async () => ({ status: 503 }));
  const network = await submit(async () => { throw new Error('offline'); });
  assert.match(unavailable.status, /접수할 수 없습니다/);
  assert.match(network.status, /연결을 확인할 수 없습니다/);
  assert.equal(unavailable.button.disabled, false);
  assert.equal(network.button.disabled, false);
});
