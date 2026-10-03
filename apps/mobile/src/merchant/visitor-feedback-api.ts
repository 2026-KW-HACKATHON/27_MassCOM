import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';

import {
  isVisitorSuggestionCode, isVisitorTagCode, maxVisitorSuggestions, maxVisitorTags,
  visitorFeedbackNoteMaxLength, type VisitorSuggestionCode, type VisitorTagCode,
} from './visitor-feedback-codes';

export type VisitorFeedbackSelection = {
  tags: VisitorTagCode[];
  suggestions: VisitorSuggestionCode[];
  note: string | null;
};
export type VisitorFeedbackInput = VisitorFeedbackSelection;
export type VisitorFeedbackApiErrorCode = 'NOT_ELIGIBLE' | 'INVALID' | 'NOTE_REJECTED' | 'RATE_LIMITED' | 'NETWORK';

export class VisitorFeedbackApiError extends Error {
  constructor(readonly code: VisitorFeedbackApiErrorCode, readonly status: number) {
    super(code);
    this.name = 'VisitorFeedbackApiError';
  }
}

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

export type VisitorFeedbackApiClient = ReturnType<typeof createVisitorFeedbackApiClient>;

export function createVisitorFeedbackApiClient(options: Options) {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request(merchantId: string, init?: RequestInit): Promise<VisitorFeedbackSelection> {
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) headers.set(name, value);
    let response: Response;
    try {
      response = await fetcher(`${apiUrl}/me/merchant-feedback/${encodeURIComponent(merchantId)}`, { ...init, headers });
    } catch {
      throw new VisitorFeedbackApiError('NETWORK', 0);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const serverCode = isRecord(payload) && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      if (shouldInvalidateSession(options.credential, response.status, serverCode)) await options.onSessionInvalid?.();
      const code: VisitorFeedbackApiErrorCode = serverCode === 'VISITOR_FEEDBACK_NOT_ELIGIBLE' && response.status === 403
        ? 'NOT_ELIGIBLE'
        : serverCode === 'VISITOR_FEEDBACK_NOTE_INVALID' && response.status === 400
          ? 'NOTE_REJECTED'
          : response.status === 429 ? 'RATE_LIMITED' : 'INVALID';
      throw new VisitorFeedbackApiError(code, response.status);
    }
    return parseSelection(payload);
  }

  return {
    getMine(merchantId: string): Promise<VisitorFeedbackSelection> {
      return request(merchantId);
    },
    save(merchantId: string, input: VisitorFeedbackInput): Promise<VisitorFeedbackSelection> {
      return request(merchantId, {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
      });
    },
  };
}

export function parseSelection(value: unknown): VisitorFeedbackSelection {
  if (!isRecord(value) || !Array.isArray(value.tags) || !Array.isArray(value.suggestions) ||
    !value.tags.every(isVisitorTagCode) || !value.suggestions.every(isVisitorSuggestionCode) ||
    value.tags.length > maxVisitorTags || value.suggestions.length > maxVisitorSuggestions ||
    new Set(value.tags).size !== value.tags.length || new Set(value.suggestions).size !== value.suggestions.length ||
    (value.note !== null && (typeof value.note !== 'string' || Array.from(value.note).length > visitorFeedbackNoteMaxLength))) {
    throw new VisitorFeedbackApiError('INVALID', 200);
  }
  return { tags: value.tags, suggestions: value.suggestions, note: value.note };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
