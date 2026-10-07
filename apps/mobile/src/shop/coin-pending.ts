import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageTag } from '@/wallet/account-scope';

export type CoinPending = { poolId: string; requestId: string };

export function coinPendingKey(accountId: string, apiUrl: string, appVariant: string): string {
  const origin = new URL(apiUrl).origin;
  return `@masscom:coin-pending:v1:${accountStorageTag(`${appVariant}:${origin}:${accountId}`)}`;
}

export async function readCoinPending(key: string): Promise<CoinPending | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('COIN_PENDING_INVALID');
  const { poolId, requestId } = value as Partial<CoinPending>;
  if (typeof poolId !== 'string' || !poolId || typeof requestId !== 'string' || !requestId) throw new Error('COIN_PENDING_INVALID');
  return { poolId, requestId };
}

export async function writeCoinPending(key: string, pending: CoinPending): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(pending));
}

export async function clearCoinPending(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
