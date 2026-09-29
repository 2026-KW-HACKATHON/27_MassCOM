import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AccountDeletionIntakeApiClient, AccountDeletionIntakeApiError, isAmbiguousIntakeFailure, recheckIntake,
} from './account-deletion-intake-api';

const dates = {
  requestedAt: '2026-10-01T00:00:00.000Z', cancelUntil: '2026-10-02T00:00:00.000Z', dueAt: '2026-10-08T00:00:00.000Z',
};
const bearer = { kind: 'bearer', sessionToken: 'showcase-session' } as const;

function client(respond: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = new AccountDeletionIntakeApiClient({
    apiUrl: 'https://demo-api.example.test',
    credential: bearer,
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return respond(String(input), init ?? {});
    },
  });
  return { api, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

test('filing posts an empty body with the bearer session and returns the receipt once', async () => {
  const { api, calls } = client(() => json(202, { receipt: '7K2M-Q9XD-4HTB-0RWE', receiptIssued: true, status: 'REQUESTED', ...dates }));
  const filed = await api.request();
  assert.equal(calls[0]!.url, 'https://demo-api.example.test/account-deletion-intake');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.equal(calls[0]!.init.body, '{}');
  const headers = new Headers(calls[0]!.init.headers);
  assert.equal(headers.get('authorization'), 'Bearer showcase-session');
  assert.equal(headers.has('x-account-id'), false);
  assert.equal(filed.receipt, '7K2M-Q9XD-4HTB-0RWE');
  assert.equal(filed.receiptIssued, true);
  assert.equal(filed.cancelUntil, dates.cancelUntil);
});

test('a re-issue sends only the explicit flag and a repeat filing carries no receipt', async () => {
  const { api, calls } = client(() => json(202, { receiptIssued: false, status: 'REQUESTED', ...dates }));
  const repeat = await api.request({ reissue: true });
  assert.equal(calls[0]!.init.body, '{"reissue":true}');
  assert.equal(repeat.receiptIssued, false);
  assert.equal('receipt' in repeat, false);
});

test('inconsistent or malformed filing responses are refused instead of shown as accepted', async () => {
  for (const body of [
    { receiptIssued: true, status: 'REQUESTED', ...dates },
    { receipt: '  ', receiptIssued: true, status: 'REQUESTED', ...dates },
    { receipt: 'AAAA-AAAA-AAAA-AAAA', receiptIssued: false, status: 'REQUESTED', ...dates },
    { receiptIssued: false, status: 'DELETED', ...dates },
    { receiptIssued: false, status: 'REQUESTED', requestedAt: 1, cancelUntil: dates.cancelUntil, dueAt: dates.dueAt },
    [],
  ]) {
    const { api } = client(() => json(202, body));
    await assert.rejects(api.request(), /INVALID_DELETION_INTAKE_RESPONSE/, JSON.stringify(body));
  }
});

test('server refusals surface their fixed code and status', async () => {
  const { api } = client(() => json(409, { code: 'DELETION_CANCEL_WINDOW_CLOSED' }));
  await assert.rejects(api.cancel(), (error: unknown) =>
    error instanceof AccountDeletionIntakeApiError && error.status === 409 && error.code === 'DELETION_CANCEL_WINDOW_CLOSED');
  const unknown = client(() => json(500, {}));
  await assert.rejects(unknown.api.request(), (error: unknown) =>
    error instanceof AccountDeletionIntakeApiError && error.code === 'HTTP_500');
});

test('the current request is read with GET, an absent request is undefined and a view is validated', async () => {
  const none = client(() => json(200, { request: null }));
  assert.equal(await none.api.current(), undefined);
  assert.equal(none.calls[0]!.init.method, 'GET');
  assert.equal(none.calls[0]!.init.body, undefined);
  const view = { status: 'REQUESTED', ...dates, cancelledAt: null, processedAt: null, rejectReason: null, deletion: null };
  const some = client(() => json(200, { request: view }));
  assert.deepEqual(await some.api.current(), view);
  for (const bad of [{ ...view, status: 'GONE' }, { ...view, deletion: { status: 'X' } }, { ...view, cancelledAt: 3 }]) {
    await assert.rejects(client(() => json(200, { request: bad })).api.current(), /INVALID_DELETION_INTAKE_RESPONSE/);
  }
  await assert.rejects(client(() => json(200, {})).api.current(), /INVALID_DELETION_INTAKE_RESPONSE/);
});

test('cancel needs the server to confirm CANCELLED', async () => {
  const ok = client(() => json(200, { status: 'CANCELLED' }));
  await ok.api.cancel();
  assert.equal(ok.calls[0]!.url, 'https://demo-api.example.test/account-deletion-intake/cancel');
  assert.equal(ok.calls[0]!.init.method, 'POST');
  await assert.rejects(client(() => json(200, { status: 'REQUESTED' })).api.cancel(), /INVALID_DELETION_INTAKE_RESPONSE/);
});

const receiptView = {
  status: 'REJECTED', ...dates, cancelledAt: null, processedAt: '2026-10-03T00:00:00.000Z', rejectReason: '본인 확인 불가', deletion: null,
};

test('a receipt lookup posts only the receipt with the bearer session and returns the validated view', async () => {
  const { api, calls } = client(() => json(200, receiptView));
  const view = await api.status('7K2M-Q9XD-4HTB-0RWE');
  assert.equal(calls[0]!.url, 'https://demo-api.example.test/account-deletion-status');
  assert.equal(calls[0]!.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { receipt: '7K2M-Q9XD-4HTB-0RWE' });
  assert.equal(new Headers(calls[0]!.init.headers).get('authorization'), 'Bearer showcase-session');
  assert.equal(view.status, 'REJECTED');
  assert.equal(view.rejectReason, '본인 확인 불가');
  assert.equal('account' in view || 'accountId' in view, false);
  await assert.rejects(client(() => json(200, { ...receiptView, status: 'GONE' })).api.status('x'), /INVALID_DELETION_INTAKE_RESPONSE/);
  await assert.rejects(client(() => json(404, { code: 'DELETION_RECEIPT_NOT_FOUND' })).api.status('x'), (error: unknown) =>
    error instanceof AccountDeletionIntakeApiError && error.status === 404 && error.code === 'DELETION_RECEIPT_NOT_FOUND');
  await assert.rejects(client(() => json(429, { code: 'DELETION_STATUS_RATE_LIMITED' })).api.status('x'), (error: unknown) =>
    error instanceof AccountDeletionIntakeApiError && error.status === 429);
});

test('a non-JSON error body keeps its HTTP status as the code and a non-JSON success is refused', async () => {
  for (const status of [502, 503, 404]) {
    const html = client(() => new Response('<html>Bad gateway</html>', { status }));
    await assert.rejects(html.api.request(), (error: unknown) =>
      error instanceof AccountDeletionIntakeApiError && error.status === status && error.code === `HTTP_${status}`, String(status));
  }
  await assert.rejects(client(() => new Response('', { status: 500 })).api.cancel(), (error: unknown) =>
    error instanceof AccountDeletionIntakeApiError && error.code === 'HTTP_500');
  await assert.rejects(client(() => new Response('<html>ok</html>', { status: 200 })).api.current(), /INVALID_DELETION_INTAKE_RESPONSE/);
  await assert.rejects(client(() => new Response('', { status: 202 })).api.request(), /INVALID_DELETION_INTAKE_RESPONSE/);
});

test('only a failure with no server answer is ambiguous, and a recheck trusts only a request that is really there', async () => {
  for (const ambiguous of [new TypeError('Network request failed'), new Error('INVALID_DELETION_INTAKE_RESPONSE'),
    new AccountDeletionIntakeApiError(500, 'HTTP_500'), new AccountDeletionIntakeApiError(502, 'HTTP_502')]) {
    assert.equal(isAmbiguousIntakeFailure(ambiguous), true, String(ambiguous));
  }
  for (const answered of [new AccountDeletionIntakeApiError(409, 'DELETION_CANCEL_WINDOW_CLOSED'),
    new AccountDeletionIntakeApiError(404, 'DELETION_NO_ACTIVE_REQUEST'), new AccountDeletionIntakeApiError(401, 'WEB_SESSION_INVALID')]) {
    assert.equal(isAmbiguousIntakeFailure(answered), false, String(answered));
  }
  const view = { status: 'REQUESTED' as const, ...dates, cancelledAt: null, processedAt: null, rejectReason: null, deletion: null };
  assert.deepEqual(await recheckIntake({ current: async () => view }), { kind: 'found', view });
  assert.deepEqual(await recheckIntake({ current: async () => undefined }), { kind: 'unknown' });
  assert.deepEqual(await recheckIntake({ current: async () => { throw new TypeError('offline'); } }), { kind: 'unknown' });
});
