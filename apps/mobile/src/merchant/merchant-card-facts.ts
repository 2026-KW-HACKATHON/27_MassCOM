import type { MerchantDetail, MerchantSummary } from '../../../api/src/real-world-contract';
import { businessLabel, campaignLabel, enrollmentLabel, rewardLabel } from './real-world-labels';

/**
 * What a store card or detail page says about a store, split by how much a missing answer matters to a visit.
 * core: facts we have, in reading order. critical: facts that decide whether the trip is worth making, so they stay
 * visible even when unknown (warning tone). missing: everything else we don't have yet; a screen groups these into
 * one notice instead of repeating "미확인" on every line.
 */
export type CardFact = { key: 'floor' | 'entrance' | 'distance'; label: string; value: string };
/** `label`/`value` fill a two-column row on the detail page; `text` is the same fact as one phrase for a card line. */
export type CriticalFact = {
  key: 'business' | 'lastOrder' | 'reward' | 'minimumSpend'; label: string; value: string; text: string;
  tone: 'normal' | 'warning'; known: boolean;
};
export type MissingFact = { key: 'position' | 'entrance' | 'floor' | 'photo' | 'schedule'; label: string };
export type MerchantFacts = { core: CardFact[]; critical: CriticalFact[]; missing: MissingFact[] };

/** A list card has the summary only; the detail page adds the fields marked optional. */
export type FactsSource = Pick<MerchantSummary, 'position' | 'floor' | 'entranceNote' | 'thumbnail' | 'business' | 'campaign' | 'distance'>
  & Partial<Pick<MerchantDetail, 'minimumSpendWon' | 'todayOverride' | 'schedule' | 'location' | 'photos'>>;

const originLabel = { CURRENT_LOCATION: '현재 위치', MANUAL: '선택한 출발지', MAP_CENTER: '지도 중심' } as const;
/** A known last order this close to the evaluation time is worth a warning. */
const lastOrderSoonMs = 30 * 60_000;
const kstClock = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(11, 16);

export function merchantCardFacts(merchant: FactsSource): MerchantFacts {
  const { business, campaign } = merchant;
  const unit = merchant.location?.unit;
  const entranceKnown = !!merchant.entranceNote || !!merchant.location?.entrance
    || merchant.thumbnail?.kind === 'ENTRANCE' || !!merchant.photos?.some((photo) => photo.kind === 'ENTRANCE');

  const core: CardFact[] = [
    ...(merchant.floor ? [{ key: 'floor' as const, label: '층·호수', value: unit ? `${merchant.floor} · ${unit}` : merchant.floor }] : []),
    ...(merchant.entranceNote ? [{ key: 'entrance' as const, label: '입구', value: merchant.entranceNote }] : []),
    ...(merchant.distance ? [{ key: 'distance' as const, label: '거리',
      value: `${Math.round(merchant.distance.meters)}m 직선거리 · ${originLabel[merchant.distance.origin]}` }] : []),
  ];

  const critical: CriticalFact[] = [{
    key: 'business', label: '영업', value: businessLabel(business), text: businessLabel(business), known: business.state !== 'UNKNOWN',
    tone: business.state === 'OPEN' && business.acceptingOrders !== false ? 'normal' : 'warning',
  }];
  const override = merchant.todayOverride;
  if (override) {
    const value = `${override.state === 'OPEN' ? '임시 영업' : '임시 휴업'} · ${override.note}`;
    critical.push({ key: 'lastOrder', label: '임시 안내', value, text: value, known: true, tone: override.state === 'OPEN' ? 'normal' : 'warning' });
  } else if (business.lastOrderAt) {
    const clock = kstClock(business.lastOrderAt);
    const past = business.acceptingOrders === false;
    // Warn only when ordering has already stopped or is about to; judged against the server's own evaluation time, not this device's clock.
    const untilLastOrder = Date.parse(business.lastOrderAt) - Date.parse(business.evaluatedAt);
    const soon = !past && untilLastOrder > 0 && untilLastOrder <= lastOrderSoonMs;
    const value = past ? `주문 마감 (마지막 주문 ${clock})` : soon ? `${clock} (곧 마감)` : clock;
    critical.push({ key: 'lastOrder', label: '마지막 주문', value, text: past ? value : `마지막 주문 ${value}`, known: true, tone: past || soon ? 'warning' : 'normal' });
  } else if (business.state === 'OPEN' || business.state === 'BREAK') {
    // No last-order time on file is the usual case (many stores take orders until closing), so it is a plain note, not a warning.
    critical.push({ key: 'lastOrder', label: '마지막 주문', value: '정보 없음', text: '마지막 주문 정보 없음', known: false, tone: 'normal' });
  }
  if (campaign) {
    const value = `${campaignLabel(campaign.state)} 캠페인 · ${enrollmentLabel(campaign.enrollment)} · ${rewardLabel(campaign.rewardAvailability)}`;
    critical.push({ key: 'reward', label: '보상', value, text: value, known: campaign.rewardAvailability !== 'UNKNOWN',
      tone: campaign.state === 'ACTIVE' && campaign.enrollment === 'OPEN' && campaign.rewardAvailability === 'AVAILABLE' ? 'normal' : 'warning' });
  } else critical.push({ key: 'reward', label: '보상', value: '진행 중인 캠페인 없음', text: '진행 중인 캠페인 없음', known: true, tone: 'warning' });
  if (merchant.minimumSpendWon !== undefined) {
    const value = merchant.minimumSpendWon > 0 ? `${merchant.minimumSpendWon.toLocaleString('ko-KR')}원` : '정해진 금액 없음';
    critical.push({ key: 'minimumSpend', label: '최소 이용', value, text: `최소 이용 ${value}`, known: true, tone: 'normal' });
  }

  const missing: MissingFact[] = [
    ...(merchant.position ? [] : [{ key: 'position' as const, label: '위치' }]),
    ...(entranceKnown ? [] : [{ key: 'entrance' as const, label: '입구' }]),
    ...(merchant.floor ? [] : [{ key: 'floor' as const, label: '층·호수' }]),
    ...(merchant.thumbnail || merchant.photos?.length ? [] : [{ key: 'photo' as const, label: '사진' }]),
    // Only the detail payload carries the schedule; `undefined` means "not asked", `null` means "owner has not entered one".
    ...(merchant.schedule === null ? [{ key: 'schedule' as const, label: '요일별 영업시간' }] : []),
  ];
  return { core, critical, missing };
}

/** One notice for a whole list: it never repeats per card. Driven by the server's unlocatedCount for the searched area. */
export function unlocatedNotice(unlocatedCount: number): string | null {
  return unlocatedCount > 0
    ? `일부 가게는 위치·입구 정보가 아직 없어요. ${unlocatedCount}곳은 지도에 표시되지 않으니 목록에서 주소를 확인해 주세요.`
    : null;
}

/** The detail page's single "정보가 더 필요한 항목" block; null when nothing is missing. */
export function missingFactsNotice(missing: readonly MissingFact[]): string | null {
  if (!missing.length) return null;
  const position = missing.some((fact) => fact.key === 'position');
  return `아직 확인되지 않았어요: ${missing.map((fact) => fact.label).join(', ')}.${position ? ' 위치가 확인되지 않아 지도에는 표시하지 않아요.' : ''}`;
}
