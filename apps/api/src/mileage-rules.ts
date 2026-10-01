// 마일리지 상점(Issue #298)의 순수 규칙: DB를 보지 않는 카탈로그·공식·결정 로직만 둔다.
// 방문·시리즈를 세는 쪽(countedVisitFromSql/countedVisitFilterSql, reward_entitlements)은
// apps/api/src/postgres/badge-rewards.ts·postgres/mileage-shop.ts가 그대로 재사용한다(여기서 다시 만들지 않는다).

export type MileageGrade = 'BRONZE' | 'SILVER' | 'GOLD';

export type MileageCharacter = {
  id: string;
  grade: MileageGrade;
  name: string;
};

// 정적 카탈로그: 하늘 동네 가게 친구들 9종, 등급마다 3종(소유자 결정 — 펭귄일 필요 없음, docs/DECISIONS.md).
export const MILEAGE_CATALOG: readonly MileageCharacter[] = [
  { id: 'cook-cat', grade: 'BRONZE', name: '요리사 냥이' },
  { id: 'cafe-bear', grade: 'BRONZE', name: '카페 곰돌이' },
  { id: 'walk-rabbit', grade: 'BRONZE', name: '산책 토끼' },
  { id: 'bakery-squirrel', grade: 'SILVER', name: '빵집 다람쥐' },
  { id: 'flower-hedgehog', grade: 'SILVER', name: '꽃집 고슴도치' },
  { id: 'book-owl', grade: 'SILVER', name: '책방 부엉이' },
  { id: 'tteok-tiger', grade: 'GOLD', name: '떡집 호랑이' },
  { id: 'market-raccoon', grade: 'GOLD', name: '시장 너구리' },
  { id: 'laundry-seal', grade: 'GOLD', name: '세탁소 물범' },
];

export const MILEAGE_GRADE_PRICES: Readonly<Record<MileageGrade, number>> = {
  BRONZE: 100,
  SILVER: 200,
  GOLD: 400,
};

// 적립 공식의 가중치. 앱이 하드코딩하지 않도록 GET /shop 응답에도 그대로 실어 보낸다.
export const MILEAGE_EARN_RULES = { visit: 50, newStore: 100, series: 200 } as const;

export function isMileageGrade(value: unknown): value is MileageGrade {
  return value === 'BRONZE' || value === 'SILVER' || value === 'GOLD';
}

export function itemsOfGrade(grade: MileageGrade): readonly MileageCharacter[] {
  return MILEAGE_CATALOG.filter((item) => item.grade === grade);
}

export function findCatalogItem(itemId: string): MileageCharacter | undefined {
  return MILEAGE_CATALOG.find((item) => item.id === itemId);
}

// earned(account) = 50 × 센 방문 + 100 × 그 방문들의 서로 다른 점포 + 200 × 완성한 점포 시리즈.
// 입력 세 수는 모두 배지 집계와 같은 집계 SQL(countedVisitFromSql/countedVisitFilterSql, reward_entitlements)이
// 이미 중복·자기 적립·취소·되살리기를 제외하고 돌려준 값이라 여기서는 다시 가리지 않는다.
export function computeEarnedMileage(input: {
  countedVisits: number;
  distinctMerchants: number;
  completedSeries: number;
}): number {
  return (
    MILEAGE_EARN_RULES.visit * input.countedVisits +
    MILEAGE_EARN_RULES.newStore * input.distinctMerchants +
    MILEAGE_EARN_RULES.series * input.completedSeries
  );
}

// 등급 안에서 안 가진 것 중 균등 난수로 하나 고른다. randomInt는 [0, items.length)를 고르는 주입점
// (운영은 node:crypto의 randomInt, 시험은 고정된 값을 주는 가짜로 바꾼다).
export function chooseUniform<T>(items: readonly T[], randomInt: (bound: number) => number): T {
  if (items.length === 0) throw new RangeError('chooseUniform needs at least one item');
  const index = randomInt(items.length);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    throw new RangeError('randomInt must return an integer in [0, bound)');
  }
  return items[index]!;
}

// 대표 캐릭터는 가진 것만 될 수 있다. null(대표 없음)은 언제나 허용한다.
export function canSetAvatar(itemId: string | null, ownedItemIds: ReadonlySet<string>): boolean {
  return itemId === null || ownedItemIds.has(itemId);
}

export type RerollDecision =
  | { kind: 'REPLAY' }
  | { kind: 'REQUEST_CONFLICT' }
  | { kind: 'RATE_LIMITED' }
  | { kind: 'STATE_CHANGED' }
  | { kind: 'GRADE_COMPLETE' }
  | { kind: 'INSUFFICIENT_MILEAGE' }
  | { kind: 'PROCEED' };

// POST /shop/rerolls의 분기 순서를 한곳에 고정한다(design-298.md "Design review fixes" 3·6번):
// 같은 requestId 재생(등급이 같으면 REPLAY, 다르면 충돌) → 새 요청만: 비율 제한 → 클라이언트가 본 remaining과
// 지금 remaining 일치 → 등급 완료 → 잔액. 서비스는 이 함수 하나만으로 분기해 순서가 코드에서 벗어나지 않는다.
export function decideReroll(input: {
  existingRequest: { grade: MileageGrade } | undefined;
  grade: MileageGrade;
  withinRateLimit: boolean;
  expectedRemaining: number;
  actualRemaining: number;
  balance: number;
  price: number;
}): RerollDecision {
  if (input.existingRequest) {
    return input.existingRequest.grade === input.grade
      ? { kind: 'REPLAY' }
      : { kind: 'REQUEST_CONFLICT' };
  }
  if (!input.withinRateLimit) return { kind: 'RATE_LIMITED' };
  if (input.expectedRemaining !== input.actualRemaining) return { kind: 'STATE_CHANGED' };
  if (input.actualRemaining <= 0) return { kind: 'GRADE_COMPLETE' };
  if (input.balance < input.price) return { kind: 'INSUFFICIENT_MILEAGE' };
  return { kind: 'PROCEED' };
}
