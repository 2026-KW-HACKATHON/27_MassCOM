import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageTag } from '@/wallet/account-scope';

export type FurniturePending = { itemId: string; requestId: string };

export function furniturePendingKey(accountId: string, apiUrl: string, appVariant: string): string {
  return `@masscom:furniture-pending:v1:${accountStorageTag(`${appVariant}:${new URL(apiUrl).origin}:${accountId}`)}`;
}

export async function readFurniturePending(key: string): Promise<FurniturePending | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FURNITURE_PENDING_INVALID');
  const pending = value as Partial<FurniturePending>;
  if (!pending.itemId || !pending.requestId) throw new Error('FURNITURE_PENDING_INVALID');
  return pending as FurniturePending;
}

export const writeFurniturePending = (key: string, pending: FurniturePending) => AsyncStorage.setItem(key, JSON.stringify(pending));
export const clearFurniturePending = (key: string) => AsyncStorage.removeItem(key);
