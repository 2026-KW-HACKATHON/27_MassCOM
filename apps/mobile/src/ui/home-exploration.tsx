import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import type { AccountCredential } from '@/auth/account-credential';
import type { CollectionSnapshot } from '@/commerce/commerce-api';
import { buildExplorationSummary } from '@/merchant/home-exploration';
import type { PublicMerchant } from '@/merchant/merchant-api';
import { createStudioApiClient, type StudioGoal } from '@/studio/studio-api';
import { resolveStudioGoal } from '@/studio/studio-goals';
import { colorsForScheme } from '@/theme/palette';

export function HomeExploration({ apiUrl, credential, onSessionInvalid, merchants, collection }: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>;
  merchants: readonly PublicMerchant[]; collection: CollectionSnapshot | undefined;
}) {
  const router = useRouter();
  const palette = colorsForScheme(useColorScheme());
  const client = useMemo(() => createStudioApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [loaded, setLoaded] = useState<{ client: typeof client; goal: StudioGoal }>();
  useFocusEffect(useCallback(() => {
    let current = true;
    void client.getMine().then((result) => { if (current) setLoaded({ client, goal: result.studio.goal }); }).catch(() => {});
    return () => { current = false; };
  }, [client]));
  const goal = loaded?.client === client ? loaded.goal : null;
  if (!collection) return null;
  const resolved = resolveStudioGoal(goal, merchants, collection);
  const summary = buildExplorationSummary(merchants, collection, new Date());
  const openMerchant = (merchantId: string) => router.push({ pathname: '/merchants/[merchantId]', params: { merchantId, from: 'recommendation' } });
  return <View style={[styles.band, { borderColor: palette.separator }]}>
    {resolved ? <Pressable accessibilityRole="button" accessibilityLabel={`${resolved.status === 'active' ? '나의 목표' : '새 목표 고르기'}, ${resolved.label}`}
      onPress={() => resolved.status !== 'active' ? router.push('/studio') : goal?.kind === 'play' ? router.push('/play') : goal?.merchantId && openMerchant(goal.merchantId)} style={styles.goal}>
      <Text style={[styles.eyebrow, { color: palette.primary }]}>{resolved.status === 'active' ? '나의 목표' : resolved.status === 'completed' ? '목표 달성' : '목표 다시 고르기'}</Text>
      <Text style={[styles.title, { color: palette.label }]}>{resolved.label}</Text>
      {resolved.status !== 'active' ? <Text style={[styles.note, { color: palette.secondaryLabel }]}>{resolved.next ? `${resolved.next.label} · 새 목표 고르기` : '새 목표 고르기'} ›</Text> : null}
    </Pressable> : null}
    {summary.weekly.target > 0 ? <>
      <Text style={[styles.title, { color: palette.label }]}>이번 주 {summary.weekly.current}곳 탐험 · 목표 {summary.weekly.target}곳</Text>
      <Text style={[styles.note, { color: palette.secondaryLabel }]}>{summary.weekly.completed ? '이번 주 목표 달성! 월요일에 새 탐험이 시작돼요.' : '새 가게도, 좋아하는 가게의 재방문도 탐험에 남아요.'}</Text>
      {summary.weekly.nextMerchantId ? <Pressable accessibilityRole="button" accessibilityLabel="이번 주 다음 탐험 가게 보기"
        onPress={() => openMerchant(summary.weekly.nextMerchantId!)} style={styles.link}><Text style={{ color: palette.primary, fontWeight: '700' }}>다음 탐험 가게 보기</Text></Pressable> : null}
      {summary.series.total > 0 ? <Text style={[styles.note, { color: palette.secondaryLabel }]}>동네 수집 세트 {summary.series.completed}/{summary.series.total} · 지금 참여 중인 가게의 방문 수집품</Text> : null}
      {summary.series.nextMerchantId ? <Pressable accessibilityRole="button" accessibilityLabel="동네 수집 세트 이어 모으기"
        onPress={() => openMerchant(summary.series.nextMerchantId!)} style={styles.link}><Text style={{ color: palette.primary, fontWeight: '700' }}>세트 이어 모으기</Text></Pressable> : null}
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  band: { borderBottomWidth: 1, paddingVertical: 14, gap: 6 },
  goal: { minHeight: 52, gap: 4, paddingBottom: 8 },
  eyebrow: { fontSize: 12, fontWeight: '800' },
  title: { fontSize: 16, fontWeight: '800', lineHeight: 23 },
  note: { fontSize: 13, lineHeight: 19 },
  link: { minHeight: 44, justifyContent: 'center' },
});
