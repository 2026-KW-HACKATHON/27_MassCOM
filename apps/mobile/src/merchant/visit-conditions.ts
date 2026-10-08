import type { MerchantDetail } from '../../../api/src/real-world-contract';
import { businessLabel } from './real-world-labels';

/**
 * Minutes a staff-issued visit code stays valid. Mirrors `ttlMs: 15 * 60 * 1000` in api/src/postgres/claim-slot-service.ts
 * (the only value server.ts uses); visit-conditions.test.ts fails if the server default moves.
 */
export const claimCodeMinutes = 15;

/**
 * SERVER_RULE: the API itself refuses or ignores the visit otherwise. STORE_SETTING: the store's own data, confirmed by a
 * person at the counter; the app shows it but does not enforce it. The list never contains a condition that is neither.
 */
export type VisitCondition = {
  key: 'activeCampaign' | 'staffCheck' | 'oncePerDay' | 'minimumSpend' | 'openHours' | 'codeTtl' | 'demoTest';
  text: string; source: 'SERVER_RULE' | 'STORE_SETTING';
};

/** Short tag shown after a condition so a person knows who checks it. */
export const conditionSourceLabel = (source: VisitCondition['source']): string => source === 'SERVER_RULE' ? '(앱이 확인)' : '(가게에서 확인)';

type ConditionSource = Pick<MerchantDetail, 'minimumSpendWon' | 'business' | 'demo'>;

// api/src/postgres/claim-slot-service.ts redeem(): findActiveCampaign (status ACTIVE and inside its dates) or CLAIM_CAMPAIGN_UNAVAILABLE.
const activeCampaign: VisitCondition = { key: 'activeCampaign', source: 'SERVER_RULE', text: '진행 중인 캠페인이 있어야 방문이 기록돼요.' };

export function visitConditions(merchant: ConditionSource): VisitCondition[] {
  // A 시연 점포 is tried with "테스트 방문 만들기" (issueShowcaseTestSlot): no staff check, and the visit date is moved back past days
  // already counted, so the staff and once-a-day rules above do not hold there.
  if (merchant.demo) {
    return [
      { key: 'demoTest', source: 'SERVER_RULE',
        text: '시연 점포는 방문 인증 화면의 "테스트 방문 만들기"로 체험해요. 직원 확인 없이 방문이 만들어지고, 이미 센 날을 피해 날짜를 옮겨 기록하므로 하루 한 번 제한은 적용되지 않아요.' },
      activeCampaign,
    ];
  }
  const spend = merchant.minimumSpendWon;
  return [
    activeCampaign,
    { key: 'staffCheck', source: 'SERVER_RULE', text: '가게 직원이 이용을 직접 확인한 뒤 1회 방문 코드를 발급해야 인정돼요.' },
    { key: 'oncePerDay', source: 'SERVER_RULE', text: '같은 가게는 하루(한국 시간 기준)에 한 번만 방문으로 인정돼요.' },
    { key: 'minimumSpend', source: 'STORE_SETTING',
      text: spend > 0 ? `가게가 정한 최소 이용 금액은 ${spend.toLocaleString('ko-KR')}원이에요. 앱이 아니라 가게에서 확인해요.` : '가게가 정한 최소 이용 금액은 없어요.' },
    { key: 'openHours', source: 'STORE_SETTING',
      text: `직원이 가게에서 직접 확인하므로 영업 중에 방문해 주세요. 지금은 ${businessLabel(merchant.business)}.` },
    { key: 'codeTtl', source: 'SERVER_RULE', text: `발급된 방문 코드는 ${claimCodeMinutes}분 안에 앱에서 확정해야 해요.` },
  ];
}

type CampaignSource = Pick<NonNullable<MerchantDetail['campaign']>, 'state' | 'enrollment' | 'rewardAvailability'>;

/**
 * What the coin card says about earning a coin now. `blocked`: the server refuses the visit (no campaign running). `caveat`: the
 * public display says something odd (full, no picture yet) that the server does not enforce at redeem, so the text says what the
 * display shows and that the visit confirmation decides. Nothing here claims a rule the server lacks.
 */
export function coinAvailability(campaign: CampaignSource | null): { kind: 'ok' } | { kind: 'blocked' | 'caveat'; reason: string } {
  if (!campaign) return { kind: 'blocked', reason: '진행 중인 캠페인이 없어 방문이 기록되지 않아요. 지금은 새 코인을 받을 수 없어요.' };
  if (campaign.state !== 'ACTIVE') return { kind: 'blocked', reason: '캠페인이 진행 중이 아니라 방문이 기록되지 않아요. 지금은 새 코인을 받을 수 없어요.' };
  if (campaign.enrollment === 'FULL') return { kind: 'caveat', reason: '참여 인원이 표시상 가득 찼지만, 방문이 확인되면 코인을 받을 수 있어요.' };
  if (campaign.enrollment === 'CLOSED') return { kind: 'caveat', reason: '참여 접수가 마감된 것으로 표시돼 있어요. 코인은 방문 확인 결과로 정해져요.' };
  if (campaign.rewardAvailability === 'UNKNOWN') return { kind: 'caveat', reason: '코인 그림이 아직 준비되지 않았어요. 지금 방문하면 보상은 기록되지만, 나중에 그림이 생겨도 이 코인에는 붙지 않아요.' };
  if (campaign.rewardAvailability === 'EXHAUSTED') return { kind: 'caveat', reason: '보상이 소진된 것으로 표시돼 있어요. 실제 지급은 방문 확인 결과로 정해져요.' };
  if (campaign.rewardAvailability === 'NOT_RUNNING') return { kind: 'caveat', reason: '보상이 운영되지 않는 것으로 표시돼 있어요. 실제 지급은 방문 확인 결과로 정해져요.' };
  return { kind: 'ok' };
}
