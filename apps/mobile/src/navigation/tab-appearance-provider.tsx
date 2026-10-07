import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { defaultTabAppearance, parseTabAppearance, type TabAppearance } from './tab-appearance';

const AppearanceContext = createContext({ appearance: defaultTabAppearance, error: '', ready: false,
  save: (async () => false) as (value: TabAppearance) => Promise<boolean> });

export function TabAppearanceProvider({ accountId, children }: { accountId?: string; children: ReactNode }) {
  const key = `masscom.tab-appearance.v1:${accountId ?? 'signed-out'}`;
  const [loaded, setLoaded] = useState<{ key: string; appearance: TabAppearance }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [settledKey, setSettledKey] = useState<string>();
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    void AsyncStorage.getItem(key).then((raw) => {
      if (request !== generation.current) return;
      setLoaded({ key, appearance: raw === null ? defaultTabAppearance : parseTabAppearance(JSON.parse(raw)) });
    }).catch(() => { if (request === generation.current) setFailure({ key, message: '저장된 꾸미기를 읽지 못했어요. 다시 적용하면 현재 선택으로 저장해요.' }); })
      .finally(() => { if (request === generation.current) setSettledKey(key); });
    return () => { generation.current = request + 1; };
  }, [key]);
  const save = async (value: TabAppearance) => {
    const request = generation.current;
    try {
      const appearance = parseTabAppearance(value);
      await AsyncStorage.setItem(key, JSON.stringify(appearance));
      if (request !== generation.current) return false;
      setLoaded({ key, appearance }); setFailure(undefined); return true;
    } catch { if (request === generation.current) setFailure({ key, message: '꾸미기를 저장하지 못했어요. 다시 시도해 주세요.' }); return false; }
  };
  return <AppearanceContext value={{ appearance: loaded?.key === key ? loaded.appearance : defaultTabAppearance,
    error: failure?.key === key ? failure.message : '', ready: settledKey === key, save }}>{children}</AppearanceContext>;
}
export const useTabAppearance = () => useContext(AppearanceContext);
