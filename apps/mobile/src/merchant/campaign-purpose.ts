// 점주가 정한 캠페인 목적을 가게 상세에 짧게 보여 주는 글(Issue #412, D-092). 서버가 보내는 purpose는 추가 필드라
// 없거나 모르는 값이면 아무것도 보이지 않는다. 혜택은 약속하지 않고 조건만 적는다(시간대 밖에도 방문은 인정된다).
export type CampaignPurposeBlock = { headline: string; lines: string[] };

const dayNames = '월화수목금토일';
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** ISO 요일(1=월 … 7=일) 목록을 사람이 읽는 말로. 평일·주말·매일은 줄여 쓴다. */
export function dayList(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter(day => Number.isInteger(day) && day >= 1 && day <= 7).sort((a, b) => a - b);
  const key = sorted.join('');
  if (key === '1234567') return '매일';
  if (key === '12345') return '평일';
  if (key === '67') return '주말';
  return sorted.map(day => dayNames[day - 1]).join('·');
}

/** 한 시간대를 "평일 14:00–17:00"처럼. 모양이 틀리면 undefined. */
export function timeWindowLabel(value: unknown): string | undefined {
  if (!isRecord(value) || !Array.isArray(value.days) || value.days.length === 0) return undefined;
  const clock = /^(?:[01]\d|2[0-3]|24):[0-5]\d$/;
  if (!value.days.every(day => Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 7)) return undefined;
  if (typeof value.start !== 'string' || typeof value.end !== 'string' || !clock.test(value.start) || !clock.test(value.end)) return undefined;
  return `${dayList(value.days as number[])} ${value.start}–${value.end}`;
}

export function campaignPurposeBlock(purpose: unknown): CampaignPurposeBlock | undefined {
  if (!isRecord(purpose)) return undefined;
  const menu = isText(purpose.featuredMenuName) ? `대표 메뉴 · ${purpose.featuredMenuName.trim()}` : undefined;
  if (purpose.kind === 'OFF_PEAK') {
    const windows = Array.isArray(purpose.timeWindows) ? purpose.timeWindows.map(timeWindowLabel) : [];
    if (windows.length === 0 || windows.some(label => label === undefined)) return undefined;
    return {
      headline: `이번 캠페인: 한산한 시간대 방문 · ${windows.join(', ')}`,
      lines: ['시간대는 한국 시간 기준이에요. 시간대 밖에 방문해도 방문은 인정돼요.', ...(menu ? [menu] : [])],
    };
  }
  if (purpose.kind === 'REVISIT') {
    const { revisitMinDays: min, revisitWindowDays: window } = purpose;
    const days = Number.isInteger(min) && Number.isInteger(window) && (min as number) < (window as number)
      ? [`처음 방문한 날로부터 ${min}일 뒤부터 ${window}일 안에 다시 방문하면 재방문으로 세요.`] : [];
    return {
      headline: '이번 캠페인: 다시 방문하기',
      lines: [...days, ...(isText(purpose.nextStepText) ? [purpose.nextStepText.trim()] : []), ...(menu ? [menu] : [])],
    };
  }
  if (purpose.kind === 'NEW_CUSTOMERS') {
    return { headline: '이번 캠페인: 처음 방문하는 분께 가게 소개', lines: menu ? [menu] : [] };
  }
  return undefined;
}
