import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AiArtGenerationError,
  OpenAiImageClient,
  type AiArtClientLog,
} from './ai-art-client.js';
import { costMicroUsd } from './ai-art-rules.js';
import {
  errorResponse,
  fakeDraftCostMicroUsd,
  fakeFinalCostMicroUsd,
  fakeOpenAiFetch,
  fakeWebp,
  hangingFetch,
  imageResponse,
  type FakeOpenAiHandler,
} from './ai-art-test-support.js';

const apiKey = 'test-only-openai-key';
const userHash = 'a'.repeat(64);

function makeClient(handler?: FakeOpenAiHandler, extra: { timeoutMs?: number; fetch?: typeof fetch } = {}) {
  const fake = fakeOpenAiFetch(handler);
  const sleeps: number[] = [];
  const logs: Parameters<AiArtClientLog>[0][] = [];
  const client = new OpenAiImageClient({
    apiKey, baseUrl: 'http://127.0.0.1:9', draftModel: 'draft-model', finalModel: 'final-model',
    fetch: extra.fetch ?? fake.fetch,
    ...(extra.timeoutMs !== undefined ? { timeoutMs: extra.timeoutMs } : {}),
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0,
    log: (event) => logs.push(event),
  });
  return { client, fake, sleeps, logs };
}

const failure = (code: string, chargeable: boolean) => (error: unknown) =>
  error instanceof AiArtGenerationError && error.failureCode === code && error.chargeable === chargeable;

test('draft request is a JSON generations call with the documented fields and the key only in the header', async () => {
  const { client, fake, logs } = makeClient((call) => call.path === '/v1/images/generations'
    ? imageResponse(fakeWebp('one'), null, { 'x-request-id': 'req_abc123' }) : undefined);
  const result = await client.generateDraft({ prompt: 'PROMPT-TEXT', userHash });

  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0]!;
  assert.equal(call.path, '/v1/images/generations');
  assert.equal(call.headers.get('authorization'), `Bearer ${apiKey}`);
  assert.equal(call.headers.get('content-type'), 'application/json');
  assert.equal(call.redirect, 'error');
  assert.deepEqual(call.json, {
    model: 'draft-model', prompt: 'PROMPT-TEXT', n: 1, size: '1024x1024', quality: 'low',
    output_format: 'webp', output_compression: 70, user: userHash,
  });
  assert.deepEqual(result.image, fakeWebp('one'));
  assert.equal(result.usage, null);

  // 로그에는 상태·요청 ID만 있고 키·프롬프트·이미지가 없다.
  assert.deepEqual(logs, [{ event: 'ai_art.openai', kind: 'draft', attempt: 1, outcome: 'ok', status: 200, requestId: 'req_abc123' }]);
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes(apiKey), false);
  assert.equal(serialized.includes('PROMPT-TEXT'), false);
});

test('usage from the response turns into the cost the budget records', async () => {
  const { client } = makeClient();
  const draft = await client.generateDraft({ prompt: 'p', userHash });
  assert.equal(costMicroUsd(draft.usage!), fakeDraftCostMicroUsd);
  const final = await client.editFinal({ prompt: 'p', image: fakeWebp('src'), userHash });
  assert.equal(costMicroUsd(final.usage!), fakeFinalCostMicroUsd);
});

test('final request is a multipart edits call with image[] and without input_fidelity or a manual content type', async () => {
  const source = fakeWebp('chosen-draft');
  const { client, fake } = makeClient();
  const result = await client.editFinal({ prompt: 'FINAL-PROMPT', image: source, userHash });

  const call = fake.calls[0]!;
  assert.equal(call.path, '/v1/images/edits');
  assert.equal(call.headers.get('authorization'), `Bearer ${apiKey}`);
  assert.equal(call.headers.has('content-type'), false);
  assert.ok(call.form instanceof FormData);
  const fields = Object.fromEntries([...call.form.entries()].filter(([, value]) => typeof value === 'string'));
  assert.deepEqual(fields, {
    model: 'final-model', prompt: 'FINAL-PROMPT', quality: 'high', size: '1024x1024',
    output_format: 'webp', output_compression: '85', user: userHash,
  });
  assert.equal(call.form.has('input_fidelity'), false);
  const file = call.form.get('image[]');
  assert.ok(file instanceof File);
  assert.equal(file.type, 'image/webp');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), source);
  assert.ok(result.image.length > 0);
});

test('moderation_blocked is not retried and not chargeable', async () => {
  const { client, fake, sleeps } = makeClient(() => errorResponse(400, 'moderation_blocked'));
  await assert.rejects(client.generateDraft({ prompt: 'p', userHash }), failure('AI_ART_MODERATION_BLOCKED', false));
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('a plain 429 is retried once after Retry-After (capped at 10 seconds) and then succeeds', async () => {
  const { client, fake, sleeps } = makeClient((_call, index) =>
    index === 0 ? errorResponse(429, 'rate_limit_exceeded', { 'retry-after': '3' }) : undefined);
  const result = await client.generateDraft({ prompt: 'p', userHash });
  assert.ok(result.image.length > 0);
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(sleeps, [3000]);

  const capped = makeClient((_call, index) =>
    index === 0 ? errorResponse(429, 'rate_limit_exceeded', { 'retry-after': '120' }) : undefined);
  await capped.client.generateDraft({ prompt: 'p', userHash });
  assert.deepEqual(capped.sleeps, [10_000]);
});

test('a 5xx or 429 that persists fails after exactly one retry with a jittered wait', async () => {
  for (const status of [500, 503, 429]) {
    const { client, fake, sleeps } = makeClient(() => errorResponse(status, null));
    await assert.rejects(client.generateDraft({ prompt: 'p', userHash }), failure('AI_ART_UPSTREAM_UNAVAILABLE', false));
    assert.equal(fake.calls.length, 2, `status ${status}`);
    assert.deepEqual(sleeps, [500], `status ${status}`);
  }
});

test('spend, usage and credit exhaustion on a 429 are never retried', async () => {
  for (const code of ['credit_balance_exhausted', 'monthly_spend_limit_exceeded', 'project_usage_limit_exceeded', 'insufficient_quota']) {
    const { client, fake, sleeps } = makeClient(() => errorResponse(429, code));
    await assert.rejects(client.generateDraft({ prompt: 'p', userHash }), failure('AI_ART_UPSTREAM_UNAVAILABLE', false), code);
    assert.equal(fake.calls.length, 1, code);
    assert.deepEqual(sleeps, [], code);
  }
});

test('other 4xx answers fail at once without a retry', async () => {
  for (const status of [400, 401, 403, 404]) {
    const { client, fake } = makeClient(() => errorResponse(status, 'invalid_api_key'));
    await assert.rejects(client.generateDraft({ prompt: 'p', userHash }), failure('AI_ART_UPSTREAM_UNAVAILABLE', false));
    assert.equal(fake.calls.length, 1, `status ${status}`);
  }
});

test('the per-request timeout goes through AbortSignal and maps to AI_ART_TIMEOUT without a retry', async () => {
  let attempts = 0;
  const counting = ((input: string | URL | Request, init?: RequestInit) => {
    attempts += 1;
    return hangingFetch(input, init);
  }) as typeof fetch;
  const { client, sleeps } = makeClient(undefined, { timeoutMs: 20, fetch: counting });
  await assert.rejects(client.generateDraft({ prompt: 'p', userHash }), failure('AI_ART_TIMEOUT', true));
  assert.equal(attempts, 1);
  assert.deepEqual(sleeps, []);
});

test('a network failure is retried once and then reported as unavailable', async () => {
  let attempts = 0;
  const flaky = (async () => {
    attempts += 1;
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const { client, sleeps } = makeClient(undefined, { fetch: flaky });
  await assert.rejects(client.generateDraft({ prompt: 'p', userHash }), failure('AI_ART_UPSTREAM_UNAVAILABLE', true));
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [500]);

  let calls = 0;
  const recovers = (async (...args: Parameters<typeof fetch>) => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return fakeOpenAiFetch().fetch(...args);
  }) as typeof fetch;
  const ok = makeClient(undefined, { fetch: recovers });
  assert.ok((await ok.client.generateDraft({ prompt: 'p', userHash })).image.length > 0);
});

test('a success body that is not a webp image is rejected as unavailable', async () => {
  for (const body of [
    JSON.stringify({ data: [] }),
    JSON.stringify({ data: [{ b64_json: Buffer.from('not an image at all, just text').toString('base64') }] }),
    JSON.stringify({ data: [{ b64_json: '' }] }),
    'not json',
  ]) {
    const { client } = makeClient(() => new Response(body, { status: 200 }));
    await assert.rejects(client.generateDraft({ prompt: 'p', userHash }), failure('AI_ART_UPSTREAM_UNAVAILABLE', true), body.slice(0, 30));
  }
});
