import type { IncomingMessage } from 'node:http';

import { RequestError } from './request-error.js';

export const MAX_BODY_BYTES = 64 * 1024;

// Malformed percent-encoding is the caller's mistake, not a server fault.
export function decodePathParameter(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new RequestError(400, 'INVALID_PATH_PARAMETER');
  }
  // `%00`은 NUL 문자로 풀리는데 PostgreSQL 텍스트 값은 NUL을 받지 않아 질의가 500으로 끝난다. 경로 값이 DB에 닿기 전에 거절한다.
  if (decoded.includes('\0')) throw new RequestError(400, 'INVALID_PATH_PARAMETER');
  return decoded;
}

export async function readJson(request: IncomingMessage, allowEmpty = false, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new RequestError(413, 'BODY_TOO_LARGE');
    }
    chunks.push(buffer);
  }

  if (allowEmpty && totalBytes === 0) return {};

  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new RequestError(400, 'INVALID_JSON_BODY');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    throw new RequestError(400, 'INVALID_JSON_BODY');
  }
}

export function requireString(body: Record<string, unknown>, field: string, allowEmpty = false): string {
  const value = body[field];
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return value;
}

export function requireNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return value;
}

// 쿠폰 조회·사용은 식별 토큰 하나만 받는다. 계정 ID 같은 알 수 없는 키는 거절한다.
export function requireIdentityTokenBody(body: Record<string, unknown>): string {
  if (Object.keys(body).some(key => key !== 'customerIdentityToken')) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return requireString(body, 'customerIdentityToken');
}

export function requirePositiveInteger(body: Record<string, unknown>, field: string): number {
  const value = requireNumber(body, field);
  if (value <= 0) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return value;
}

export function requireHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  const selected = Array.isArray(value) ? value[0] : value;
  if (!selected?.trim()) throw new RequestError(400, 'IDEMPOTENCY_KEY_REQUIRED');
  return selected;
}

const consentBodyKeys = ['termsVersion', 'privacyVersion', 'ageConfirmed', 'termsAccepted', 'privacyAccepted'] as const;

/** 정확히 다섯 키만 받는다: 알 수 없는 키·빠진 키·잘못된 자료형은 400. 값이 true인지·버전이 현재인지는 서비스가 판단한다. */
export function readConsentBody(body: Record<string, unknown>): {
  termsVersion: string; privacyVersion: string; ageConfirmed: boolean; termsAccepted: boolean; privacyAccepted: boolean;
} {
  const keys = Object.keys(body);
  if (keys.length !== consentBodyKeys.length || consentBodyKeys.some((key) => !Object.hasOwn(body, key))) {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  const { termsVersion, privacyVersion, ageConfirmed, termsAccepted, privacyAccepted } = body;
  if (typeof termsVersion !== 'string' || typeof privacyVersion !== 'string' || termsVersion.length > 64 ||
      privacyVersion.length > 64 || typeof ageConfirmed !== 'boolean' || typeof termsAccepted !== 'boolean' ||
      typeof privacyAccepted !== 'boolean') {
    throw new RequestError(400, 'INVALID_REQUEST');
  }
  return { termsVersion, privacyVersion, ageConfirmed, termsAccepted, privacyAccepted };
}

export function requireEmptyBody(body: Record<string, unknown>): void {
  if (Object.keys(body).length > 0) throw new RequestError(400, 'INVALID_REQUEST');
}

export function requireOnlyKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new RequestError(400, 'INVALID_REQUEST');
}
