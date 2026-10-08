const count = value => Number.isSafeInteger(value) && value >= 0;
const won = value => /^(?:0|[1-9]\d*)$/.test(String(value)) ? `${BigInt(value).toLocaleString('ko-KR')}원` : null;

export function benefitStatusText(benefit) {
  if (benefit === null) return '등록된 캠페인 혜택이 없습니다.';
  if (!benefit || !['ACTIVE', 'PAUSED'].includes(benefit.status)
    || ![benefit.issued, benefit.redeemed, benefit.usable, benefit.expiredUnused, benefit.additionalIssuable,
      benefit.maxUses, benefit.issuedCount].every(count)) return '혜택 현황을 확인하지 못했습니다.';
  const costs = [benefit.unitExtraCostWon, benefit.costBorne, benefit.maxExposure, benefit.promisedMaxCost].map(won);
  if (costs.some(value => value === null)) return '혜택 현황을 확인하지 못했습니다.';
  return `${benefit.title} · ${benefit.status === 'ACTIVE' ? '발급 중' : '발급 중지'} · 발급 ${benefit.issued}장 · 사용 ${benefit.redeemed}장 · 사용 가능 ${benefit.usable}장 · 만료 미사용 ${benefit.expiredUnused}장 · 추가 발급 가능 ${benefit.additionalIssuable}장 · 1장당 추가 원가 ${costs[0]} · 부담한 추가 원가 ${costs[1]} · 이미 약속한 최대 비용 ${costs[3]} · 최대 추가 원가 ${costs[2]}. 추가 원가 기준이며 매출·이익이 아닙니다.`;
}

export function benefitStatusRecords(response) {
  if (Array.isArray(response?.benefits)) return response.benefits;
  return response?.benefit ? [response.benefit] : [];
}

export function campaignBenefitsStatusText(response) {
  const benefits = benefitStatusRecords(response);
  return benefits.length ? benefits.map(benefitStatusText).join(' / ') : benefitStatusText(null);
}
