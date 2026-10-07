import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import type { AccountCredential } from '@/auth/account-credential';
import { createStudioApiClient, type FurnitureSnapshot } from '@/studio/studio-api';
import { ownedFurniture } from '@/studio/studio-furniture';
import { FurnitureArt } from '@/studio/furniture-layer';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';
import { StateScene } from '@/ui/state-scene';

export function RoomInventoryScreen({ apiUrl, credential, onSessionInvalid }: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>;
}) {
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  const client = useMemo(() => createStudioApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [snapshot, setSnapshot] = useState<FurnitureSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { setSnapshot(await client.getFurniture()); } catch { setError(true); }
    finally { setLoading(false); }
  }, [client]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return <SkyBackdrop><SkyScrollView header={<BackHeader title="보관함" />} contentContainerStyle={styles.content}>
    {loading && !snapshot ? <StateScene kind="loading" title="보관함을 불러오는 중" /> : null}
    {error ? <StateScene kind="error" title="보관함을 불러오지 못했어요" action={{ label: '다시 시도', onPress: () => void load() }} /> : null}
    {snapshot ? <>
      <Text style={[styles.summary, { color: palette.label }]}>보유 가구 {ownedFurniture(snapshot, 'FURNITURE').length}개</Text>
      {(['FURNITURE', 'WALL', 'FLOOR'] as const).map((kind) => <View key={kind} style={styles.section}>
        <Text accessibilityRole="header" style={[styles.heading, { color: palette.label }]}>{kind === 'FURNITURE' ? '가구' : kind === 'WALL' ? '벽' : '바닥'}</Text>
        {ownedFurniture(snapshot, kind).length ? ownedFurniture(snapshot, kind).map((entry) => <View key={entry.id}
          style={[styles.row, { backgroundColor: palette.surface, borderColor: palette.separator }]}>
          <FurnitureArt assetId={entry.item.assetId} name={entry.item.name} size={48} />
          <Text style={[styles.name, { color: palette.label }]}>{entry.item.name}</Text>
          <Text style={[styles.meta, { color: palette.secondaryLabel }]}>보유 중</Text>
        </View>) : <Text style={[styles.meta, { color: palette.secondaryLabel }]}>보유한 물건이 없어요.</Text>}
      </View>)}
      <Pressable accessibilityRole="button" onPress={() => router.push('/studio')} style={[styles.action, { backgroundColor: palette.primary }]}>
        <Text style={[styles.actionText, { color: palette.onPrimary }]}>마이룸에 배치</Text>
      </Pressable>
    </> : null}
  </SkyScrollView></SkyBackdrop>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 48, gap: 16 },
  summary: { fontSize: 19, fontWeight: '800' },
  section: { gap: 9 }, heading: { fontSize: 17, fontWeight: '800' },
  row: { minHeight: 58, paddingHorizontal: 15, borderWidth: 1, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { flex: 1, fontSize: 15, fontWeight: '700' }, meta: { fontSize: 13, lineHeight: 20 },
  action: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  actionText: { fontSize: 15, fontWeight: '800' },
});
