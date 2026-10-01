import AsyncStorage from '@react-native-async-storage/async-storage';

import { favoritesKey, parseStoredList, shownReactionsKey } from './collection-prefs';

/**
 * Thin AsyncStorage adapter; the pure key/merge/parse logic lives in collection-prefs.ts. Reads never reject — a
 * missing key, corrupt JSON, or a storage-layer failure all resolve to empty rather than propagating, so a bad
 * read never permanently blocks the writes that are gated on it finishing (see index.tsx's prefsLoaded).
 */

async function readRaw(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function readFavorites(accountId: string): Promise<readonly string[]> {
  return parseStoredList(await readRaw(favoritesKey(accountId)));
}

export async function writeFavorites(accountId: string, favorites: readonly string[]): Promise<void> {
  await AsyncStorage.setItem(favoritesKey(accountId), JSON.stringify(favorites));
}

export async function readShownReactions(accountId: string): Promise<ReadonlySet<string>> {
  return new Set(parseStoredList(await readRaw(shownReactionsKey(accountId))));
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
