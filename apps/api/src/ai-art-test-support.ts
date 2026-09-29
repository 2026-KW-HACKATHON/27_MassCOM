// AI 가게 그림 시험 도우미: 실제 OpenAI를 부르지 않고 fetch만 바꿔 끼운다. 서비스 코드는 이 파일을 가져오지 않는다.
import { createHash } from 'node:crypto';

function littleEndian(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

// RIFF....WEBP 머리를 갖춘 시험용 바이트. 실제로 그려지는 그림은 아니고, label이 다르면 바이트(그래서 sha256)도 다르다.
export function fakeWebp(label: string): Buffer {
  const payload = Buffer.from(`fake-webp:${label}`);
  const padded = payload.length % 2 === 1 ? Buffer.concat([payload, Buffer.alloc(1)]) : payload;
  const chunk = Buffer.concat([Buffer.from('VP8L'), littleEndian(payload.length), padded]);
  return Buffer.concat([Buffer.from('RIFF'), littleEndian(4 + chunk.length), Buffer.from('WEBP'), chunk]);
}

export const fakeDraftUsage = {
  input_tokens: 120, input_tokens_details: { image_tokens: 0, text_tokens: 120 }, output_tokens: 272,
};
export const fakeFinalUsage = {
  input_tokens: 1400, input_tokens_details: { image_tokens: 1300, text_tokens: 100 }, output_tokens: 3000,
};
// 위 usage를 기본 요율(5·8·30)로 계산한 마이크로 USD.
export const fakeDraftCostMicroUsd = 120 * 5 + 272 * 30;
export const fakeFinalCostMicroUsd = 100 * 5 + 1300 * 8 + 3000 * 30;

export type FakeOpenAiCall = {
  path: '/v1/images/generations' | '/v1/images/edits';
  headers: Headers;
  json?: Record<string, unknown>;
  form?: FormData;
  signal: AbortSignal | undefined;
  redirect: RequestRedirect | undefined;
};

export type FakeOpenAiHandler = (call: FakeOpenAiCall, index: number) => Response | Promise<Response> | undefined;

export function imageResponse(
  image: Buffer, usage: object | null = fakeDraftUsage, headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ created: 1, data: [{ b64_json: image.toString('base64') }], ...(usage ? { usage } : {}) }),
    { status: 200, headers: { 'content-type': 'application/json', ...headers } },
  );
}

export function errorResponse(
  status: number, code: string | null, headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ error: { type: 'invalid_request_error', code, message: 'test error message' } }),
    { status, headers: { 'content-type': 'application/json', ...headers } },
  );
}

// handler가 undefined를 돌려주면 기본 성공 응답을 준다. 기본 응답의 그림은 프롬프트·입력 그림·호출 순서로 정해져 항상 다르다.
export function fakeOpenAiFetch(handler?: FakeOpenAiHandler): { fetch: typeof fetch; calls: FakeOpenAiCall[] } {
  const calls: FakeOpenAiCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path !== '/v1/images/generations' && path !== '/v1/images/edits') {
      return new Response('not found', { status: 404 });
    }
    const call: FakeOpenAiCall = {
      path, headers: new Headers(init?.headers), signal: init?.signal ?? undefined, redirect: init?.redirect,
    };
    if (typeof init?.body === 'string') call.json = JSON.parse(init.body) as Record<string, unknown>;
    if (init?.body instanceof FormData) call.form = init.body;
    calls.push(call);
    const custom = await handler?.(call, calls.length - 1);
    if (custom) return custom;
    const seed = createHash('sha256').update(`${calls.length}:${JSON.stringify(call.json ?? [...call.form!.keys()])}`)
      .update(String(call.json?.prompt ?? call.form?.get('prompt') ?? '')).digest('hex');
    return path === '/v1/images/generations'
      ? imageResponse(fakeWebp(`draft:${seed}`), fakeDraftUsage, { 'x-request-id': 'req_fake_draft' })
      : imageResponse(fakeWebp(`final:${seed}`), fakeFinalUsage, { 'x-request-id': 'req_fake_final' });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

// 요청이 끝나지 않고 signal이 중단될 때만 거절하는 fetch. AbortSignal.timeout 경로를 시험한다.
export const hangingFetch = ((_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
  })) as typeof fetch;
