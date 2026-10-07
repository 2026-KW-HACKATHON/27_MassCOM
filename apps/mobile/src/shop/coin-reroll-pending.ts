import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountStorageTag } from '@/wallet/account-scope';
import type { CoinSource } from './coin-api';

export type CoinRerollPending = { ticketId: string; source: CoinSource; poolId: string; requestId: string };

export function coinRerollPendingKey(accountId: string, apiUrl: string, appVariant: string): string {
  return `@masscom:coin-reroll-pending:v1:${accountStorageTag(`${appVariant}:${new URL(apiUrl).origin}:${accountId}`)}`;
}

export async function readCoinRerollPending(key: string): Promise<CoinRerollPending | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('COIN_REROLL_PENDING_INVALID');
  const pending = value as Partial<CoinRerollPending>;
  if (!pending.ticketId || !pending.poolId || !pending.requestId || !pending.source?.sourceId
    || !['VISIT', 'STORE_DRAW', 'GRADE_DRAW', 'REROLL'].includes(pending.source.sourceKind)) throw new Error('COIN_REROLL_PENDING_INVALID');
  return pending as CoinRerollPending;
}

export const writeCoinRerollPending = (key: string, pending: CoinRerollPending) => AsyncStorage.setItem(key, JSON.stringify(pending));
export async function startOrResumeCoinReroll(key: string, create?: () => CoinRerollPending | null): Promise<CoinRerollPending | null> {
  const saved = await readCoinRerollPending(key);
  if (saved || !create) return saved;
  const attempt = create();
  if (!attempt) return null;
  await writeCoinRerollPending(key, attempt);
  return attempt;
}
export const clearCoinRerollPending = (key: string) => AsyncStorage.removeItem(key);
