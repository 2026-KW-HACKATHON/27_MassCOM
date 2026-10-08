import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';

import { parseMerchantArtPath } from './art-source';

// D-048 점주용 그림 API 계약(docs/superpowers/specs/2026-09-29-ai-store-art-design.md §6). 서버가 정본이며 앱은 형식이 어긋난
// 응답을 보여 주지 않고 거절한다. 라운드는 허용된 필드만 골라 담아 서버가 더 보내도 화면과 상태에 남지 않는다.

export const DRAFT_COUNT = 4;

export type ArtRoundStatus = 'DRAFTING' | 'DRAFTS_READY' | 'FINALIZING' | 'FINAL_READY' | 'APPLIED' | 'FAILED';
export type ArtDraft = { index: number; style: string; label: string; imageDataUrl: string };
export type ArtRound = {
  id: string;
  status: ArtRoundStatus;
  drafts: readonly ArtDraft[];
  chosenIndex: number | null;
  final: { imageDataUrl: string } | null;
  failureCode: string | null;
  createdAt: string;
};
export type ArtQuota = { draftRoundsLeft: number; finalsLeft: number;
  account?: { draftRoundsLeft: number; finalsLeft: number; resetsAt: string; cooldownUntil: string | null } };
export type OwnerArt = {
  configured: boolean;
  current: { artUrl: string } | null;
  quota: ArtQuota;
  round: ArtRound | null;
};

export class OwnerArtApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'OwnerArtApiError';
  }
}

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

export type OwnerArtApiClient = ReturnType<typeof createOwnerArtApiClient>;

const roundStatuses: readonly ArtRoundStatus[] = ['DRAFTING', 'DRAFTS_READY', 'FINALIZING', 'FINAL_READY', 'APPLIED', 'FAILED'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 점주에게만 data URL로 주는 시안·최종 이미지. 형식이 다르면(다른 이미지 종류·외부 주소·스크립트) 그리지 않는다.
const imageDataUrlPrefix = /^data:image\/(webp|png);base64,/;
const maxRetryAfterSeconds = 24 * 60 * 60;
const maxLabelLength = 30;
const maxCodeLength = 64;

export function createOwnerArtApiClient(options: Options) {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) {
      headers.set(name, value);
    }
    let response: Response;
    try {
      response = await fetcher(`${apiUrl}${path}`, { ...init, headers });
    } catch {
      throw new OwnerArtApiError(0, 'NETWORK_ERROR');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string'
        ? payload.code
        : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, code)) {
        await options.onSessionInvalid?.();
      }
      throw new OwnerArtApiError(
        response.status,
        code,
        response.status === 429 ? parseRetryAfter(response.headers.get('retry-after')) : undefined,
      );
    }
    return payload;
  }

  const artPath = (merchantId: string) => {
    if (merchantId.trim().length === 0) throw new OwnerArtApiError(404, 'MERCHANT_NOT_FOUND');
    return `/merchant/merchants/${encodeURIComponent(merchantId)}/art`;
  };
  const roundPath = (merchantId: string, roundId: string) => {
    // A round id is a UUID; anything else cannot be one of ours, so it never becomes part of a URL.
    if (!uuidPattern.test(roundId)) throw new OwnerArtApiError(404, 'AI_ART_ROUND_NOT_FOUND');
    return `${artPath(merchantId)}/rounds/${roundId}`;
  };
  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return {
    async getArt(merchantId: string): Promise<OwnerArt> {
      return parseOwnerArt(await request(artPath(merchantId)));
    },

    /** Starts the four drafts. The server answers at once (202) and keeps drawing; poll `getRound`. */
    async createRound(merchantId: string): Promise<ArtRound> {
      return parseArtRound(await request(`${artPath(merchantId)}/rounds`, json('POST', {})));
    },

    async getRound(merchantId: string, roundId: string): Promise<ArtRound> {
      return parseArtRound(await request(roundPath(merchantId, roundId)));
    },

    /** Picks one draft (0..3) to be redrawn in high quality. */
    async chooseDraft(merchantId: string, roundId: string, index: number): Promise<ArtRound> {
      if (!Number.isInteger(index) || index < 0 || index >= DRAFT_COUNT) throw new OwnerArtApiError(400, 'AI_ART_INDEX_INVALID');
      return parseArtRound(await request(`${roundPath(merchantId, roundId)}/choose`, json('POST', { index })));
    },

    /** Makes the final picture the merchant's own; returns the public art path customers load. */
    async applyRound(merchantId: string, roundId: string): Promise<string> {
      const payload = await request(`${roundPath(merchantId, roundId)}/apply`, json('POST', {}));
      const path = isRecord(payload) ? parseMerchantArtPath(payload.artUrl) : null;
      if (!path) throw invalidResponse();
      return path;
    },

    /** Publishes a photo the owner explicitly chose after previewing it. */
    async uploadPhoto(merchantId: string, imageDataUrl: string): Promise<string> {
      const payload = await request(`${artPath(merchantId)}/upload`, json('POST', { imageDataUrl }));
      const path = isRecord(payload) ? parseMerchantArtPath(payload.artUrl) : null;
      if (!path) throw invalidResponse();
      return path;
    },

    async resetArt(merchantId: string): Promise<void> {
      const payload = await request(artPath(merchantId), { method: 'DELETE' });
      if (!isRecord(payload) || payload.status !== 'RESET') throw invalidResponse();
    },
  };
}

export function parseOwnerArt(value: unknown): OwnerArt {
  if (!isRecord(value) || typeof value.configured !== 'boolean') throw invalidResponse();
  return {
    configured: value.configured,
    current: parseCurrent(value.current),
    quota: parseQuota(value.quota),
    round: value.round === null ? null : parseArtRound(value.round),
  };
}

export function parseArtRound(value: unknown): ArtRound {
  if (!isRecord(value) || typeof value.id !== 'string' || !uuidPattern.test(value.id)) throw invalidResponse();
  if (!roundStatuses.includes(value.status as ArtRoundStatus)) throw invalidResponse();
  const status = value.status as ArtRoundStatus;
  if (!Array.isArray(value.drafts) || value.drafts.length > DRAFT_COUNT) throw invalidResponse();
  const drafts = value.drafts.map(parseDraft).sort((left, right) => left.index - right.index);
  if (new Set(drafts.map((draft) => draft.index)).size !== drafts.length) throw invalidResponse();
  const chosenIndex = parseChosenIndex(value.chosenIndex);
  const final = parseFinal(value.final);
  const failureCode = parseFailureCode(value.failureCode);
  if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) throw invalidResponse();

  // A round in one of these states without what the screen draws for it would show an empty panel: refuse it.
  if (status === 'DRAFTS_READY' && drafts.length !== DRAFT_COUNT) throw invalidResponse();
  if ((status === 'FINALIZING' || status === 'FINAL_READY') && chosenIndex === null) throw invalidResponse();
  if (chosenIndex !== null && drafts.length > 0 && !drafts.some((draft) => draft.index === chosenIndex)) throw invalidResponse();
  if (status === 'FINAL_READY' && final === null) throw invalidResponse();
  if ((status === 'FAILED') !== (failureCode !== null)) throw invalidResponse();

  return { id: value.id, status, drafts, chosenIndex, final, failureCode, createdAt: value.createdAt };
}

function parseDraft(value: unknown): ArtDraft {
  if (
    !isRecord(value) || !Number.isInteger(value.index) || (value.index as number) < 0 || (value.index as number) >= DRAFT_COUNT ||
    !isShortText(value.style, maxCodeLength) || !isShortText(value.label, maxLabelLength)
  ) throw invalidResponse();
  return { index: value.index as number, style: value.style, label: value.label, imageDataUrl: parseImageDataUrl(value.imageDataUrl) };
}

function parseImageDataUrl(value: unknown): string {
  const prefix = typeof value === 'string' ? imageDataUrlPrefix.exec(value) : null;
  // An empty payload after the prefix is not a picture either.
  if (typeof value !== 'string' || !prefix || value.length <= prefix[0].length) throw invalidResponse();
  return value;
}

function parseFinal(value: unknown): { imageDataUrl: string } | null {
  if (value === null) return null;
  if (!isRecord(value)) throw invalidResponse();
  return { imageDataUrl: parseImageDataUrl(value.imageDataUrl) };
}

function parseChosenIndex(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= DRAFT_COUNT) throw invalidResponse();
  return value as number;
}

function parseFailureCode(value: unknown): string | null {
  if (value === null) return null;
  if (!isShortText(value, maxCodeLength)) throw invalidResponse();
  return value;
}

function parseCurrent(value: unknown): { artUrl: string } | null {
  if (value === null) return null;
  const artUrl = isRecord(value) ? parseMerchantArtPath(value.artUrl) : null;
  if (!artUrl) throw invalidResponse();
  return { artUrl };
}

function parseQuota(value: unknown): ArtQuota {
  if (!isRecord(value) || !isCount(value.draftRoundsLeft) || !isCount(value.finalsLeft)) throw invalidResponse();
  const account = value.account;
  if (account !== undefined && (!isRecord(account) || !isCount(account.draftRoundsLeft) || !isCount(account.finalsLeft)
    || typeof account.resetsAt !== 'string' || !Number.isFinite(Date.parse(account.resetsAt))
    || (account.cooldownUntil !== null && (typeof account.cooldownUntil !== 'string'
      || !Number.isFinite(Date.parse(account.cooldownUntil)))))) throw invalidResponse();
  return { draftRoundsLeft: value.draftRoundsLeft, finalsLeft: value.finalsLeft,
    ...(account !== undefined ? { account: account as ArtQuota['account'] } : {}) };
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null || !/^\d+$/.test(header.trim())) return undefined;
  return Math.min(maxRetryAfterSeconds, Math.max(1, Number(header.trim())));
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000;
}

function isShortText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): OwnerArtApiError {
  return new OwnerArtApiError(200, 'INVALID_RESPONSE');
}

/**
 * A request the server may have accepted can still reach the app as a reply it refuses to read, or as "already in progress" or
 * "wrong step". The screen then reloads the round, or it would keep showing a state the server has moved past.
 */
export function needsArtReload(error: unknown): boolean {
  return error instanceof OwnerArtApiError
    && (error.code === 'INVALID_RESPONSE' || error.code === 'AI_ART_ROUND_STATE' || error.code === 'AI_ART_ROUND_IN_PROGRESS' || error.code === 'AI_ART_ROUND_NOT_FOUND');
}

/** Polling should stop for an answer that will not change by asking again (no access, no such round); network and server trouble keep trying. */
export function isPermanentArtError(error: unknown): boolean {
  return error instanceof OwnerArtApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

/** Plain Korean for a server code (an error's code or a failed round's failureCode); a raw code or status never reaches the screen. */
export function artCodeMessage(code: string | null | undefined, retryAfterSeconds?: number): string {
  switch (code) {
    case 'AI_ART_NOT_CONFIGURED':
      return '아직 준비 중이에요. 곧 열릴 예정이에요.';
    case 'AI_ART_BUDGET_EXHAUSTED':
      return '이번 달 그림 만들기 한도를 다 썼어요.';
    case 'AI_ART_DAILY_LIMIT':
      return retryAfterSeconds === undefined
        ? '오늘은 더 만들 수 없어요. 내일 다시 해 주세요.'
        : `오늘은 더 만들 수 없어요. 내일 다시 해 주세요. (약 ${Math.max(1, Math.ceil(retryAfterSeconds / 3600))}시간 뒤부터 가능해요)`;
    case 'AI_ART_ACCOUNT_DAILY_LIMIT':
      return retryAfterSeconds === undefined
        ? '이 계정의 오늘 그림 만들기 횟수를 다 썼어요. 한국 시간 자정 후 다시 해 주세요.'
        : `이 계정의 오늘 그림 만들기 횟수를 다 썼어요. 한국 시간 자정 후 다시 해 주세요. (${retryAfterSeconds < 60 ? `${retryAfterSeconds}초` : retryAfterSeconds < 3600 ? `약 ${Math.ceil(retryAfterSeconds / 60)}분` : `약 ${Math.ceil(retryAfterSeconds / 3600)}시간`} 남았어요)`;
    case 'AI_ART_COOLDOWN':
      return retryAfterSeconds === undefined
        ? '연속 생성은 1분 간격으로 할 수 있어요. 잠시 후 다시 해 주세요.'
        : `연속 생성은 1분 간격으로 할 수 있어요. ${retryAfterSeconds}초 후 다시 해 주세요.`;
    case 'AI_ART_ROUND_IN_PROGRESS':
      return '이미 그림을 만들고 있어요. 조금만 기다려 주세요.';
    case 'AI_ART_ROUND_STATE':
      return '이미 다음 단계로 넘어갔어요. 화면을 새로 불러올게요.';
    case 'AI_ART_ROUND_NOT_FOUND':
      return '찾을 수 없는 그림이에요. 화면을 새로 불러올게요.';
    case 'AI_ART_MODERATION_BLOCKED':
      return '이 가게 정보로는 그림을 만들 수 없었어요.';
    case 'AI_ART_UPSTREAM_UNAVAILABLE':
    case 'AI_ART_TIMEOUT':
    case 'AI_ART_INTERRUPTED':
      return '그림을 만들지 못했어요. 잠시 후 다시 해 주세요.';
    case 'MERCHANT_ACCESS_DENIED':
      return '이 가게의 그림을 바꿀 권한이 없어요.';
    case 'MERCHANT_ART_IMAGE_INVALID':
      return '사진을 확인하지 못했어요. JPG, PNG, WebP 사진을 다시 선택해 주세요.';
    case 'MERCHANT_ART_IMAGE_TOO_LARGE':
      return '5MB 이하 사진을 선택해 주세요.';
    case 'SESSION_INVALID':
      return '로그인이 만료됐어요. 다시 로그인해 주세요.';
    case 'NETWORK_ERROR':
      return '네트워크에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
    case 'INVALID_RESPONSE':
      return '서버 응답을 확인하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
    default:
      return '요청을 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
  }
}

export function ownerArtErrorMessage(error: unknown): string {
  if (!(error instanceof OwnerArtApiError)) return artCodeMessage('NETWORK_ERROR');
  return artCodeMessage(error.code, error.retryAfterSeconds);
}

/** What the screen says when checking on a round failed: a network blip keeps checking, so it does not ask the owner to retry. */
export function pollFailureMessage(error: unknown): string {
  return isPermanentArtError(error) ? ownerArtErrorMessage(error) : '진행 상황을 확인하지 못했어요. 계속 다시 확인하고 있어요.';
}
