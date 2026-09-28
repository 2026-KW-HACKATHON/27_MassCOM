export type RewardGoal = {
  targetVisitCount: 1 | 3 | 5;
  displayName: string;
};

export type PublicCampaign = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  enrollmentStatus: 'OPEN' | 'FULL';
  rewardGoals: readonly RewardGoal[];
};

export type PublicMerchant = {
  id: string;
  name: string;
  story: string;
  roadAddress: string;
  minimumSpendWon: number;
  menuItems: readonly { name: string; priceWon: number }[];
  businessHours: string;
  demo: boolean;
  campaign: PublicCampaign;
};

type Fetcher = typeof fetch;

export class MerchantApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MerchantApiError';
  }
}

export function createMerchantApiClient(apiUrl: string, fetcher: Fetcher = fetch) {
  return {
    async listMerchants(signal?: AbortSignal): Promise<readonly PublicMerchant[]> {
      const response = await fetcher(`${apiUrl}/merchants`, {
        headers: { Accept: 'application/json' },
        signal,
      });

      if (!response.ok) {
        throw new MerchantApiError('음식점 목록을 불러오지 못했습니다.', response.status);
      }

      return parseMerchantList(await response.json());
    },
  };
}

export function parseMerchantList(payload: unknown): readonly PublicMerchant[] {
  if (!isRecord(payload) || !Array.isArray(payload.merchants)) {
    throw invalidPayload();
  }

  return payload.merchants.map(parseMerchant);
}

function parseMerchant(value: unknown): PublicMerchant {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.name) ||
    typeof value.story !== 'string' ||
    !isNonEmptyString(value.roadAddress) ||
    !Number.isInteger(value.minimumSpendWon) ||
    (value.minimumSpendWon as number) < 0 ||
    typeof value.demo !== 'boolean' ||
    (value.businessHours !== undefined && typeof value.businessHours !== 'string') ||
    (value.menuItems !== undefined && (!Array.isArray(value.menuItems) ||
      !value.menuItems.every((item: unknown) => isRecord(item) && isNonEmptyString(item.name) &&
        Number.isSafeInteger(item.priceWon) && (item.priceWon as number) >= 0 &&
        (item.priceWon as number) <= 1_000_000_000)))
  ) {
    throw invalidPayload();
  }

  return {
    id: value.id,
    name: value.name,
    story: value.story,
    roadAddress: value.roadAddress,
    minimumSpendWon: value.minimumSpendWon as number,
    menuItems: (value.menuItems ?? []) as PublicMerchant['menuItems'],
    businessHours: typeof value.businessHours === 'string' ? value.businessHours : '',
    demo: value.demo,
    campaign: parseCampaign(value.campaign),
  };
}

function parseCampaign(value: unknown): PublicCampaign {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.title) ||
    !isIsoDate(value.startsAt) ||
    !isIsoDate(value.endsAt) ||
    (value.enrollmentStatus !== 'OPEN' && value.enrollmentStatus !== 'FULL') ||
    !Array.isArray(value.rewardGoals)
  ) {
    throw invalidPayload();
  }

  return {
    id: value.id,
    title: value.title,
    startsAt: value.startsAt,
    endsAt: value.endsAt,
    enrollmentStatus: value.enrollmentStatus,
    rewardGoals: value.rewardGoals.map(parseRewardGoal),
  };
}

function parseRewardGoal(value: unknown): RewardGoal {
  if (
    !isRecord(value) ||
    (value.targetVisitCount !== 1 && value.targetVisitCount !== 3 && value.targetVisitCount !== 5) ||
    !isNonEmptyString(value.displayName)
  ) {
    throw invalidPayload();
  }

  return {
    targetVisitCount: value.targetVisitCount,
    displayName: value.displayName,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function invalidPayload(): MerchantApiError {
  return new MerchantApiError('음식점 응답 형식이 올바르지 않습니다.');
}
