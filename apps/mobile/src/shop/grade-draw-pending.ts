import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageTag } from '@/wallet/account-scope';
import { isMileageGrade, type MileageGrade } from './shop-api';
import { pendingPurchaseScopeKey, type PendingPurchaseScope } from './pending-purchase-storage';

export type PendingGradeDraw = { grade: MileageGrade; requestId: string; expectedPoolVersion: string };
const key = (scope: PendingPurchaseScope) => `@masscom:grade-draw-pending:v1:${accountStorageTag(pendingPurchaseScopeKey(scope))}`;

export async function readPendingGradeDraw(scope: PendingPurchaseScope): Promise<PendingGradeDraw | null> {
  const raw = await AsyncStorage.getItem(key(scope));
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('저장된 뽑기 요청을 읽지 못했어요.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('저장된 뽑기 요청을 읽지 못했어요.');
  const pending = value as Partial<PendingGradeDraw>;
  if (!isMileageGrade(pending.grade) || typeof pending.requestId !== 'string' || !pending.requestId
    || typeof pending.expectedPoolVersion !== 'string' || !pending.expectedPoolVersion) throw new Error('저장된 뽑기 요청을 읽지 못했어요.');
  return { grade: pending.grade, requestId: pending.requestId, expectedPoolVersion: pending.expectedPoolVersion };
}
export async function writePendingGradeDraw(scope: PendingPurchaseScope, pending: PendingGradeDraw): Promise<void> {
  await AsyncStorage.setItem(key(scope), JSON.stringify(pending));
}
export async function clearPendingGradeDraw(scope: PendingPurchaseScope): Promise<void> {
  await AsyncStorage.removeItem(key(scope));
}
