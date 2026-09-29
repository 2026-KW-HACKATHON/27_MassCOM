#!/usr/bin/env node
// 로컬 시험용 가짜 OpenAI 이미지 서버(Issue #236, D-048). 실제 키·네트워크 없이 AI 가게 그림의 전체 흐름을 확인한다.
//
//   node scripts/fake-openai-images.mjs [--port 4010]
//   AI_ART_OPENAI_BASE_URL=http://127.0.0.1:4010 OPENAI_API_KEY=fake-local-key npm run start:local --prefix apps/api
//
// 127.0.0.1에서만 듣고 Node 표준 라이브러리만 쓴다. `/v1/images/generations`(JSON)와 `/v1/images/edits`(multipart)에
// 작은 webp를 돌려준다. 그림은 한 가지 색으로 채운 1024x1024 무손실 webp라 시안은 스타일마다 색이 다르고, 최종은 고른
// 시안의 색을 이어받아 조금 밝게 나온다(그래서 "고른 시안이 최종에 이어졌는지"를 눈으로 확인할 수 있다). 요청마다 색의
// 아래 비트가 달라 같은 바이트가 두 번 나오지 않는다(가게 그림 sha256은 유일해야 한다).
//
// 선택 환경 변수
//   FAKE_OPENAI_FAIL   moderation | rate_limit | spend_limit | server_error : 해당 오류를 돌려준다(기본: 정상)
//   FAKE_OPENAI_FAIL_PATH  generations | edits | both : 오류를 낼 경로(기본 both)
//   FAKE_OPENAI_DELAY_MS   응답 전 지연(ms, 기본 1500). 실제처럼 1~2분을 보려면 60000 등으로 올린다
//   FAKE_OPENAI_LOG_PROMPT 1이면 받은 프롬프트를 로그에 찍는다(기본: 길이만)
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const maxBodyBytes = 16 * 1024 * 1024;
const imageSize = 1024;

// ---- 한 가지 색으로 채운 VP8L(무손실 webp) 인코더 ----------------------------------------------------
// 변환·색 캐시·메타 접두어 없이, 다섯 접두어 부호(초록·빨강·파랑·알파·거리)를 각각 "기호 하나짜리 단순 부호"로 둔다. 기호가
// 하나뿐인 부호는 화소당 0비트라서 크기와 상관없이 파일이 34바이트다.

class BitWriter {
  constructor() { this.bytes = []; this.current = 0; this.used = 0; }
  write(value, bits) {
    for (let index = 0; index < bits; index++) {
      this.current |= ((value >> index) & 1) << this.used;
      if (++this.used === 8) { this.bytes.push(this.current); this.current = 0; this.used = 0; }
    }
  }
  finish() {
    if (this.used > 0) this.bytes.push(this.current);
    return Buffer.from(this.bytes);
  }
}

// 헤더 40비트 + 변환·캐시·메타 3비트 = 43. 이어서 단순 부호 다섯 개(1+1+1+8 = 11비트씩).
const headerBits = 43;
const codeOrder = ['green', 'red', 'blue', 'alpha'];

export function encodeSolidWebp({ red, green, blue }, size = imageSize) {
  const bits = new BitWriter();
  bits.write(0x2f, 8);
  bits.write(size - 1, 14);
  bits.write(size - 1, 14);
  bits.write(0, 1); // alpha_is_used: 항상 불투명
  bits.write(0, 3); // version
  bits.write(0, 1); // 변환 없음
  bits.write(0, 1); // 색 캐시 없음
  bits.write(0, 1); // 메타 접두어 없음
  const symbols = { green, red, blue, alpha: 255 };
  for (const channel of codeOrder) {
    bits.write(1, 1); // 단순 부호
    bits.write(0, 1); // 기호 1개
    bits.write(1, 1); // 첫 기호를 8비트로
    bits.write(symbols[channel], 8);
  }
  bits.write(1, 1); // 거리 부호: 단순
  bits.write(0, 1);
  bits.write(1, 1);
  bits.write(0, 8);
  const data = bits.finish();
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write('VP8L', 0, 'ascii');
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + chunk.length, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, chunk]);
}

function readBits(buffer, start, count) {
  let value = 0;
  for (let index = 0; index < count; index++) {
    const position = start + index;
    value |= ((buffer[position >> 3] >> (position & 7)) & 1) << index;
  }
  return value;
}

// 이 파일의 encodeSolidWebp가 만든 webp에서 색을 읽는다. 다른 파일이면 null이다.
export function readSolidWebpColor(bytes) {
  if (bytes.length < 21 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP'
    || bytes.toString('ascii', 12, 16) !== 'VP8L' || bytes[20] !== 0x2f) return null;
  const data = bytes.subarray(20);
  if (data.length < 13) return null;
  const channels = {};
  let position = headerBits;
  for (const channel of codeOrder) {
    if (readBits(data, position, 3) !== 0b101) return null; // 단순 부호·기호 1개·8비트
    channels[channel] = readBits(data, position + 3, 8);
    position += 11;
  }
  return { red: channels.red, green: channels.green, blue: channels.blue };
}

// ---- 색 정하기 ----------------------------------------------------------------------------------

// 스타일마다 다른 바탕색. 프롬프트의 스타일 문장(ai-art-rules.ts의 artStyles)에서 고른다.
const styleColors = [
  [/rubber-stamp/i, { red: 200, green: 60, blue: 60 }],
  [/die-cut sticker/i, { red: 70, green: 130, blue: 220 }],
  [/watercolor/i, { red: 110, green: 190, blue: 140 }],
  [/woodblock/i, { red: 220, green: 170, blue: 60 }],
];
const fallbackColor = { red: 150, green: 110, blue: 200 };

function styleColor(prompt) {
  return styleColors.find(([pattern]) => pattern.test(prompt))?.[1] ?? fallbackColor;
}

const processMask = randomBytes(2).readUInt16LE(0) & 0xfff;
let serial = 0;
// 아래 4비트씩 세 채널(12비트)에 일련번호를 섞는다. 4096장까지는 프로세스 안에서 같은 바이트가 나오지 않는다.
function uniqueLowBits(color) {
  const value = (serial++ ^ processMask) & 0xfff;
  const withLow = (channel, nibble) => (channel & 0xf0) | nibble;
  return {
    red: withLow(color.red, value & 0xf),
    green: withLow(color.green, (value >> 4) & 0xf),
    blue: withLow(color.blue, (value >> 8) & 0xf),
  };
}

const lighten = (channel) => Math.min(255, channel + Math.round((255 - channel) * 0.35));

// ---- multipart 읽기 -----------------------------------------------------------------------------

export function parseMultipart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '');
  if (!boundary) return null;
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const fields = new Map();
  const files = new Map();
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    // 각 부분은 "\r\n헤더\r\n\r\n내용\r\n" 모양이다.
    const part = body.subarray(start + delimiter.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const head = part.subarray(0, split).toString('utf8');
      const content = part.subarray(split + 4);
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      if (name !== undefined) {
        if (/filename="/i.test(head)) files.set(name, content);
        else fields.set(name, content.toString('utf8'));
      }
    }
    start = next;
  }
  return { fields, files };
}

// ---- 서버 ---------------------------------------------------------------------------------------

const failures = {
  moderation: { status: 400, error: { type: 'image_generation_user_error', code: 'moderation_blocked',
    message: 'Your request was rejected by the safety system (fake).' } },
  rate_limit: { status: 429, retryAfter: '1', error: { type: 'requests', code: 'rate_limit_exceeded',
    message: 'Rate limit reached (fake).' } },
  spend_limit: { status: 429, error: { type: 'insufficient_quota', code: 'credit_balance_exhausted',
    message: 'Credit balance exhausted (fake).' } },
  server_error: { status: 500, error: { type: 'server_error', code: null, message: 'The server had an error (fake).' } },
};

export function fakeServerOptionsFromEnv(env) {
  const fail = env.FAKE_OPENAI_FAIL?.trim() || undefined;
  if (fail !== undefined && !(fail in failures)) throw new Error(`FAKE_OPENAI_FAIL must be one of ${Object.keys(failures).join(', ')}`);
  const failPath = env.FAKE_OPENAI_FAIL_PATH?.trim() || 'both';
  if (!['generations', 'edits', 'both'].includes(failPath)) throw new Error('FAKE_OPENAI_FAIL_PATH must be generations, edits or both');
  const delayMs = env.FAKE_OPENAI_DELAY_MS?.trim() ? Number(env.FAKE_OPENAI_DELAY_MS) : 1500;
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 600_000) throw new Error('FAKE_OPENAI_DELAY_MS must be between 0 and 600000');
  return { fail, failPath, delayMs, logPrompt: env.FAKE_OPENAI_LOG_PROMPT === '1' };
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', 'x-request-id': `req_fake_${randomBytes(6).toString('hex')}`, ...headers });
  response.end(JSON.stringify(body));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFakeOpenAiImagesServer(options = fakeServerOptionsFromEnv(process.env), log = console.log) {
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      const kind = path === '/v1/images/generations' ? 'generations' : path === '/v1/images/edits' ? 'edits' : null;
      if (request.method !== 'POST' || kind === null) {
        sendJson(response, 404, { error: { type: 'invalid_request_error', code: 'not_found', message: 'Unknown route (fake).' } });
        return;
      }
      if (!/^Bearer \S+$/.test(request.headers.authorization ?? '')) {
        sendJson(response, 401, { error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'Missing API key (fake).' } });
        return;
      }
      const body = await readBody(request);
      let prompt;
      let model;
      let input;
      if (kind === 'generations') {
        const json = JSON.parse(body.toString('utf8'));
        prompt = String(json.prompt ?? '');
        model = String(json.model ?? '');
      } else {
        const form = parseMultipart(body, request.headers['content-type']);
        if (!form) throw Object.assign(new Error('multipart required'), { status: 400 });
        prompt = form.fields.get('prompt') ?? '';
        model = form.fields.get('model') ?? '';
        input = form.files.get('image[]');
      }
      log(`fake-openai ${kind} model=${model || '(none)'} prompt=${options.logPrompt ? JSON.stringify(prompt) : `${prompt.length} chars`}`);
      if (options.delayMs > 0) await sleep(options.delayMs);

      const failure = options.fail !== undefined && (options.failPath === 'both' || options.failPath === kind)
        ? failures[options.fail] : undefined;
      if (failure) {
        sendJson(response, failure.status, { error: failure.error }, failure.retryAfter ? { 'retry-after': failure.retryAfter } : {});
        return;
      }
      if (!model) {
        sendJson(response, 400, { error: { type: 'invalid_request_error', code: 'missing_required_parameter', message: 'model is required (fake).' } });
        return;
      }

      const draftColor = kind === 'generations' ? styleColor(prompt) : (input && readSolidWebpColor(input)) || fallbackColor;
      const color = kind === 'generations' ? draftColor
        : { red: lighten(draftColor.red), green: lighten(draftColor.green), blue: lighten(draftColor.blue) };
      const image = encodeSolidWebp(uniqueLowBits(color));
      sendJson(response, 200, {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: image.toString('base64') }],
        output_format: 'webp', quality: kind === 'generations' ? 'low' : 'high', size: `${imageSize}x${imageSize}`,
        usage: kind === 'generations'
          ? { input_tokens: 120, input_tokens_details: { image_tokens: 0, text_tokens: 120 }, output_tokens: 272 }
          : { input_tokens: 1400, input_tokens_details: { image_tokens: 1300, text_tokens: 100 }, output_tokens: 3000 },
      });
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 400;
      sendJson(response, status, { error: { type: 'invalid_request_error', code: null, message: 'Bad request (fake).' } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const portFlag = process.argv.indexOf('--port');
  const port = Number(portFlag === -1 ? process.env.PORT ?? 4010 : process.argv[portFlag + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('port must be an integer between 0 and 65535');
  const server = createFakeOpenAiImagesServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`fake OpenAI images server listening on http://127.0.0.1:${server.address().port} (local QA only)`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
