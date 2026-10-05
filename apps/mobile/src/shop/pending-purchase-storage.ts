import AsyncStorage from '@react-native-async-storage/async-storage';

import { accountStorageTag } from '@/wallet/account-scope';

import { isMileageGrade, type MileageGrade } from './shop-api';

export type StoredPendingPurchase = {
  grade: MileageGrade;
  requestId: string;
  expectedRemaining: number;
};

export type PendingPurchaseScope = {
  accountId: string;
  apiUrl: string;
  appVariant: string;
};

export function pendingPurchaseScope(input: PendingPurchaseScope): PendingPurchaseScope {
  return { accountId: input.accountId.trim(), apiUrl: apiOrigin(input.apiUrl), appVariant: input.appVariant.trim() };
}

export function pendingPurchaseScopeKey(scope: PendingPurchaseScope): string {
  const stable = pendingPurchaseScope(scope);
  return `${stable.appVariant}:${stable.apiUrl}:${stable.accountId}`;
}

export function pendingPurchaseStorageKey(scope: PendingPurchaseScope): string {
  return `@masscom:shop-pending-purchase:v2:${accountStorageTag(pendingPurchaseScopeKey(scope))}`;
}

function apiOrigin(apiUrl: string): string {
  try { return new URL(apiUrl).origin; } catch { return apiUrl.trim().replace(/\/+$/, ''); }
}

export class PendingPurchaseStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'PendingPurchaseStorageError';
    this.cause = options?.cause;
  }
}

export async function readPendingPurchase(scope: PendingPurchaseScope): Promise<StoredPendingPurchase | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(pendingPurchaseStorageKey(scope));
  } catch (cause) {
    throw new PendingPurchaseStorageError('저장된 구매 확인 정보를 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.', { cause });
  }
  if (raw === null) return null;
  let parsed: Partial<StoredPendingPurchase>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredPendingPurchase>;
  } catch (cause) {
    throw new PendingPurchaseStorageError('저장된 구매 확인 정보가 손상됐어요. 잠시 뒤 다시 시도해 주세요.', { cause });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PendingPurchaseStorageError('저장된 구매 확인 정보가 손상됐어요. 잠시 뒤 다시 시도해 주세요.');
  }
  const expectedRemaining = parsed.expectedRemaining;
  if (!isMileageGrade(parsed.grade) || typeof parsed.requestId !== 'string' || !parsed.requestId
    || typeof expectedRemaining !== 'number' || !Number.isInteger(expectedRemaining) || expectedRemaining < 0) {
    throw new PendingPurchaseStorageError('저장된 구매 확인 정보가 손상됐어요. 잠시 뒤 다시 시도해 주세요.');
  }
  return { grade: parsed.grade, requestId: parsed.requestId, expectedRemaining };
}

export async function writePendingPurchase(scope: PendingPurchaseScope, pending: StoredPendingPurchase): Promise<void> {
  await AsyncStorage.setItem(pendingPurchaseStorageKey(scope), JSON.stringify(pending));
}

export async function clearPendingPurchase(scope: PendingPurchaseScope): Promise<void> {
  await AsyncStorage.removeItem(pendingPurchaseStorageKey(scope));
}
