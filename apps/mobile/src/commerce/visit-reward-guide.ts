// 방문 완료 카드의 "이번 방문으로 얻은 것·다음 등급까지" 안내(Issue #332). 적립·등급 판정은 서버가 정본이라, 화면은 서버가
// 센 값을 말로 옮기기만 하고 규칙(50·100·200)을 따라 계산하지 않는다.

/** 가게 캠페인의 수집품 목표는 인정된 방문 1·3·5회다(점포 목록에서 다시 읽지 않고 이 값으로 안내한다). */
export const defaultVisitGoals: readonly VisitGoal[] = [1, 3, 5];

export type VisitGoal = 1 | 3 | 5;

const gradeByGoal: Record<VisitGoal, string> = { 1: '브론즈', 3: '실버', 5: '골드' };

export type VisitRewardGuide = { nextGradeLine: string | null };

export function visitRewardGuide(input: { progressCount: number; goals: readonly VisitGoal[] }): VisitRewardGuide {
  return { nextGradeLine: nextGradeLine(input.progressCount, input.goals) };
}

function nextGradeLine(progressCount: number, goals: readonly VisitGoal[]): string | null {
  // 목표가 하나도 없는 가게는 시리즈 자체가 없어 "골드까지 모았어요"라고 말할 수 없다.
  if (goals.length === 0) return null;
  const next = [...goals].sort((a, b) => a - b).find((goal) => goal > progressCount);
  if (next === undefined) return '골드까지 모았어요';
  return `${gradeByGoal[next]} 수집품까지 ${next - progressCount}번 남았어요 (같은 가게는 하루 1번)`;
}

/**
 * 이번 방문으로 실제 늘어난 마일리지. 서버는 적립 합계를 계정·가게 단위로 세므로(두 번째 캠페인에서는 첫 방문 보너스가 다시
 * 붙지 않는다) 방문 횟수로 짐작하지 않고 방문 전·후 상점 요약의 적립 합계(`mileage.earned`) 차이만 보여 준다.
 * 어느 한쪽이라도 없거나, 늘지 않았거나, 복구된(replayed) 수령이면 줄 자체를 감춘다.
 */
export function mileageDeltaLine(input: { replayed: boolean; before: number | undefined; after: number | undefined }): string | null {
  if (input.replayed) return null;
  const { before, after } = input;
  if (typeof before !== 'number' || typeof after !== 'number' || !Number.isFinite(before) || !Number.isFinite(after)) return null;
  const delta = after - before;
  if (delta <= 0) return null;
  return `+${delta.toLocaleString('ko-KR')} 마일리지 적립`;
}

/** 상점에서 뽑을 수 있는 현재 마일리지. 상점 요약을 읽었을 때만 보인다. */
export function mileageBalanceLine(balance: number): string {
  return `보유 ${balance.toLocaleString('ko-KR')}마일리지`;
}

/**
 * 방문 전 적립 합계 읽기를 `ms`까지만 기다린다. 늦거나 실패하거나 없으면 undefined: 그 방문은 "+N 적립" 줄만 빠지고,
 * 읽기가 멈춘 채 방문 수령을 붙잡지 않는다.
 */
export function settleWithin<T>(promise: Promise<T> | undefined, ms: number): Promise<T | undefined> {
  if (!promise) return Promise.resolve(undefined);
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(undefined); },
    );
  });
}
