import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AccountCredential } from '@/auth/account-credential';
import { createCourseApiClient, type Course } from '@/courses/course-api';
import { clearedCourseDetail } from '@/courses/course-detail-state';
import { courseChipText, courseStateText } from '@/courses/course-copy';
import { consentRecheckLabel, consentRequiredMessage, needsConsentRecheck } from '@/privacy/consent-flow';
import { useConsentRecheck } from '@/privacy/consent-recheck';
import { colorsForScheme } from '@/theme/palette';
import { BackHeader } from '@/ui/back-header';
import { FloatingCard } from '@/ui/floating-card';
import { SkyBackdrop } from '@/ui/sky-backdrop';
import { SkyScrollView } from '@/ui/sky-scroll-view';

export function CoursesScreen({ apiUrl, credential, onSessionInvalid, courseId }: {
  apiUrl: string; credential: AccountCredential; onSessionInvalid: () => Promise<void>; courseId?: string;
}) {
  const router = useRouter();
  const recheckConsent = useConsentRecheck();
  const palette = colorsForScheme(useColorScheme());
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createCourseApiClient({ apiUrl, credential, onSessionInvalid }), [apiUrl, credential, onSessionInvalid]);
  const [courses, setCourses] = useState<Course[]>();
  const [error, setError] = useState<string>();
  const [errorNeedsConsent, setErrorNeedsConsent] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = courseId ? [await api.get(courseId, signal)] : await api.list(signal);
      if (!signal?.aborted) { setCourses(next); setError(undefined); setErrorNeedsConsent(false); }
    } catch (cause) {
      if (!signal?.aborted) {
        const cleared = courseId && clearedCourseDetail(cause);
        if (cleared) { setCourses(cleared.courses); setSceneOpen(cleared.sceneOpen); }
        setError('코스를 불러오지 못했어요. 다시 시도해 주세요.');
      }
    }
  }, [api, courseId]);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]));
  async function refresh() { setRefreshing(true); await load(); setRefreshing(false); }
  async function unlock(course: Course) {
    if (unlocking || course.state !== 'READY' || course.done !== course.total) return;
    setUnlocking(true);
    setError(undefined);
    setErrorNeedsConsent(false);
    try {
      const result = await api.unlock(course.id);
      setCourses([result.course]);
      setSceneOpen(result.course.state === 'UNLOCKED');
    } catch (cause) {
      await load();
      const needsConsent = needsConsentRecheck(cause);
      setErrorNeedsConsent(needsConsent);
      setError(needsConsent ? consentRequiredMessage : '장면을 열지 못했어요. 단계 상태를 다시 확인해 주세요.');
    } finally { setUnlocking(false); }
  }
  const course = courseId && courses?.[0]?.id === courseId ? courses[0] : undefined;
  return <SkyBackdrop><SkyScrollView header={<BackHeader title={courseId ? '코스 상세' : '동네 코스'} />}
    contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={insets.top} />}>
    {courses === undefined && !error ? <View style={styles.center}><ActivityIndicator color={palette.primary} /><Text style={{ color: palette.label }}>코스를 불러오는 중</Text></View> : null}
    {error ? <View style={styles.center}><Text accessibilityRole="alert" style={{ color: palette.onErrorContainer }}>{error}</Text>
      <Pressable accessibilityRole="button" onPress={errorNeedsConsent ? recheckConsent : () => void refresh()} style={[styles.button, { backgroundColor: palette.primary }]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{errorNeedsConsent ? consentRecheckLabel : '다시 불러오기'}</Text>
      </Pressable></View> : null}
    {courses?.length === 0 ? <FloatingCard><Text style={{ color: palette.label }}>지금 공개된 코스가 없어요.</Text></FloatingCard> : null}
    {!courseId ? courses?.map(item => <FloatingCard key={item.id} onPress={() => router.push({ pathname: '/courses/[courseId]', params: { courseId: item.id } })}
      accessibilityLabel={`${item.title}, ${courseChipText(item)}, ${courseStateText(item)}`} accessibilityHint="코스 상세 보기" style={styles.card}>
      <Text selectable style={[styles.title, { color: palette.label }]}>{item.title}</Text>
      <Text style={{ color: palette.primary }}>{courseChipText(item)}</Text>
      <Text style={{ color: palette.secondaryLabel }}>{courseStateText(item)}</Text>
      <Text style={{ color: palette.primary }}>단계 보기 →</Text>
    </FloatingCard>) : null}
    {course ? <>
      <FloatingCard style={styles.card}>
        <Text selectable style={[styles.title, { color: palette.label }]}>{course.title}</Text>
        <Text selectable style={{ color: palette.secondaryLabel }}>{course.situationLabel}</Text>
        <Text accessibilityLiveRegion="polite" style={{ color: palette.label }}>{courseStateText(course)}</Text>
      </FloatingCard>
      {course.steps.map(step => <FloatingCard key={step.position} style={styles.step}>
        <View style={styles.stepCopy}>
          <Text selectable style={{ color: palette.label, fontWeight: '800' }}>{step.position}. {step.merchantName}</Text>
          <Text style={{ color: palette.secondaryLabel }}>{step.targetVisitCount}회 방문 · {step.pieceLabel}</Text>
          <Text style={{ color: step.done ? palette.primary : palette.secondaryLabel }}>{step.state === 'UNAVAILABLE' ? '지금은 이용할 수 없는 가게예요' : step.done ? '완료' : step.full ? '자리 없음' : '미완료'}</Text>
        </View>
        {step.done && step.artwork ? <Image source={{ uri: step.artwork.thumbnailDataUrl }} resizeMode="contain" accessible
          accessibilityLabel={`${step.merchantName} 코인`} style={styles.coin} /> : null}
      </FloatingCard>)}
      {course.state === 'READY' ? <Pressable accessibilityRole="button" disabled={unlocking} onPress={() => void unlock(course)} style={[styles.button, { backgroundColor: palette.primary }]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>{unlocking ? '장면 확인 중' : '장면 열기'}</Text>
      </Pressable> : null}
      {course.state === 'UNLOCKED' && !sceneOpen ? <Pressable accessibilityRole="button" onPress={() => setSceneOpen(true)} style={[styles.button, { backgroundColor: palette.primary }]}>
        <Text style={[styles.buttonText, { color: palette.onPrimary }]}>장면 보기</Text>
      </Pressable> : null}
      {course.state === 'UNLOCKED' && sceneOpen ? <FloatingCard style={styles.card}>
        <Text selectable style={[styles.title, { color: palette.label }]}>{course.sceneKey}</Text>
        <Text style={{ color: palette.secondaryLabel }}>가게 코인으로 채운 코스 장면</Text>
        <View style={styles.sceneCoins}>{course.steps.map(step => <View key={step.position} style={styles.sceneCoin}>
          {step.artwork ? <Image source={{ uri: step.artwork.thumbnailDataUrl }} resizeMode="contain" accessible
            accessibilityLabel={`${step.merchantName} 코인`} style={styles.coin} /> : <Text style={{ color: palette.secondaryLabel }}>코인 그림 없음</Text>}
          <Text selectable style={{ color: palette.label }}>{step.merchantName}</Text>
        </View>)}</View>
      </FloatingCard> : null}
    </> : null}
  </SkyScrollView></SkyBackdrop>;
}

const styles = StyleSheet.create({
  content: { gap: 14, padding: 20, paddingBottom: 48 },
  center: { alignItems: 'center', gap: 12, padding: 20 },
  card: { gap: 10 },
  title: { fontSize: 23, fontWeight: '900' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepCopy: { flex: 1, gap: 5 },
  coin: { width: 64, height: 64 },
  button: { alignItems: 'center', padding: 14, borderRadius: 14 },
  buttonText: { fontWeight: '900' },
  sceneCoins: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  sceneCoin: { alignItems: 'center', width: 90, gap: 5 },
});
