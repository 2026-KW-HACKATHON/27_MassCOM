import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Storage } from '@reown/appkit-react-native';

const prefix = '@masscom:appkit:';

function storageKey(key: string): string {
  return `${prefix}${key}`;
}

export const appKitStorage: Storage = {
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

async function getKeys(): Promise<string[]> {
  const keys = await AsyncStorage.getAllKeys();
  return keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
}
