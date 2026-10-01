import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConsentApiClient, ConsentApiError } from './consent-api';

const bearer = { kind: 'bearer', sessionToken: 'app-session' } as const;
const versions = { termsVersion: 'terms-2026-09-30', privacyVersion: 'privacy-2026-10-01' };

function client(respond: (url: string, init: RequestInit) => Response, credential = bearer as never) {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = new ConsentApiClient({
    apiUrl: 'https://api.example.test/',
    credential,
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return respond(String(input), init ?? {});
    },
  });
  return { api, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test('the default fetcher works called as this.fetchImpl(...), not just as a bare function (#309 web)', async () => {
  const originalFetch = globalThis.fetch;
  function brandCheckedFetch(this: unknown) {
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(Response.json({ required: false, ...versions }));
  }
  globalThis.fetch = brandCheckedFetch as typeof fetch;
  try {
    const api = new ConsentApiClient({ apiUrl: 'https://api.example.test', credential: bearer });
    assert.deepEqual(await api.status(), { required: false, ...versions });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('status reads /me/consent with the bearer session only', async () => {
  const { api, calls } = client(() => json(200, { required: true, ...versions }));
  assert.deepEqual(await api.status(), { required: true, ...versions });
  assert.equal(calls[0]!.url, 'https://api.example.test/me/consent');
  assert.equal(calls[0]!.init.method, 'GET');
  assert.equal(calls[0]!.init.body, undefined);
  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get('authorization'), 'Bearer app-session');
  assert.equal(headers.has('content-type'), false);
});

test('record sends exactly the shown versions and the three yes answers, nothing about the account or the route', async () => {
  const { api, calls } = client(() => json(200, { required: false, ...versions }));
  assert.deepEqual(await api.record(), { required: false, ...versions });
  assert.equal(calls[0]!.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    ...versions, ageConfirmed: true, termsAccepted: true, privacyAccepted: true,
  });
  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('authorization'), 'Bearer app-session');
  assert.equal(headers.has('x-account-id'), false);
});

test('server refusals keep their status and code; a body that is not JSON keeps only the status', async () => {
  for (const [status, body, code] of [
    [401, { code: 'SESSION_INVALID' }, 'SESSION_INVALID'],
    [409, { code: 'CONSENT_VERSION_MISMATCH' }, 'CONSENT_VERSION_MISMATCH'],
    [410, { code: 'ACCOUNT_DELETED' }, 'ACCOUNT_DELETED'],
    [404, { code: 'NOT_FOUND' }, 'NOT_FOUND'],
  ] as const) {
    const { api } = client(() => json(status, body));
    await assert.rejects(api.record(), (error) => error instanceof ConsentApiError && error.status === status && error.code === code);
  }
  const { api } = client(() => new Response('<html>bad gateway</html>', { status: 502 }));
  await assert.rejects(api.status(), (error) => error instanceof ConsentApiError && error.status === 502 && error.code === 'HTTP_502');
});

test('malformed answers are refused instead of read as agreed', async () => {
  for (const body of [
    {}, [], null, { required: 'no', ...versions }, { required: false, termsVersion: 1, privacyVersion: 'x' },
    { required: false, termsVersion: ' ', privacyVersion: 'x' }, { required: false, termsVersion: 'x' },
  ]) {
    const { api } = client(() => json(200, body));
    await assert.rejects(api.record(), /INVALID_CONSENT_RESPONSE/, JSON.stringify(body));
  }
  const { api } = client(() => new Response('', { status: 200 }));
  await assert.rejects(api.status(), /INVALID_CONSENT_RESPONSE/);
});

test('a plain http API outside local development is refused', () => {
  assert.throws(() => new ConsentApiClient({ apiUrl: 'http://api.example.test', credential: bearer }), /HTTPS/);
});
