import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Storage } from '@reown/appkit-react-native';

const basePrefix = '@masscom:appkit:';

/** Wallet session storage that only ever reads and writes keys under the given account prefix. */
export function createAppKitStorage(prefix: string): Storage {
  const storageKey = (key: string) => `${prefix}${key}`;
  const getKeys = async () =>
    (await AsyncStorage.getAllKeys())
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length));

  return {
    getKeys,
    async getEntries<T>() {
      const keys = await getKeys();
      const entries = await AsyncStorage.multiGet(keys.map(storageKey));
      return entries.flatMap(([key, value]) => {
        if (value === null) return [];
        return [[key.slice(prefix.length), JSON.parse(value) as T] as [string, T]];
      });
    },
    async getItem<T>(key: string) {
      const value = await AsyncStorage.getItem(storageKey(key));
      return value === null ? undefined : (JSON.parse(value) as T);
    },
    async setItem<T>(key: string, value: T) {
      await AsyncStorage.setItem(storageKey(key), JSON.stringify(value));
    },
    async removeItem(key: string) {
      await AsyncStorage.removeItem(storageKey(key));
    },
  };
}

/** Every wallet session key on the device, whichever account wrote it. */
export async function listAppKitStorageKeys(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(basePrefix));
}

export async function removeAppKitStorageKeys(keys: string[]): Promise<void> {
  await AsyncStorage.multiRemove(keys);
}
