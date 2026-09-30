import AsyncStorage from '@react-native-async-storage/async-storage';

import { favoritesKey, shownReactionsKey } from './collection-prefs';

/** Thin AsyncStorage adapter; the pure key/merge logic lives in collection-prefs.ts. */

export async function readFavorites(accountId: string): Promise<readonly string[]> {
  const raw = await AsyncStorage.getItem(favoritesKey(accountId));
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function writeFavorites(accountId: string, favorites: readonly string[]): Promise<void> {
  await AsyncStorage.setItem(favoritesKey(accountId), JSON.stringify(favorites));
}

export async function readShownReactions(accountId: string): Promise<ReadonlySet<string>> {
  const raw = await AsyncStorage.getItem(shownReactionsKey(accountId));
  return new Set(raw ? (JSON.parse(raw) as string[]) : []);
}

export async function writeShownReactions(accountId: string, events: ReadonlySet<string>): Promise<void> {
  await AsyncStorage.setItem(shownReactionsKey(accountId), JSON.stringify([...events]));
}

export async function listCollectionPrefKeys(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith('@masscom:collection:'));
}

export async function removeCollectionPrefKeys(keys: string[]): Promise<void> {
  await AsyncStorage.multiRemove(keys);
}
