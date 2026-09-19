export type RecommendationGoal = {
  targetVisitCount: 1 | 3 | 5;
  displayName: string;
};

export type RecommendationCandidate = {
  merchantId: string;
  merchantName: string;
  roadAddress: string;
  campaignId: string;
  campaignTitle: string;
  enrollmentStatus: 'OPEN' | 'FULL';
  progressVisitCount: number;
  rewardGoals: readonly RecommendationGoal[];
  demo: boolean;
};

export type Recommendation = Omit<RecommendationCandidate, 'rewardGoals'> & {
  reasonCode: 'NEW_PLACE' | 'NEXT_REWARD' | 'COLLECTION_COMPLETE';
  reasonText: string;
  nextGoal?: RecommendationGoal & { remainingVisits: number };
};

export interface RecommendationSource {
  listCandidates(accountId: string): Promise<readonly RecommendationCandidate[]>;
}

export interface RecommendationReader {
  listRecommendations(accountId: string): Promise<readonly Recommendation[]>;
}

export class RecommendationService implements RecommendationReader {
  constructor(
    private readonly source: RecommendationSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listRecommendations(accountId: string): Promise<readonly Recommendation[]> {
    const candidates = (await this.source.listCandidates(accountId))
      .filter((candidate) => candidate.enrollmentStatus === 'OPEN')
      .map(toRankedRecommendation);
    const groups = new Map<string, RankedRecommendation[]>();

    for (const candidate of candidates) {
      const group = groups.get(candidate.rank) ?? [];
      group.push(candidate);
      groups.set(candidate.rank, group);
    }

    const rotationSeed = koreanDayNumber(this.now()) + stableAccountHash(accountId);
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([, group]) => rotate(group.sort(byMerchantId), rotationSeed))
      .map(({ rank: _rank, ...recommendation }) => recommendation);
  }
}

type RankedRecommendation = Recommendation & { rank: string };

function toRankedRecommendation(candidate: RecommendationCandidate): RankedRecommendation {
  const nextGoal = candidate.rewardGoals.find(
    (goal) => goal.targetVisitCount > candidate.progressVisitCount,
  );
  const base = {
    merchantId: candidate.merchantId,
    merchantName: candidate.merchantName,
    roadAddress: candidate.roadAddress,
    campaignId: candidate.campaignId,
    campaignTitle: candidate.campaignTitle,
    enrollmentStatus: candidate.enrollmentStatus,
    progressVisitCount: candidate.progressVisitCount,
    demo: candidate.demo,
  } as const;

  if (candidate.progressVisitCount === 0) {
    return {
      ...base,
      rank: '0:0',
      reasonCode: 'NEW_PLACE',
      reasonText: '아직 방문하지 않은 동네 가게예요.',
      ...(nextGoal
        ? {
            nextGoal: {
              ...nextGoal,
              remainingVisits: nextGoal.targetVisitCount,
            },
          }
        : {}),
    };
  }

  if (nextGoal) {
    const remainingVisits = nextGoal.targetVisitCount - candidate.progressVisitCount;
    return {
      ...base,
      rank: `1:${String(remainingVisits).padStart(2, '0')}`,
      reasonCode: 'NEXT_REWARD',
      reasonText: `${remainingVisits}번 더 방문하면 ${nextGoal.displayName}을 받을 수 있어요.`,
      nextGoal: { ...nextGoal, remainingVisits },
    };
  }

  return {
    ...base,
    rank: '2:0',
    reasonCode: 'COLLECTION_COMPLETE',
    reasonText: '이 가게의 고정 보상을 모두 모았어요.',
  };
}

function rotate<T>(items: readonly T[], seed: number): readonly T[] {
  if (items.length < 2) return items;
  const offset = ((seed % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function byMerchantId(left: { merchantId: string }, right: { merchantId: string }): number {
  return left.merchantId.localeCompare(right.merchantId);
}

function stableAccountHash(value: string): number {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return hash;
}

function koreanDayNumber(value: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const numberFor = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((part) => part.type === type)?.value);
  return Math.floor(Date.UTC(numberFor('year'), numberFor('month') - 1, numberFor('day')) / 86_400_000);
}
