export type RecommendationReasonCode = 'NEW_PLACE' | 'NEXT_REWARD' | 'COLLECTION_COMPLETE';

export type Recommendation = {
  merchantId: string;
  merchantName: string;
  roadAddress: string;
  campaignId: string;
  campaignTitle: string;
  enrollmentStatus: 'OPEN';
  progressVisitCount: number;
  demo: boolean;
  reasonCode: RecommendationReasonCode;
  reasonText: string;
  nextGoal?: {
    targetVisitCount: 1 | 3 | 5;
    displayName: string;
    remainingVisits: number;
  };
};

type Options = {
  apiUrl: string;
  accountId: string;
  fetcher?: typeof fetch;
};

export class RecommendationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'RecommendationApiError';
  }
}

export function createRecommendationApiClient(options: Options) {
  const apiUrl = options.apiUrl.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;

  return {
    async listRecommendations(signal?: AbortSignal): Promise<readonly Recommendation[]> {
      const response = await fetcher(`${apiUrl}/recommendations`, {
        headers: {
          Accept: 'application/json',
          'x-account-id': options.accountId,
        },
        signal,
      });
      const payload = await response.json();
      if (!response.ok) {
        const code = isRecord(payload) && typeof payload.code === 'string'
          ? payload.code
          : `HTTP_${response.status}`;
        throw new RecommendationApiError(response.status, code);
      }
      return parseRecommendations(payload);
    },
  };
}

function parseRecommendations(value: unknown): readonly Recommendation[] {
  if (!isRecord(value) || !Array.isArray(value.recommendations)) {
    throw invalidResponse();
  }
  return value.recommendations.map(parseRecommendation);
}

function parseRecommendation(value: unknown): Recommendation {
  if (
    !isRecord(value) ||
    !isString(value.merchantId) ||
    !isString(value.merchantName) ||
    !isString(value.roadAddress) ||
    !isString(value.campaignId) ||
    !isString(value.campaignTitle) ||
    value.enrollmentStatus !== 'OPEN' ||
    !isNonNegativeInteger(value.progressVisitCount) ||
    typeof value.demo !== 'boolean' ||
    !isReasonCode(value.reasonCode) ||
    !isString(value.reasonText)
  ) {
    throw invalidResponse();
  }

  const nextGoal = value.nextGoal === undefined ? undefined : parseNextGoal(value.nextGoal);
  if (value.reasonCode !== 'COLLECTION_COMPLETE' && !nextGoal) {
    throw invalidResponse();
  }

  return {
    merchantId: value.merchantId,
    merchantName: value.merchantName,
    roadAddress: value.roadAddress,
    campaignId: value.campaignId,
    campaignTitle: value.campaignTitle,
    enrollmentStatus: 'OPEN',
    progressVisitCount: value.progressVisitCount,
    demo: value.demo,
    reasonCode: value.reasonCode,
    reasonText: value.reasonText,
    ...(nextGoal ? { nextGoal } : {}),
  };
}

function parseNextGoal(value: unknown): NonNullable<Recommendation['nextGoal']> {
  if (
    !isRecord(value) ||
    (value.targetVisitCount !== 1 && value.targetVisitCount !== 3 && value.targetVisitCount !== 5) ||
    !isString(value.displayName) ||
    !Number.isInteger(value.remainingVisits) ||
    (value.remainingVisits as number) <= 0
  ) {
    throw invalidResponse();
  }
  return {
    targetVisitCount: value.targetVisitCount,
    displayName: value.displayName,
    remainingVisits: value.remainingVisits as number,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isReasonCode(value: unknown): value is RecommendationReasonCode {
  return value === 'NEW_PLACE' || value === 'NEXT_REWARD' || value === 'COLLECTION_COMPLETE';
}

function invalidResponse(): RecommendationApiError {
  return new RecommendationApiError(200, 'INVALID_RESPONSE', '추천 응답 형식이 올바르지 않습니다.');
}
