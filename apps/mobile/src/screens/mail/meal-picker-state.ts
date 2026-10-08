import type { MealSchedule } from '@/social/social-api';

const dayMs = 24 * 60 * 60 * 1000;
const kstOffsetMs = 9 * 60 * 60 * 1000;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export type MealPickerOption = { value: string; label: string };

export function mealToday(now = new Date()): string {
  return new Date(now.getTime() + kstOffsetMs).toISOString().slice(0, 10);
}

export function isMealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function mealDateLabel(value: string, today = mealToday()): string {
  if (!isMealDate(value)) return '날짜 선택';
  const date = new Date(`${value}T00:00:00Z`);
  const yearsAhead = date.getUTCFullYear() - Number(today.slice(0, 4));
  const yearLabel = yearsAhead === 1 ? '내년 ' : yearsAhead > 1 ? `${yearsAhead}년 후 ` : '';
  return `${yearLabel}${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 (${['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()]})`;
}

/** Only real calendar days enter the wheel; the API year is retained across New Year. */
export function mealDateOptions(today: string, count = 366): MealPickerOption[] {
  if (!isMealDate(today)) return [];
  const first = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const value = new Date(first + index * dayMs).toISOString().slice(0, 10);
    return { value, label: mealDateLabel(value, today) };
  });
}

export function mealTimeOptions(minTime = '00:00', maxTime = '23:59'): string[] {
  if (!timePattern.test(minTime) || !timePattern.test(maxTime) || minTime > maxTime) return [];
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  return Array.from({ length: minutes(maxTime) - minutes(minTime) + 1 }, (_, index) => {
    const value = minutes(minTime) + index;
    return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  });
}

export function mealScheduleError(date: string, schedule: MealSchedule, now = new Date()): string | undefined {
  if (!isMealDate(date)) return '식사 날짜를 선택해 주세요.';
  if (date < mealToday(now)) return '지난 날짜예요. 식사 날짜를 다시 선택해 주세요.';
  const firstTime = schedule.kind === 'CONFIRMED' ? schedule.time : schedule.startTime;
  if (!timePattern.test(firstTime) || (schedule.kind === 'RANGE' && !timePattern.test(schedule.endTime))) {
    return '식사 시간을 선택해 주세요.';
  }
  if (schedule.kind === 'RANGE' && schedule.startTime >= schedule.endTime) return '끝 시간을 시작 시간보다 늦게 선택해 주세요.';
  if (Date.parse(`${date}T${firstTime}:00+09:00`) <= now.getTime()) return '이미 지난 시간이에요. 이후 시간을 선택해 주세요.';
  return undefined;
}

export function mealResponseTimeError(date: string, selectedTime: string, startTime: string, endTime: string, now = new Date()): string | undefined {
  if (!timePattern.test(selectedTime) || selectedTime < startTime || selectedTime > endTime) {
    return '제안된 범위 안에서 시간을 선택해 주세요.';
  }
  return mealScheduleError(date, { kind: 'CONFIRMED', time: selectedTime }, now);
}
