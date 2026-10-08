// 점주 목적형 캠페인 규칙(Issue #412, D-092). DB 없이 시험할 수 있는 순수 함수만 둔다.
// 시간대는 모두 한국 시간(KST, 서머타임 없음)이고 시작은 포함·끝은 제외이며 자정을 넘기는 시간대는 없다.
import type { CampaignPurposeSummary } from './real-world-contract.js';
import { looksLikePersonalData } from './reversal-rules.js';

export const campaignPurposes = ['NEW_CUSTOMERS', 'REVISIT', 'OFF_PEAK'] as const;
export type CampaignPurpose = (typeof campaignPurposes)[number];

// days는 ISO 요일(1=월 … 7=일), start·end는 "HH:MM". end는 24:00까지 쓸 수 있다(그날 끝까지).
export type TimeWindow = { days: number[]; start: string; end: string };

export const maxTimeWindows = 3;
export const featuredMenuNameMaxLength = 40;
export const nextStepTextMaxLength = 80;
export const revisitMinDaysRange = { min: 1, max: 30, default: 1 } as const;
export const revisitWindowDaysRange = { min: 2, max: 60, default: 14 } as const;

// 관리자 초안 입력의 purpose 객체. 목적에 맞는 칸만 채우고 나머지는 비우거나 null로 둔다.
export type CampaignPurposeInput = {
  purpose: CampaignPurpose;
  featuredMenuName?: string | null;
  revisitMinDays?: number | null;
  revisitWindowDays?: number | null;
  nextStepText?: string | null;
  timeWindows?: TimeWindow[] | null;
};

// 저장·내보내기용 목적 설정(DB 행과 같은 모양). 쓰지 않는 칸은 null이다.
export type CampaignPurposeSettings = {
  purpose: CampaignPurpose;
  featuredMenuName: string | null;
  revisitMinDays: number;
  revisitWindowDays: number;
  nextStepText: string | null;
  timeWindows: TimeWindow[] | null;
};

export type CampaignPurposeProblem =
  | 'PURPOSE_UNKNOWN' | 'FIELD_NOT_ALLOWED' | 'WINDOWS_REQUIRED' | 'WINDOWS_INVALID'
  | 'TEXT_INVALID' | 'REVISIT_DAYS_INVALID' | 'MENU_UNKNOWN';

export type CampaignPurposeResult =
  | { ok: true; value: CampaignPurposeSettings }
  | { ok: false; problem: CampaignPurposeProblem };

export type WindowStatus = 'IN_WINDOW' | 'OUTSIDE_WINDOW' | 'NONE';
export type BenefitState = 'ELIGIBLE' | 'OUTSIDE_WINDOW' | 'NONE';

const startClockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const kstOffsetMs = 9 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;
const minuteMs = 60 * 1000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// "HH:MM"을 자정부터의 분으로 바꾼다. 형식이 틀리면 undefined. 끝 시각에만 "24:00"을 허용한다.
export function parseClockMinutes(value: unknown, allowEndOfDay = false): number | undefined {
  if (typeof value !== 'string') return undefined;
  if (allowEndOfDay && value === '24:00') return 24 * 60;
  if (!startClockPattern.test(value)) return undefined;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
}

// 시간대 1~3개를 검사하고 요일을 오름차순으로 정리해 돌려준다. 하나라도 틀리면 undefined(일부만 받지 않는다).
export function normalizeTimeWindows(raw: unknown): TimeWindow[] | undefined {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > maxTimeWindows) return undefined;
  const windows: TimeWindow[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) return undefined;
    const keys = Object.keys(entry);
    if (keys.length !== 3 || !keys.every(key => key === 'days' || key === 'start' || key === 'end')) return undefined;
    const { days, start, end } = entry;
    if (!Array.isArray(days) || days.length < 1 || days.length > 7) return undefined;
    if (!days.every(day => Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 7)) return undefined;
    if (new Set(days).size !== days.length) return undefined;
    const startMinutes = parseClockMinutes(start);
    const endMinutes = parseClockMinutes(end, true);
    if (startMinutes === undefined || endMinutes === undefined || endMinutes <= startMinutes) return undefined;
    windows.push({ days: [...(days as number[])].sort((a, b) => a - b), start: start as string, end: end as string });
  }
  return windows;
}

// 한국 시간 요일(ISO 1~7)과 자정부터의 밀리초. Date.UTC 기준 1970-01-01은 목요일이다.
export function kstClock(instant: Date): { isoWeekday: number; msOfDay: number } | undefined {
  const ms = instant.getTime();
  if (!Number.isFinite(ms)) return undefined;
  const shifted = ms + kstOffsetMs;
  const dayIndex = Math.floor(shifted / dayMs);
  return { isoWeekday: (((dayIndex + 3) % 7) + 7) % 7 + 1, msOfDay: shifted - dayIndex * dayMs };
}

// 시간대 안인지. 시작 시각은 포함, 끝 시각은 제외한다. 날짜·요일은 모두 한국 시간으로 본다.
export function isWithinWindows(instant: Date, windows: readonly TimeWindow[]): boolean {
  const clock = kstClock(instant);
  if (!clock) return false;
  return windows.some(window => window.days.includes(clock.isoWeekday) &&
    clock.msOfDay >= parseClockMinutes(window.start)! * minuteMs &&
    clock.msOfDay < parseClockMinutes(window.end, true)! * minuteMs);
}

// 시간대 조건이 없으면 NONE(옛 캠페인·신규/재방문 목적). 조건이 있으면 그 순간이 안인지 밖인지.
export function windowStatusAt(instant: Date, windows: readonly TimeWindow[] | null | undefined): WindowStatus {
  if (!windows || windows.length === 0) return 'NONE';
  return isWithinWindows(instant, windows) ? 'IN_WINDOW' : 'OUTSIDE_WINDOW';
}

// 혜택 상태는 시간대 조건만 본다. 신규·재방문 조건의 판정은 혜택 발급 단계(PR 2)가 따로 한다.
export function benefitStateFor(status: WindowStatus): BenefitState {
  return status === 'IN_WINDOW' ? 'ELIGIBLE' : status;
}

// 고객·점원에게 그대로 보이는 짧은 글이라 제어·서식 문자와 연락처·웹 주소·긴 숫자열을 거절한다.
function cleanText(raw: unknown, maxLength: number): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.normalize('NFC').trim();
  const length = Array.from(text).length;
  if (length < 1 || length > maxLength) return undefined;
  if (/[\p{Cc}\p{Cf}]/u.test(text) || looksLikePersonalData(text)) return undefined;
  return text;
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

const optionalFields = ['featuredMenuName', 'revisitMinDays', 'revisitWindowDays', 'nextStepText', 'timeWindows'];
const allowedFields: Record<CampaignPurpose, readonly string[]> = {
  NEW_CUSTOMERS: ['purpose', 'featuredMenuName'],
  REVISIT: ['purpose', 'featuredMenuName', 'revisitMinDays', 'revisitWindowDays', 'nextStepText'],
  OFF_PEAK: ['purpose', 'featuredMenuName', 'timeWindows'],
};

// 관리자 초안 입력의 purpose 객체를 검사한다. 목적에 맞지 않는 칸이 오면 조용히 버리지 않고 거절한다.
// menuNames가 비어 있지 않으면 대표 메뉴는 그 가게 메뉴 이름 중 하나여야 한다(메뉴 정보가 없는 가게는 이름만 검사한다).
export function normalizeCampaignPurpose(raw: unknown, menuNames: readonly string[] = []): CampaignPurposeResult {
  if (!isPlainObject(raw)) return { ok: false, problem: 'PURPOSE_UNKNOWN' };
  const purpose = campaignPurposes.find(candidate => candidate === raw.purpose);
  if (!purpose) return { ok: false, problem: 'PURPOSE_UNKNOWN' };
  for (const [key, value] of Object.entries(raw)) {
    if (allowedFields[purpose].includes(key)) continue;
    // 다른 목적의 칸이 null·undefined로 비어 오는 것(양식이 모든 칸을 보내는 경우)은 받는다. 값이 있으면 거절한다.
    if (optionalFields.includes(key) && isAbsent(value)) continue;
    return { ok: false, problem: 'FIELD_NOT_ALLOWED' };
  }

  let featuredMenuName: string | null = null;
  if (!isAbsent(raw.featuredMenuName)) {
    const name = cleanText(raw.featuredMenuName, featuredMenuNameMaxLength);
    if (name === undefined) return { ok: false, problem: 'TEXT_INVALID' };
    if (menuNames.length > 0 && !menuNames.some(menu => menu.normalize('NFC').trim() === name)) {
      return { ok: false, problem: 'MENU_UNKNOWN' };
    }
    featuredMenuName = name;
  }

  let revisitMinDays: number = revisitMinDaysRange.default;
  let revisitWindowDays: number = revisitWindowDaysRange.default;
  let nextStepText: string | null = null;
  if (purpose === 'REVISIT') {
    if (!isAbsent(raw.revisitMinDays)) {
      if (!Number.isInteger(raw.revisitMinDays) || (raw.revisitMinDays as number) < revisitMinDaysRange.min ||
          (raw.revisitMinDays as number) > revisitMinDaysRange.max) return { ok: false, problem: 'REVISIT_DAYS_INVALID' };
      revisitMinDays = raw.revisitMinDays as number;
    }
    if (!isAbsent(raw.revisitWindowDays)) {
      if (!Number.isInteger(raw.revisitWindowDays) || (raw.revisitWindowDays as number) < revisitWindowDaysRange.min ||
          (raw.revisitWindowDays as number) > revisitWindowDaysRange.max) return { ok: false, problem: 'REVISIT_DAYS_INVALID' };
      revisitWindowDays = raw.revisitWindowDays as number;
    }
    if (revisitMinDays >= revisitWindowDays) return { ok: false, problem: 'REVISIT_DAYS_INVALID' };
    if (!isAbsent(raw.nextStepText)) {
      const text = cleanText(raw.nextStepText, nextStepTextMaxLength);
      if (text === undefined) return { ok: false, problem: 'TEXT_INVALID' };
      nextStepText = text;
    }
  }

  let timeWindows: TimeWindow[] | null = null;
  if (purpose === 'OFF_PEAK') {
    if (isAbsent(raw.timeWindows)) return { ok: false, problem: 'WINDOWS_REQUIRED' };
    const windows = normalizeTimeWindows(raw.timeWindows);
    if (!windows) return { ok: false, problem: 'WINDOWS_INVALID' };
    timeWindows = windows;
  }

  return { ok: true, value: { purpose, featuredMenuName, revisitMinDays, revisitWindowDays, nextStepText, timeWindows } };
}

// 응답에 싣는 요약. 목적에 맞는 칸만 담고 비어 있는 칸은 아예 두지 않는다(DB 조회 결과 purposeSummarySql과 같은 모양).
export function purposeSummaryFromSettings(settings: CampaignPurposeSettings): CampaignPurposeSummary {
  const summary: CampaignPurposeSummary = { kind: settings.purpose };
  if (settings.featuredMenuName !== null) summary.featuredMenuName = settings.featuredMenuName;
  if (settings.purpose === 'REVISIT') {
    summary.revisitMinDays = settings.revisitMinDays;
    summary.revisitWindowDays = settings.revisitWindowDays;
    if (settings.nextStepText !== null) summary.nextStepText = settings.nextStepText;
  }
  if (settings.timeWindows !== null) summary.timeWindows = settings.timeWindows;
  return summary;
}
