import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { AccountCredential } from '@/auth/account-credential';
import { createExperienceApiClient, type EquipmentPatch, type ExperienceSnapshot } from './experience-api';

export function useExperience(apiUrl: string, credential: AccountCredential | undefined, onSessionInvalid: () => Promise<void>, refreshToken = 0) {
  const client = useMemo(() => credential ? createExperienceApiClient({ apiUrl, credential, onSessionInvalid }) : undefined,
    [apiUrl, credential, onSessionInvalid]);
  const [snapshotState, setSnapshotState] = useState<{ client: NonNullable<typeof client>; value: ExperienceSnapshot }>();
  const snapshot = snapshotState && snapshotState.client === client ? snapshotState.value : undefined;
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!client) { setSnapshotState(undefined); setError(undefined); return; }
    try {
      const result = await client.get();
      if (generation.current === request) { setSnapshotState({ client, value: result }); setError(undefined); }
    } catch {
      if (generation.current === request) setError('꾸미기 정보를 불러오지 못했어요.');
    }
  }, [client]);
  useFocusEffect(useCallback(() => {
    void refreshToken;
    void load();
    return () => { generation.current += 1; };
  }, [load, refreshToken]));
  const save = useCallback(async (equipment: EquipmentPatch) => {
    if (!client || saving) return false;
    const request = generation.current;
    setSaving(true); setError(undefined);
    try {
      const result = await client.equip(equipment);
      if (generation.current === request) setSnapshotState({ client, value: result });
      return generation.current === request;
    } catch {
      if (generation.current === request) setError('장착하지 못했어요. 다시 시도해 주세요.');
      return false;
    } finally { setSaving(false); }
  }, [client, saving]);
  const wish = useCallback(async (itemId: string | null) => {
    if (!client || saving) return false;
    const request = generation.current;
    setSaving(true); setError(undefined);
    try {
      const result = await client.wish(itemId);
      if (generation.current === request) setSnapshotState({ client, value: result });
      return generation.current === request;
    } catch {
      if (generation.current === request) setError('목표를 저장하지 못했어요. 다시 시도해 주세요.');
      return false;
    } finally { setSaving(false); }
  }, [client, saving]);
  return { snapshot, error, saving, refresh: load, save, wish };
}
