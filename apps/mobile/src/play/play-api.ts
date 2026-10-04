import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import { consentRequiredMessage, needsConsentRecheck } from '@/privacy/consent-flow';
import type { GameAction, GameKind, PlayRun } from '../../../api/src/play-rules';

export type PlayRecord = { kind: GameKind; bestScore: number; plays: number };
export type PlaySnapshot = { records: PlayRecord[]; unlockedThemes: string[] };
export type PlayFinish = { kind: GameKind; score: number; bestScore: number; plays: number; completed: boolean; correct: number; total: number; unlockedThemes: string[] };

export class PlayApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'PlayApiError';
  }
}

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

const kinds = new Set<GameKind>(['stack', 'memory', 'delivery', 'orders']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const kind = (value: unknown): value is GameKind => kinds.has(value as GameKind);
const invalid = () => new PlayApiError(0, 'INVALID_RESPONSE');

export function createPlayApiClient({ apiUrl, credential, onSessionInvalid, fetcher = fetch }: Options) {
  const base = apiUrl.replace(/\/+$/, '');
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(credential))) headers.set(name, value);
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, { ...init, headers });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new PlayApiError(0, 'NETWORK_ERROR');
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = record(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(credential, response.status, code)) await onSessionInvalid?.();
      throw new PlayApiError(response.status, code);
    }
    return payload;
  }
  const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  return {
    async getPlay(signal?: AbortSignal): Promise<PlaySnapshot> {
      const value = await request('/me/play', { signal });
      if (!record(value) || !Array.isArray(value.records) || !strings(value.unlockedThemes)) throw invalid();
      const records = value.records.map((entry) => {
        if (!record(entry) || !kind(entry.kind) || !integer(entry.bestScore) || !integer(entry.plays)) throw invalid();
        return { kind: entry.kind, bestScore: entry.bestScore, plays: entry.plays };
      });
      return { records, unlockedThemes: value.unlockedThemes };
    },
    async start(kind: GameKind, signal?: AbortSignal): Promise<PlayRun> {
      const value = await request('/me/play/runs', post({ kind }, signal));
      if (!record(value) || typeof value.id !== 'string' || !value.id || value.kind !== kind || !integer(value.seed) || value.seed > 0x7fffffff
        || typeof value.startedAt !== 'string' || Number.isNaN(Date.parse(value.startedAt))
        || typeof value.expiresAt !== 'string' || Number.isNaN(Date.parse(value.expiresAt))
        || !integer(value.durationMs) || value.durationMs === 0 || value.rulesVersion !== 1) throw invalid();
      return value as PlayRun;
    },
    async finish(run: PlayRun, actions: readonly GameAction[], signal?: AbortSignal): Promise<PlayFinish> {
      const value = await request(`/me/play/runs/${encodeURIComponent(run.id)}/finish`, post({ actions }, signal));
      if (!record(value) || value.kind !== run.kind || !integer(value.score) || !integer(value.bestScore)
        || !integer(value.plays) || typeof value.completed !== 'boolean' || !integer(value.correct)
        || !integer(value.total) || !strings(value.unlockedThemes)) throw invalid();
      return value as PlayFinish;
    },
  };
}

export function playErrorMessage(error: unknown): string {
  if (needsConsentRecheck(error)) return consentRequiredMessage;
  if (error instanceof PlayApiError) {
    if (error.code === 'NETWORK_ERROR') return '연결을 확인한 뒤 다시 시도해 주세요.';
    if (error.code === 'RUN_EXPIRED' || error.code === 'PLAY_RUN_EXPIRED') return '시간이 지나 게임이 끝났어요. 새로 시작해 주세요.';
  }
  return '게임 정보를 처리하지 못했어요. 다시 시도해 주세요.';
}
