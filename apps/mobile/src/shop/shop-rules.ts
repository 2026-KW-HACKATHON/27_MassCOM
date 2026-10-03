import type { MileageGrade, ShopGradeView } from './shop-api';

// 화면이 쓰는 순수 표시 규칙. 가격·카탈로그·확률은 서버 응답(GET /shop)을 그대로 읽고 여기서 다시 적지 않는다
// (design-298.md: "앱이 하드코딩하지 않도록"). 이 파일은 그 응답을 사람이 읽을 문구·버튼 상태로만 바꾼다.

export function formatMileage(amount: number): string {
  return `${amount.toLocaleString('ko-KR')}P`;
}

/** 등급 카드의 "남은 N종 · 각 1/N" 공개 문구. 구매 전에 항상 보인다(design-298.md API "Probability disclosure"). */
export function rerollDisclosure(grade: ShopGradeView): string {
  return grade.remaining > 0
    ? `남은 ${grade.remaining}종 중 하나를 같은 확률(1/${grade.remaining})로 받아요.`
    : '이 등급의 친구를 모두 모았어요.';
}

export type RerollButtonState = { disabled: boolean; reason?: string };

/** 등급이 완료됐거나 잔액이 모자라면 버튼을 비활성화하고 이유를 보여준다. */
export function rerollButtonState(grade: ShopGradeView, balance: number): RerollButtonState {
  if (grade.remaining <= 0) return { disabled: true, reason: '모두 모았어요' };
  if (balance < grade.price) return { disabled: true, reason: `마일리지 ${formatMileage(grade.price - balance)} 부족` };
  return { disabled: false };
}

/** "방문마다 50P, 처음 가는 가게마다 100P, 가게 시리즈를 완성하면 200P를 받아요." 가중치는 서버가 보낸 값을 그대로 쓴다. */
export function earnRulesText(rules: { visit: number; newStore: number; series: number }): string {
  return `방문마다 ${rules.visit}P, 처음 가는 가게마다 ${rules.newStore}P, 가게 시리즈를 완성하면 ${rules.series}P를 받아요.`;
}

/** 시연 서버가 체험 마일리지를 더해 준 때만 잔액 아래에 붙는 작은 안내(#333). 운영 응답은 보너스가 없어 null이다. */
export function showcaseBonusLabel(bonus: number | undefined): string | null {
  return bonus !== undefined && bonus > 0 ? '시연 체험 마일리지 포함' : null;
}

export type FriendGridCell = { id: string; grade: MileageGrade; name: string; owned: boolean; isAvatar: boolean };

/** 가게 친구 그리드: 가진 친구는 색이, 안 가진 친구는 실루엣 "?"로 표시된다(design-298.md Android). */
export function buildFriendGrid(
  items: readonly { id: string; grade: MileageGrade; name: string; owned: boolean }[],
  avatar: string | null,
): FriendGridCell[] {
  return items.map((item) => ({ ...item, isAvatar: item.id === avatar }));
}

// ponytail: Math.random은 암호화 난수가 아니지만 이 id는 추측 방지가 아니라 한 구매 시도 안에서 재시도를 구분하기만
// 하면 된다(서버가 실제 거부 판단을 한다). 추측 방지가 필요해지면 expo-crypto로 바꾈 자리.
export function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type PendingPurchase = { grade: MileageGrade; requestId: string };

/**
 * 구매 시도 하나 동안 requestId를 유지한다: 같은 등급으로 다시 누르면(네트워크 오류 뒤 재시도) 같은 id를 그대로 써서
 * 서버가 같은 요청으로 재생(REPLAY)하게 한다(design-298.md Design review fixes 3번). 등급이 다르거나 대기 중인
 * 시도가 없으면 새 id를 만든다.
 */
export function resumeOrStartPurchase(
  pending: PendingPurchase | undefined,
  grade: MileageGrade,
  makeId: () => string = createRequestId,
): PendingPurchase {
  return pending && pending.grade === grade ? pending : { grade, requestId: makeId() };
}
