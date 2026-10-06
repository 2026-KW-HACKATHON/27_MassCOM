import type { BusinessState, CampaignSummary, OpeningPeriod, PhotoKind, WalkingRoute } from '../../../api/src/real-world-contract';

export function businessLabel(business: Pick<BusinessState,'state'|'basis'> & Partial<Pick<BusinessState,'acceptingOrders'>>): string {
  const state = {OPEN:'영업 중',CLOSED:'영업 종료',BREAK:'휴게 중',UNKNOWN:'영업 상태 미확인'}[business.state];
  const orderState=business.state==='OPEN'&&business.acceptingOrders===false?`${state} · 주문 마감`:state;
  return business.basis === 'UNKNOWN' ? orderState : `${orderState} · ${business.basis === 'SCHEDULE' ? '시간표 기준' : '점주 임시 안내'}`;
}
export const campaignLabel = (state: CampaignSummary['state']) => ({ACTIVE:'진행 중',PAUSED:'일시 중지',SCHEDULED:'시작 전',ENDED:'종료'})[state];
export const enrollmentLabel = (state: CampaignSummary['enrollment']) => ({OPEN:'참여 가능',FULL:'참여 정원 도달',CLOSED:'참여 마감'})[state];
export const rewardLabel = (state: CampaignSummary['rewardAvailability']) => ({AVAILABLE:'보상 가능',EXHAUSTED:'보상 소진',NOT_RUNNING:'보상 운영 안 함',UNKNOWN:'보상 상태 미확인'})[state];
export const photoKindLabel = (kind: PhotoKind) => ({STORE:'가게',MENU:'메뉴',ENTRANCE:'입구',PACKAGING:'포장',SIGN:'간판'})[kind];
export const routeWarningLabel = (warning: WalkingRoute['stops'][number]['warnings'][number] | 'ORDER_CLOSED') => ({HOURS_UNKNOWN:'도착 시 영업시간 미확인',CLOSED_AT_ARRIVAL:'도착 예상 시 영업 종료',CAMPAIGN_UNAVAILABLE:'도착 예상 시 캠페인 이용 불가',ORDER_CLOSED:'도착 예상 시 주문 마감'})[warning];

const minuteLabel=(minute:number)=>`${String(Math.floor(minute/60)%24).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}${minute>=1440?' 다음날':''}`;
export function openingPeriodLabel(period:OpeningPeriod):string {
  return `${minuteLabel(period.startMinute)}–${minuteLabel(period.endMinute)}${period.lastOrderMinute===null?'':` · 마지막 주문 ${minuteLabel(period.lastOrderMinute)}`}`;
}
