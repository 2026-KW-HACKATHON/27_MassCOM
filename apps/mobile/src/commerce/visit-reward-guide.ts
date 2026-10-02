// 방문 완료 카드의 "이번 방문으로 얻은 것·다음 등급까지" 안내(Issue #332). 문구만 만들고, 적립·등급은 서버가 정본이다.

/**
 * 적립 가중치는 서버 apps/api/src/mileage-rules.ts의 MILEAGE_EARN_RULES와 같은 값이다(visit-reward-guide.test.ts가
 * 그 소스를 읽어 어긋나면 실패한다). 방문 완료 응답에는 이 값이 실려 오지 않아 문구에만 따로 둔다.
 */
export const visitMileage = 50;
export const newStoreMileage = 100;
export const seriesCompleteMileage = 200;

/** 가게 캠페인의 수집품 목표는 인정된 방문 1·3·5회다. 점포 목록을 못 읽었을 때만 이 값을 쓴다. */
export const defaultVisitGoals: readonly VisitGoal[] = [1, 3, 5];

export type VisitGoal = 1 | 3 | 5;

const gradeByGoal: Record<VisitGoal, string> = { 1: '브론즈', 3: '실버', 5: '골드' };

/** 첫 방문 보너스는 점포의 첫 인정 방문(1회째), 시리즈 완성 보너스는 5회째에 붙는다. */
const firstVisitCount = 1;
const seriesCompleteCount = 5;

export type VisitRewardGuide = { mileageLine: string | null; nextGradeLine: string | null };

export function visitRewardGuide(input: {
  progressCounted: boolean;
  progressCount: number;
  goals: readonly VisitGoal[];
}): VisitRewardGuide {
  return {
    mileageLine: mileageLine(input.progressCounted, input.progressCount),
    nextGradeLine: nextGradeLine(input.progressCount, input.goals),
  };
}

function mileageLine(progressCounted: boolean, progressCount: number): string | null {
  if (!progressCounted) return null;
  let line = `+${visitMileage} 마일리지 적립`;
  if (progressCount === firstVisitCount) line += ` · 첫 방문 +${newStoreMileage}`;
  if (progressCount === seriesCompleteCount) line += ` · 시리즈 완성 +${seriesCompleteMileage}`;
  return line;
}

function nextGradeLine(progressCount: number, goals: readonly VisitGoal[]): string | null {
  // 목표가 하나도 없는 가게는 시리즈 자체가 없어 "골드까지 모았어요"라고 말할 수 없다.
  if (goals.length === 0) return null;
  const next = [...goals].sort((a, b) => a - b).find((goal) => goal > progressCount);
  if (next === undefined) return '골드까지 모았어요';
  return `${gradeByGoal[next]} 수집품까지 ${next - progressCount}번 남았어요 (같은 가게는 하루 1번)`;
}

/** 상점에서 뽑을 수 있는 현재 마일리지. 상점 요약을 읽었을 때만 보인다. */
export function mileageBalanceLine(balance: number): string {
  return `보유 ${balance.toLocaleString('ko-KR')}마일리지`;
}
