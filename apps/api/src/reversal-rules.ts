// 방문 취소·쿠폰 사용 되돌리기 규칙(Issue #243). DB 없이 시험할 수 있는 순수 함수만 둔다.
import { createHmac } from 'node:crypto';

import { rewardMilestones, type RewardMilestone } from './badge-rules.js';

export const visitCancelReasons = ['WRONG_CUSTOMER', 'DUPLICATE', 'NOT_A_REAL_VISIT', 'OTHER'] as const;
export type VisitCancelReason = (typeof visitCancelReasons)[number];

export const couponVoidReasons = ['ISSUED_IN_ERROR', 'ABUSE_SUSPECTED', 'MERCHANT_REQUEST', 'OTHER'] as const;
export type CouponVoidReason = (typeof couponVoidReasons)[number];

export const reversalNoteMaxLength = 100;
// 쿠폰 사용 처리 뒤 되돌릴 수 있는 시간. 정확히 10분 0초까지는 가능하다.
export const couponUndoWindowMs = 10 * 60 * 1000;
export const recentVisitLimit = 50;
export const recentCouponRedemptionWindowMs = 24 * 60 * 60 * 1000;
export const recentCouponRedemptionLimit = 20;

export function isVisitCancelReason(value: unknown): value is VisitCancelReason {
  return typeof value === 'string' && (visitCancelReasons as readonly string[]).includes(value);
}

export function isCouponVoidReason(value: unknown): value is CouponVoidReason {
  return typeof value === 'string' && (couponVoidReasons as readonly string[]).includes(value);
}

const kstOffsetMs = 9 * 60 * 60 * 1000;

// 한국 영업일 'YYYY-MM-DD'. KST는 일광절약시간이 없어 고정 +9시간이 정확하다.
export function kstBusinessDate(at: Date): string {
  return new Date(at.getTime() + kstOffsetMs).toISOString().slice(0, 10);
}

export function canCancelVisitOn(businessDate: string, now: Date): boolean {
  return businessDate === kstBusinessDate(now);
}

export function couponUndoDeadline(redeemedAt: Date): Date {
  return new Date(redeemedAt.getTime() + couponUndoWindowMs);
}

export function isWithinCouponUndoWindow(redeemedAt: Date, now: Date): boolean {
  return now.getTime() <= redeemedAt.getTime() + couponUndoWindowMs;
}

export type NoteResult = { ok: true; note: string | null } | { ok: false };

// NFKC로 바꾼 글자에서 찾는다(전각 숫자·전각 골뱅이·호환 문자가 ASCII로 접힌다).
const personalDataPatterns = [
  /@/u, // 이메일·SNS 계정
  /https?:\/\/|www\./iu, // 주소(URL)
  // 스킴 없는 주소(instagram.com/x). 흔한 최상위 도메인만 본다.
  /[\p{L}\p{Nd}][\p{L}\p{Nd}-]*[.。](?:com|net|org|kr|co|io|me)(?![\p{L}\p{Nd}])/iu,
  // 전화번호·카드·주문번호처럼 긴 숫자열. 숫자 사이의 구분자는 길이 제한 없이 글자·숫자가 아닌 문자의 연속(공백·하이픈·슬래시·밑줄·
  // 유니코드 붙임표 U+2010~2015…)이거나 붙임표로 쓰이는 한글 모음 ㅡ(U+3161)·ᅳ(U+1173), 보이지 않는 한글 채움 문자
  // (U+115F·U+1160·U+3164·U+FFA0, 글자로 분류되지만 화면에 안 보임)이면 이어진 것으로 본다.
  // 구분자와 숫자 집합이 겹치지 않아 되돌아가기 폭발이 없고, 메모가 100자로 잘려 있어 입력 크기도 작다.
  /(?:\p{Nd}(?:[^\p{L}\p{Nd}]|[\u3161\u1173\u115F\u1160\u3164\uFFA0])*){8,}/u,
];

// 이메일·웹 주소·긴 숫자열(전화번호 등)이 보이는지 본다. 방문·쿠폰 되돌리기 메모와 계정 삭제 거절 사유가 같은 기준을 쓴다(#194).
// 이름·주소 같은 그 밖의 개인정보는 걸러 내지 못한다.
export function looksLikePersonalData(text: string): boolean {
  const probe = text.normalize('NFKC');
  return personalDataPatterns.some((pattern) => pattern.test(probe));
}

// 선택 메모를 정리한다. 제어·서식 문자를 없애고 공백을 접은 뒤 100자(코드 포인트) 이하만 받는다.
// 이메일·웹 주소·긴 숫자열(전화번호 등)이 보이면 개인정보가 들어갔을 수 있어 거절한다. 그 밖의 개인정보(이름·주소 등)는 걸러 내지 못한다.
// 저장하는 글은 NFC 그대로다(NFKC는 호환 자모 'ㅋㅋ' 같은 글자를 바꾸므로 검사에만 쓴다). 빈 메모는 null이다.
export function normalizeReversalNote(raw: unknown): NoteResult {
  if (raw === undefined || raw === null) return { ok: true, note: null };
  if (typeof raw !== 'string') return { ok: false };
  const note = raw
    .normalize('NFC')
    .replace(/[\r\n\t]+/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (note === '') return { ok: true, note: null };
  if (Array.from(note).length > reversalNoteMaxLength) return { ok: false };
  if (looksLikePersonalData(note)) return { ok: false };
  return { ok: true, note };
}

// 세어지지 않는 이유를 응답·저장에 쓰는 값. 직원 본인 적립과 점포 직원 계정으로 받은 방문을 함께 이 값으로 알린다.
export type ProgressExcludedReason = 'STAFF_SELF';
export const staffProgressExcludedReason: ProgressExcludedReason = 'STAFF_SELF';

// 실제 점포에서는 (1) 직원이 자기 계정으로 받은 방문과 (2) 방문한 고객 계정이 그 점포의 ACTIVE 직원인 방문(동료가 대신 발급해도)을
// 기록만 하고 진행·보상·NFT·도감에 세지 않는다. (2)는 수령 시점의 멤버 여부로 판정한다.
// 시연 점포는 한 사람이 점원과 고객을 함께 시연하므로 그대로 센다(메달·배지의 countedVisitFilterSql과 같은 규칙).
export function isStaffAccountClaim(input: {
  merchantIsDemo: boolean;
  slotCreatedByAccountId: string;
  customerAccountId: string;
  customerIsActiveMember: boolean;
}): boolean {
  return (
    !input.merchantIsDemo &&
    (input.slotCreatedByAccountId === input.customerAccountId || input.customerIsActiveMember)
  );
}

export type MintJobFacts = {
  status: string;
  transactionHash: string | null;
  lastErrorCode: string | null;
  // outbox 대여(lease)가 지금 유효한지: 워커가 전송을 준비 중일 수 있다.
  leased: boolean;
};

export type MintJobDisposition = 'ALREADY_CANCELLED' | 'CANCELABLE' | 'MINTED' | 'IN_PROGRESS';

const cancelableMintStatuses: readonly string[] = ['QUEUED', 'PREPARED', 'RETRYABLE', 'PAUSED', 'MANUAL_REVIEW'];

// 계정 삭제(cancelUnsentMintJobs)와 같은 기준: 체인에 보낸 적이 없고 응답 분실도 아니며 유효한 대여가 없을 때만 취소한다.
// 모르는 상태는 보수적으로 "이미 발행"으로 본다.
export function classifyMintJob(job: MintJobFacts): MintJobDisposition {
  if (job.status === 'CANCELLED') return 'ALREADY_CANCELLED';
  if (job.status === 'FINALIZED' || job.status === 'SUBMITTED' || job.status === 'CONFIRMING') return 'MINTED';
  if (job.transactionHash !== null || job.lastErrorCode === 'MINT_SUBMISSION_RESPONSE_LOST') return 'MINTED';
  if (!cancelableMintStatuses.includes(job.status)) return 'MINTED';
  return job.leased ? 'IN_PROGRESS' : 'CANCELABLE';
}

export type RevocableEntitlement = {
  id: string;
  targetVisitCount: number;
  sourceVisitEventId: string;
};

// 취소한 방문이 만든 권리와, 다시 센 진행 횟수보다 목표가 큰 권리를 되돌린다.
export function selectEntitlementsToRevoke<T extends RevocableEntitlement>(
  entitlements: readonly T[],
  input: { visitEventId: string; progressAfter: number },
): T[] {
  return entitlements.filter(
    (entitlement) =>
      entitlement.sourceVisitEventId === input.visitEventId || entitlement.targetVisitCount > input.progressAfter,
  );
}

// 다시 센 배지 수로 더는 열 수 없는 상자의 번호.
export function milestonesToVoid(earnedTiers: number): RewardMilestone[] {
  return rewardMilestones
    .filter(({ requiredTiers }) => requiredTiers > earnedTiers)
    .map(({ milestone }) => milestone);
}

const labelAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// 점원 화면에 보이는 고객 표시. 점포마다 다른 HMAC에서 4글자만 뽑아 계정 ID·이메일과 역산할 수 없다.
export function maskedCustomerLabel(secret: string, merchantId: string, customerAccountId: string): string {
  const digest = createHmac('sha256', secret)
    .update('customer-label\0')
    .update(merchantId, 'utf8')
    .update('\0')
    .update(customerAccountId, 'utf8')
    .digest();
  let label = '';
  for (let index = 0; index < 4; index += 1) label += labelAlphabet[digest[index]! % labelAlphabet.length];
  return `손님 ${label}`;
}
