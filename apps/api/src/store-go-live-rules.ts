// 실제 점포 운영 시작 규칙(Issue #246). DB 없이 시험할 수 있는 순수 함수만 둔다.
import { looksLikePersonalData } from './reversal-rules.js';

// 동의서·확인 기록은 운영자가 따로 보관하고 서비스에는 참조 번호만 남긴다. migration 0032의 DB CHECK와 같은 형식이다.
const documentReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/;

// 앞뒤 공백을 지운 참조 번호를 돌려준다. 형식이 틀리거나 이메일·웹 주소·8자리 이상 숫자열(사업자등록번호·전화번호)처럼 보이면 null이다.
export function normalizeDocumentReference(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const reference = raw.trim();
  if (!documentReferencePattern.test(reference) || looksLikePersonalData(reference)) return null;
  return reference;
}

// D-043의 점주 동의 5항목. 관리자가 모두 확인해야 혜택을 만든다.
export const ownerOfferConsentItems = ['benefit', 'ownerPaysCost', 'validity', 'issuanceCap', 'duplicateUse'] as const;
export type OwnerOfferConsent = Record<(typeof ownerOfferConsentItems)[number], true>;
export const ownerOfferConsentChecklistVersion = 'owner-offer-consent-v1';

export function isCompleteOwnerOfferConsent(raw: unknown): raw is OwnerOfferConsent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === ownerOfferConsentItems.length &&
    ownerOfferConsentItems.every(item => record[item] === true);
}

// 기존에 consent_note를 읽는 쪽(시연 seed 비교·운영 기록)이 계속 동작하도록 참조 번호와 확인 항목 판을 한 줄로 적는다.
export function composeOfferConsentNote(reference: string): string {
  return `점주 동의서 ${reference} · 확인 항목 ${ownerOfferConsentChecklistVersion}` +
    '(혜택 내용·비용 점주 부담·유효 기간·발급 상한·중복 사용 정책)';
}

// 관리자가 만드는 혜택은 발급 상한이 필수다. 동네 가게 쿠폰으로 충분한 상한을 둔다.
export const rewardOfferIssuanceCapMax = 10_000;

export const ownerDemotionReasons = ['OWNER_REQUEST', 'OWNERSHIP_CHANGED', 'VERIFICATION_FAILED', 'OTHER'] as const;
export type OwnerDemotionReason = (typeof ownerDemotionReasons)[number];

export function isOwnerDemotionReason(value: unknown): value is OwnerDemotionReason {
  return typeof value === 'string' && (ownerDemotionReasons as readonly string[]).includes(value);
}

// 점포당 ACTIVE OWNER 상한. 점포 행 잠금 뒤에 세어 지킨다.
export const maxActiveOwnersPerMerchant = 2;

export type MerchantPublishFacts = { menuItemCount: number; businessHours: string; roadAddress: string };

// 공개 전에 채워야 하는 항목 중 빠진 것. 비어 있으면 공개할 수 있다.
export function missingPublishRequirements(facts: MerchantPublishFacts): ('MENU' | 'HOURS' | 'ADDRESS')[] {
  const missing: ('MENU' | 'HOURS' | 'ADDRESS')[] = [];
  if (facts.menuItemCount < 1) missing.push('MENU');
  if (!facts.businessHours.trim()) missing.push('HOURS');
  if (!facts.roadAddress.trim()) missing.push('ADDRESS');
  return missing;
}
