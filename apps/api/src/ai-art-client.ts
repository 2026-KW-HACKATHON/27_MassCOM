// OpenAI 이미지 API 클라이언트(Issue #236, D-048). SDK 없이 기본 fetch만 쓰고 시험에서 fetch를 바꿔 끼운다.
// 키·프롬프트·이미지 바이트는 로그에 남기지 않는다. 남기는 것은 상태 코드, 오류 코드, x-request-id뿐이다.
import {
  classifyOpenAiHttpFailure,
  isWebp,
  parseImageUsage,
  type AiArtFailureCode,
  type ImageUsage,
} from './ai-art-rules.js';

export type AiArtImage = { image: Buffer; usage: ImageUsage | null };

export interface AiArtImageClient {
  generateDraft(input: { prompt: string; userHash: string }): Promise<AiArtImage>;
  editFinal(input: { prompt: string; image: Uint8Array; userHash: string }): Promise<AiArtImage>;
}

// chargeable: 요청이 OpenAI에 닿았고 이미지가 만들어졌는지 알 수 없어 비용이 나갔을 수 있는 실패(시간 초과·네트워크 끊김·
// 이상한 성공 응답, 게이트웨이 오류 502·504). 이런 실패는 다시 보내지 않고 예상 비용을 그대로 둔다. 그 밖의 HTTP 오류 응답
// (429·500·503·정책 차단 등)은 이미지가 만들어지지 않았으므로 false다.
export class AiArtGenerationError extends Error {
  constructor(readonly failureCode: AiArtFailureCode, readonly chargeable: boolean) {
    super(failureCode);
    this.name = 'AiArtGenerationError';
  }
}

export type AiArtClientLog = (event: {
  event: 'ai_art.openai';
  kind: 'draft' | 'final';
  attempt: number;
  outcome: 'ok' | 'http_error' | 'network_error' | 'timeout' | 'invalid_response';
  status?: number;
  errorCode?: string;
  requestId?: string;
}) => void;

export type AiArtClientOptions = {
  apiKey: string;
  baseUrl: string;
  draftModel: string;
  finalModel: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: AiArtClientLog;
};

export const aiArtRequestTimeoutMs = 180_000;
const maxImageBytes = 4 * 1024 * 1024;
// 성공 본문은 base64 그림 한 장(최대 maxImageBytes*2 글자)과 usage뿐이다. 오류 본문은 짧은 JSON이라 64KB면 넉넉하다.
// content-length는 믿지 않는다(chunked·압축 응답은 값이 없거나 다르다): 실제로 읽은 바이트를 센다.
const maxSuccessBodyBytes = maxImageBytes * 2 + 64 * 1024;
const maxErrorBodyBytes = 64 * 1024;
const safeToken = /^[A-Za-z0-9_.:-]{1,128}$/;

const draftSettings = { size: '1024x1024', quality: 'low', output_format: 'webp', output_compression: 70 } as const;
const finalSettings = { size: '1024x1024', quality: 'high', output_format: 'webp', output_compression: 85 } as const;

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

class BodyTooLargeError extends Error {
  constructor() {
    super('response body too large');
    this.name = 'BodyTooLargeError';
  }
}

// 본문을 스트림으로 읽으면서 maxBytes를 넘는 순간 리더를 취소하고 멈춘다(넘친 바이트는 메모리에 더 쌓지 않는다).
// fetch가 압축을 이미 풀어 주므로 세는 것은 풀린 바이트다.
async function readBodyCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function readJsonCapped(response: Response, maxBytes: number): Promise<unknown> {
  return JSON.parse((await readBodyCapped(response, maxBytes)).toString('utf8'));
}

// 기본 로그: 허용된 필드(상태·오류 코드·x-request-id·횟수)만 든 객체를 그대로 찍는다. 키·프롬프트·이미지는 들어 있지 않다.
const logToConsole: AiArtClientLog = console.log.bind(console);

export class OpenAiImageClient implements AiArtImageClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly log: AiArtClientLog;

  constructor(private readonly options: AiArtClientOptions) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? aiArtRequestTimeoutMs;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
    this.log = options.log ?? logToConsole;
  }

  generateDraft(input: { prompt: string; userHash: string }): Promise<AiArtImage> {
    return this.post('draft', '/v1/images/generations', () => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.options.draftModel, prompt: input.prompt, n: 1, ...draftSettings, user: input.userHash,
      }),
    }));
  }

  editFinal(input: { prompt: string; image: Uint8Array; userHash: string }): Promise<AiArtImage> {
    return this.post('final', '/v1/images/edits', () => {
      // multipart 경계가 들어간 Content-Type은 fetch가 FormData에서 만든다. 직접 지정하지 않는다.
      const form = new FormData();
      form.append('model', this.options.finalModel);
      form.append('prompt', input.prompt);
      form.append('quality', finalSettings.quality);
      form.append('size', finalSettings.size);
      form.append('output_format', finalSettings.output_format);
      form.append('output_compression', String(finalSettings.output_compression));
      form.append('user', input.userHash);
      form.append('image[]', new Blob([Uint8Array.from(input.image)], { type: 'image/webp' }), 'draft.webp');
      return { headers: {}, body: form };
    });
  }

  private async post(
    kind: 'draft' | 'final',
    path: string,
    build: () => { headers: Record<string, string>; body: string | FormData },
  ): Promise<AiArtImage> {
    for (let attempt = 1; ; attempt++) {
      const request = build();
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.options.apiKey}`, ...request.headers },
          body: request.body,
          // 이 API는 리다이렉트하지 않는다. 따라가지 않아 키가 다른 곳으로 넘어가지 않게 한다.
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (isTimeout(error)) {
          this.log({ event: 'ai_art.openai', kind, attempt, outcome: 'timeout' });
          throw new AiArtGenerationError('AI_ART_TIMEOUT', true);
        }
        // 요청이 OpenAI에 닿았는지, 이미지가 만들어졌는지 알 수 없다. 다시 보내면 비용이 두 번 나갈 수 있으므로 시간 초과와
        // 똑같이 다루어 예상 비용을 그대로 두고(chargeable) 끝낸다.
        this.log({ event: 'ai_art.openai', kind, attempt, outcome: 'network_error' });
        throw new AiArtGenerationError('AI_ART_UPSTREAM_UNAVAILABLE', true);
      }

      const rawRequestId = response.headers.get('x-request-id');
      const requestId = rawRequestId !== null && safeToken.test(rawRequestId) ? rawRequestId : undefined;
      if (response.ok) return this.readImage(kind, attempt, response, requestId);

      let errorCode: string | undefined;
      try {
        const body: unknown = await readJsonCapped(response, maxErrorBodyBytes);
        const error = body && typeof body === 'object' ? Reflect.get(body, 'error') : undefined;
        const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
        if (typeof code === 'string' && safeToken.test(code)) errorCode = code;
      } catch (error) {
        if (isTimeout(error)) {
          this.log({ event: 'ai_art.openai', kind, attempt, outcome: 'timeout', status: response.status });
          throw new AiArtGenerationError('AI_ART_TIMEOUT', true);
        }
        // 본문이 JSON이 아니거나 너무 크면(읽기를 멈추고 취소했다) 상태 코드만으로 분류한다.
      }
      this.log({
        event: 'ai_art.openai', kind, attempt, outcome: 'http_error', status: response.status,
        ...(errorCode !== undefined ? { errorCode } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
      });
      const failure = classifyOpenAiHttpFailure({
        status: response.status, errorCode, retryAfter: response.headers.get('retry-after'), random: this.random,
      });
      if (!failure.retry || attempt >= 2) throw new AiArtGenerationError(failure.code, failure.chargeable === true);
      await this.sleep(failure.retryAfterMs ?? 1000);
    }
  }

  private async readImage(
    kind: 'draft' | 'final', attempt: number, response: Response, requestId: string | undefined,
  ): Promise<AiArtImage> {
    const invalid = (): never => {
      this.log({
        event: 'ai_art.openai', kind, attempt, outcome: 'invalid_response', status: response.status,
        ...(requestId !== undefined ? { requestId } : {}),
      });
      throw new AiArtGenerationError('AI_ART_UPSTREAM_UNAVAILABLE', true);
    };
    // 선언된 길이는 빠른 거절에만 쓴다. 상한은 아래 스트림 읽기가 실제 바이트로 지킨다.
    if (Number(response.headers.get('content-length') ?? 0) > maxSuccessBodyBytes) {
      await response.body?.cancel().catch(() => undefined);
      return invalid();
    }
    let body: unknown;
    try {
      body = await readJsonCapped(response, maxSuccessBodyBytes);
    } catch (error) {
      if (isTimeout(error)) {
        this.log({ event: 'ai_art.openai', kind, attempt, outcome: 'timeout', status: response.status });
        throw new AiArtGenerationError('AI_ART_TIMEOUT', true);
      }
      return invalid();
    }
    const data = body && typeof body === 'object' ? Reflect.get(body, 'data') : undefined;
    const first: unknown = Array.isArray(data) ? data[0] : undefined;
    const encoded = first && typeof first === 'object' ? Reflect.get(first, 'b64_json') : undefined;
    if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > maxImageBytes * 2) return invalid();
    const image = Buffer.from(encoded, 'base64');
    if (image.length > maxImageBytes || !isWebp(image)) return invalid();

    this.log({
      event: 'ai_art.openai', kind, attempt, outcome: 'ok', status: response.status,
      ...(requestId !== undefined ? { requestId } : {}),
    });
    return { image, usage: parseImageUsage(body && typeof body === 'object' ? Reflect.get(body, 'usage') : undefined) };
  }
}
