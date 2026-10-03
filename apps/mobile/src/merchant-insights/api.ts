import { headersForCredential, type AccountCredential } from '@/auth/account-credential';
import { shouldInvalidateSession } from '@/auth/session-invalid';
import { isVisitorSuggestionCode, isVisitorTagCode, type VisitorSuggestionCode, type VisitorTagCode } from '@/merchant/visitor-feedback-codes';

export type MerchantOverview = {
  generatedAt: string;
  businessDate: string;
  weekStartsOn: string;
  visits: { today: number; thisWeek: number; lastWeek: number; last7Days: { date: string; count: number }[]; total: number };
  comparison: { lastWeekSameSpan: number; delta: number } | null;
  couponsRedeemedThisWeek: number;
  repeatVisitors: number;
  weekVisitors?: { first: number; repeat: number };
  weekCollectibles?: { gradeId: string; gradeName: string; count: number }[];
  weekCoupons?: { issued: number; redeemed: number };
  weekDetailViews?: number;
  campaign: { title: string; status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED'; isPublic: boolean; startsAt: string; endsAt: string; phase: 'LIVE' | 'SCHEDULED' | 'NOT_PUBLIC' | 'EXPIRED' | 'DRAFT' | 'PAUSED' | 'ENDED' } | null;
  readiness: { steps: { key: 'basic' | 'menu' | 'members' | 'reward' | 'campaign' | 'visible'; label: string; state: 'DONE' | 'NEEDS_SETUP' | 'CHECK' | 'WAITING_APPROVAL' | 'SCHEDULED'; hint: string }[]; remaining: number; message: string };
};

export type VisitorFeedbackSummary = {
  tags: { code: VisitorTagCode; label: string; count: number }[];
  suggestions: { code: VisitorSuggestionCode; label: string; count: number }[];
  notes: { customerLabel: string; date: string; text: string }[];
};

export type MerchantInsightsErrorCode = 'NETWORK' | 'INVALID_RESPONSE' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'HTTP_ERROR';

export class MerchantInsightsApiError extends Error {
  constructor(readonly code: MerchantInsightsErrorCode, readonly status: number) {
    super(code);
    this.name = 'MerchantInsightsApiError';
  }
}

type Options = {
  apiUrl: string;
  credential: AccountCredential;
  onSessionInvalid?: () => void | Promise<void>;
  fetcher?: typeof fetch;
};

export type MerchantInsightsApiClient = ReturnType<typeof createMerchantInsightsApiClient>;

export function createMerchantInsightsApiClient(options: Options) {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  async function request(merchantId: string, resource: 'overview' | 'visitor-feedback'): Promise<unknown> {
    const headers = new Headers({ Accept: 'application/json' });
    for (const [name, value] of Object.entries(headersForCredential(options.credential))) headers.set(name, value);
    let response: Response;
    try {
      response = await fetcher(`${apiUrl}/merchant/merchants/${encodeURIComponent(merchantId)}/${resource}`, { headers });
    } catch {
      throw new MerchantInsightsApiError('NETWORK', 0);
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
      throw new MerchantInsightsApiError(response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR', response.status);
    }
    return payload;
  }

  return {
    async getOverview(merchantId: string): Promise<MerchantOverview> {
      return parseMerchantOverview(await request(merchantId, 'overview'));
    },
    async getVisitorFeedback(merchantId: string): Promise<VisitorFeedbackSummary> {
      return parseVisitorFeedbackSummary(await request(merchantId, 'visitor-feedback'));
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isInstant = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === 'string' && (choices as readonly string[]).includes(value);
const invalid = (): never => { throw new MerchantInsightsApiError('INVALID_RESPONSE', 200); };

export function parseMerchantOverview(value: unknown): MerchantOverview {
  if (!isRecord(value) || !isInstant(value.generatedAt) || !isDate(value.businessDate) || !isDate(value.weekStartsOn) ||
    !isRecord(value.visits) || !isCount(value.visits.today) || !isCount(value.visits.thisWeek) ||
    !isCount(value.visits.lastWeek) || !isCount(value.visits.total) || !Array.isArray(value.visits.last7Days) ||
    !value.visits.last7Days.every((day: unknown) => isRecord(day) && isDate(day.date) && isCount(day.count)) ||
    (value.comparison !== null && (!isRecord(value.comparison) || !isCount(value.comparison.lastWeekSameSpan) || !Number.isSafeInteger(value.comparison.delta))) ||
    !isCount(value.couponsRedeemedThisWeek) || !isCount(value.repeatVisitors) ||
    (value.weekVisitors !== undefined && (!isRecord(value.weekVisitors) ||
      !isCount(value.weekVisitors.first) || !isCount(value.weekVisitors.repeat))) ||
    (value.weekCollectibles !== undefined && (!Array.isArray(value.weekCollectibles) ||
      !value.weekCollectibles.every((grade: unknown) => isRecord(grade) && typeof grade.gradeId === 'string' &&
        typeof grade.gradeName === 'string' && isCount(grade.count)))) ||
    (value.weekCoupons !== undefined && (!isRecord(value.weekCoupons) ||
      !isCount(value.weekCoupons.issued) || !isCount(value.weekCoupons.redeemed))) ||
    (value.weekDetailViews !== undefined && !isCount(value.weekDetailViews)) ||
    (value.campaign !== null && (!isRecord(value.campaign) || typeof value.campaign.title !== 'string' ||
      !oneOf(value.campaign.status, ['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']) || typeof value.campaign.isPublic !== 'boolean' ||
      !isInstant(value.campaign.startsAt) || !isInstant(value.campaign.endsAt) ||
      !oneOf(value.campaign.phase, ['LIVE', 'SCHEDULED', 'NOT_PUBLIC', 'EXPIRED', 'DRAFT', 'PAUSED', 'ENDED']))) ||
    !isRecord(value.readiness) || !isCount(value.readiness.remaining) || typeof value.readiness.message !== 'string' ||
    !Array.isArray(value.readiness.steps) || !value.readiness.steps.every((step: unknown) => isRecord(step) &&
      oneOf(step.key, ['basic', 'menu', 'members', 'reward', 'campaign', 'visible']) && typeof step.label === 'string' &&
      oneOf(step.state, ['DONE', 'NEEDS_SETUP', 'CHECK', 'WAITING_APPROVAL', 'SCHEDULED']) && typeof step.hint === 'string')) invalid();
  return value as MerchantOverview;
}

export function parseVisitorFeedbackSummary(value: unknown): VisitorFeedbackSummary {
  if (!isRecord(value) || !Array.isArray(value.tags) || !Array.isArray(value.suggestions) || !Array.isArray(value.notes) ||
    !value.tags.every((item: unknown) => isRecord(item) && isVisitorTagCode(item.code) && typeof item.label === 'string' && isCount(item.count)) ||
    !value.suggestions.every((item: unknown) => isRecord(item) && isVisitorSuggestionCode(item.code) && typeof item.label === 'string' && isCount(item.count)) ||
    !value.notes.every((item: unknown) => isRecord(item) && typeof item.customerLabel === 'string' &&
      isDate(item.date) && typeof item.text === 'string')) invalid();
  return value as VisitorFeedbackSummary;
}
