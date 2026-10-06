import type { BusinessSchedule, BusinessOverride, BusinessState, OpeningPeriod } from './real-world-contract.js';
import { RealWorldError } from './real-world-contract.js';

const KST = 9 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;
const localDate = (time: Date) => new Date(time.getTime() + KST);
const dateKey = (time: Date) => localDate(time).toISOString().slice(0, 10);
const midnightUtc = (key: string) => Date.parse(`${key}T00:00:00.000Z`) - KST;
const isoWeekday = (key: string) => ((new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function periods(value: unknown): OpeningPeriod[] {
  if (!Array.isArray(value) || value.length > 12) throw new RealWorldError('SCHEDULE_INVALID');
  const sorted = value.map((p: unknown) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new RealWorldError('SCHEDULE_INVALID');
    const raw = p as Record<string, unknown>;
    const start = raw.startMinute, end = raw.endMinute, last = raw.lastOrderMinute;
    if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 0 || (start as number) >= 1440 ||
        (end as number) <= (start as number) || (end as number) > 2880 ||
        (end as number) - (start as number) > 1440 ||
        !(last === null || Number.isInteger(last) && (last as number) >= (start as number) && (last as number) <= (end as number))) {
      throw new RealWorldError('SCHEDULE_INVALID');
    }
    return { startMinute: start as number, endMinute: end as number, lastOrderMinute: last as number | null };
  }).sort((a, b) => a.startMinute - b.startMinute);
  if (sorted.some((p, i) => i > 0 && p.startMinute < sorted[i - 1]!.endMinute)) throw new RealWorldError('SCHEDULE_INVALID');
  return sorted;
}

export function validateSchedule(value: unknown): BusinessSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RealWorldError('SCHEDULE_INVALID');
  const raw = value as Record<string, unknown>;
  if (raw.timezone !== 'Asia/Seoul' || !Array.isArray(raw.weekly) || raw.weekly.length !== 7 ||
      !Array.isArray(raw.exceptions) || raw.exceptions.length > 366 ||
      !(raw.verifiedAt === null || typeof raw.verifiedAt === 'string' && Number.isFinite(Date.parse(raw.verifiedAt)))) {
    throw new RealWorldError('SCHEDULE_INVALID');
  }
  const weekly = raw.weekly.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new RealWorldError('SCHEDULE_INVALID');
    const day = entry as Record<string, unknown>;
    if (!Number.isInteger(day.weekday) || (day.weekday as number) < 1 || (day.weekday as number) > 7) throw new RealWorldError('SCHEDULE_INVALID');
    return { weekday: day.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7, periods: periods(day.periods) };
  });
  if (new Set(weekly.map(day => day.weekday)).size !== 7) throw new RealWorldError('SCHEDULE_INVALID');
  for (const day of weekly) {
    const next = weekly.find(item => item.weekday === (day.weekday === 7 ? 1 : day.weekday + 1));
    const last = day.periods.at(-1);
    if (last && next?.periods[0] && last.endMinute > 1440 + next.periods[0].startMinute) {
      throw new RealWorldError('SCHEDULE_INVALID');
    }
  }
  const exceptions = raw.exceptions.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new RealWorldError('SCHEDULE_INVALID');
    const exception = entry as Record<string, unknown>;
    if (!validDate(exception.date) || !(exception.note === null || typeof exception.note === 'string' && exception.note.length <= 300)) {
      throw new RealWorldError('SCHEDULE_INVALID');
    }
    return { date: exception.date, periods: periods(exception.periods), note: exception.note as string | null };
  });
  if (new Set(exceptions.map(day => day.date)).size !== exceptions.length) throw new RealWorldError('SCHEDULE_INVALID');
  return { timezone: 'Asia/Seoul', weekly, exceptions, verifiedAt: raw.verifiedAt as string | null };
}

function stateAt(schedule: BusinessSchedule, time: Date): { state: 'OPEN' | 'CLOSED' | 'BREAK'; lastOrderAt: string | null; acceptingOrders: boolean } {
  const today = dateKey(time), previous = dateKey(new Date(midnightUtc(today) - 1));
  const todayOverride = schedule.exceptions.find(item => item.date === today);
  const sources = [previous, today].map(key => ({
    key, periods: schedule.exceptions.find(item => item.date === key)?.periods ??
      schedule.weekly.find(item => item.weekday === isoWeekday(key))!.periods,
  }));
  const todayStart = midnightUtc(today);
  const spans = sources.flatMap(({ key, periods }) => periods
    .filter(period => key === today || period.endMinute > 1440 && !todayOverride)
    .map(period => ({
      start: midnightUtc(key) + period.startMinute * 60_000,
      end: midnightUtc(key) + period.endMinute * 60_000,
      last: period.lastOrderMinute === null ? null : midnightUtc(key) + period.lastOrderMinute * 60_000,
    })));
  const active = spans.find(span => time.getTime() >= span.start && time.getTime() < span.end);
  if (active) return { state: 'OPEN', lastOrderAt: active.last === null ? null : new Date(active.last).toISOString(),
    acceptingOrders: active.last === null || time.getTime() < active.last };
  const todaySpans = spans.filter(span => span.start >= todayStart && span.start < todayStart + dayMs);
  const minute = (time.getTime() - todayStart) / 60_000;
  const isBreak = todaySpans.some(span => (span.end - todayStart) / 60_000 <= minute) &&
    todaySpans.some(span => (span.start - todayStart) / 60_000 > minute);
  return { state: isBreak ? 'BREAK' : 'CLOSED', lastOrderAt: null, acceptingOrders: false };
}

function stateWithoutNext(schedule: BusinessSchedule | null, at: Date,
  override: BusinessOverride | null): BusinessState {
  const evaluatedAt = at.toISOString();
  const activeOverride = override && Date.parse(override.startsAt) <= at.getTime() && at.getTime() < Date.parse(override.expiresAt);
  if (activeOverride) return { state: override.state, basis: 'OWNER_OVERRIDE', evaluatedAt,
    nextChangeAt: null, informationUpdatedAt: override.startsAt,
    acceptingOrders: override.state === 'OPEN' ? null : false, lastOrderAt: null };
  if (!schedule) return { state: 'UNKNOWN', basis: 'UNKNOWN', evaluatedAt, nextChangeAt: null,
    informationUpdatedAt: null, acceptingOrders: null, lastOrderAt: null };
  const current = stateAt(schedule, at);
  return { ...current, basis: 'SCHEDULE', evaluatedAt, nextChangeAt: null,
    informationUpdatedAt: schedule.verifiedAt };
}

export function businessStateAt(schedule: BusinessSchedule | null, at: Date,
  override: BusinessOverride | null = null): BusinessState {
  const current = stateWithoutNext(schedule, at, override);
  const today = dateKey(at);
  const days = [-1, 0, 1, 2].map(offset => dateKey(new Date(midnightUtc(today) + offset * dayMs)));
  const boundaries = [
    ...(schedule ? days.flatMap(key => {
      const day = schedule.exceptions.find(item => item.date === key)?.periods ??
        schedule.weekly.find(item => item.weekday === isoWeekday(key))!.periods;
      return [midnightUtc(key), ...day.flatMap(p => [p.startMinute, p.endMinute, p.lastOrderMinute]
        .filter((n): n is number => n !== null).map(n => midnightUtc(key) + n * 60_000))];
    }) : []),
    ...(override ? [Date.parse(override.startsAt), Date.parse(override.expiresAt)] : []),
  ].filter(time => time > at.getTime()).sort((a, b) => a - b);
  const next = boundaries.find(time => {
    const state = stateWithoutNext(schedule, new Date(time), override);
    return state.state !== current.state || state.basis !== current.basis ||
      state.acceptingOrders !== current.acceptingOrders || state.lastOrderAt !== current.lastOrderAt;
  });
  return { ...current, nextChangeAt: next ? new Date(next).toISOString() : null };
}
