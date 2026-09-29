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
// 이상한 성공 응답). HTTP 오류 응답(429·5xx·정책 차단 등)은 이미지가 만들어지지 않았으므로 false다.
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
const maxResponseBytes = 16 * 1024 * 1024;
const safeToken = /^[A-Za-z0-9_.:-]{1,128}$/;

const draftSettings = { size: '1024x1024', quality: 'low', output_format: 'webp', output_compression: 70 } as const;
const finalSettings = { size: '1024x1024', quality: 'high', output_format: 'webp', output_compression: 85 } as const;

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

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
    this.log = options.log ?? ((event) => console.log(JSON.stringify(event)));
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
        this.log({ event: 'ai_art.openai', kind, attempt, outcome: 'network_error' });
        if (attempt >= 2) throw new AiArtGenerationError('AI_ART_UPSTREAM_UNAVAILABLE', true);
        await this.sleep(500 + Math.floor(this.random() * 1000));
        continue;
      }

      const rawRequestId = response.headers.get('x-request-id');
      const requestId = rawRequestId !== null && safeToken.test(rawRequestId) ? rawRequestId : undefined;
      if (response.ok) return this.readImage(kind, attempt, response, requestId);

      let errorCode: string | undefined;
      try {
        const body: unknown = await response.json();
        const error = body && typeof body === 'object' ? Reflect.get(body, 'error') : undefined;
        const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
        if (typeof code === 'string' && safeToken.test(code)) errorCode = code;
      } catch (error) {
        if (isTimeout(error)) {
          this.log({ event: 'ai_art.openai', kind, attempt, outcome: 'timeout', status: response.status });
          throw new AiArtGenerationError('AI_ART_TIMEOUT', true);
        }
        // 본문이 JSON이 아니면 상태 코드만으로 분류한다.
      }
      this.log({
        event: 'ai_art.openai', kind, attempt, outcome: 'http_error', status: response.status,
        ...(errorCode !== undefined ? { errorCode } : {}),
        ...(requestId !== undefined ? { requestId } : {}),
      });
      const failure = classifyOpenAiHttpFailure({
        status: response.status, errorCode, retryAfter: response.headers.get('retry-after'), random: this.random,
      });
      if (!failure.retry || attempt >= 2) throw new AiArtGenerationError(failure.code, false);
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
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > maxResponseBytes) return invalid();
    let body: unknown;
    try {
      body = await response.json();
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
