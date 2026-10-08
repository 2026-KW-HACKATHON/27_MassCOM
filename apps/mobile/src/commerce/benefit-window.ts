// 점주 목적형 캠페인의 시간대 조건 안내 문구(Issue #412, D-092). 방문 인정은 시간대와 무관하다(D1).
// 서버가 시간대를 판정해 보내며, 옛 서버가 필드를 안 보내거나 시간대 조건이 없으면 아무 문구도 보이지 않는다.
// 혜택은 뒤 PR에서 생기므로 지금 문구는 혜택을 말하지 않고 점주가 정한 시간대 조건만 중립적으로 적는다.
import type { IssuedClaim, RedeemedClaim } from './commerce-api';

export const outsideWindowStaffNote = '방문 확인 시점 기준으로 점주가 정한 캠페인 시간대 밖이에요. 방문과 수집품은 그대로 인정돼요.';
export const outsideWindowCustomerNote = '이번 방문은 점주가 정한 캠페인 시간대 밖이었어요. 방문과 수집품은 그대로 인정돼요.';

/** 점원 화면: 방금 발급한 코드가 시간대 밖일 때만. */
export function staffWindowNote(claim: Pick<IssuedClaim, 'windowStatus'> | undefined): string | undefined {
  return claim?.windowStatus === 'OUTSIDE_WINDOW' ? outsideWindowStaffNote : undefined;
}

/** 고객 화면: 진행에 세어진 방문이 시간대 밖이었을 때만. 직원 본인·같은 날 두 번째 방문은 "세지 않습니다" 줄과 어긋나지 않게 아무것도 붙이지 않는다. */
export function customerBenefitNote(
  claim: (Pick<RedeemedClaim, 'benefit'> & { visit: Pick<RedeemedClaim['visit'], 'progressCounted'> }) | undefined,
): string | undefined {
  return claim?.visit.progressCounted === true && claim.benefit?.state === 'OUTSIDE_WINDOW' ? outsideWindowCustomerNote : undefined;
}
