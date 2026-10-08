// 점주 목적형 캠페인의 시간대 조건 안내 문구(Issue #412, D-092). 방문 인정은 시간대와 무관하고(D1) 혜택만 시간대를 따른다.
// 서버가 시간대를 판정해 보내며, 옛 서버가 필드를 안 보내거나 시간대 조건이 없으면 아무 문구도 보이지 않는다.
import type { IssuedClaim, RedeemedClaim } from './commerce-api';

export const outsideWindowStaffNote = '지금은 혜택 시간대가 아니에요(방문은 인정돼요)';
export const outsideWindowCustomerNote = '이번 방문은 혜택 시간대가 아니었어요. 방문과 수집품은 그대로 인정돼요.';

/** 점원 화면: 방금 발급한 코드가 시간대 밖일 때만. */
export function staffWindowNote(claim: Pick<IssuedClaim, 'windowStatus'> | undefined): string | undefined {
  return claim?.windowStatus === 'OUTSIDE_WINDOW' ? outsideWindowStaffNote : undefined;
}

/** 고객 화면: 방문을 확정했는데 혜택 시간대가 아니었을 때만. */
export function customerBenefitNote(claim: Pick<RedeemedClaim, 'benefit'> | undefined): string | undefined {
  return claim?.benefit?.state === 'OUTSIDE_WINDOW' ? outsideWindowCustomerNote : undefined;
}
