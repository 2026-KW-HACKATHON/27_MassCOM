import type { CreateMealInvitationInput } from './social.js';

export const friendshipGiftDailySendLimit = 5;
export const friendshipGiftRewardDailyCap = 25;
export const friendshipGiftRewardAmount = 5;
export const maxMessageBodyLength = 500;
export const mailPageSize = 20;
export const requestIdMaxLength = 128;

const kstOffsetMs = 9 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const hhmmPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const invisibleOnly = /^[\s\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800]*$/u;

export type ParsedMealInvitation = {
  merchantId: string;
  date: string;
  schedule:
    | { kind: 'CONFIRMED'; time: string }
    | { kind: 'RANGE'; startTime: string; endTime: string };
};

export type MealResponseDecision =
  | { kind: 'ACCEPT'; selectedTime: string }
  | { kind: 'DECLINE'; selectedTime: null };

export function kstBusinessDate(now: Date): string {
  const kstDay = Math.floor((now.getTime() + kstOffsetMs) / dayMs);
  return new Date(kstDay * dayMs).toISOString().slice(0, 10);
}

export function validateRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const requestId = value.trim();
  if (requestId.length < 1 || requestId.length > requestIdMaxLength) return null;
  return requestId;
}

export function parseMessageBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  if (body.length < 1 || invisibleOnly.test(body)) return null;
  if (Array.from(body).length > maxMessageBodyLength) return null;
  return body;
}

export function isHHmm(value: string): boolean {
  return hhmmPattern.test(value);
}

export function compareHHmm(left: string, right: string): number {
  return minutesOf(left) - minutesOf(right);
}

export function computeReward(earnedToday: number): number {
  if (!Number.isSafeInteger(earnedToday) || earnedToday < 0) return 0;
  return Math.min(friendshipGiftRewardAmount, Math.max(0, friendshipGiftRewardDailyCap - earnedToday));
}

export function parseMealInvitation(input: CreateMealInvitationInput, now: Date): ParsedMealInvitation | null {
  if (typeof input.merchantId !== 'string' || input.merchantId.trim().length < 1) return null;
  if (typeof input.date !== 'string' || !datePattern.test(input.date)) return null;
  const date = new Date(`${input.date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date) return null;
  if (input.date < kstBusinessDate(now)) return null;
  if (input.kind === 'CONFIRMED') {
    if (typeof input.time !== 'string' || !isHHmm(input.time)) return null;
    if (input.startTime !== undefined || input.endTime !== undefined) return null;
    return { merchantId: input.merchantId.trim(), date: input.date, schedule: { kind: 'CONFIRMED', time: input.time } };
  }
  if (input.kind === 'RANGE') {
    if (input.time !== undefined) return null;
    if (typeof input.startTime !== 'string' || typeof input.endTime !== 'string') return null;
    if (!isHHmm(input.startTime) || !isHHmm(input.endTime)) return null;
    if (compareHHmm(input.startTime, input.endTime) >= 0) return null;
    return {
      merchantId: input.merchantId.trim(),
      date: input.date,
      schedule: { kind: 'RANGE', startTime: input.startTime, endTime: input.endTime },
    };
  }
  return null;
}

export function parseMealResponse(input: {
  decision: 'ACCEPT' | 'DECLINE';
  selectedTime?: string;
}, invitation: ParsedMealInvitation): MealResponseDecision | null {
  if (input.decision === 'DECLINE') return { kind: 'DECLINE', selectedTime: null };
  if (input.decision !== 'ACCEPT') return null;
  if (invitation.schedule.kind === 'CONFIRMED') {
    if (input.selectedTime !== undefined && input.selectedTime !== invitation.schedule.time) return null;
    return { kind: 'ACCEPT', selectedTime: invitation.schedule.time };
  }
  if (typeof input.selectedTime !== 'string' || !isHHmm(input.selectedTime)) return null;
  if (compareHHmm(input.selectedTime, invitation.schedule.startTime) < 0) return null;
  if (compareHHmm(input.selectedTime, invitation.schedule.endTime) > 0) return null;
  return { kind: 'ACCEPT', selectedTime: input.selectedTime };
}

export function buildGenericPushPayload(input: {
  mailId: string;
  type: string;
}): { title: string; body: string; data: Record<string, string> } {
  return {
    title: '새 우편이 도착했어요',
    body: '친구 소식이 있어요',
    data: { mailId: input.mailId, type: input.type },
  };
}

function minutesOf(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour! * 60 + minute!;
}
