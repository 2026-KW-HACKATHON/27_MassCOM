import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ExpoPushGateway } from './expo-push-gateway.js';
import type { PushMessage } from './social.js';

const message = (to = 'ExpoPushToken[token]'): PushMessage => ({
  to,
  title: '새 우편이 도착했어요',
  body: '친구 소식이 있어요',
  data: { mailId: 'mail-1', type: 'MESSAGE' },
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

test('send posts Expo messages to the fixed endpoint with optional bearer auth only in headers', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const gateway = new ExpoPushGateway({
    bearerCredential: 'secret-access-token',
    fetchFn: (async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return jsonResponse({ data: [{ status: 'ok', id: 'ticket-1' }] });
    }) as typeof fetch,
  });

  assert.deepEqual(await gateway.send([message()]), [{ status: 'ok', id: 'ticket-1' }]);
  assert.equal(calls[0]!.url, 'https://exp.host/--/api/v2/push/send');
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, 'Bearer secret-access-token');
  assert.equal(JSON.stringify(calls[0]!.init.body).includes('secret-access-token'), false);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), [message()]);
});

test('send chunks batches and rejects response cardinality mismatches without throwing', async () => {
  const batchSizes: number[] = [];
  const gateway = new ExpoPushGateway({
    fetchFn: (async (_url, init) => {
      const body = JSON.parse(String(init!.body)) as PushMessage[];
      batchSizes.push(body.length);
      return jsonResponse({ data: body.length === 100 ? body.map((_, index) => ({ status: 'ok', id: `ticket-${index}` })) : [] });
    }) as typeof fetch,
  });

  const tickets = await gateway.send(Array.from({ length: 101 }, (_, index) => message(`ExpoPushToken[${index}]`)));
  assert.deepEqual(batchSizes, [100, 1]);
  assert.equal(tickets.slice(0, 100).every((ticket) => ticket.status === 'ok'), true);
  assert.deepEqual(tickets[100], { status: 'error', code: 'EXPO_TICKET_SHAPE', retryable: false });
});

test('send maps HTTP 429 and 5xx to retryable tickets and 4xx to fatal tickets', async () => {
  for (const [status, retryable] of [[429, true], [500, true], [503, true], [400, false], [401, false]] as const) {
    const gateway = new ExpoPushGateway({
      fetchFn: (async () => new Response('{}', { status })) as typeof fetch,
    });
    assert.deepEqual(await gateway.send([message(), message('ExpoPushToken[2]')]), [
      { status: 'error', code: `EXPO_HTTP_${status}`, retryable },
      { status: 'error', code: `EXPO_HTTP_${status}`, retryable },
    ]);
  }
});

test('send maps ticket error details without exposing message content', async () => {
  const gateway = new ExpoPushGateway({
    fetchFn: (async () => jsonResponse({
      data: [
        { status: 'error', message: 'token is gone', details: { error: 'DeviceNotRegistered' } },
        { status: 'error', message: 'slow down', details: { error: 'MessageRateExceeded' } },
      ],
    })) as typeof fetch,
  });
  assert.deepEqual(await gateway.send([message(), message('ExpoPushToken[2]')]), [
    { status: 'error', code: 'DeviceNotRegistered', retryable: false },
    { status: 'error', code: 'MessageRateExceeded', retryable: true },
  ]);
});

test('send treats malformed successful responses as ticket shape errors', async () => {
  const invalidJsonGateway = new ExpoPushGateway({
    fetchFn: (async () => new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
  });
  assert.deepEqual(await invalidJsonGateway.send([message()]), [
    { status: 'error', code: 'EXPO_TICKET_SHAPE', retryable: false },
  ]);

  const wrongShapeGateway = new ExpoPushGateway({
    fetchFn: (async () => jsonResponse({ data: { status: 'ok', id: 'ticket-1' } })) as typeof fetch,
  });
  assert.deepEqual(await wrongShapeGateway.send([message()]), [
    { status: 'error', code: 'EXPO_TICKET_SHAPE', retryable: false },
  ]);
});

test('send converts timeout and network failures into retryable tickets', async () => {
  const timeoutGateway = new ExpoPushGateway({
    timeoutMs: 1,
    fetchFn: ((async (_url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown) as typeof fetch,
  });
  assert.deepEqual(await timeoutGateway.send([message()]), [
    { status: 'error', code: 'EXPO_TIMEOUT', retryable: true },
  ]);

  const networkGateway = new ExpoPushGateway({
    fetchFn: (async () => {
      throw new Error('connection reset');
    }) as typeof fetch,
  });
  assert.deepEqual(await networkGateway.send([message()]), [
    { status: 'error', code: 'EXPO_NETWORK', retryable: true },
  ]);
});

test('getReceipts posts ids and leaves missing receipt ids absent from the result map', async () => {
  const gateway = new ExpoPushGateway({
    fetchFn: (async (url, init) => {
      assert.equal(String(url), 'https://exp.host/--/api/v2/push/getReceipts');
      assert.deepEqual(JSON.parse(String(init!.body)), { ids: ['ticket-1', 'ticket-2', 'ticket-3'] });
      return jsonResponse({
        data: {
          'ticket-1': { status: 'ok' },
          'ticket-3': { status: 'error', details: { error: 'DeviceNotRegistered' } },
        },
      });
    }) as typeof fetch,
  });
  const receipts = await gateway.getReceipts(['ticket-1', 'ticket-2', 'ticket-3']);
  assert.deepEqual(receipts.get('ticket-1'), { status: 'ok' });
  assert.equal(receipts.has('ticket-2'), false);
  assert.deepEqual(receipts.get('ticket-3'), {
    status: 'error',
    code: 'DeviceNotRegistered',
    retryable: false,
    deadToken: true,
  });
});

test('getReceipts treats malformed successful responses as receipt shape errors', async () => {
  const invalidJsonGateway = new ExpoPushGateway({
    fetchFn: (async () => new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
  });
  assert.deepEqual([...await invalidJsonGateway.getReceipts(['ticket-1'])], [
    ['ticket-1', { status: 'error', code: 'EXPO_RECEIPT_SHAPE', retryable: false }],
  ]);

  const wrongEnvelopeGateway = new ExpoPushGateway({
    fetchFn: (async () => jsonResponse({ data: [] })) as typeof fetch,
  });
  assert.deepEqual([...await wrongEnvelopeGateway.getReceipts(['ticket-1', 'ticket-2'])], [
    ['ticket-1', { status: 'error', code: 'EXPO_RECEIPT_SHAPE', retryable: false }],
    ['ticket-2', { status: 'error', code: 'EXPO_RECEIPT_SHAPE', retryable: false }],
  ]);

  const wrongEntryGateway = new ExpoPushGateway({
    fetchFn: (async () => jsonResponse({ data: { 'ticket-1': {}, 'ticket-2': { status: 'ok' } } })) as typeof fetch,
  });
  assert.deepEqual([...await wrongEntryGateway.getReceipts(['ticket-1', 'ticket-2', 'ticket-3'])], [
    ['ticket-1', { status: 'error', code: 'EXPO_RECEIPT_SHAPE', retryable: false }],
    ['ticket-2', { status: 'ok' }],
  ]);
});

test('getReceipts maps HTTP retryability for every requested id', async () => {
  const retryGateway = new ExpoPushGateway({
    fetchFn: (async () => new Response('{}', { status: 503 })) as typeof fetch,
  });
  assert.deepEqual([...await retryGateway.getReceipts(['ticket-1', 'ticket-2'])], [
    ['ticket-1', { status: 'error', code: 'EXPO_HTTP_503', retryable: true }],
    ['ticket-2', { status: 'error', code: 'EXPO_HTTP_503', retryable: true }],
  ]);

  const fatalGateway = new ExpoPushGateway({
    fetchFn: (async () => new Response('{}', { status: 403 })) as typeof fetch,
  });
  assert.deepEqual([...await fatalGateway.getReceipts(['ticket-1'])], [
    ['ticket-1', { status: 'error', code: 'EXPO_HTTP_403', retryable: false }],
  ]);
});
