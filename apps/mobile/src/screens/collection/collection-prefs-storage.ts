import AsyncStorage from '@react-native-async-storage/async-storage';

import { favoritesKey, parseStoredList, shownReactionsKey } from './collection-prefs';

/**
 * Thin AsyncStorage adapter; the pure key/merge/parse logic lives in collection-prefs.ts. Reads never reject.
 * A missing key or corrupt JSON is "no data" (empty). A storage-layer failure is reported separately for favorites
 * (undefined) so the screen re-reads before its first write instead of overwriting saved favorites with an empty list.
 */

async function readRaw(key: string): Promise<string | null | undefined> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return undefined;
  }
}

/** undefined = the storage layer failed (not "no favorites"). */
export async function readFavorites(accountId: string): Promise<readonly string[] | undefined> {
  const raw = await readRaw(favoritesKey(accountId));
  return raw === undefined ? undefined : parseStoredList(raw);
}

export async function writeFavorites(accountId: string, favorites: readonly string[]): Promise<void> {
  await AsyncStorage.setItem(favoritesKey(accountId), JSON.stringify(favorites));
}

export async function readShownReactions(accountId: string): Promise<ReadonlySet<string>> {
  return new Set(parseStoredList((await readRaw(shownReactionsKey(accountId))) ?? null));
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
