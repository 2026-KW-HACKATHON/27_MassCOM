import AsyncStorage from '@react-native-async-storage/async-storage';

import { DISCLOSURE_PREFIX } from './disclosure-record';

/** Thin AsyncStorage adapter for the foreign-account purge (the pure key logic is in disclosure-record.ts), like the collection prefs. */
export async function listDisclosureKeys(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(DISCLOSURE_PREFIX));
}

export async function removeDisclosureKeys(keys: string[]): Promise<void> {
  await AsyncStorage.multiRemove(keys);
}
