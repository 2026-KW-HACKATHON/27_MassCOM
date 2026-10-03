// 시연 전부 체험(#333): 시연 서버에서만 쓰는 상수와 순수 규칙. 운영 규칙(D-004 하루 한 번 진행, D-006 점포·캠페인 기간,
// D-063 마일리지 상점 적립)은 그대로이고, 시연 테스트 방문 발급자(SHOWCASE_TEST_VISIT_ISSUER) 슬롯에만 아래 규칙이 붙는다.
// 이 파일의 값은 showcaseDeployment가 참일 때만 런타임에 읽힌다: server.ts는 showcaseAllAccessOptions(Boolean(showcaseDeployment))로
// 서비스 옵션을 만들어 넘기고(운영은 빈 객체), 서비스의 날짜 규칙 함수도 그 옵션이 켜진 분기에서만 불린다. 예외는 두 가지다 —
// SHOWCASE_TEST_VISIT_LIMIT_PER_HOUR는 운영 서버에서도 한도 객체를 만들 때 읽히지만 시연 전용 라우트(운영에서는 404)만 그 한도를 쓰고,
// SHOWCASE_SEED_CAMPAIGN_BACKDATE_DAYS는 시연 시드 명령에서만 읽힌다. server.ts 배선은 all-access-wiring.test.ts가 고정한다.

// 마일리지 상점 전체(브론즈 3종 100·실버 3종 200·골드 3종 400 = 2,100)를 몇 번이고 뽑아 볼 수 있는 시연 보너스.
export const SHOWCASE_BONUS_MILEAGE = 100_000;
// 시연 상점의 시간당 재뽑기 한도(운영 기본 30). 카탈로그가 9종이라 사실상 막히지 않게만 넓힌다.
export const SHOWCASE_REROLL_RATE_LIMIT = 600;
// 시연 "테스트 방문 만들기" 계정당 시간당 한도(#295의 10에서 올림). 하루 한 점포 5회·점포 3곳을 한 번에 시험하기에 넉넉한 값이다.
export const SHOWCASE_TEST_VISIT_LIMIT_PER_HOUR = 60;
// 오늘로부터 며칠 전까지 날짜를 옮겨 세어 볼 수 있는지(오늘 포함 30일). 캠페인 시작일보다 앞서지는 못한다.
export const SHOWCASE_MAX_BACKDATE_DAYS = 29;
// 시연 시드 캠페인의 시작 시각을 시드 시각보다 이만큼(일) 앞에 둔다. SHOWCASE_MAX_BACKDATE_DAYS(29)보다 하루 크다.
export const SHOWCASE_SEED_CAMPAIGN_BACKDATE_DAYS = 30;

// server.ts가 서비스를 만들 때 펼쳐 넘기는 시연 전용 옵션의 유일한 출처. 운영(false)은 빈 객체라 서비스는 옵션 기본값 그대로 만들어진다.
export function showcaseAllAccessOptions(showcaseDeployment: boolean): {
  claimSlots: { showcaseTestVisitBackdating?: true };
  mileageShop: { showcaseBonusMileage?: number; rerollRateLimit?: number };
} {
  if (!showcaseDeployment) return { claimSlots: {}, mileageShop: {} };
  return {
    claimSlots: { showcaseTestVisitBackdating: true },
    mileageShop: { showcaseBonusMileage: SHOWCASE_BONUS_MILEAGE, rerollRateLimit: SHOWCASE_REROLL_RATE_LIMIT },
  };
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const kstDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function kstDateOf(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function kstMidnightMs(kstDate: string): number {
  return Date.parse(`${kstDate}T00:00:00+09:00`);
}

function kstTimeOfDayMs(ms: number): number {
  return (((ms + KST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
}

export type ShowcaseVisitDate = {
  // 방문이 잡힐 한국(KST) 날짜 'YYYY-MM-DD'. DB의 business_date가 occurredAt에서 같은 값으로 계산된다.
  kstDate: string;
  // 그 날짜의 "지금과 같은 한국 시각". 오늘이면 정확히 nowMs다.
  occurredAt: Date;
};

// 아직 쓰지 않은 가장 최근 한국 날짜를 고른다: earliestKstDate <= d <= 오늘, 오늘로부터 maxBackDays일 이내, usedKstDates에 없음.
// 고를 날이 없으면 null(호출자는 지금 시각으로 되돌아가 같은 날 두 번째 방문처럼 세어지지 않게 둔다).
export function pickShowcaseVisitDate(input: {
  nowMs: number;
  usedKstDates: ReadonlySet<string>;
  earliestKstDate: string;
  maxBackDays: number;
}): ShowcaseVisitDate | null {
  if (!Number.isFinite(input.nowMs)) throw new RangeError('nowMs must be a finite number');
  if (!kstDatePattern.test(input.earliestKstDate)) throw new RangeError('earliestKstDate must be YYYY-MM-DD');
  if (!Number.isSafeInteger(input.maxBackDays) || input.maxBackDays < 0) {
    throw new RangeError('maxBackDays must be a non-negative integer');
  }
  const timeOfDayMs = kstTimeOfDayMs(input.nowMs);
  for (let back = 0; back <= input.maxBackDays; back += 1) {
    // 한국은 일광절약시간이 없어 24시간씩 빼면 날짜가 정확히 하루씩 줄고 한국 시각은 그대로다.
    const kstDate = kstDateOf(input.nowMs - back * DAY_MS);
    if (kstDate < input.earliestKstDate) return null;
    if (input.usedKstDates.has(kstDate)) continue;
    const occurredAtMs = Math.min(kstMidnightMs(kstDate) + timeOfDayMs, input.nowMs);
    return { kstDate, occurredAt: new Date(occurredAtMs) };
  }
  return null;
}

// 캠페인 시작 시각(startsAtMs) 이전으로는 옮기지 않는다: "그 날짜의 지금과 같은 시각"이 시작 시각보다 앞서면 다음 날부터다.
// 시작 시각이 지금보다 앞서야(이미 시작한 캠페인) 의미가 있다 — redeem이 시작한 캠페인만 찾기 때문이다.
export function earliestShowcaseVisitDate(campaignStartsAtMs: number, nowMs: number): string {
  if (!Number.isFinite(campaignStartsAtMs) || !Number.isFinite(nowMs)) {
    throw new RangeError('campaignStartsAtMs and nowMs must be finite numbers');
  }
  const startKstDate = kstDateOf(campaignStartsAtMs);
  const sameTimeOnStartDayMs = kstMidnightMs(startKstDate) + kstTimeOfDayMs(nowMs);
  return sameTimeOnStartDayMs >= campaignStartsAtMs
    ? startKstDate
    : kstDateOf(kstMidnightMs(startKstDate) + DAY_MS);
}
